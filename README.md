# HRV Biofeedback

**Live: [spikol.github.io/hrv_bio](https://spikol.github.io/hrv_bio/)**

A static HTML/CSS/JS app that reads live heart-rate variability from a BLE
chest strap and turns it into sound with [Tone.js](https://tonejs.github.io/).
No build step, no server-side code — just files served over HTTP, including
straight from GitHub Pages above (it's served over `https://`, so Web
Bluetooth works there too, not just on localhost).

See [notes.md](notes.md) for a walkthrough of how the code is organized
and how data flows from a heartbeat to a sound, and
[expansion_plan.md](expansion_plan.md) for what's needed to add EmotiBit
and BITalino support.

## Running it

Web Bluetooth requires `https://` or `localhost`, and only works in
Chromium-based browsers (Chrome, Edge). It will not work in Safari or Firefox.

Easiest: just open **[spikol.github.io/hrv_bio](https://spikol.github.io/hrv_bio/)**
in Chrome or Edge — it's `https://`, so no local setup needed.

To run it locally instead (e.g. while making changes):

```sh
cd /Users/zfp165/Documents/dev/hrv
python3 -m http.server 8000
```

Then open `http://localhost:8000` in Chrome or Edge.

1. Wake your Polar H10 (tap it or put it on — it won't advertise while idle).
2. Click **Connect**, pick it from the browser's device picker.
3. Click **Enable audio** (required — browsers block audio until a user
   gesture starts it). **Turn off audio** disposes the audio graph again.

No sensor on hand? Use the **Test signal** card instead of Connect — drag
the Relaxed/Stressed slider and click **Start test signal** to feed
synthetic heartbeats through the same HRV + audio pipeline. Connect and
the test signal are mutually exclusive (starting one disables the other)
so their beats never mix into the same HRV window.

## Architecture

```
index.html          entry point, loads Tone.js from CDN + js/main.js
css/style.css        UI styling

js/main.js            wires sensor -> HRV processor -> visualizer + audio together

js/sensors/
  SensorAdapter.js     base interface every device adapter implements
  PolarH10Adapter.js    real implementation: BLE Heart Rate Service (Polar H10)
  FutureAdapters.js     stubs for EmotiBit / BITalino (see below)
  registry.js           device list shown in the picker — add new devices here

js/hrv/HRVProcessor.js  rolling HRV metrics from a stream of RR intervals

js/visualizer/Tachogram.js      canvas beat-to-beat interval chart
js/visualizer/JellyfishOcean.js    pixel-art jellyfish scene: HRV metrics -> color/motion
js/visualizer/MoebiusJellyfish.js  same mapping, drawn as a single ink-and-wash jellyfish

js/audio/BiofeedbackEngine.js  Tone.js graph: HRV metrics -> sound

js/sim/RRSimulator.js  generates synthetic RR intervals (Relaxed/Stressed
                        slider) for testing the audio mapping with no
                        sensor attached
```

### Sensor adapters

Every device adapter extends `SensorAdapter` and dispatches the same events,
so the rest of the app (HRV math, visualizer, audio) never needs to know
which physical device is connected:

- `statuschange` — `{ status: 'disconnected'|'connecting'|'connected'|'error', message? }`
- `beat` — `{ rrMs, timestamp }`, once per detected heartbeat
- `hr` — `{ bpm, timestamp }`, device-reported instantaneous BPM
- `battery` — `{ level }`, 0–100, if the device exposes it

**Polar H10** (implemented) uses the standard BLE Heart Rate Service and
parses the RR-interval fields in the Heart Rate Measurement characteristic
— that's what makes real HRV possible, not just BPM. It also does a
one-shot battery level read if the Battery Service is available.

**EmotiBit** and **BITalino** (stubbed, not yet implemented) are next on
the list but don't map cleanly onto Web Bluetooth:
- EmotiBit streams multi-channel biosignals (including PPG for HR/HRV)
  over WiFi/OSC via its own tooling, not a fixed BLE GATT characteristic.
- BITalino boards typically pair over Bluetooth *Classic* (SPP), which
  Web Bluetooth (BLE-only) can't open directly.

Both will likely need a small local bridge (e.g. a WebSocket relay) rather
than a browser-only BLE connection. Their stub classes already implement
the `SensorAdapter` interface, so wiring them in later is a matter of
filling in `connect()`/`disconnect()`, not restructuring the app. To add a
device once its adapter exists, add one entry to `js/sensors/registry.js`.
See [expansion_plan.md](expansion_plan.md) for the detailed bridge design
for each.

### HRV metrics

Computed over a 60-second sliding window of RR intervals:

- **BPM** — 60000 / mean RR interval
- **SDNN** — standard deviation of RR intervals
- **RMSSD** — root mean square of successive RR differences
- **pNN50** — % of successive RR differences greater than 50ms
- **Calm score** — a simplified, relative "openness" indicator in `[0, 1]`:
  RMSSD relative to its own slow-moving baseline, squashed through a
  logistic curve. This is **not** the frequency-domain HeartMath coherence
  metric (which needs spectral/LF-power analysis) — it's a lightweight
  stand-in that still moves smoothly enough to drive audio in real time.

### Audio mapping (Tone.js)

- Every heartbeat triggers a short percussive pulse (`MembraneSynth`).
- A sustained pad crossfades between a calm chord voicing and a tense
  chord voicing based on the calm score.
- The pad's lowpass filter cutoff and reverb amount are driven by RMSSD
  — higher HRV opens the filter and adds space; lower HRV muffles and
  dries it out.

All mappings live in `BiofeedbackEngine.updateMapping()` — that's the
place to retune ranges, swap synths, or add new mapped parameters (e.g.
tempo from BPM, a breathing pacer, etc).

### Ocean visualization

The **Ocean** panel mirrors the audio mapping visually, in two swappable
styles (toggle in the panel), both reading the same live metrics:

- **Pixel (school)** — five flat-shaded pixel-art jellyfish.
- **Moebius (solo)** — one jellyfish drawn with flowing bezier curves,
  ink outlines, and a soft color wash, plus drifting bubbles — a loose
  nod to Mœbius's linework, the opposite technique from the blocky pixel
  style.

In both, jellyfish blend blue (calm) to red (stressed) based on the calm
score, continuously swim upward and fade out near the top edge, then
respawn fading in from below the bottom — faster and more often under
stress, slow and unhurried when calm. Their bells pulse in time with BPM,
with an extra synchronized kick on every real heartbeat, the same moment
the audio pulse fires. Both renderers are driven by the same
`handleBeat()` call in `main.js` as the audio, so switching styles never
falls out of sync.

## Known limitations

- Only tested against the standard BLE Heart Rate Service profile (Polar
  H10). Other BLE HR straps that follow the same GATT profile should work
  too, but haven't been tried.
- The BLE connection path itself needs a real device in hand to verify —
  it wasn't exercised end-to-end in the environment this was built in.
- "Calm score" is a relative, per-session heuristic, not a validated
  physiological coherence metric — don't use it for anything clinical.
