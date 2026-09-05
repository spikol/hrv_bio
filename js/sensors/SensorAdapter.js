/**
 * Common interface every device adapter implements, so the rest of the app
 * (HRV processing, visualizer, audio engine) never has to know which sensor
 * is plugged in.
 *
 * Events dispatched (CustomEvent, detail shown):
 *   'statuschange' { status: 'disconnected'|'connecting'|'connected'|'error', message?: string }
 *   'beat'         { rrMs: number, timestamp: number }   // one per detected heartbeat
 *   'hr'           { bpm: number, timestamp: number }    // device-reported instantaneous BPM
 *   'battery'      { level: number }                     // 0-100, if the device exposes it
 */
export class SensorAdapter extends EventTarget {
  constructor(name) {
    super();
    this.name = name;
    this.status = 'disconnected';
  }

  /** @returns {boolean} */
  get isConnected() {
    return this.status === 'connected';
  }

  /** Prompt device selection / pairing and start streaming. Must be called from a user gesture. */
  async connect() {
    throw new Error(`${this.name}: connect() not implemented`);
  }

  async disconnect() {
    throw new Error(`${this.name}: disconnect() not implemented`);
  }

  _setStatus(status, message) {
    this.status = status;
    this.dispatchEvent(new CustomEvent('statuschange', { detail: { status, message } }));
  }
}
