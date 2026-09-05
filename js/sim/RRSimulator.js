const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Sum-of-uniforms approximation of a standard normal (mean 0, sd ~1). */
function gaussianRandom() {
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Math.random();
  return (sum - 3) / 3;
}

/**
 * Generates synthetic RR intervals so the HRV -> audio pipeline can be
 * exercised without a physical sensor. `stress` in [0,1] interpolates
 * between a relaxed profile (slower rate, higher beat-to-beat
 * variability = higher HRV) and a stressed profile (faster rate, lower
 * variability = lower HRV), mirroring the real relationship between
 * sympathetic activation and reduced HRV. Fires onBeat(rrMs) on the same
 * schedule a real heart would, by using each generated RR interval as
 * the delay before the next beat.
 */
export class RRSimulator {
  constructor(onBeat) {
    this.onBeat = onBeat;
    this.running = false;
    this.stress = 0.2;
    this._timeoutId = null;
  }

  setStress(value) {
    this.stress = clamp(value, 0, 1);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._scheduleNext();
  }

  stop() {
    this.running = false;
    if (this._timeoutId != null) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
  }

  _scheduleNext() {
    if (!this.running) return;
    const rrMs = this._nextRR();
    this._timeoutId = setTimeout(() => {
      this.onBeat(rrMs);
      this._scheduleNext();
    }, rrMs);
  }

  _nextRR() {
    const relaxedMeanRR = 1000; // ~60 bpm
    const stressedMeanRR = 480; // ~125 bpm
    const relaxedJitterMs = 70; // high beat-to-beat variability (high HRV)
    const stressedJitterMs = 8; // low variability (low HRV)

    const meanRR = relaxedMeanRR + (stressedMeanRR - relaxedMeanRR) * this.stress;
    const jitterMs = relaxedJitterMs + (stressedJitterMs - relaxedJitterMs) * this.stress;

    const rr = meanRR + gaussianRandom() * jitterMs;
    return clamp(rr, 300, 1500);
  }
}
