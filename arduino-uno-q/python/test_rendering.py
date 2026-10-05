"""Hardware-free regression check for hrv.py and led_matrix.py.

Doesn't touch BLE or Bridge — just the pure-Python HRV math and frame
rendering, which is everything that can be verified without a physical
UNO Q and Polar H10 in hand. Run with: python3 test_rendering.py
"""

from hrv import HRVProcessor
from led_matrix import COLS, HEART_BITMAP, ROWS, render_bpm, render_heart


def test_hrv_math():
    hrv = HRVProcessor(window_seconds=60.0)
    rr_sequence_ms = [820, 810, 835, 800, 790, 825, 815, 805, 840, 795, 830, 812]
    t = 0.0
    metrics = None
    for rr in rr_sequence_ms:
        t += rr / 1000.0
        metrics = hrv.add_rr(rr, timestamp=t)

    assert 60 < metrics.bpm < 90, "bpm out of sane range"
    assert metrics.sdnn > 0 and metrics.rmssd > 0
    assert 0 <= metrics.coherence <= 1
    assert metrics.sample_count == len(rr_sequence_ms)
    print(
        f"HRV math: OK (bpm={metrics.bpm:.1f} rmssd={metrics.rmssd:.1f}ms "
        f"coherence={metrics.coherence:.2f})"
    )


def test_render_heart():
    frame = render_heart(200)
    assert len(frame) == ROWS * COLS == 104
    expected_lit = sum(sum(row) for row in HEART_BITMAP)
    actual_lit = sum(1 for v in frame if v > 0)
    assert actual_lit == expected_lit, f"expected {expected_lit} lit pixels, got {actual_lit}"
    assert set(frame) <= {0, 200}
    assert all(v == 0 for v in render_heart(0))
    print(f"render_heart: OK ({actual_lit} lit pixels)")


def test_render_bpm():
    frame = render_bpm(72)
    assert len(frame) == 104
    assert sum(1 for v in frame if v) == 18  # 7 lit cells in "7" + 11 in "2"
    print("render_bpm: OK")


def ascii_preview(frame, label):
    print(f"\n{label}:")
    for r in range(ROWS):
        row = frame[r * COLS : (r + 1) * COLS]
        print("".join("#" if v > 128 else ("." if v > 0 else " ") for v in row))


if __name__ == "__main__":
    test_hrv_math()
    test_render_heart()
    test_render_bpm()
    ascii_preview(render_heart(200), "heart @ brightness 200")
    ascii_preview(render_bpm(72), "bpm=72")
    print("\nALL TESTS PASSED")
