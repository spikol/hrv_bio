"""Builds 104-byte grayscale frames for the UNO Q's built-in 8x13 LED matrix.

All rendering happens here, in Python, on purpose: the MCU-side sketch
stays a ~20-line "dumb display driver" (just blits whatever 104-byte
buffer Bridge hands it), mirroring how the browser app keeps rendering
logic out of SensorAdapter and in the visualizer classes.

Matrix is treated as ROWS=8 x COLS=13, row-major, matching the "8 x 13 /
104 pixels" spec. If the on-board orientation turns out to be transposed
once you test against real hardware, flip ROWS/COLS below and the heart
bitmap's row/col loop — everything else is unaffected.
"""

from __future__ import annotations

ROWS = 8
COLS = 13

# 13-wide x 8-tall heart, hand-drawn, symmetric about the center column.
HEART_BITMAP = [
    [0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1],
    [1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0],
]

# Compact 3x5 digit font (row-major, 1 = lit) for the periodic BPM readout.
DIGIT_FONT: dict[str, list[list[int]]] = {
    "0": [[1, 1, 1], [1, 0, 1], [1, 0, 1], [1, 0, 1], [1, 1, 1]],
    "1": [[0, 1, 0], [1, 1, 0], [0, 1, 0], [0, 1, 0], [1, 1, 1]],
    "2": [[1, 1, 1], [0, 0, 1], [1, 1, 1], [1, 0, 0], [1, 1, 1]],
    "3": [[1, 1, 1], [0, 0, 1], [1, 1, 1], [0, 0, 1], [1, 1, 1]],
    "4": [[1, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], [0, 0, 1]],
    "5": [[1, 1, 1], [1, 0, 0], [1, 1, 1], [0, 0, 1], [1, 1, 1]],
    "6": [[1, 1, 1], [1, 0, 0], [1, 1, 1], [1, 0, 1], [1, 1, 1]],
    "7": [[1, 1, 1], [0, 0, 1], [0, 1, 0], [0, 1, 0], [0, 1, 0]],
    "8": [[1, 1, 1], [1, 0, 1], [1, 1, 1], [1, 0, 1], [1, 1, 1]],
    "9": [[1, 1, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], [1, 1, 1]],
}


def _blank_frame() -> list[int]:
    return [0] * (ROWS * COLS)


def render_heart(brightness: int) -> list[int]:
    """A full-brightness-at-`brightness` heart; 0-255. Used for the resting
    pulse glow and the bright flash on each real heartbeat."""
    brightness = max(0, min(255, brightness))
    frame = _blank_frame()
    for r in range(ROWS):
        for c in range(COLS):
            if HEART_BITMAP[r][c]:
                frame[r * COLS + c] = brightness
    return frame


def render_bpm(bpm: int) -> list[int]:
    """Two stacked 3x5 digits (tens, ones) of `bpm`, centered on the matrix."""
    digits = f"{max(0, min(99, round(bpm))):02d}"
    frame = _blank_frame()
    col_offset = 1
    row_offset = (ROWS - 5) // 2
    for digit in digits:
        glyph = DIGIT_FONT[digit]
        for r in range(5):
            for c in range(3):
                if glyph[r][c]:
                    frame[(row_offset + r) * COLS + (col_offset + c)] = 255
        col_offset += 4  # 3 wide + 1 column gap
    return frame
