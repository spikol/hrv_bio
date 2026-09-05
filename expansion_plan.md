# Expansion plan: adding EmotiBit and BITalino

Both devices are stubbed out in [js/sensors/FutureAdapters.js](js/sensors/FutureAdapters.js)
and listed as "coming soon" in [js/sensors/registry.js](js/sensors/registry.js).
Neither can connect the way [PolarH10Adapter.js](js/sensors/PolarH10Adapter.js)
does — both need a local bridge process in front of the browser. This note
explains why, and what each bridge + adapter would need to do. Nothing here
is built yet; this is the plan for when hardware is in hand to test against.

## Why Web Bluetooth doesn't work for either

`PolarH10Adapter` works because the H10 speaks a **standard, adopted BLE
GATT profile** (Heart Rate Service, `0x180D`) that already hands over
computed RR intervals — `navigator.bluetooth.requestDevice()` in the
browser is all that's needed. Neither EmotiBit nor BITalino offers that:

- **EmotiBit** streams over **WiFi using OSC (Open Sound Control) over
  UDP**, not BLE at all. Browsers can't open raw UDP sockets or speak OSC
  — JS in a browser is limited to HTTP/WebSocket/WebRTC. This is a hard
  platform limit, not a documentation gap.
- **BITalino** (the common board) pairs over **Bluetooth *Classic*
  (SPP — Serial Port Profile)**, not BLE. Web Bluetooth is BLE-only by
  design; there is no browser API that can open a Classic SPP connection.
  (PLUX's newer "BITalino (r)evolution BLE" variant exists, but speaks a
  proprietary GATT protocol of its own, not a standard service — so even
  that variant needs PLUX's command spec, not a plug-and-play
  `requestDevice()` call.)

Second shared gap: both devices stream **raw waveform data**, not
computed heartbeats. The Polar H10's firmware already does peak detection
onboard and hands over clean RR intervals; EmotiBit (PPG) and BITalino
(ECG) don't — something downstream has to find the heartbeats in the
waveform itself.

## The common shape of the fix: a local bridge

For both devices, the plan is the same three-piece pattern:

```
device ──(device-specific transport)──▶ bridge process ──WebSocket──▶ XAdapter ──beat events──▶ (existing app, unchanged)
                                          (peak-detects the waveform,
                                           computes RR ms)
```

Because `HRVProcessor`, `Tachogram`, and `BiofeedbackEngine` only ever
consume the events defined on `SensorAdapter` (`beat`, `hr`, `battery`,
`statuschange`) — never anything BLE-specific — none of that code needs
to change for either device. The entire lift is: one bridge process, one
adapter class that opens a WebSocket instead of `navigator.bluetooth`.

## EmotiBit

**Hardware/network prerequisite:** EmotiBit on the same WiFi network as
whatever machine runs the bridge (it's configured onto WiFi via its own
setup flow, not paired directly to the browser).

**Bridge process** (Python or Node, run alongside the web server):
1. Listen for the EmotiBit's OSC/UDP stream. Use `python-osc` or the
   EmotiBit team's own `EmotiBit_DataParser` for the handshake/discovery
   rather than parsing the wire format from scratch.
2. Run peak detection on the PPG channel(s) — EmotiBit exposes infrared/
   red/green PPG as separate channels ("PI"/"PR"/"PG") — to find
   individual heartbeats, then compute ms between beats.
3. Re-publish each detected beat over a local WebSocket as JSON, e.g.
   `{"type":"beat","rrMs":812}`.

**Adapter:** `EmotiBitAdapter.connect()` opens
`new WebSocket('ws://localhost:PORT')`, and on each message dispatches
the same `beat`/`hr`/`battery`/`statuschange` events `PolarH10Adapter`
already dispatches.

**Caveat:** PPG-derived RR is more motion-sensitive and generally noisier
than a chest strap's ECG-derived RR, so HRV numbers will likely be less
clean than the H10's, especially during movement.

## BITalino

**Hardware prerequisite:** BITalino with its **ECG sensor module**
actually plugged into the acquisition channel, with electrodes placed
correctly — BITalino is modular, so heart data only exists in the stream
if the ECG probe is the one attached.

**Pairing prerequisite:** unlike BLE's on-page picker, Classic SPP
devices need to be paired at the **OS level** first, which then exposes a
serial port/device the bridge process reads from.

**Bridge process:**
1. Open the SPP connection and speak BITalino's frame protocol — use
   PLUX's own `bitalino` Python package (`pip install bitalino`), which
   already handles connect / start-acquisition / binary frame decoding,
   rather than reimplementing SPP framing from scratch.
2. Run R-peak/QRS detection on the ECG channel to find each heartbeat,
   then compute ms between beats (Pan-Tompkins-style detection; libraries
   like `neurokit2` implement this) — the ECG equivalent of the PPG peak
   detection EmotiBit's bridge needs.
3. Re-publish each detected beat over a local WebSocket, same JSON shape:
   `{"type":"beat","rrMs":812}`.

**Adapter:** `BitalinoAdapter.connect()` opens the same kind of
`WebSocket` and dispatches the same event set.

**Caveat:** this one leans more heavily on the bridge than EmotiBit does,
since even *discovering* the device requires OS-level Bluetooth pairing
(no browser picker at all involved). Worth weighing whether running a
background bridge process for everyday use is worth it, versus reserving
BITalino for signals it's better suited to (EDA, EMG) alongside the
Polar H10 handling HR/HRV.

## Status

Both on hold until hardware is available to build and test against. When
ready: build the bridge first (verifiable independently via its own
WebSocket test client), then the adapter (drop-in replacement for the
stub in `FutureAdapters.js`, flip `available: true` in `registry.js`).
