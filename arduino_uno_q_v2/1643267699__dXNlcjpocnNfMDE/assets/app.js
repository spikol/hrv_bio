const canvas = document.getElementById('plot');
const ctx = canvas.getContext('2d');
const width = canvas.width;
const height = canvas.height;
const midY = height / 2;
const bpmValueEl = document.getElementById('bpm-value');
const calmValueEl = document.getElementById('calm-value');
const rmssdValueEl = document.getElementById('rmssd-value');
const sdnnValueEl = document.getElementById('sdnn-value');
const pnn50ValueEl = document.getElementById('pnn50-value');
let errorContainer;

const ui = new WebUI({
  path: '/socket.io',
  transports: ['polling', 'websocket'],
  autoConnect: true,
});

ui.on_connect(onUIConnected);
ui.on_disconnect(onUIDisconnected);
ui.on_message('sample', s => {
  updateStats(s);
  sampleLog.push(s);
});
ui.on_message('beat', b => {
  updateStats(b);
  beats.push({ time: Date.now() });
});

function onUIConnected() {
  if (errorContainer) {
    errorContainer.style.display = 'none';
    errorContainer.textContent = '';
  }
}

function onUIDisconnected() {
  errorContainer = document.getElementById('error-container');
  if (errorContainer) {
    errorContainer.textContent = 'Connection to the board lost. Please check the connection.';
    errorContainer.style.display = 'block';
  }
}

function updateStats(d) {
  if (d.bpm != null) bpmValueEl.textContent = Math.round(d.bpm);
  if (d.coherence != null) calmValueEl.textContent = `${Math.round(d.coherence * 100)}%`;
  if (d.rmssd != null) rmssdValueEl.textContent = d.rmssd.toFixed(1);
  if (d.sdnn != null) sdnnValueEl.textContent = d.sdnn.toFixed(1);
  if (d.pnn50 != null) pnn50ValueEl.textContent = `${d.pnn50.toFixed(0)}%`;
}

// Timestamps (client-side arrival time) of recent heartbeats. The trace is
// redrawn from this list every frame rather than storing waveform samples,
// since all we actually know is *when* each beat happened.
const beats = [];
// Every 'sample' message received this session, in order — the source for CSV export.
const sampleLog = [];
const WINDOW_MS = 4000; // how much history is visible across the canvas width
const COMPLEX_MS = 380; // duration of one synthesized PQRST pulse
const AMPLITUDE = 70; // px

// A hand-built normalized PQRST complex (phase 0..1 -> roughly -1..1), since
// we only have beat timing from the HRV pipeline, not a real ECG signal.
function ecgComplex(phase) {
  if (phase < 0.12) return 0.1 * Math.sin((phase / 0.12) * Math.PI); // P wave
  if (phase < 0.18) return 0; // PR segment
  if (phase < 0.22) return -0.15 * ((phase - 0.18) / 0.04); // Q dip
  if (phase < 0.27) return -0.15 + 1.15 * ((phase - 0.22) / 0.05); // R upstroke
  if (phase < 0.32) return 1.0 - 1.3 * ((phase - 0.27) / 0.05); // R downstroke into S
  if (phase < 0.36) return -0.3 + 0.3 * ((phase - 0.32) / 0.04); // S back to baseline
  if (phase < 0.55) return 0; // ST segment
  if (phase < 0.8) return 0.25 * Math.sin(((phase - 0.55) / 0.25) * Math.PI); // T wave
  return 0;
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(57, 255, 106, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= width; x += 20) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += 20) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(57, 255, 106, 0.25)';
  ctx.beginPath();
  for (let x = 0; x <= width; x += 100) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += 100) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

function drawFrame() {
  const now = Date.now();

  // drop beats that have fully scrolled off (and finished their pulse)
  while (beats.length && now - beats[0].time > WINDOW_MS + COMPLEX_MS) {
    beats.shift();
  }

  ctx.fillStyle = '#0a0e0a';
  ctx.fillRect(0, 0, width, height);
  drawGrid();

  ctx.strokeStyle = '#39ff6a';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#39ff6a';
  ctx.shadowBlur = 6;
  ctx.beginPath();

  for (let x = 0; x <= width; x += 2) {
    const tAt = now - WINDOW_MS + (x / width) * WINDOW_MS;
    let v = 0;
    for (const b of beats) {
      const phase = (tAt - b.time) / COMPLEX_MS;
      if (phase >= 0 && phase < 1) {
        v = ecgComplex(phase);
        break;
      }
    }
    const wander = Math.sin(tAt / 300) * 1.5; // subtle baseline drift
    const y = midY - v * AMPLITUDE + wander;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  requestAnimationFrame(drawFrame);
}

requestAnimationFrame(drawFrame);

fetch('/samples')
  .then(r => r.json())
  .then(list => {
    if (Array.isArray(list) && list.length) {
      sampleLog.push(...list);
      updateStats(list[list.length - 1]);
    }
  })
  .catch(e => console.debug('Failed to load /samples', e));

const CSV_COLUMNS = ['t', 'bpm', 'rmssd', 'sdnn', 'pnn50', 'coherence'];

function toCsv(rows) {
  const header = ['timestamp', 'bpm', 'rmssd_ms', 'sdnn_ms', 'pnn50_pct', 'coherence'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const cells = CSV_COLUMNS.map((key, i) => {
      if (key === 't') return new Date(row.t * 1000).toISOString();
      const v = row[key];
      return v == null ? '' : v;
    });
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

document.getElementById('download-csv').addEventListener('click', () => {
  if (!sampleLog.length) return;
  const blob = new Blob([toCsv(sampleLog)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hrv-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
