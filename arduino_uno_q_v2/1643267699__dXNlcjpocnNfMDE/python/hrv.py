"""Rolling HRV metrics from a stream of RR intervals.

Direct port of js/hrv/HRVProcessor.js — same formulas, same sliding
window, same simplified "coherence" (calm score). Kept as a line-for-line
equivalent so the two HRV pipelines (browser app, UNO Q display) agree
with each other; see that file's docstring for the full rationale on why
`coherence` is a relative heuristic and not the clinical HeartMath metric.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass


@dataclass
class HRVMetrics:
    bpm: float | None
    sdnn: float | None
    rmssd: float | None
    pnn50: float | None
    coherence: float | None
    sample_count: int


class HRVProcessor:
    def __init__(self, window_seconds: float = 60.0):
        self.window_seconds = window_seconds
        self._rr: list[tuple[float, float]] = []  # [(rr_ms, t_seconds), ...]
        self._baseline: float | None = None

    def add_rr(self, rr_ms: float, timestamp: float | None = None) -> HRVMetrics:
        t = timestamp if timestamp is not None else time.monotonic()
        self._rr.append((rr_ms, t))
        self._trim(t)
        return self._compute_metrics()

    def reset(self) -> None:
        self._rr.clear()
        self._baseline = None

    def _trim(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self._rr and self._rr[0][1] < cutoff:
            self._rr.pop(0)

    def _compute_metrics(self) -> HRVMetrics:
        rr = [v for v, _ in self._rr]
        n = len(rr)

        if n < 2:
            return HRVMetrics(None, None, None, None, None, n)

        mean = sum(rr) / n
        bpm = 60000.0 / mean

        variance = sum((v - mean) ** 2 for v in rr) / n
        sdnn = math.sqrt(variance)

        sq_diff_sum = 0.0
        nn50 = 0
        for i in range(1, n):
            diff = rr[i] - rr[i - 1]
            sq_diff_sum += diff * diff
            if abs(diff) > 50:
                nn50 += 1
        rmssd = math.sqrt(sq_diff_sum / (n - 1))
        pnn50 = (nn50 / (n - 1)) * 100

        coherence = self._coherence_score(rmssd)

        return HRVMetrics(bpm, sdnn, rmssd, pnn50, coherence, n)

    def _coherence_score(self, rmssd: float) -> float:
        if self._baseline is None:
            self._baseline = rmssd
        else:
            self._baseline = self._baseline * 0.95 + rmssd * 0.05
        ratio = rmssd / self._baseline if self._baseline > 0 else 1.0
        return 1.0 / (1.0 + math.exp(-4 * (ratio - 1)))
