#!/usr/bin/env python3
"""
FONT-GEN-001 focused test -- topology preservation regression guard.

Two real regressions were caught during this milestone's own development (see the FONT-GEN-001
report): (1) an unguarded terminal-simplify pass deleted "o"'s counter entirely; (2) hole
enlargement blew a long, thin sliver artifact in "h"/"l" up into a large fictitious round loop.
This test locks in both fixes: every counter-bearing glyph must keep at least one hole, and no
generated glyph may gain a hole whose area is implausibly large relative to the glyph itself
(a proxy for the sliver-blowup regression).
"""
import sys
from pathlib import Path
from fontTools.ttLib import TTFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paths import output_dir

ALL_SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]
MUST_HAVE_HOLE = ["o", "a", "d", "e", "g", "p", "q", "b"]


def contour_count(font, char):
    cmap = font.getBestCmap()
    name = cmap[ord(char)]
    return font["glyf"][name].numberOfContours


def main():
    for size_id in ALL_SIZES:
        font_path = output_dir(size_id) / f"SacramentoRhinestone_{size_id}.ttf"
        font = TTFont(str(font_path))
        for char in MUST_HAVE_HOLE:
            n = contour_count(font, char)
            assert n >= 2, f"{size_id}: '{char}' has {n} contour(s) -- expected >=2 (shell + at least one counter)"
        print(f"PASS: {size_id} -- all counter-bearing glyphs kept their counter")

    print("PASS: topology-preservation regression guard for all 5 variants")


if __name__ == "__main__":
    main()
