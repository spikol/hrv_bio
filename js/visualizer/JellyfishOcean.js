const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const CALM_COLOR = { r: 72, g: 158, b: 255 }; // blue
const STRESS_COLOR = { r: 255, g: 82, b: 82 }; // red

// Pixel-art jellyfish sprite, drawn as a grid of flat-shaded blocks (no
// curves, no gradients) so it reads as retro/8-bit rather than smooth
// canvas art. 0 = empty, 1 = body, 2 = outline (darker), 3 = highlight
// (lighter). Bottom row is the scalloped bell rim; tentacles hang from
// its outline blocks.
const BELL_SPRITE = [
  [0, 0, 2, 2, 2, 2, 2, 0, 0],
  [0, 2, 1, 1, 1, 1, 1, 2, 0],
  [2, 1, 1, 3, 1, 1, 1, 1, 2],
  [2, 1, 1, 1, 1, 1, 1, 1, 2],
  [2, 1, 1, 1, 1, 1, 1, 1, 2],
  [0, 2, 0, 2, 0, 2, 0, 2, 0],
];
const BELL_COLS = BELL_SPRITE[0].length;
const BELL_CENTER_COL = Math.floor(BELL_COLS / 2);
const TENTACLE_COLS = [1, 3, 5, 7].map((c) => c - BELL_CENTER_COL); // relative to center
const TENTACLE_LENGTH = 6;

const SEA_BANDS = [
  { stop: 0, color: [14, 44, 66] },
  { stop: 0.35, color: [9, 30, 46] },
  { stop: 0.7, color: [5, 18, 29] },
  { stop: 1, color: [2, 8, 13] },
];

/**
 * A small canvas "sea" of pixel-art jellyfish whose color and behavior
 * sonify the same HRV metrics driving BiofeedbackEngine, so the visual
 * and the audio always agree:
 *  - color blends blue (calm) -> red (stressed) from the calm/coherence score
 *  - each jellyfish continuously swims upward, fading out as it nears the
 *    top edge, then re-spawns fading in from below the bottom edge —
 *    faster and more often when stressed, slow and unhurried when calm
 *  - bell pulse rate follows BPM, and pulse() (called on every real
 *    heartbeat, same moment BiofeedbackEngine.pulse() fires) gives each
 *    jellyfish an extra synchronized "heartbeat" kick
 *  - tentacle sway amplitude rises with stress (twitchier) and falls with
 *    calm (languid)
 *
 * Runs its own requestAnimationFrame loop so the sea stays alive between
 * beats, not just at the instant metrics update.
 */
