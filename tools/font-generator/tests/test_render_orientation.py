#!/usr/bin/env python3
"""
FONT-GEN-005 focused test -- render_stones.py orientation regression guard.

A real bug was found: render_review_png()/render_ocr_image() flipped Y (`h - (yMm - miny) * scale`)
as if StoneLayout's yMm were the standard math/font Y-up convention. It isn't -- opentype.js's
Glyph.getPath() already negates Y internally for direct canvas rendering, and
src/renderer/CanvasRenderer2D.js's renderStoneLayout() maps `yPx = oy + stone.yMm * s` with no flip
at all. StoneLayout's yMm is Y-down already, so the extra flip in render_stones.py double-flipped
it, rendering every review/OCR image upside down (see docs/specifications/FONT-GEN-005-*.md).

This locks in the fix with a synthetic case (no font/measure.mjs dependency): a stone at the
lowest yMm must land in the top half of the output image, matching CanvasRenderer2D.js's own
(flip-free) convention, and a stone at the highest yMm must land in the bottom half.
"""
import sys
import tempfile
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.render_stones import render_review_png, render_ocr_image

# Two widely-separated, distinctly-colored-by-position stones: min yMm at one xMm, max yMm at a
# different xMm, so the rendered pixel positions unambiguously identify which stone is which.
STONES = [
    {"xMm": 0.0, "yMm": 0.0, "sizeMm": 2.0},   # min yMm
    {"xMm": 20.0, "yMm": 40.0, "sizeMm": 2.0},  # max yMm
]


def _darkest_row_band(img, is_dark):
    """Returns (top_half_has_mark, bottom_half_has_mark) for pixels matching is_dark(pixel)."""
    w, h = img.size
    px = img.load()
    top_hit = bottom_hit = False
    for y in range(h):
        for x in range(w):
            if is_dark(px[x, y]):
                if y < h / 2:
                    top_hit = True
                else:
                    bottom_hit = True
    return top_hit, bottom_hit


def _expected_columns(w, pad_mm, px_per_mm):
    # Mirrors render_stones.py's own _bounds()/cx formula: minx = min(xMm) - pad_mm.
    minx = 0.0 - pad_mm
    stone1_cx = (STONES[0]["xMm"] - minx) * px_per_mm
    stone2_cx = (STONES[1]["xMm"] - minx) * px_per_mm
    return int(stone1_cx), int(stone2_cx)


def check_review_png():
    px_per_mm = 10
    pad_mm = max(s["sizeMm"] for s in STONES)
    with tempfile.TemporaryDirectory() as tmp:
        out_path = Path(tmp) / "orientation.png"
        render_review_png(STONES, out_path, px_per_mm=px_per_mm)
        img = Image.open(out_path).convert("RGB")
        w, h = img.size
        px = img.load()
        stone_color = (243, 189, 50)
        stone1_x, stone2_x = _expected_columns(w, pad_mm, px_per_mm)

        def col_hit_rows(x):
            return [y for y in range(h) if px[max(0, min(w - 1, x)), y] == stone_color]

        min_y_stone_rows = col_hit_rows(stone1_x)  # STONES[0]: min yMm
        max_y_stone_rows = col_hit_rows(stone2_x)  # STONES[1]: max yMm

        assert min_y_stone_rows, "expected to find the min-yMm stone's pixels at its expected column"
        assert max_y_stone_rows, "expected to find the max-yMm stone's pixels at its expected column"

        assert max(min_y_stone_rows) < h / 2, (
            f"min-yMm stone should render in the TOP half of the image (row < {h/2}), "
            f"found rows {min_y_stone_rows} -- Y-flip regression"
        )
        assert min(max_y_stone_rows) > h / 2, (
            f"max-yMm stone should render in the BOTTOM half of the image (row > {h/2}), "
            f"found rows {max_y_stone_rows} -- Y-flip regression"
        )
    print("PASS: render_review_png -- min yMm renders at top, max yMm renders at bottom (matches CanvasRenderer2D.js)")


def check_ocr_image():
    px_per_mm = 10
    pad_mm = max(s["sizeMm"] for s in STONES) * 2  # matches render_ocr_image()'s own pad_mm
    img = render_ocr_image(STONES, px_per_mm=px_per_mm, blur_mm=0.01).convert("L")
    w, h = img.size
    px = img.load()
    # render_ocr_image() supersamples 4x then downsamples, plus a fixed 24px margin -- compute the
    # expected column the same way, in final (post-downsample, post-margin) pixel space.
    minx = 0.0 - pad_mm
    scale = px_per_mm  # SUPERSAMPLE cancels out: pixel positions are computed pre-downsample then / SUPERSAMPLE
    margin = 24
    stone1_x = margin + int((STONES[0]["xMm"] - minx) * scale)
    stone2_x = margin + int((STONES[1]["xMm"] - minx) * scale)

    def col_hit_rows(x):
        return [y for y in range(h) if px[max(0, min(w - 1, x)), y] < 128]

    min_y_stone_rows = col_hit_rows(stone1_x)
    max_y_stone_rows = col_hit_rows(stone2_x)

    assert min_y_stone_rows, "expected to find the min-yMm stone's dark pixels at its expected column"
    assert max_y_stone_rows, "expected to find the max-yMm stone's dark pixels at its expected column"
    assert max(min_y_stone_rows) < h / 2, (
        f"min-yMm stone should render in the TOP half of the OCR image, found rows {min_y_stone_rows}"
    )
    assert min(max_y_stone_rows) > h / 2, (
        f"max-yMm stone should render in the BOTTOM half of the OCR image, found rows {max_y_stone_rows}"
    )
    print("PASS: render_ocr_image -- min yMm renders at top, max yMm renders at bottom (matches CanvasRenderer2D.js)")


def main():
    check_review_png()
    check_ocr_image()
    print("PASS: render_stones.py orientation regression guard")


if __name__ == "__main__":
    main()
