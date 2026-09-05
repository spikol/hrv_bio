/**
 * Turns a stream of RR intervals (ms between consecutive heartbeats) into
 * rolling HRV metrics over a sliding time window.
 *
 * 'coherence' here is a simplified, relative "openness" score in [0,1] —
 * RMSSD relative to its own slow-moving baseline, squashed through a
 * logistic curve. It is NOT the frequency-domain HeartMath coherence
 * metric (that needs spectral/LF-power analysis); it's a lightweight
 * stand-in that still moves smoothly and usefully for sonification.
 */
export class HRVProcessor extends EventTarget {
  constructor({ windowSeconds = 60 } = {}) {
    super();
    this.windowSeconds = windowSeconds;
    this.rrIntervals = []; // [{ rrMs, t }]
    this._baseline = null;
  }

  /** @param {number} rrMs @param {number} [timestamp] performance.now()-style ms */
  addRR(rrMs, timestamp = performance.now()) {
    this.rrIntervals.push({ rrMs, t: timestamp });
    this._trim(timestamp);
    const metrics = this._computeMetrics();
    this.dispatchEvent(new CustomEvent('metrics', { detail: metrics }));
    return metrics;
  }

  reset() {
    this.rrIntervals = [];
    this._baseline = null;
  }

  _trim(now) {
    const cutoff = now - this.windowSeconds * 1000;
    while (this.rrIntervals.length && this.rrIntervals[0].t < cutoff) {
      this.rrIntervals.shift();
    }
  }

  _computeMetrics() {
    const rr = this.rrIntervals.map((r) => r.rrMs);
    const sampleCount = rr.length;

    if (sampleCount < 2) {
      return { bpm: null, sdnn: null, rmssd: null, pnn50: null, coherence: null, sampleCount };
    }

    const mean = rr.reduce((a, b) => a + b, 0) / rr.length;
    const bpm = 60000 / mean;

    const variance = rr.reduce((a, b) => a + (b - mean) ** 2, 0) / rr.length;
    const sdnn = Math.sqrt(variance);

    let sqDiffSum = 0;
    let nn50 = 0;
    for (let i = 1; i < rr.length; i++) {
      const diff = rr[i] - rr[i - 1];
      sqDiffSum += diff * diff;
      if (Math.abs(diff) > 50) nn50++;
    }
    const rmssd = Math.sqrt(sqDiffSum / (rr.length - 1));
    const pnn50 = (nn50 / (rr.length - 1)) * 100;

    const coherence = this._coherenceScore(rmssd);

    return { bpm, sdnn, rmssd, pnn50, coherence, sampleCount };
  }

  _coherenceScore(rmssd) {
    if (this._baseline == null) {
      this._baseline = rmssd;
    } else {
      this._baseline = this._baseline * 0.95 + rmssd * 0.05;
    }
    const ratio = this._baseline > 0 ? rmssd / this._baseline : 1;
    return 1 / (1 + Math.exp(-4 * (ratio - 1)));
  }
}
