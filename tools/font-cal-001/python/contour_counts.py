#!/usr/bin/env python3
"""FONT-CAL-001 -- diagnosis support: per-glyph contour count for Sacramento.

Read-only inspection of fonts/sources/Sacramento/Sacramento.ttf's glyf table. Used to determine
which glyphs are single-contour (one continuous stroke -- the only shape this experiment's cusp-
widening modification technique can target) versus multi-contour (a separate decorative mark, e.g.
capital H/K's small flourish loops, printed with bounding boxes below to show they are genuinely
distinct small marks and not touching the main stroke).

Usage: python3 contour_counts.py
"""
import string

from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

SACRAMENTO_PATH = "fonts/sources/Sacramento/Sacramento.ttf"


def contours_for(glyph_set, glyph_name):
    pen = RecordingPen()
    glyph_set[glyph_name].draw(pen)
    contours = []
    current = []
    for command, args in pen.value:
        if command == "moveTo":
            if current:
                contours.append(current)
            current = [args[0]]
        elif command in ("lineTo",):
            current.append(args[0])
        elif command == "qCurveTo":
            current.extend(a for a in args if a is not None)
    if current:
        contours.append(current)
    return contours


def main():
    font = TTFont(SACRAMENTO_PATH)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()

    single_contour = []
    multi_contour = []
    for ch in string.ascii_lowercase + string.ascii_uppercase + string.digits:
        glyph_name = cmap.get(ord(ch))
        if not glyph_name:
            continue
        contours = contours_for(glyph_set, glyph_name)
        if len(contours) == 1:
            single_contour.append(ch)
        else:
            multi_contour.append((ch, contours))

    print(f"Single-contour glyphs ({len(single_contour)}): {single_contour}")
    print()
    print(f"Multi-contour glyphs ({len(multi_contour)}):")
    for ch, contours in multi_contour:
        print(f"  {ch}: {len(contours)} contours")
        for i, contour in enumerate(contours):
            xs = [p[0] for p in contour]
            ys = [p[1] for p in contour]
            print(f"    contour {i}: {len(contour)} pts, bbox x[{min(xs)},{max(xs)}] y[{min(ys)},{max(ys)}]")


if __name__ == "__main__":
    main()
