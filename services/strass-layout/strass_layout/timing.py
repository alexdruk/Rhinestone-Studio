"""Per-stage wall-clock timing in whole milliseconds."""
import time

STAGES = ("detect", "layout", "eyes", "colour", "check")


class Stopwatch:
    def __init__(self):
        self.t0 = self.mark = time.perf_counter()
        self.ms = {k: 0.0 for k in STAGES}

    def lap(self, stage):
        now = time.perf_counter()
        self.ms[stage] += (now - self.mark) * 1000
        self.mark = now

    def stages(self):
        return {k: int(round(v)) for k, v in self.ms.items()}

    def total(self):
        return int(round((time.perf_counter() - self.t0) * 1000))
