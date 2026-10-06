"""layout_frame() and layout(): the whole pipeline on arrays in memory.

layout_frame() runs the prototype's v6 pipeline and returns its final stones in the
prototype's own format, order and frame coordinates. layout() adds the IMG-026
steps on top: the S1 crop to the stones' bounding box, the S2 report recomputed
from the returned list, the S3 gap check on the rounded numbers and the S4
catalogue id check.
"""
import numpy as np

from .colour import CAT_IDS
from .detect import detect_stones
from .distinct import distinct_tones
from .errors import CatalogueMismatch, NoStones
from .geometry import FrameState, holes, violations
from .imageio import decode_png
from .models import load_models
from .ordered import ordered_layout
from .post import SIZE_KEYS, post_process
from .timing import Stopwatch

MIN_STONES = 50
RESULT_VERSION = 1


def layout_frame(png_bytes, target_pitch_mm=2.1, models=None):
    """Run the pipeline on PNG bytes.

    Returns {"stones": [{x, y, size, d, color}], "frame": {...}, "stagesMs": {...}, "ms": int}.
    The stones are in OpenAI-frame mm, in the prototype's order. The frame holds
    mmPerPx, widthMm, heightMm, the strict subject mask (an array), face and pupilsMm.
    """
    clock = Stopwatch()
    models = models or load_models()
    px = decode_png(png_bytes)
    det = detect_stones(px, models)
    if len(det) < MIN_STONES:
        raise NoStones("Only %d stones were detected; at least %d are needed." % (len(det), MIN_STONES))
    clock.lap("detect")
    state = FrameState(px.a, det, target_pitch_mm)
    first = ordered_layout(px, det, state)
    clock.lap("layout")
    stones, info = post_process(px, det, state, first, models, clock)
    P = np.array([[q["x"], q["y"]] for q in stones])
    D = np.array([q["d"] for q in stones])
    C = [q["color"] for q in stones]
    colours = distinct_tones(px.rgb, px.a, first["s"], P, D, C)
    for q, c in zip(stones, colours):
        q["color"] = c
    clock.lap("colour")
    s = float(first["s"])
    frame = {
        "mmPerPx": s,
        "widthMm": px.width * s,
        "heightMm": px.height * s,
        "mask": info["mask"],
        "face": info["face"],
        "pupilsMm": info["pupilsMm"],
    }
    return {"stones": stones, "frame": frame, "stagesMs": clock.stages(), "ms": clock.total()}


def check_colour_ids(color_ids):
    """S4: the service's catalogue must not hold an id the caller does not know."""
    if color_ids is None:
        return
    known = set(color_ids)
    extra = [c for c in CAT_IDS if c not in known]
    if extra:
        raise CatalogueMismatch("The layout service has colours the app does not know: " + ", ".join(extra))


def finish_layout(result):
    """S1 crop, S2 report and S3 gap check on the output of layout_frame()."""
    clock = Stopwatch()
    stones = result["stones"]
    frame = result["frame"]
    s = frame["mmPerPx"]
    P = np.array([[q["x"], q["y"]] for q in stones])
    D = np.array([q["d"] for q in stones])
    off_x = round(float((P[:, 0] - D / 2).min()), 3)
    off_y = round(float((P[:, 1] - D / 2).min()), 3)
    cropped = [[round(q["x"] - off_x, 3), round(q["y"] - off_y, 3), q["size"], q["color"]] for q in stones]
    Pc = np.array([[c[0], c[1]] for c in cropped])
    width = round(float((Pc[:, 0] + D / 2).max()), 3)
    height = round(float((Pc[:, 1] + D / 2).max()), 3)
    cnt, gmin = violations(Pc, D)
    hmax, cover = holes(P, D, frame["mask"], s)
    by_size = {}
    for key in SIZE_KEYS.values():
        n = sum(1 for q in stones if q["size"] == key)
        if n:
            by_size[key] = n
    counts = {}
    for q in stones:
        counts[q["color"]] = counts.get(q["color"], 0) + 1
    colours = dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))
    clock.lap("check")
    stages = dict(result["stagesMs"])
    stages["check"] += clock.stages()["check"]
    report = {
        "stones": len(stones),
        "bySize": by_size,
        "colours": colours,
        "minGapMm": round(float(gmin), 4),
        "violations": int(cnt.sum() // 2),
        "coverage": round(float(cover), 3),
        "largestEmptyCircleMm": round(float(hmax), 3),
        "face": frame["face"],
        "pupilsMm": frame["pupilsMm"],
        "frameMm": round(frame["widthMm"], 3),
        "offsetMm": [off_x, off_y],
        "mmPerPx": round(s, 6),
        "stagesMs": stages,
        "ms": result["ms"] + clock.total(),
    }
    return {"version": RESULT_VERSION, "widthMm": width, "heightMm": height, "stones": cropped, "report": report}


def layout(png_bytes, color_ids=None, target_pitch_mm=2.1, models=None):
    """PNG bytes in, the finished layout of IMG-026 out (see the spec's Entry point)."""
    check_colour_ids(color_ids)
    return finish_layout(layout_frame(png_bytes, target_pitch_mm, models))
