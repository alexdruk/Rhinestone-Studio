"""layout_frame() and layout(): the whole pipeline on arrays in memory.

layout_frame() runs the prototype's v6 pipeline and returns its final stones in the
prototype's own format, order and frame coordinates. layout() adds the IMG-026
steps on top: the S1 crop to the stones' bounding box, the S2 report recomputed
from the returned list, the S3 gap check on the rounded numbers and the S4
catalogue id check.

IMG-026M (from IS IS-05c): with Rules.skin_nearest_inner the colours skin_nearest reads are taken
from the inner ordered.SAMPLE_SHARE of each stone's radius instead of its whole disc. The report
gains pupilsAtMm (IS-05b), and face can be null (Rules.plausible_eyes).

IMG-026O (from IS spec 7.5): after the colours, layout_frame() runs the size cap, the overlap
cleanup and the hole fill that Rules.size_cap, overlap_cleanup and hole_fill turn on
(cleanup.clean_up). The report gains their acceptance figures: capped, removed, removedShare, filled
and cleanupCoverage (IS's coverage after the cleanup); violations and minGapMm are measured on the
returned stones, so after every step. stagesMs gains "cleanup".

IMG-026P (from IS spec 7.6): with mode "bw" (Black & white), layout_frame() then reads every stone's
Jet or Crystal from the AI image (bw.map_black_and_white), the filled stones by the vote; its time
counts under "cleanup". The caller's colorIds then need only Jet and Crystal.
"""
import numpy as np

from .bw import BW_IDS, DEFAULT_BW_THRESHOLD, map_black_and_white
from .cleanup import clean_up
from .colour import CAT_IDS, palette, stone_colours
from .detect import detect_stones
from .distinct import distinct_tones
from .faces import finish_faces
from .errors import CatalogueMismatch, NoStones
from .geometry import FrameState, holes, violations
from .imageio import decode_png
from .models import load_models
from .ordered import SAMPLE_SHARE, ordered_layout
from .post import SIZE_KEYS, post_process
from .rules import DEFAULT
from .timing import Stopwatch

MIN_STONES = 50
RESULT_VERSION = 1
MODES = ("colour", "bw")


def layout_frame(png_bytes, target_pitch_mm=2.1, models=None, rules=DEFAULT, mode="colour", bw_threshold=DEFAULT_BW_THRESHOLD):
    """Run the pipeline on PNG bytes.

    Returns {"stones": [{x, y, size, d, color}], "frame": {...}, "stagesMs": {...}, "ms": int}.
    The stones are in OpenAI-frame mm, in the prototype's order. The frame holds
    mmPerPx, widthMm, heightMm, the strict subject mask (an array), face, pupilsMm, pupilsAtMm
    (the pupil stones' centres) and cleanup (clean_up()'s figures, or None when no build O rule is on).
    IMG-026P: mode "bw" makes every stone Jet or Crystal by the AI image's lightness (bw_threshold).
    """
    if mode not in MODES:
        raise ValueError("mode must be colour or bw.")
    clock = Stopwatch()
    models = models or load_models()
    px = decode_png(png_bytes)
    det = detect_stones(px, models)
    if len(det) < MIN_STONES:
        raise NoStones("Only %d stones were detected; at least %d are needed." % (len(det), MIN_STONES))
    clock.lap("detect")
    state = FrameState(px.a, det, target_pitch_mm)
    first = ordered_layout(px, det, state, rules)
    clock.lap("layout")
    stones, info = post_process(px, det, state, first, models, clock, rules)
    P = np.array([[q["x"], q["y"]] for q in stones])
    D = np.array([q["d"] for q in stones])
    C = [q["color"] for q in stones]
    colours = distinct_tones(px.rgb, px.a, first["s"], P, D, C, palette(rules), rules.mean_colour)
    # IMG-026M (IS-05c): with rules.skin_nearest_inner, skin_nearest reads the inner SAMPLE_SHARE of each stone.
    share = SAMPLE_SHARE if rules.skin_nearest_inner else 1.0
    lab = stone_colours(px.rgb, px.a, np.stack([P[:, 1] / first["s"], P[:, 0] / first["s"], share * 0.5 * D / first["s"], np.zeros(len(P))], 1), True) if rules.skin_nearest else None
    colours = finish_faces(P, D, colours, palette(rules), info["face"], info["eyeZones"], rules, lab)
    for q, c in zip(stones, colours):
        q["color"] = c
    clock.lap("colour")
    s = float(first["s"])
    cleanup = None
    if rules.size_cap or rules.overlap_cleanup or rules.hole_fill:  # IMG-026O
        stones, cleanup = clean_up(stones, px.rgba[..., 3], s, info["face"], info["pupilsAtMm"], info["mask"], rules)
    if mode == "bw":  # IMG-026P: the filled stones come last in stones
        filled = cleanup["filled"] if cleanup else 0
        stones = map_black_and_white(stones, px.rgba, s, range(len(stones) - filled, len(stones)), bw_threshold)
    clock.lap("cleanup")
    frame = {
        "mmPerPx": s,
        "widthMm": px.width * s,
        "heightMm": px.height * s,
        "mask": info["mask"],
        "face": info["face"],
        "pupilsMm": info["pupilsMm"],
        "pupilsAtMm": info["pupilsAtMm"],
        "cleanup": cleanup,
    }
    return {"stones": stones, "frame": frame, "stagesMs": clock.stages(), "ms": clock.total()}


def check_colour_ids(color_ids, mode="colour"):
    """S4: the service's catalogue must not hold an id the caller does not know. IMG-026P: in Black &
    white the service answers only Jet and Crystal, so only those two must be known."""
    if color_ids is None:
        return
    known = set(color_ids)
    extra = [c for c in (BW_IDS if mode == "bw" else CAT_IDS) if c not in known]
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
    cleanup = frame.get("cleanup") or {"capped": 0, "removed": 0, "removedShare": 0.0, "filled": 0, "coverage": cover}
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
        "capped": cleanup["capped"],
        "removed": cleanup["removed"],
        "removedShare": round(float(cleanup["removedShare"]), 4),
        "filled": cleanup["filled"],
        "cleanupCoverage": round(float(cleanup["coverage"]), 3),
        "face": frame["face"],
        "pupilsMm": frame["pupilsMm"],
        "pupilsAtMm": [[round(x - off_x, 3), round(y - off_y, 3)] for x, y in frame["pupilsAtMm"]],
        "frameMm": round(frame["widthMm"], 3),
        "offsetMm": [off_x, off_y],
        "mmPerPx": round(s, 6),
        "stagesMs": stages,
        "ms": result["ms"] + clock.total(),
    }
    return {"version": RESULT_VERSION, "widthMm": width, "heightMm": height, "stones": cropped, "report": report}


def layout(png_bytes, color_ids=None, target_pitch_mm=2.1, models=None, rules=DEFAULT, mode="colour", bw_threshold=DEFAULT_BW_THRESHOLD):
    """PNG bytes in, the finished layout of IMG-026 out (see the spec's Entry point). IMG-026P: mode
    "colour" (the default) or "bw" (Black & white: only Jet and Crystal)."""
    if mode not in MODES:
        raise ValueError("mode must be colour or bw.")
    check_colour_ids(color_ids, mode)
    return finish_layout(layout_frame(png_bytes, target_pitch_mm, models, rules, mode, bw_threshold))
