import { SensorAdapter } from './SensorAdapter.js';

const HEART_RATE_SERVICE = 'heart_rate';
const HEART_RATE_MEASUREMENT = 'heart_rate_measurement';
const BATTERY_SERVICE = 'battery_service';
const BATTERY_LEVEL = 'battery_level';

/**
 * Polar H10 (and any other standard BLE Heart Rate Service device) via
 * Web Bluetooth. Parses the Heart Rate Measurement characteristic per the
 * Bluetooth SIG spec, including the RR-interval fields the H10 sends
 * (units of 1/1024s), which is what makes real HRV possible.
 */
export class PolarH10Adapter extends SensorAdapter {
  constructor() {
    super('Polar H10 (BLE Heart Rate)');
    this._device = null;
    this._hrChar = null;
    this._onHrValue = this._onHrValue.bind(this);
    this._onGattDisconnected = this._onGattDisconnected.bind(this);
  }

  async connect() {
    if (!navigator.bluetooth) {
      this._setStatus('error', 'Web Bluetooth is not available in this browser.');
      throw new Error('Web Bluetooth unavailable');
    }

    this._setStatus('connecting');
    try {
      this._device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [HEART_RATE_SERVICE] }],
        optionalServices: [BATTERY_SERVICE],
      });
      this._device.addEventListener('gattserverdisconnected', this._onGattDisconnected);

      const server = await this._device.gatt.connect();

      const hrService = await server.getPrimaryService(HEART_RATE_SERVICE);
      this._hrChar = await hrService.getCharacteristic(HEART_RATE_MEASUREMENT);
      this._hrChar.addEventListener('characteristicvaluechanged', this._onHrValue);
      await this._hrChar.startNotifications();

      this._setStatus('connected', this._device.name || 'Heart Rate device');

      this._readBatteryOnce(server).catch(() => {
        /* battery service is optional; ignore if absent */
      });
    } catch (err) {
      this._setStatus('error', err.message || String(err));
      throw err;
    }
  }

  async disconnect() {
    if (this._hrChar) {
      try {
        this._hrChar.removeEventListener('characteristicvaluechanged', this._onHrValue);
        await this._hrChar.stopNotifications();
      } catch {
        /* device may already be gone */
      }
      this._hrChar = null;
    }
    if (this._device?.gatt?.connected) {
      this._device.gatt.disconnect();
    }
    this._setStatus('disconnected');
  }

  async _readBatteryOnce(server) {
    const battService = await server.getPrimaryService(BATTERY_SERVICE);
    const battChar = await battService.getCharacteristic(BATTERY_LEVEL);
    const value = await battChar.readValue();
    this.dispatchEvent(new CustomEvent('battery', { detail: { level: value.getUint8(0) } }));
  }

  _onGattDisconnected() {
    this._hrChar = null;
    this._setStatus('disconnected', 'Device disconnected');
  }

  /** @param {Event} event */
  _onHrValue(event) {
    const value = event.target.value; // DataView
    const timestamp = performance.now();
    const flags = value.getUint8(0);
    const hrFormat16Bit = (flags & 0x01) !== 0;
    const energyExpendedPresent = (flags & 0x08) !== 0;
    const rrPresent = (flags & 0x10) !== 0;

    let index = 1;
    let bpm;
    if (hrFormat16Bit) {
      bpm = value.getUint16(index, true);
      index += 2;
    } else {
      bpm = value.getUint8(index);
      index += 1;
    }
    this.dispatchEvent(new CustomEvent('hr', { detail: { bpm, timestamp } }));

    if (energyExpendedPresent) {
      index += 2; // energy expended field, not used here
    }

    if (rrPresent) {
      for (; index + 1 < value.byteLength; index += 2) {
        const rrUnits = value.getUint16(index, true); // 1/1024 second
        const rrMs = (rrUnits / 1024) * 1000;
        this.dispatchEvent(new CustomEvent('beat', { detail: { rrMs, timestamp } }));
      }
    }
  }
}
