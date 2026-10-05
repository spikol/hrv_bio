// UNO Q MCU-side sketch: a deliberately "dumb" display driver.
//
// All HRV logic, BLE handling, and frame rendering happens in Python on
// the Linux side (python/polar_hrv_display.py) — this sketch just blits
// whatever 104-byte grayscale buffer Bridge hands it to the 8x13 LED
// matrix. Mirrors how the browser app keeps rendering decisions out of
// SensorAdapter and in the visualizer classes.
//
// NOT verified against real hardware (built without a physical UNO Q to
// test on) — confirmed against Arduino's own published example snippets
// for Arduino_LED_Matrix + Bridge, but please check this against the
// boilerplate Arduino App Lab generates when you create a new "Sketch +
// Python App" project, in particular:
//   - whether Bridge needs an explicit #include on your App Lab version
//     (examples we found didn't show one, implying the board core
//     provides it automatically in an App Lab sketch — like Serial)
//   - whether loop() needs an explicit call to pump Bridge RPC dispatch
//   - ROWS/COLS orientation (see led_matrix.py's comment — flip there,
//     not here, if the heart/digits render sideways)

#include <Arduino_LED_Matrix.h>

Arduino_LED_Matrix matrix;

void draw(std::vector<uint8_t> frame) {
  if (frame.size() != 104) return;  // 8 x 13 — ignore malformed frames
  matrix.draw(frame.data());
}

void setup() {
  matrix.begin();
  matrix.setGrayscaleBits(8);  // 256 levels, matches the brightness values Python sends
  Bridge.begin();
  Bridge.provide("draw", draw);
}

void loop() {
  // Intentionally empty — rendering is driven entirely by draw() calls
  // arriving over Bridge from the Python side. If RPC calls stop working,
  // check whether your App Lab version expects something here (e.g. a
  // Bridge update/poll call) rather than assuming it's purely interrupt-driven.
}
