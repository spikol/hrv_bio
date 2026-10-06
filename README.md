# HRV Biofeedback

**Live: [spikol.github.io/hrv_bio](https://spikol.github.io/hrv_bio/)**

This project turns live heart-rate variability (HRV) from a Polar H10
chest strap into sound and visuals, so you can hear and see yourself
relax. Open the link above in Chrome or Edge, connect your strap, and
it starts within seconds. You don't need to install anything.

## Pick a way to run it

| You want… | Use | Hardware |
| --- | --- | --- |
| Sound and visuals in a browser | The web app (this folder) | Polar H10 + Chrome/Edge, or no sensor (test signal) |
| A standalone display with no computer attached | [arduino-uno-q/](arduino-uno-q/) | Polar H10 + Arduino UNO Q |
| The same, plus a live plot and CSV export in a browser | [arduino_uno_q_v2/](arduino_uno_q_v2/1643267699__dXNlcjpocnNfMDE/) | Polar H10 + Arduino UNO Q running App Lab |

The rest of this README covers the web app. Each Arduino folder has its
own README.

For more detail, see:

- [notes.md](notes.md): how the code is organized, and how a heartbeat
  becomes a sound
- [expansion_plan.md](expansion_plan.md): how to add EmotiBit and
  BITalino support

## Run the web app

Web Bluetooth only works in Chromium-based browsers (Chrome, Edge), and
only over `https://` or `localhost`. It does not work in Safari or
Firefox.

**Hosted:** open [spikol.github.io/hrv_bio](https://spikol.github.io/hrv_bio/).
It is served over `https://`, so it needs no setup.

**Local** (when you are changing the code):

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000` in Chrome or Edge.

1. Wake your Polar H10 by tapping it or putting it on. It won't
   advertise while idle.
2. Click **Connect** and pick the strap in the browser's device picker.
3. Click **Enable audio**. Browsers block sound until you click
   something. **Turn off audio** stops it again.

**No sensor?** Use the **Test signal** card instead. Set the
Relaxed/Stressed slider and click **Start test signal**. This feeds
synthetic heartbeats through the same HRV and audio pipeline. You can run
either the sensor or the test signal, but not both, so their beats never
mix.

## How the web app works

Every heartbeat flows through one pipeline: sensor → HRV processor →
audio + visuals. There is no build step and no server-side code.

```text
index.html          entry point, loads Tone.js from CDN + js/main.js
css/style.css       UI styling

js/main.js          wires sensor -> HRV processor -> visualizer + audio

js/sensors/
  SensorAdapter.js    base interface every device adapter implements
  PolarH10Adapter.js  BLE Heart Rate Service (Polar H10)
  FutureAdapters.js   stubs for EmotiBit / BITalino
  registry.js         device list shown in the picker; add new devices here

js/hrv/HRVProcessor.js  rolling HRV metrics from a stream of RR intervals

js/visualizer/Tachogram.js         beat-to-beat interval chart
js/visualizer/JellyfishOcean.js    pixel-art jellyfish school
js/visualizer/MoebiusJellyfish.js  single ink-and-wash jellyfish

js/audio/BiofeedbackEngine.js  Tone.js graph: HRV metrics -> sound

js/sim/RRSimulator.js  synthetic RR intervals for testing with no sensor
```

### Any sensor can plug in through one interface

Every device adapter extends `SensorAdapter` and fires the same events.
As a result, the HRV math, visuals, and audio don't depend on which
device is connected.

- `statuschange`: `{ status: 'disconnected'|'connecting'|'connected'|'error', message? }`
- `beat`: `{ rrMs, timestamp }`, once per heartbeat
- `hr`: `{ bpm, timestamp }`, the BPM reported by the device
- `battery`: `{ level }`, 0–100, if the device reports it

**Polar H10 works today.** It uses the standard BLE Heart Rate Service.
The adapter reads the RR intervals (the time between beats), which is
what makes real HRV possible, not just BPM.

**EmotiBit and BITalino are stubs.** Neither fits Web Bluetooth. EmotiBit
streams over WiFi/OSC, and BITalino pairs over Bluetooth Classic, which
browsers can't open. Both will need a small local bridge, such as a
WebSocket relay. Their stubs already implement `SensorAdapter`, so adding
either means filling in `connect()`/`disconnect()` and adding one entry
to `registry.js`. [expansion_plan.md](expansion_plan.md) describes each
bridge.

### Five metrics over a 60-second window

- **BPM**: 60000 ÷ mean RR interval
- **SDNN**: standard deviation of RR intervals
- **RMSSD**: root mean square of successive RR differences
- **pNN50**: % of successive RR differences over 50 ms
- **Calm score** (0–1): RMSSD compared with its own slow-moving
  baseline, then smoothed onto a 0–1 curve. It is a lightweight stand-in
  for HeartMath coherence, not the real thing (which needs spectral
  analysis).

### Higher HRV sounds calmer and more open

- Each heartbeat triggers a short drum pulse (`MembraneSynth`).
- A sustained pad crossfades from a tense chord to a calm chord as the
  calm score rises.
- RMSSD drives the pad's filter and reverb. With high HRV the sound is
  bright and spacious. With low HRV it is muffled and dry.

To change how HRV maps to sound, edit
`BiofeedbackEngine.updateMapping()`. That is where you would add new
mappings, such as tempo from BPM or a breathing pacer.

### Jellyfish show the same state as the sound

The **Ocean** panel has two styles, which you switch in the panel:

- **Pixel (school)**: five flat-shaded pixel-art jellyfish
- **Moebius (solo)**: one jellyfish with flowing ink lines, a soft color
  wash, and drifting bubbles

In both styles, jellyfish shift from blue (calm) to red (stressed). They
rise and respawn faster under stress and drift slowly when you're calm.
Their bells pulse with your BPM and kick on every real heartbeat. Audio
and visuals share the same `handleBeat()` call in `main.js`, so they
stay in sync.

## Known limitations

- **Only tested with the Polar H10.** Other straps that use the standard
  BLE Heart Rate profile should work but haven't been tried.
- **The calm score is a per-session heuristic.** It has not been
  validated, so don't use it for anything clinical.
- **The Arduino versions have not been run on real hardware.** See each
  folder's README for what still needs checking.

## Known issues to fix

- **v1 probably can't find the strap.** In
  [arduino-uno-q/python/polar_hrv_display.py](arduino-uno-q/python/polar_hrv_display.py),
  the Heart Rate service and characteristic UUIDs end in `...34fa`. The
  standard Bluetooth UUIDs end in `...34fb`. v2 uses the correct value.
- **v2 only connects to one specific strap.**
  [ble_hr_service.py](arduino_uno_q_v2/1643267699__dXNlcjpocnNfMDE/host_service/ble_hr_service.py)
  looks for the exact device name `"Polar H10 434D7326"`. To use another
  strap, change `DEVICE_NAME_HINT` to `"Polar H10"`.
- **v2's README is empty.** Setup steps currently live in
  [host_service/README.md](arduino_uno_q_v2/1643267699__dXNlcjpocnNfMDE/host_service/README.md).
