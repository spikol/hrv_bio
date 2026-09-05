# Code notes

Walkthrough of what each file does and how data flows through the app.
(See [README.md](README.md) for how to run it.)

## Data flow, end to end

```
BLE device / test-signal slider
        │  rrMs (ms between beats)
        ▼
  SensorAdapter subclass  ──beat/hr/battery/statuschange events──┐
  (or RRSimulator, same shape)                                    │
                                                                    ▼
                                                            js/main.js
                                                          (handleBeat)
                                                                    │
                                    ┌───────────────────────────────┼───────────────────────┐
                                    ▼                                ▼                        ▼
                            HRVProcessor.addRR()             Tachogram.push()          BiofeedbackEngine
                            → { bpm, sdnn, rmssd,               (canvas chart)          .pulse() (per beat)
                                 pnn50, coherence }                                      .updateMapping(metrics)
                                    │                                                          │
                                    ▼                                                          ▼
                            metrics-card DOM text                                     Tone.js audio graph
```

Everything downstream of a beat — HRV math, the chart, the audio — doesn't
care whether that beat came from a real Polar H10 or the test-signal
simulator. Both just call the same `handleBeat(rrMs, timestamp)` in
`main.js`. That's the one seam that matters in this codebase: anything
that can produce an RR interval can drive the whole app.

## `js/sensors/` — where beats come from

**`SensorAdapter.js`** — the base class. Defines the contract every device
must follow: a `connect()`/`disconnect()` pair, an `isConnected` getter,
and four events dispatched via the standard `EventTarget` API (`beat`,
`hr`, `battery`, `statuschange`). Nothing in here talks to hardware —
it's purely the shape adapters must fill in.

**`PolarH10Adapter.js`** — the only real implementation right now. Uses
`navigator.bluetooth.requestDevice()` filtered to the standard BLE Heart
Rate Service (`0x180D`), then subscribes to notifications on the Heart
Rate Measurement characteristic (`0x2A37`). The parsing in `_onHrValue()`
follows the Bluetooth SIG spec byte-for-byte:

- byte 0 is a flags bitfield: bit 0 says whether BPM is 8-bit or 16-bit,
  bit 3 says an "energy expended" field is present (skipped, unused),
  bit 4 says RR-interval fields are present.
- BPM is read first (`hr` event).
- Then, if present, each remaining pair of bytes is one RR interval, sent
  in units of 1/1024 second — converted to milliseconds and dispatched as
  a separate `beat` event per interval (a single notification can contain
  more than one beat if the radio was slow to report).

Also does a one-shot read of the Battery Service if the device exposes
it, and listens for `gattserverdisconnected` so an unplugged/out-of-range
strap correctly flips the UI back to "disconnected" instead of hanging.

**`FutureAdapters.js`** — stub classes for EmotiBit and BITalino. Both
extend `SensorAdapter` so they already fit the app's shape, but their
`connect()` just throws with an explanation. Reason: neither device
exposes a fixed BLE GATT heart-rate profile the way Polar does —
EmotiBit streams over WiFi/OSC, BITalino typically pairs over Bluetooth
*Classic* (SPP), which Web Bluetooth (BLE-only) can't open. Real support
will need a small local bridge process on the other end; the browser-side
adapter shape here is ready for that once it exists.

**`registry.js`** — the list the device `<select>` is built from
(`{ id, label, Adapter, available }`). Adding a working device later is
one line here plus its adapter class — `main.js` never changes.

## `js/sim/RRSimulator.js` — synthetic beats for testing without hardware

Generates RR intervals on its own schedule (using `setTimeout`, rescheduling
itself after each beat using that beat's own interval as the delay — same
timing shape a real heart would produce) so you can hear the audio mapping
without a sensor attached.

Driven by one parameter, `stress` in `[0, 1]`, set from the "Relaxed /
Stressed" slider. It linearly interpolates two profiles:

| | mean RR (rate) | jitter (variability) |
|---|---|---|
| relaxed (`stress = 0`) | 1000ms (~60bpm) | ±70ms |
| stressed (`stress = 1`) | 480ms (~125bpm) | ±8ms |

This models a real, well-known physiological pattern — sympathetic
activation raises heart rate *and* suppresses beat-to-beat variability —
so sliding toward "stressed" should visibly drop RMSSD/the calm score and
speed up the pulse, and sliding toward "relaxed" does the opposite. The
jitter itself is Gaussian-ish, approximated by summing six `Math.random()`
calls (a cheap Central Limit Theorem trick — no need for a real
Box-Muller transform at this scale).

## `js/hrv/HRVProcessor.js` — turning RR intervals into HRV metrics

