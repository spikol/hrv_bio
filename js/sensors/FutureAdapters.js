import { SensorAdapter } from './SensorAdapter.js';

/**
 * Placeholders for devices requested for later. Both implement the same
 * SensorAdapter interface as PolarH10Adapter so wiring them up later is a
 * matter of filling in connect()/disconnect(), not rearchitecting the app.
 *
 * Neither device exposes a simple fixed BLE GATT "heart rate" profile the
 * way Polar's chest straps do, so both need more than Web Bluetooth alone:
 *
 * - EmotiBit streams multi-channel biosignals (incl. PPG for HR/HRV) over
 *   WiFi/OSC via the EmotiBit Oscilloscope/DataParser tooling, not a fixed
 *   GATT characteristic. A browser adapter would most likely talk to a
 *   small local bridge (e.g. WebSocket) that re-publishes OSC as JSON.
 * - BITalino boards typically pair over Bluetooth Classic (SPP), which
 *   Web Bluetooth (BLE-only) cannot open directly. A bridge (native app,
 *   or the vendor's API over a local WebSocket/serial) is needed here too.
 */

export class EmotiBitAdapter extends SensorAdapter {
  constructor() {
    super('EmotiBit');
  }

  async connect() {
    throw new Error('EmotiBit support is not implemented yet — needs a WiFi/OSC bridge.');
  }

  async disconnect() {}
}

export class BitalinoAdapter extends SensorAdapter {
  constructor() {
    super('BITalino');
  }

  async connect() {
    throw new Error('BITalino support is not implemented yet — needs a Bluetooth Classic bridge.');
  }

  async disconnect() {}
}
