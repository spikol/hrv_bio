const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const CALM_CHORD = ['C4', 'E4', 'G4', 'D5']; // open, consonant (add9)
const TENSE_CHORD = ['C4', 'D#4', 'F#4', 'A#4']; // dissonant/unresolved

/**
 * Maps live HRV metrics onto a Tone.js audio graph:
 *  - a short percussive "pulse" fires on every detected heartbeat
 *  - a sustained pad crossfades between a calm and a tense chord voicing
 *    based on the calm/coherence score, and opens/closes a lowpass filter
 *    plus reverb send based on RMSSD (higher HRV -> brighter, more spacious)
 *
 * Requires Tone.js loaded globally (see index.html) and must be started
 * from a user gesture via start().
 */
export class BiofeedbackEngine {
  constructor() {
    this.ready = false;
    this.pulseEnabled = true;
    this.padEnabled = true;
  }

  async start() {
    if (this.ready) return;
    await Tone.start();

    this.master = new Tone.Gain(1).toDestination();

    // Heartbeat pulse chain
    this.pulseSynth = new Tone.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 4,
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.2 },
    }).connect(this.master);
    this.pulseSynth.volume.value = -14;

    // Pad chain: calmSynth/tenseSynth -> respective gain -> mix -> filter -> reverb -> master
    this.filter = new Tone.Filter({ frequency: 800, type: 'lowpass', rolloff: -12 }).connect(this.master);
    this.reverb = new Tone.Reverb({ decay: 4, wet: 0.3 }).connect(this.filter);
    await this.reverb.generate();

    this.mix = new Tone.Gain(1).connect(this.reverb);

    this.calmGain = new Tone.Gain(1).connect(this.mix);
    this.tenseGain = new Tone.Gain(0).connect(this.mix);

    this.calmSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 2, decay: 0.5, sustain: 1, release: 3 },
      volume: -18,
    }).connect(this.calmGain);

    this.tenseSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 2, decay: 0.5, sustain: 1, release: 3 },
      volume: -22,
    }).connect(this.tenseGain);

    if (this.padEnabled) {
      this.calmSynth.triggerAttack(CALM_CHORD);
      this.tenseSynth.triggerAttack(TENSE_CHORD);
    }

    this.ready = true;
  }

  stop() {
    if (!this.ready) return;
    this.calmSynth.releaseAll();
    this.tenseSynth.releaseAll();
    [this.pulseSynth, this.filter, this.reverb, this.mix, this.calmGain, this.tenseGain, this.calmSynth, this.tenseSynth, this.master].forEach(
      (node) => node?.dispose()
    );
    this.ready = false;
  }

  setPulseEnabled(enabled) {
    this.pulseEnabled = enabled;
  }

  setPadEnabled(enabled) {
    this.padEnabled = enabled;
    if (!this.ready) return;
    if (enabled) {
      this.calmSynth.triggerAttack(CALM_CHORD);
      this.tenseSynth.triggerAttack(TENSE_CHORD);
    } else {
      this.calmSynth.releaseAll();
      this.tenseSynth.releaseAll();
    }
  }

  setMasterVolumeDb(db) {
    if (!this.ready) return;
    this.master.gain.rampTo(Tone.dbToGain(db), 0.05);
  }

  /** Call once per detected beat. */
  pulse() {
    if (!this.ready || !this.pulseEnabled) return;
    this.pulseSynth.triggerAttackRelease('C2', '16n');
  }

  /** Call whenever HRVProcessor emits new metrics. */
  updateMapping({ rmssd, coherence }) {
    if (!this.ready || !this.padEnabled) return;
    if (rmssd == null || coherence == null) return;

    // RMSSD -> filter brightness & reverb amount (assume a ~0-120ms practical range)
    const rmssdNorm = clamp(rmssd / 120, 0, 1);
    const cutoff = 300 + rmssdNorm * 3700; // 300Hz (muffled) .. 4000Hz (bright)
    this.filter.frequency.rampTo(cutoff, 1.5);
    this.reverb.wet.rampTo(0.15 + rmssdNorm * 0.5, 1.5);

    // Calm score -> crossfade between calm and tense chord voicings
    const calm = clamp(coherence, 0, 1);
    this.calmGain.gain.rampTo(calm, 1.5);
    this.tenseGain.gain.rampTo(1 - calm, 1.5);
  }
}
