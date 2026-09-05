import { SENSOR_REGISTRY } from './sensors/registry.js';
import { HRVProcessor } from './hrv/HRVProcessor.js';
import { Tachogram } from './visualizer/Tachogram.js';
import { JellyfishOcean } from './visualizer/JellyfishOcean.js';
import { BiofeedbackEngine } from './audio/BiofeedbackEngine.js';
import { RRSimulator } from './sim/RRSimulator.js';

const $ = (id) => document.getElementById(id);

const deviceSelect = $('device-select');
const connectBtn = $('connect-btn');
const disconnectBtn = $('disconnect-btn');
const statusDot = $('status-dot');
const statusText = $('status-text');
const batteryText = $('battery-text');
const logEl = $('log');

const mBpm = $('m-bpm');
const mRmssd = $('m-rmssd');
const mSdnn = $('m-sdnn');
const mPnn50 = $('m-pnn50');
const mCoherence = $('m-coherence');
const mCount = $('m-count');

const audioEnableBtn = $('audio-enable-btn');
const audioDisableBtn = $('audio-disable-btn');
const togglePulse = $('toggle-pulse');
const togglePad = $('toggle-pad');
const volumeSlider = $('volume');

const stressSlider = $('stress-slider');
const simStartBtn = $('sim-start-btn');
const simStopBtn = $('sim-stop-btn');

let adapter = null;
const hrv = new HRVProcessor({ windowSeconds: 60 });
const tachogram = new Tachogram($('tachogram'));
const ocean = new JellyfishOcean($('ocean'));
const audioEngine = new BiofeedbackEngine();
const simulator = new RRSimulator((rrMs) => handleBeat(rrMs, performance.now()));

function log(message, isError = false) {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  if (isError) line.classList.add('err');
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function populateDeviceSelect() {
  deviceSelect.innerHTML = '';
  for (const entry of SENSOR_REGISTRY) {
    const opt = document.createElement('option');
    opt.value = entry.id;
    opt.textContent = entry.label;
    opt.disabled = !entry.available;
    deviceSelect.appendChild(opt);
  }
}

function fmt(value, digits = 0) {
  return value == null || Number.isNaN(value) ? '–' : value.toFixed(digits);
}

function setStatus(status, message) {
  statusDot.className = `dot ${status}`;
  const labels = {
    disconnected: 'Not connected',
    connecting: 'Connecting…',
    connected: message ? `Connected — ${message}` : 'Connected',
    error: message ? `Error: ${message}` : 'Error',
  };
  statusText.textContent = labels[status] ?? status;
  disconnectBtn.disabled = status !== 'connected';
  simStartBtn.disabled = status === 'connecting' || status === 'connected';
  updateConnectAvailability(status);
}

/** Keeps "Connect" and "Start test signal" mutually exclusive so the two beat sources don't mix. */
function updateConnectAvailability(sensorStatus) {
  const sensorBusy = sensorStatus === 'connecting' || sensorStatus === 'connected';
  connectBtn.disabled = sensorBusy || simulator.running;
}

function resetMetricsUI() {
  mBpm.textContent = '–';
  mRmssd.textContent = '–';
  mSdnn.textContent = '–';
  mPnn50.textContent = '–';
  mCoherence.textContent = '–';
  mCount.textContent = '0';
  batteryText.hidden = true;
  ocean.updateMetrics({ coherence: 0.65, bpm: 70 });
}

function wireAdapter(instance) {
  instance.addEventListener('statuschange', (e) => {
    const { status, message } = e.detail;
    setStatus(status, message);
    log(`${instance.name}: ${status}${message ? ` (${message})` : ''}`, status === 'error');
    if (status === 'disconnected' || status === 'error') {
      resetMetricsUI();
    }
  });

  instance.addEventListener('battery', (e) => {
    batteryText.hidden = false;
    batteryText.textContent = `Battery ${e.detail.level}%`;
  });

  instance.addEventListener('beat', (e) => {
    handleBeat(e.detail.rrMs, e.detail.timestamp);
  });
}

/** Shared by real sensor beats and the test-signal simulator. */
function handleBeat(rrMs, timestamp) {
  const metrics = hrv.addRR(rrMs, timestamp);
  tachogram.push(rrMs);
  updateMetricsUI(metrics);
  audioEngine.pulse();
  audioEngine.updateMapping(metrics);
  ocean.updateMetrics(metrics);
  ocean.pulse();
}

function updateMetricsUI(metrics) {
  mBpm.textContent = fmt(metrics.bpm, 0);
  mRmssd.textContent = fmt(metrics.rmssd, 1);
  mSdnn.textContent = fmt(metrics.sdnn, 1);
  mPnn50.textContent = fmt(metrics.pnn50, 0);
  mCoherence.textContent = metrics.coherence == null ? '–' : fmt(metrics.coherence * 100, 0) + '%';
  mCount.textContent = String(metrics.sampleCount);
}

connectBtn.addEventListener('click', async () => {
  const entry = SENSOR_REGISTRY.find((e) => e.id === deviceSelect.value);
  if (!entry) return;

  hrv.reset();
  tachogram.clear();
  resetMetricsUI();

  adapter = new entry.Adapter();
  wireAdapter(adapter);

  try {
    await adapter.connect();
  } catch (err) {
    log(err.message || String(err), true);
  }
});

disconnectBtn.addEventListener('click', async () => {
  if (adapter) {
    await adapter.disconnect();
  }
});

audioEnableBtn.addEventListener('click', async () => {
  await audioEngine.start();
  audioEngine.setMasterVolumeDb(Number(volumeSlider.value));
  audioEngine.setPulseEnabled(togglePulse.checked);
  audioEngine.setPadEnabled(togglePad.checked);
  audioEnableBtn.textContent = 'Audio enabled';
  audioEnableBtn.disabled = true;
  audioDisableBtn.disabled = false;
  log('Audio engine started.');
});

audioDisableBtn.addEventListener('click', () => {
  audioEngine.stop();
  audioEnableBtn.textContent = 'Enable audio';
  audioEnableBtn.disabled = false;
  audioDisableBtn.disabled = true;
  log('Audio engine stopped.');
});

togglePulse.addEventListener('change', () => audioEngine.setPulseEnabled(togglePulse.checked));
togglePad.addEventListener('change', () => audioEngine.setPadEnabled(togglePad.checked));
volumeSlider.addEventListener('input', () => audioEngine.setMasterVolumeDb(Number(volumeSlider.value)));

stressSlider.addEventListener('input', () => simulator.setStress(Number(stressSlider.value) / 100));

simStartBtn.addEventListener('click', () => {
  hrv.reset();
  tachogram.clear();
  resetMetricsUI();
  simulator.setStress(Number(stressSlider.value) / 100);
  simulator.start();
  simStartBtn.disabled = true;
  simStopBtn.disabled = false;
  updateConnectAvailability(adapter?.status);
  log('Test signal started.');
});

simStopBtn.addEventListener('click', () => {
  simulator.stop();
  simStartBtn.disabled = false;
  simStopBtn.disabled = true;
  updateConnectAvailability(adapter?.status);
  log('Test signal stopped.');
});

if (!navigator.bluetooth) {
  log('This browser does not support Web Bluetooth. Use Chrome or Edge over https:// or localhost.', true);
}

populateDeviceSelect();
setStatus('disconnected');