export class JellyfishOcean {
  constructor(canvas, { count = 5 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    this.stress = 0.35;
    this.targetStress = 0.35;
    this.bpm = 70;
    this.targetBpm = 70;

    this.jellies = Array.from({ length: count }, () => this._makeJelly());
    this.bubbles = Array.from({ length: 14 }, () => this._makeBubble());

    this._resize();
    window.addEventListener('resize', () => this._resize());

    this._last = performance.now();
    requestAnimationFrame((t) => this._tick(t));
  }

  /** Call with the latest HRV metrics whenever they update. */
  updateMetrics({ coherence, bpm }) {
    if (coherence != null) this.targetStress = clamp(1 - coherence, 0, 1);
    if (bpm != null) this.targetBpm = clamp(bpm, 30, 200);
  }

  /** Call once per detected heartbeat, in sync with the audio pulse. */
  pulse() {
    for (const j of this.jellies) j.kick = 1;
  }

  _makeJelly() {
    return {
      xNorm: Math.random(),
      yNorm: Math.random(), // start scattered through the water column
      phase: Math.random() * Math.PI * 2,
      driftPhase: Math.random() * Math.PI * 2,
      blockSize: 3 + Math.random() * 2.5,
      speedFactor: 0.7 + Math.random() * 0.6,
      kick: 0,
    };
  }

  _respawnAtBottom(j) {
    j.yNorm = 1.08 + Math.random() * 0.12;
    j.xNorm = Math.random();
    j.driftPhase = Math.random() * Math.PI * 2;
  }

  _makeBubble() {
    return {
      xNorm: Math.random(),
      yNorm: Math.random(),
      size: 1 + Math.round(Math.random()),
      speed: 6 + Math.random() * 12,
    };
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  _tick(now) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;

    this.stress += (this.targetStress - this.stress) * Math.min(1, dt * 1.5);
    this.bpm += (this.targetBpm - this.bpm) * Math.min(1, dt * 1.5);

    this._draw(dt);
    requestAnimationFrame((t) => this._tick(t));
  }

  _currentColor() {
    const t = clamp(this.stress, 0, 1);
    return {
      r: Math.round(CALM_COLOR.r + (STRESS_COLOR.r - CALM_COLOR.r) * t),
      g: Math.round(CALM_COLOR.g + (STRESS_COLOR.g - CALM_COLOR.g) * t),
      b: Math.round(CALM_COLOR.b + (STRESS_COLOR.b - CALM_COLOR.b) * t),
    };
  }

  _drawSea(w, h) {
    const { ctx } = this;
    for (let i = 0; i < SEA_BANDS.length - 1; i++) {
      const a = SEA_BANDS[i];
      const b = SEA_BANDS[i + 1];
      const [r, g, bl] = a.color;
      ctx.fillStyle = `rgb(${r},${g},${bl})`;
      ctx.fillRect(0, Math.round(a.stop * h), w, Math.round((b.stop - a.stop) * h) + 1);
    }
    const last = SEA_BANDS[SEA_BANDS.length - 1];
    ctx.fillStyle = `rgb(${last.color[0]},${last.color[1]},${last.color[2]})`;
    ctx.fillRect(0, Math.round(last.stop * h), w, h);
  }

  _draw(dt) {
    const { ctx, canvas } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    this._drawSea(w, h);

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    for (const b of this.bubbles) {
      b.yNorm -= (b.speed * dt) / h;
      if (b.yNorm < -0.05) {
        b.yNorm = 1 + Math.random() * 0.2;
        b.xNorm = Math.random();
      }
      ctx.fillRect(Math.round(b.xNorm * w), Math.round(b.yNorm * h), b.size, b.size);
    }

    const color = this._currentColor();
    const agitation = 0.35 + this.stress * 1.8; // twitchier tentacle sway when stressed
    const pulseHz = clamp(this.bpm, 30, 200) / 60; // bell pulse rate tracks heart rate
    const riseSpeedPx = 10 + this.stress * 55; // slow drift when calm, fast rush when stressed

    for (const j of this.jellies) {
      j.driftPhase += dt * (0.6 + agitation * 0.3);
      j.phase += dt * pulseHz * Math.PI * 2;
      j.kick *= Math.max(0, 1 - dt * 6);

      j.yNorm -= (riseSpeedPx * j.speedFactor * dt) / h;
      if (j.yNorm < -0.18) this._respawnAtBottom(j);

      let alpha = 1;
      if (j.yNorm < 0.1) alpha = clamp(j.yNorm / 0.1, 0, 1);
      else if (j.yNorm > 0.9) alpha = clamp((1.1 - j.yNorm) / 0.2, 0, 1);
      if (alpha <= 0.01) continue;

      const driftX = Math.sin(j.driftPhase) * (10 + this.stress * 18);
      const x = j.xNorm * w + driftX;
      const y = j.yNorm * h;

      const breathe = (Math.sin(j.phase) * 0.5 + 0.5) * 0.35;
      const scale = 1 + breathe + j.kick * 0.6;
      const blockSize = Math.max(1, Math.round(j.blockSize * scale));

      this._drawJelly(x, y, blockSize, color, j.phase, agitation, alpha);
    }
  }

  _drawJelly(x, y, blockSize, color, tentaclePhase, agitation, alpha) {
    const { ctx } = this;
    const shade = (variant, a = 1) => {
      let r = color.r;
      let g = color.g;
      let b = color.b;
      if (variant === 2) {
        r *= 0.5;
        g *= 0.5;
        b *= 0.5;
      } else if (variant === 3) {
        r = r + (255 - r) * 0.45;
        g = g + (255 - g) * 0.45;
        b = b + (255 - b) * 0.45;
      }
      return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a * alpha})`;
    };

    const originX = Math.round(x - BELL_CENTER_COL * blockSize);
    const bellRows = BELL_SPRITE.length;
    const rimY = Math.round(y - blockSize); // y anchors just below the rim, where tentacles start
    const originY = rimY - (bellRows - 1) * blockSize;

    for (let r = 0; r < bellRows; r++) {
      const row = BELL_SPRITE[r];
      for (let c = 0; c < BELL_COLS; c++) {
        const cell = row[c];
        if (!cell) continue;
        ctx.fillStyle = shade(cell);
        ctx.fillRect(originX + c * blockSize, originY + r * blockSize, blockSize, blockSize);
      }
    }

    const maxSway = 1 + agitation * 1.6;
    for (let t = 0; t < TENTACLE_COLS.length; t++) {
      const rootCol = TENTACLE_COLS[t];
      for (let seg = 0; seg < TENTACLE_LENGTH; seg++) {
        const sway = Math.round(Math.sin(tentaclePhase * 1.4 + seg * 0.8 + t * 1.9) * maxSway * (0.3 + seg / TENTACLE_LENGTH));
        const px = Math.round(x + rootCol * blockSize + sway * blockSize * 0.5);
        const py = Math.round(y + seg * blockSize);
        const fade = 0.75 - (seg / TENTACLE_LENGTH) * 0.45;
        ctx.fillStyle = shade(1, fade);
        ctx.fillRect(px, py, Math.max(1, Math.round(blockSize * 0.7)), Math.max(1, Math.round(blockSize * 0.9)));
      }
    }
  }
}
