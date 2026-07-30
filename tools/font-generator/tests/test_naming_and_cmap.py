#!/usr/bin/env python3
"""
FONT-GEN-001 focused test -- internal font names + cmap preservation.

Checks the milestone brief's explicit "no ElegantCursive placeholder" requirement and that every
generated variant's cmap still covers exactly what the source Sacramento.ttf covers (Unicode
mappings preserved, per processing requirement #9).
"""
import sys
from pathlib import Path
from fontTools.ttLib import TTFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paths import SOURCE_FONT, output_dir

ALL_SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]


def main():
    source = TTFont(str(SOURCE_FONT))
    source_cmap = set(source.getBestCmap().keys())

    for size_id in ALL_SIZES:
        font_path = output_dir(size_id) / f"SacramentoRhinestone_{size_id}.ttf"
        font = TTFont(str(font_path))

        family = font["name"].getDebugName(1)
        assert family is not None and "ElegantCursive" not in family, f"{size_id}: placeholder name leaked into family"
        assert size_id in family, f"{size_id}: family name {family!r} does not identify the variant"
        assert "Sacramento" in family, f"{size_id}: family name {family!r} does not reference Sacramento"

        cmap = set(font.getBestCmap().keys())
        missing = source_cmap - cmap
        assert not missing, f"{size_id}: lost cmap coverage for codepoints {sorted(missing)}"

        print(f"PASS: {size_id} -- family={family!r}, cmap preserved ({len(cmap)} codepoints)")

    print("PASS: naming + cmap preservation for all 5 variants")


if __name__ == "__main__":
    main()