Keeps a sliding window (default 60s) of `{ rrMs, t }` pairs. Every call to
`addRR()` trims anything older than the window, recomputes all metrics
from what's left, and emits a `metrics` event (not currently listened to
outside `main.js`'s direct return-value usage, but kept as an event for
anything else that might want to subscribe later).

Metrics computed, standard formulas:
- **BPM** = 60000 / mean(RR)
- **SDNN** = population standard deviation of the RR intervals in the window
- **RMSSD** = root-mean-square of successive RR differences
- **pNN50** = % of successive differences whose absolute value exceeds 50ms

Plus one non-standard one:

- **coherence** (labeled "Calm score" in the UI) — RMSSD relative to its
  own exponentially-smoothed baseline (`baseline = 0.95·baseline +
  0.05·rmssd`), passed through a logistic curve centered on that
  baseline. It moves smoothly frame to frame (good for driving audio
  parameters without zippering) and trends up when HRV rises relative to
  *your own recent history*. It is explicitly **not** the frequency-domain
  HeartMath coherence metric — that requires spectral/LF-power analysis
  this app doesn't do. Don't read anything clinical into it.

## `js/visualizer/Tachogram.js` — the live chart

A plain `<canvas>` line chart, no charting library. Keeps the last
`maxPoints` (120) RR values in an array, autoscales the y-axis to
`[min-20, max+20]` of whatever's currently in the window, and redraws on
every `push()`. `clear()` empties it — called whenever `main.js` starts a
fresh connection or test run so old data doesn't bleed into a new session.
Handles `devicePixelRatio` on resize so it stays sharp on retina displays.

## `js/audio/BiofeedbackEngine.js` — HRV metrics → Tone.js sound

Two independent things happen here, both starting only after `start()`
is called (must run from a user gesture — browsers block audio otherwise,
hence the "Enable audio" button):

1. **Per-beat pulse** — `pulse()` fires a `Tone.MembraneSynth` hit
   (`triggerAttackRelease('C2', '16n')`) on every beat, gated by
   `pulseEnabled`. This is the audible "heartbeat."

2. **Continuous pad** — two `Tone.PolySynth` voices are started once and
   left sustaining indefinitely (`triggerAttack`, no matching release
   until `stop()`/`setPadEnabled(false)`): a "calm" chord (`C4 E4 G4 D5`,
   an open add9 voicing) and a "tense" chord (`C4 D#4 F#4 A#4`, a
   deliberately unresolved cluster). Each runs through its own
   `Tone.Gain` node, both summed into one `mix` gain, then through a
   shared `Tone.Filter` (lowpass) and `Tone.Reverb` before the master
   output.

   `updateMapping({ rmssd, coherence })`, called after every beat, moves
   four `AudioParam`-backed values with a 1.5s ramp (so changes glide
   instead of stepping):
   - `filter.frequency` — 300Hz–4000Hz, driven by RMSSD normalized against
     an assumed 0–120ms practical range. Higher HRV → brighter/opener.
   - `reverb.wet` — 0.15–0.65, same RMSSD normalization. Higher HRV → more
     spacious.
   - `calmGain.gain` / `tenseGain.gain` — driven by the coherence/calm
     score, crossfading between the two chords. Higher calm score → more
     of the consonant chord in the mix, less of the dissonant one.

`stop()` releases both chords and disposes every node in the graph
(filter, reverb, gains, synths, master), so `start()` can be called again
later to rebuild a clean graph rather than accumulating disposed nodes.

`setMasterVolumeDb()` ramps a master `Tone.Gain` (all audio routes through
it) rather than touching `Tone.Destination` directly, so the volume
slider affects only this app's output.

If you want to change how HRV maps to sound, `updateMapping()` is the one
function to edit — e.g. tie tempo/an arpeggiator to BPM, add a breathing
pacer, or swap the chords/synth types.

## `js/main.js` — wiring

No logic of its own beyond DOM plumbing and the mutual-exclusion rule
below; everything else is delegated to the modules above.

- Builds the device `<select>` from `SENSOR_REGISTRY`.
- `connectBtn` instantiates the chosen adapter class, wires its events
  (`wireAdapter()`), and calls `connect()`.
- Real sensor beats and simulator beats both funnel through the shared
  `handleBeat(rrMs, timestamp)`, which is the only place that touches
  `HRVProcessor`, `Tachogram`, and `BiofeedbackEngine` per beat.
- `updateConnectAvailability()` keeps "Connect" and "Start test signal"
  mutually exclusive — running both at once would interleave two beat
  sources into one HRV window, which is never useful, so starting one
  disables the other's start control.
- Audio enable/disable buttons and the pulse/pad checkboxes and volume
  slider just forward to the corresponding `BiofeedbackEngine` methods.
- The stress slider forwards to `RRSimulator.setStress()` on every
  `input` event, so you can drag it live while the test signal runs and
  hear the audio react in real time.
