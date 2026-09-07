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
                    ┌───────────────────────┬───────────────────────┼───────────────────────┐
                    ▼                       ▼                        ▼                        ▼
            HRVProcessor.addRR()     Tachogram.push()          BiofeedbackEngine        JellyfishOcean +
            → { bpm, sdnn, rmssd,       (canvas chart)          .pulse() (per beat)     MoebiusJellyfish
                 pnn50, coherence }                              .updateMapping()        .updateMetrics()
                    │                                                  │                 .pulse() (per beat)
                    ▼                                                  ▼                        │
            metrics-card DOM text                            Tone.js audio graph                ▼
                                                                                    two canvases, one shown
                                                                                    at a time via a style toggle
```

Everything downstream of a beat — HRV math, the chart, the audio, both
jellyfish renderers — doesn't care whether that beat came from a real
Polar H10 or the test-signal simulator. All of it just gets called from
the same `handleBeat(rrMs, timestamp)` in `main.js`. That's the one seam
that matters in this codebase: anything that can produce an RR interval
can drive the whole app.

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

## `js/visualizer/JellyfishOcean.js` — HRV metrics → a canvas jellyfish scene

Same idea as the audio engine, drawn instead of played, so the two always
agree with each other since both read the same metrics.

**Rendering style** — deliberately pixel-art/8-bit rather than smooth
canvas art: `BELL_SPRITE` is a small hand-authored grid (9 cols × 6 rows,
values `0` empty / `1` body / `2` outline / `3` highlight) drawn as flat
`fillRect` blocks, no curves or gradients anywhere. `_drawJelly()` walks
the grid and stamps one block per non-zero cell; tentacles are the same
idea, one block per segment hanging from the rim's outline columns
(`TENTACLE_COLS`). The sea background is flat horizontal color bands
(`SEA_BANDS`) instead of a smooth gradient, and bubbles are small squares
instead of circles, for the same reason. `imageSmoothingEnabled = false`
on both the context and after every resize keeps edges crisp.

- **Color** — each block's shade blends from blue (`{72,158,255}`) to
  red (`{255,82,82}`) based on `1 - coherence` (the calm score inverted =
  "stress"), then the sprite's `2`/`3` cells darken/lighten that base
  color for simple flat-shaded depth. `stress` eases toward its target
  each frame (`stress += (target - stress) * dt * 1.5`) so color shifts
  glide rather than jump, same reasoning as the audio's `rampTo()` calls.
- **Swim up, disappear, reappear from the bottom** — every jellyfish has
  a `yNorm` (0 = top of canvas, 1 = bottom) that continuously decreases
  each frame (`riseSpeedPx`, scaled by `stress` and a per-jelly
  `speedFactor`), so they drift upward and off the top. Once
  `yNorm < -0.18` (fully offscreen above), `_respawnAtBottom()` resets it
  to `1.08–1.2` (just below the visible area) with a new random `xNorm`.
  Near each edge, `alpha` ramps 1→0 (approaching the top) or 0→1
  (emerging past the bottom) over a small band, so it reads as fading out
  / fading in rather than an abrupt pop — see the two branches around
  `js/visualizer/JellyfishOcean.js:181-184`. Rise speed scaling with
  stress means calm reads as slow, unhurried ascents and stress reads as
  a faster, more frequent rush upward.
- **Bell pulse rate** — each jellyfish's block size scales up and down on
  a sine wave whose frequency is BPM converted to Hz (`bpm / 60`), so
  calmer/slower hearts produce a slower breathing pulse and faster hearts
  a quicker one. Scaling is done by recomputing an integer `blockSize`
  each frame (not `ctx.scale()`), which keeps every block edge pixel-
  aligned instead of blurring under fractional scale.
- **Heartbeat kick** — `pulse()`, called from the same `handleBeat()` that
  calls `audioEngine.pulse()`, gives every jellyfish an extra momentary
  size bump (`kick = 1`, decaying via `kick *= 1 - dt*6`) layered into
  that same block-size calculation — the exact instant a real heartbeat
  happens is visible as a synchronized kick across the whole scene.
- **Tentacle sway** — each tentacle segment's horizontal offset is a sine
  wave whose amplitude (`maxSway`) grows with `agitation` (derived from
  `stress`), so tentacles swing further and faster when stressed, and
  hang languid when calm.

Runs its own `requestAnimationFrame` loop from construction (not gated on
`handleBeat`), so the sea keeps swimming between beats instead of
freezing — `updateMetrics()`/`pulse()` just retarget where that
continuous animation is heading. `main.js` also calls
`ocean.updateMetrics({ coherence: 0.65, bpm: 70 })` inside
`resetMetricsUI()`, so disconnecting/resetting eases the scene back to a
neutral state instead of freezing on the last extreme color.

## `js/visualizer/MoebiusJellyfish.js` — the same mapping, drawn as ink and wash

A second, alternate renderer for the Ocean panel: one jellyfish instead
of a school, drawn with flowing bezier curves, thin ink outlines, radial-
gradient color washes, and drifting circular bubbles — a loose nod to
Mœbius's linework, deliberately the opposite rendering technique from
`JellyfishOcean`'s flat pixel blocks. It reads the exact same metrics
shape (`updateMetrics({ coherence, bpm })`, `pulse()`) and reuses the
same swim-up/fade-out/respawn-from-bottom motion model as the pixel
version (`js/visualizer/JellyfishOcean.js:181-184`), just applied to one
larger, more detailed specimen instead of five small ones.

What differs from the pixel renderer, beyond curves-vs-blocks:
- **Bell** — one closed bezier path (`bezierCurveTo` twice) forms a
  lens-shaped dome, filled with a radial-gradient wash from the calm/
  stress color (opaque near the top, fading toward the rim) instead of
  flat-shaded blocks.
- **Meridian ribs & hatch shading** — a handful of thin curved lines
  converging at the bell's apex, plus a small cluster of short diagonal
  strokes on one side, are pure decoration meant to suggest volume the
  way cross-contour ink linework does — there's no pixel-art equivalent
  of this, it only makes sense once you're drawing curves.
- **Tentacles** — six bezier strands per frame (not per-segment blocks),
  each stroked with a linear gradient from solid color at the root to
  fully transparent at the tip, approximating a tapering ink line.
- **Bubbles** — stroked circles with a small highlight dot, instead of
  filled squares.

`main.js` instantiates both `JellyfishOcean` and `MoebiusJellyfish`
against two separate `<canvas>` elements (`#ocean` / `#ocean-moebius`)
and feeds both from the same `handleBeat()`/`resetMetricsUI()` calls, so
switching styles mid-session never loses sync with the audio. A small
"Pixel (school)" / "Moebius (solo)" toggle in `index.html` just flips
which canvas has the `hidden` attribute (`setOceanStyle()` near the
bottom of `main.js`) — both keep animating and receiving metrics
underneath regardless of which is visible.

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
  `HRVProcessor`, `Tachogram`, `BiofeedbackEngine`, `JellyfishOcean`, and
  `MoebiusJellyfish` per beat.
- `updateConnectAvailability()` keeps "Connect" and "Start test signal"
  mutually exclusive — running both at once would interleave two beat
  sources into one HRV window, which is never useful, so starting one
  disables the other's start control.
- Audio enable/disable buttons and the pulse/pad checkboxes and volume
  slider just forward to the corresponding `BiofeedbackEngine` methods.
- The stress slider forwards to `RRSimulator.setStress()` on every
  `input` event, so you can drag it live while the test signal runs and
  hear the audio react in real time.
- `setOceanStyle()` toggles the `hidden` attribute on `#ocean` /
  `#ocean-moebius` and the `.active` class on the two style buttons —
  both `JellyfishOcean` and `MoebiusJellyfish` keep animating and
  receiving metrics regardless of which canvas is visible, so switching
  never has to "catch up."
