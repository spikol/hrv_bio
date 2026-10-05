"""Polar H10 -> HRV -> UNO Q LED matrix.

Runs on the UNO Q's Linux side (Qualcomm QRB2210, via Arduino App Lab).
Connects directly to the Polar H10 over BLE using the same standard
Heart Rate Service the browser app uses (js/sensors/PolarH10Adapter.js),
computes the same HRV metrics (hrv.py — a direct port of
js/hrv/HRVProcessor.js), and renders them to the board's built-in 8x13
LED matrix via the Bridge RPC link to the MCU sketch (sketch/sketch.ino).

Not run against real hardware from here — no physical UNO Q or BLE
device available in this environment. The BLE parsing and HRV math are
the same logic already verified end-to-end in the browser app; what's
unverified is the Bridge import path and bleak's exact scan/connect
behavior on this board's Debian image. See the project README for what
to check first if something doesn't come up.

Usage: run this from Arduino App Lab as the project's Python App, or
directly with `python3 polar_hrv_display.py` once `pip install -r
requirements.txt` has been run in that environment.
"""

from __future__ import annotations

import asyncio
import sys
import time

from bleak import BleakClient, BleakScanner

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

HR_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fa"
HR_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fa"
DEVICE_NAME_HINT = "Polar H10"  # substring match used when scanning

RENDER_HZ = 20
KICK_DECAY_PER_SEC = 6.0  # how fast each heartbeat's bright flash fades
BASELINE_MIN = 40  # ambient glow when stressed (calm score near 0)
BASELINE_MAX = 160  # ambient glow when calm (calm score near 1)
BPM_DISPLAY_EVERY_SEC = 5.0  # show the heart pulse for this long...
BPM_DISPLAY_FOR_SEC = 1.5  # ...then the BPM digits for this long


def parse_hr_measurement(data: bytes) -> tuple[int, list[float]]:
    """Same parsing as PolarH10Adapter.js's _onHrValue(), ported to Python:
    BLE Heart Rate Measurement characteristic (0x2A37), flags byte then
    BPM then optional energy-expended then optional RR intervals in units
    of 1/1024 second."""
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


class DisplayState:
    """Shared between the BLE notification handler and the render loop."""

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

    print(f"Scanning for a BLE device matching {DEVICE_NAME_HINT!r} ...")
    device = await BleakScanner.find_device_by_filter(
        lambda d, adv: (d.name or "").find(DEVICE_NAME_HINT) != -1
        or HR_SERVICE_UUID in (adv.service_uuids or []),
        timeout=20.0,
    )
    if device is None:
        raise RuntimeError(
            f"No device matching {DEVICE_NAME_HINT!r} found within 20s. Wake the "
            "Polar H10 (tap it / put it on) and make sure it isn't already "
            "connected to another app (e.g. Polar Flow)."
        )
    print(f"Found {device.name} ({device.address}), connecting...")

    def on_hr_notify(_sender, data: bytearray) -> None:
        bpm, rr_list_ms = parse_hr_measurement(bytes(data))
        if not rr_list_ms:
            return
        metrics = None
        for rr_ms in rr_list_ms:
            metrics = hrv.add_rr(rr_ms)
        state.on_metrics(metrics)
        rmssd_txt = f"{metrics.rmssd:.1f}" if metrics.rmssd is not None else "-"
        calm_txt = f"{metrics.coherence * 100:.0f}%" if metrics.coherence is not None else "-"
        print(f"bpm={bpm} rmssd={rmssd_txt}ms calm={calm_txt}")

    async with BleakClient(device) as client:
        await client.start_notify(HR_MEASUREMENT_UUID, on_hr_notify)
        print("Connected. Streaming heart rate -> LED matrix. Ctrl+C to stop.")
        await render_loop(state)


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\nStopped.")
