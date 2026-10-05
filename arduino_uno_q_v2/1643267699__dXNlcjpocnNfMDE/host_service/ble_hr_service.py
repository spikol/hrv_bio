#!/usr/bin/env python3
"""Standalone BLE -> HTTP bridge for the Polar H10.

Run this directly on the UNO Q's Debian host — NOT inside an Arduino App
container. App Lab's Python app containers have no D-Bus/BlueZ access, so
`bleak` can never reach the Polar H10 from python/polar_hrv_display.py
itself. This script runs outside that sandbox, where D-Bus/BlueZ work
natively, and republishes the parsed heart-rate stream over plain HTTP so
the containerized app can poll it instead. See README.md in this folder
for the systemd unit that keeps it running.

Endpoints:
    GET /hr      -> [{"bpm": int, "rr_ms": [float, ...], "t": float}, ...]
                    (returns everything received since the last poll, then
                    clears the buffer)
    GET /health  -> {"connected": bool, "device": str | null}
"""

from __future__ import annotations

import asyncio
import json
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from bleak import BleakClient, BleakScanner

HR_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb"
DEVICE_NAME_HINT = "Polar H10 434D7326"

HTTP_HOST = "0.0.0.0"
HTTP_PORT = 8765
SCAN_TIMEOUT_SEC = 20.0
RECONNECT_DELAY_SEC = 5.0

_events: "queue.SimpleQueue[dict]" = queue.SimpleQueue()
_status = {"connected": False, "device": None}
_status_lock = threading.Lock()


def parse_hr_measurement(data: bytes) -> tuple[int, list[float]]:
    """BLE Heart Rate Measurement characteristic (0x2A37) parsing.

    Duplicated from python/polar_hrv_display.py on purpose: this script
    runs in a separate process/environment from the App Lab container and
    has no import path back into python/."""
    flags = data[0]
    hr_format_16bit = bool(flags & 0x01)
    energy_expended_present = bool(flags & 0x08)
    rr_present = bool(flags & 0x10)

    index = 1
    if hr_format_16bit:
        bpm = int.from_bytes(data[index : index + 2], "little")
        index += 2
    else:
        bpm = data[index]
        index += 1

    if energy_expended_present:
        index += 2

    rr_list_ms: list[float] = []
    if rr_present:
        while index + 1 < len(data):
            rr_units = int.from_bytes(data[index : index + 2], "little")
            rr_list_ms.append((rr_units / 1024.0) * 1000.0)
            index += 2

    return bpm, rr_list_ms


def _set_status(connected: bool, device: str | None) -> None:
    with _status_lock:
        _status["connected"] = connected
        _status["device"] = device


class HRRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        pass  # quiet; use /health and the service's own prints for diagnostics

    def _write_json(self, payload: object) -> None:
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/hr":
            drained = []
            while True:
                try:
                    drained.append(_events.get_nowait())
                except queue.Empty:
                    break
            self._write_json(drained)
        elif self.path == "/health":
            with _status_lock:
                self._write_json(dict(_status))
        else:
            self.send_response(404)
            self.end_headers()


def _run_http_server() -> None:
    server = ThreadingHTTPServer((HTTP_HOST, HTTP_PORT), HRRequestHandler)
    server.serve_forever()


async def _connect_and_stream() -> None:
    print(f"Scanning for a BLE device matching {DEVICE_NAME_HINT!r} ...")
    device = await BleakScanner.find_device_by_filter(
        lambda d, adv: (d.name or "").find(DEVICE_NAME_HINT) != -1
        or HR_SERVICE_UUID in (adv.service_uuids or []),
        timeout=SCAN_TIMEOUT_SEC,
    )
    if device is None:
        print(f"No device matching {DEVICE_NAME_HINT!r} found within {SCAN_TIMEOUT_SEC:.0f}s.")
        return

    print(f"Found {device.name} ({device.address}), connecting...")

    def on_hr_notify(_sender, data: bytearray) -> None:
        bpm, rr_list_ms = parse_hr_measurement(bytes(data))
        _events.put_nowait({"bpm": bpm, "rr_ms": rr_list_ms, "t": time.time()})

    async with BleakClient(device) as client:
        await client.start_notify(HR_MEASUREMENT_UUID, on_hr_notify)
        _set_status(True, device.name)
        print(f"Connected. Streaming heart rate over HTTP :{HTTP_PORT}/hr")
        while client.is_connected:
            await asyncio.sleep(1.0)


async def _ble_loop() -> None:
    while True:
        try:
            await _connect_and_stream()
        except Exception as exc:
            print(f"BLE session ended: {exc}")
        _set_status(False, None)
        print(f"Reconnecting in {RECONNECT_DELAY_SEC:.0f}s ...")
        await asyncio.sleep(RECONNECT_DELAY_SEC)


def main() -> None:
    threading.Thread(target=_run_http_server, daemon=True).start()
    print(f"HTTP server listening on {HTTP_HOST}:{HTTP_PORT}")
    try:
        asyncio.run(_ble_loop())
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
