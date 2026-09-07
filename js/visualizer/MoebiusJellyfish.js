const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const CALM_COLOR = { r: 96, g: 176, b: 255 }; // blue
const STRESS_COLOR = { r: 255, g: 96, b: 96 }; // red
const INK = '20,26,40'; // dark ink used for outlines / cross-hatching

/**
 * A single jellyfish rendered in a loose Moebius-esque ink-and-wash style
 * — flowing bezier bell and tentacles, fine cross-contour rib lines, a
 * hatch-shaded accent, a soft radial color wash, and drifting bubbles —
 * as an alternate look for the same HRV -> color/motion mapping as
 * JellyfishOcean (which uses flat pixel blocks instead of curves). Driven
 * by the same updateMetrics()/pulse() calls from main.js, so switching
 * styles never falls out of sync with the audio.
 */
export class MoebiusJellyfish {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.stress = 0.35;
    this.targetStress = 0.35;
    this.bpm = 70;
    this.targetBpm = 70;

    this.jelly = this._makeJelly();
    this.bubbles = Array.from({ length: 10 }, () => this._makeBubble());

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
    this.jelly.kick = 1;
  }

  _makeJelly() {
    return {
      xNorm: 0.5 + (Math.random() - 0.5) * 0.2,
      yNorm: 0.5 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      driftPhase: Math.random() * Math.PI * 2,
      kick: 0,
    };
  }

  _respawnAtBottom(j) {
    j.yNorm = 1.2 + Math.random() * 0.1;
    j.xNorm = 0.5 + (Math.random() - 0.5) * 0.35;
    j.driftPhase = Math.random() * Math.PI * 2;
  }

  _makeBubble() {
    return {
      xNorm: Math.random(),
      yNorm: Math.random(),
      r: 1.5 + Math.random() * 3.5,
      speed: 5 + Math.random() * 10,
      wobble: Math.random() * Math.PI * 2,
    };
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _tick(now) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;

    this.stress += (this.targetStress - this.stress) * Math.min(1, dt * 1.5);
    this.bpm += (this.targetBpm - this.bpm) * Math.min(1, dt * 1.5);

    this._draw(dt);
    requestAnimationFrame((t) => this._tick(t));
  }

  _color(alpha = 1) {
    const t = clamp(this.stress, 0, 1);
    const r = Math.round(CALM_COLOR.r + (STRESS_COLOR.r - CALM_COLOR.r) * t);
    const g = Math.round(CALM_COLOR.g + (STRESS_COLOR.g - CALM_COLOR.g) * t);
    const b = Math.round(CALM_COLOR.b + (STRESS_COLOR.b - CALM_COLOR.b) * t);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  _draw(dt) {
    const { ctx, canvas } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    const sea = ctx.createRadialGradient(w * 0.5, h * 0.35, h * 0.1, w * 0.5, h * 0.5, h * 0.95);
    sea.addColorStop(0, '#132a3d');
    sea.addColorStop(0.6, '#0a1a29');
    sea.addColorStop(1, '#040c14');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, w, h);

    this._drawBubbles(dt, w, h);

    const j = this.jelly;
    const agitation = 0.35 + this.stress * 1.8;
    const pulseHz = clamp(this.bpm, 30, 200) / 60;
    const riseSpeedPx = 6 + this.stress * 30;

    j.driftPhase += dt * (0.4 + agitation * 0.2);
    j.phase += dt * pulseHz * Math.PI * 2;
    j.kick *= Math.max(0, 1 - dt * 5);

    j.yNorm -= (riseSpeedPx * dt) / h;
    if (j.yNorm < -0.25) this._respawnAtBottom(j);

    let alpha = 1;
    if (j.yNorm < 0.12) alpha = clamp(j.yNorm / 0.12, 0, 1);
    else if (j.yNorm > 0.88) alpha = clamp((1.2 - j.yNorm) / 0.32, 0, 1);

    if (alpha > 0.01) {
      const driftX = Math.sin(j.driftPhase) * (14 + this.stress * 22);
      const x = j.xNorm * w + driftX;
      const y = j.yNorm * h;
      const breathe = (Math.sin(j.phase) * 0.5 + 0.5) * 0.18;
      const scale = (Math.min(w, h) / 260) * (1 + breathe + j.kick * 0.3);
      this._drawJelly(x, y, scale, j.phase, agitation, alpha);
    }
  }

  _drawBubbles(dt, w, h) {
    const { ctx } = this;
    for (const b of this.bubbles) {
      b.yNorm -= (b.speed * dt) / h;
      b.wobble += dt * 1.4;
      if (b.yNorm < -0.05) {
        b.yNorm = 1 + Math.random() * 0.2;
        b.xNorm = Math.random();
      }
      const x = b.xNorm * w + Math.sin(b.wobble) * 4;
      const y = b.yNorm * h;

      ctx.beginPath();
      ctx.arc(x, y, b.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${INK},0.35)`;
      ctx.lineWidth = 0.75;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x - b.r * 0.3, y - b.r * 0.3, Math.max(0.4, b.r * 0.25), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
    }
  }

  _drawJelly(x, y, scale, phase, agitation, alpha) {
    const { ctx } = this;
    const bellW = 46 * scale;
    const bellH = 40 * scale;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);

    // bell silhouette (lens-shaped dome, drawn as one flowing bezier path)
    ctx.beginPath();
    ctx.moveTo(-bellW, 0);
    ctx.bezierCurveTo(-bellW, -bellH * 1.3, bellW, -bellH * 1.3, bellW, 0);
    ctx.bezierCurveTo(bellW * 0.6, bellH * 0.18, -bellW * 0.6, bellH * 0.18, -bellW, 0);
    ctx.closePath();

    const wash = ctx.createRadialGradient(0, -bellH * 0.5, bellW * 0.1, 0, -bellH * 0.3, bellW * 1.1);
    wash.addColorStop(0, this._color(0.75));
    wash.addColorStop(1, this._color(0.15));
    ctx.fillStyle = wash;
    ctx.fill();

    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `rgba(${INK},0.8)`;
    ctx.stroke();

    // meridian ribs — cross-contour lines suggesting the bell's curvature
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = `rgba(${INK},0.45)`;
    for (let i = -2; i <= 2; i++) {
      const off = (i / 2) * bellW * 0.75;
      ctx.beginPath();
      ctx.moveTo(off, 0);
      ctx.quadraticCurveTo(off * 0.5, -bellH * 1.15, 0, -bellH * 1.25);
      ctx.stroke();
    }

    // hatch-shading accent on the shadow side
    ctx.strokeStyle = `rgba(${INK},0.3)`;
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 6; i++) {
      const hx = bellW * 0.35 + i * 2.5;
      ctx.beginPath();
      ctx.moveTo(hx, -bellH * 0.15 - i * 1.5);
      ctx.lineTo(hx - 6, -bellH * 0.35 - i * 1.5);
      ctx.stroke();
    }

    ctx.restore();

    // tentacles — flowing bezier strands, tapering to transparent at the tip
    const strands = 6;
    for (let i = 0; i < strands; i++) {
      const t = strands > 1 ? i / (strands - 1) - 0.5 : 0;
      const rootX = x + t * bellW * 1.5;
      const rootY = y + 2 * scale;
      const len = (60 + Math.abs(t) * 20) * scale;
      const sway = Math.sin(phase * 1.1 + i * 1.6) * (8 + agitation * 10);
      const midX = rootX + sway;
      const midY = rootY + len * 0.55;
      const endX = rootX + sway * 1.6 + t * 10 * scale;
      const endY = rootY + len;

      const grad = ctx.createLinearGradient(rootX, rootY, endX, endY);
      grad.addColorStop(0, this._color(0.55 * alpha));
      grad.addColorStop(1, this._color(0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.1 * scale;
      ctx.beginPath();
      ctx.moveTo(rootX, rootY);
      ctx.quadraticCurveTo(midX, midY, endX, endY);
      ctx.stroke();
    }
  }
}
