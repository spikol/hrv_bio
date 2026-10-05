"""Polar H10 -> HRV -> UNO Q LED matrix.

Runs on the UNO Q's Linux side (Qualcomm QRB2210, via Arduino App Lab) as
a Python App container. App Lab's app containers have no D-Bus/BlueZ
access, so this module does NOT talk to the Polar H10 over BLE directly —
that part runs as a separate, always-on process on the host
(host_service/ble_hr_service.py, see that folder's README for setup).
This module polls that service's local HTTP endpoint instead, computes
HRV metrics (hrv.py — a direct port of js/hrv/HRVProcessor.js) from the
RR intervals it returns, and renders them to the board's built-in 8x13
LED matrix via the Bridge RPC link to the MCU sketch (sketch/sketch.ino).

Not run against real hardware from here — no physical UNO Q or BLE
device available in this environment. The HRV math is the same logic
already verified end-to-end in the browser app; what's unverified is the
Bridge import path and the host service's exact behavior on this board's
Debian image. See the project README for what to check first if
something doesn't come up.

Usage: run this from Arduino App Lab as the project's Python App, with
host_service/ble_hr_service.py already running on the board's host (not
in a container) — see host_service/README.md.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import struct
import sys
import time
import urllib.error
import urllib.request
from collections import deque

from hrv import HRVMetrics, HRVProcessor
from led_matrix import render_bpm, render_heart

try:
    from arduino.app_utils import Bridge
except ImportError:
    Bridge = None
    print(
        "WARNING: could not import Bridge from arduino.app_utils. Run this inside "
        "Arduino App Lab's Python environment on the UNO Q, or fix this import to "
        "match whatever App Lab's generated template uses on your install — the "
        "exact module path wasn't independently confirmed. Continuing without the "
        "matrix (HRV numbers still print to the console).",
        file=sys.stderr,
    )

try:
    from arduino.app_bricks.web_ui import WebUI
except ImportError:
    WebUI = None
    print(
        "WARNING: could not import WebUI from arduino.app_bricks.web_ui. Run this "
        "inside Arduino App Lab with the arduino:web_ui brick added to app.yaml. "
        "Continuing without the live web plot.",
        file=sys.stderr,
    )

# Live plot (assets/index.html) — a rolling buffer of recent HRV samples,
# served over the WebUI brick's websocket like an Arduino Serial Plotter.
SAMPLES_MAX = 200
samples: deque[dict] = deque(maxlen=SAMPLES_MAX)
web_ui = WebUI() if WebUI is not None else None
if web_ui is not None:
    web_ui.expose_api("GET", "/samples", lambda: list(samples))

HR_SERVICE_PORT = int(os.environ.get("BLE_HR_SERVICE_PORT", "8765"))
HR_SERVICE_HOST = os.environ.get("BLE_HR_SERVICE_HOST")  # override auto-detected gateway
POLL_INTERVAL_SEC = 0.5
POLL_RETRY_SEC = 2.0

RENDER_HZ = 20
KICK_DECAY_PER_SEC = 6.0  # how fast each heartbeat's bright flash fades
BASELINE_MIN = 40  # ambient glow when stressed (calm score near 0)
BASELINE_MAX = 160  # ambient glow when calm (calm score near 1)
BPM_DISPLAY_EVERY_SEC = 5.0  # show the heart pulse for this long...
BPM_DISPLAY_FOR_SEC = 1.5  # ...then the BPM digits for this long


def _detect_host_gateway() -> str | None:
    """Reads this container's default route to find the Docker bridge
    gateway IP — where host_service/ble_hr_service.py listens, since
    App Lab's containers can't reach the Polar H10 over BLE directly
    (no D-Bus/BlueZ access; see that script's module docstring)."""
    try:
        with open("/proc/net/route") as f:
            next(f)  # header line
            for line in f:
                fields = line.split()
                if len(fields) < 3 or fields[1] != "00000000":
                    continue
                return socket.inet_ntoa(struct.pack("<L", int(fields[2], 16)))
    except OSError:
        return None
    return None


async def _fetch_hr_events(loop: asyncio.AbstractEventLoop, base_url: str) -> list[dict]:
    def _get() -> list[dict]:
        with urllib.request.urlopen(f"{base_url}/hr", timeout=2.0) as resp:
            return json.loads(resp.read())

    return await loop.run_in_executor(None, _get)


class DisplayState:
    """Shared between the HR polling loop and the render loop."""

    def __init__(self) -> None:
        self.kick = 0.0
        self.baseline_brightness = (BASELINE_MIN + BASELINE_MAX) // 2
        self.bpm = 0

    def on_metrics(self, metrics: HRVMetrics) -> None:
        self.kick = 1.0  # flash at full brightness on every real heartbeat
        if metrics.bpm is not None:
            self.bpm = round(metrics.bpm)
        if metrics.coherence is not None:
            # calm score 0..1 -> ambient glow: dim when stressed, bright when calm
            self.baseline_brightness = round(
                BASELINE_MIN + (BASELINE_MAX - BASELINE_MIN) * metrics.coherence
            )


async def render_loop(state: DisplayState) -> None:
    period = 1.0 / RENDER_HZ
    cycle_start = time.monotonic()
    cycle_length = BPM_DISPLAY_EVERY_SEC + BPM_DISPLAY_FOR_SEC

    while True:
        state.kick = max(0.0, state.kick - KICK_DECAY_PER_SEC * period)

        elapsed_in_cycle = (time.monotonic() - cycle_start) % cycle_length
        showing_bpm = elapsed_in_cycle >= BPM_DISPLAY_EVERY_SEC

        if showing_bpm and state.bpm > 0:
            frame = render_bpm(state.bpm)
        else:
            brightness = min(
                255,
                state.baseline_brightness + round(state.kick * (255 - state.baseline_brightness)),
            )
            frame = render_heart(brightness)

        if Bridge is not None:
            Bridge.call("draw", bytes(frame))

        await asyncio.sleep(period)


async def run() -> None:
    hrv = HRVProcessor(window_seconds=60.0)
    state = DisplayState()
    loop = asyncio.get_event_loop()

    host = HR_SERVICE_HOST or _detect_host_gateway()
    if host is None:
        raise RuntimeError(
            "Could not determine the host's gateway IP to reach "
            "host_service/ble_hr_service.py. Set the BLE_HR_SERVICE_HOST "
            "environment variable explicitly."
        )
    base_url = f"http://{host}:{HR_SERVICE_PORT}"
    print(f"Polling heart-rate events from {base_url} ...")

    asyncio.create_task(render_loop(state))

    while True:
        try:
            events = await _fetch_hr_events(loop, base_url)
        except (urllib.error.URLError, OSError) as exc:
            print(f"Waiting for ble_hr_service at {base_url} ({exc}) ...")
            await asyncio.sleep(POLL_RETRY_SEC)
            continue

        for event in events:
            rr_list_ms = event.get("rr_ms") or []
            if not rr_list_ms:
                continue
            metrics = None
            for rr_ms in rr_list_ms:
                metrics = hrv.add_rr(rr_ms)
                # One 'beat' message per heartbeat, not per poll tick, so the
                # web UI's cardiogram pulse lands on the actual beat instead
                # of being batched with whatever else arrived this tick.
                if web_ui is not None:
                    try:
                        web_ui.send_message(
                            "beat",
                            {"t": time.time(), "bpm": metrics.bpm, "coherence": metrics.coherence},
                        )
                    except Exception:
                        pass
            state.on_metrics(metrics)
            rmssd_txt = f"{metrics.rmssd:.1f}" if metrics.rmssd is not None else "-"
            calm_txt = f"{metrics.coherence * 100:.0f}%" if metrics.coherence is not None else "-"
            print(f"bpm={event.get('bpm')} rmssd={rmssd_txt}ms calm={calm_txt}")

            sample = {
                "t": time.time(),
                "bpm": metrics.bpm,
                "rmssd": metrics.rmssd,
                "sdnn": metrics.sdnn,
                "pnn50": metrics.pnn50,
                "coherence": metrics.coherence,
            }
            samples.append(sample)
            if web_ui is not None:
                try:
                    web_ui.send_message("sample", sample)
                except Exception:
                    pass  # do not break the HRV loop on a websocket hiccup

        await asyncio.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\nStopped.")
