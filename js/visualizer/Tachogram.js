/** Lightweight canvas line-chart of recent RR intervals (a tachogram). */
export class Tachogram {
  constructor(canvas, { maxPoints = 120 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxPoints = maxPoints;
    this.data = [];
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  push(rrMs) {
    this.data.push(rrMs);
    if (this.data.length > this.maxPoints) this.data.shift();
    this.draw();
  }

  clear() {
    this.data = [];
    this.draw();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    if (this.data.length < 2) return;

    const min = Math.min(...this.data) - 20;
    const max = Math.max(...this.data) + 20;
    const span = Math.max(1, max - min);

    ctx.strokeStyle = '#4fd1c5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.data.forEach((v, i) => {
      const x = (i / (this.maxPoints - 1)) * w;
      const y = h - ((v - min) / span) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}
