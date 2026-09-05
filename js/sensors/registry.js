import { PolarH10Adapter } from './PolarH10Adapter.js';
import { EmotiBitAdapter, BitalinoAdapter } from './FutureAdapters.js';

/**
 * Add new devices here — one entry, one adapter class implementing
 * SensorAdapter — and they show up in the device picker automatically.
 */
export const SENSOR_REGISTRY = [
  { id: 'polar-h10', label: 'Polar H10 (Bluetooth)', Adapter: PolarH10Adapter, available: true },
  { id: 'emotibit', label: 'EmotiBit (coming soon)', Adapter: EmotiBitAdapter, available: false },
  { id: 'bitalino', label: 'BITalino (coming soon)', Adapter: BitalinoAdapter, available: false },
];
