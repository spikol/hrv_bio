# Polar H10 → UNO Q LED matrix

Connects a Polar H10 directly to an [Arduino UNO Q](https://docs.arduino.cc/)
over Bluetooth and displays live heartbeats and HRV on the board's
built-in 8×13 LED matrix — no browser, no phone, no laptop needed once
it's running.

**Not tested on real hardware.** This was built without a physical UNO Q
or Polar H10 in hand (verified against Arduino's own published example
code instead — see [Verification status](#verification-status) below).
Treat it as a strong starting point, not a known-working build.

## How it fits together

The UNO Q is two processors on one board: a Linux-capable Qualcomm
Dragonwing QRB2210, and a real-time STM32U585 microcontroller, bridged
by Arduino's **Bridge** RPC library. That maps naturally onto this
project's existing architecture:

```
Polar H10 ──BLE──▶ python/polar_hrv_display.py ──Bridge.call("draw", frame)──▶ sketch/sketch.ino ──▶ 8x13 LED matrix
            (Linux side, Qualcomm QRB2210)         (MCU side, STM32U585)
```

- **`python/polar_hrv_display.py`** does everything smart: connects to
  the Polar H10's standard BLE Heart Rate Service with
  [`bleak`](https://github.com/hbldh/bleak) (same GATT service/
  characteristic the browser app's
  [`PolarH10Adapter.js`](../js/sensors/PolarH10Adapter.js) uses — same
  flags-byte parsing, ported line for line), computes the same rolling
  HRV metrics as [`HRVProcessor.js`](../js/hrv/HRVProcessor.js) (ported
  to [`hrv.py`](python/hrv.py)), and renders 104-byte grayscale frames
  ([`led_matrix.py`](python/led_matrix.py)).
- **`sketch/sketch.ino`** is a deliberately dumb ~20-line display
  driver: it just blits whatever frame Bridge hands it to the matrix.
  Same separation of concerns as the browser app's
  `SensorAdapter` / visualizer split — one side holds logic, the other
  just renders.

### What's on the display

- A pulsing heart icon: brightness flashes to full on every real
  heartbeat and decays, so the flash rate *is* your heart rate.
- Ambient glow brightness between beats reflects the calm score (RMSSD
  relative to its own baseline, same simplified metric as the browser
  app — see `HRVProcessor.js`'s docstring for why it's not a clinical
  coherence measure): brighter when calm, dimmer when stressed. The LED
  matrix is single-color, so this is the brightness analog of the
  browser app's blue↔red jellyfish color mapping.
- Every ~5 seconds, a 1.5s readout of your current BPM as two digits.

## Setup

1. Open **Arduino App Lab** and create a new **Sketch + Python App**
   project on your UNO Q (this generates the correct boilerplate/imports
   for your App Lab version — see the caveats below on why that matters
   more than usual here).
2. Replace the generated sketch with [`sketch/sketch.ino`](sketch/sketch.ino).
3. Copy [`python/hrv.py`](python/hrv.py),
   [`python/led_matrix.py`](python/led_matrix.py), and
   [`python/polar_hrv_display.py`](python/polar_hrv_display.py) into the
   project's Python app folder.
4. In that Python environment: `pip install -r python/requirements.txt`
   (just `bleak`).
5. Wake the Polar H10 (tap it / put it on — it won't advertise while
   idle) and make sure it isn't already connected to another app (Polar
   Flow, the browser app, etc. — BLE devices generally only hold one
   connection at a time).
6. Run `polar_hrv_display.py`. It scans for a device advertising as
   "Polar H10" (or the standard Heart Rate Service), connects, and
   starts streaming to the matrix.

No real sensor yet? Run [`python/test_rendering.py`](python/test_rendering.py)
instead — it exercises the HRV math and frame rendering with a synthetic
RR sequence and prints an ASCII preview of the heart icon and a sample
BPM readout, no BLE or Bridge required. This is what was actually run to
verify this code before handing it to you (see below).

## Verification status

What's verified, and how:

- **BLE parsing + HRV math** — logically identical to the browser app's
  already-verified `PolarH10Adapter.js` + `HRVProcessor.js`; re-verified
  here independently by running `test_rendering.py`, which feeds a
  synthetic 12-beat RR sequence through `hrv.py` and asserts sane output
  (73.6 bpm, RMSSD 27.4ms, calm score 0.95 for a smooth sequence).
- **Frame rendering** — `test_rendering.py` asserts the heart bitmap and
  "72" digit frames have exactly the expected number of lit pixels, and
  prints an ASCII preview confirming the shapes are legible.
- **Everything hardware-specific is unverified** — no physical board was
  available to test against. Specifically, double-check these against
  Arduino's own docs/generated templates if something doesn't work:
  - The `Bridge` import in `polar_hrv_display.py`
    (`from arduino.app_utils import Bridge`) — found in Arduino's
    published example diffs, not independently confirmed.
  - Whether `sketch.ino`'s `loop()` needs an explicit Bridge pump/poll
    call, or whether RPC dispatch is purely interrupt-driven as written.
  - The matrix's row/col orientation — `led_matrix.py` assumes 8 rows ×
    13 columns, row-major; if the heart renders sideways or mirrored,
    flip `ROWS`/`COLS` there (nowhere else needs to change).
  - Whether `bleak` needs manual installation in App Lab's Python
    environment, or ships preinstalled.

If you hit a wall on any of these, the fix is almost always "copy
App Lab's auto-generated boilerplate for that one piece, keep this
project's logic." Let me know what you find and I'll fold the correction
back in.
