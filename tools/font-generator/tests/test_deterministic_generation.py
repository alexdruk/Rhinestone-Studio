#!/usr/bin/env python3
"""
FONT-GEN-001 focused test -- deterministic generation.

Regenerating the same size from the same source + config must produce byte-identical TTF bytes
(excluding the 'created'/'modified' timestamps fontTools' head table always stamps with the
current time -- everything else, including every glyph outline, must match exactly).
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from generate import generate_one
from paths import output_dir


def strip_head_timestamps(ttf_bytes):
    from fontTools.ttLib import TTFont
    import io
    # recalcTimestamp=False: TTFont.save() otherwise always re-stamps head.modified (and therefore
    # checkSumAdjustment) to the current wall-clock time regardless of what's set beforehand.
    font = TTFont(io.BytesIO(ttf_bytes), recalcTimestamp=False)
    font["head"].created = 0
    font["head"].modified = 0
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


def main():
    size_id = "SS6"
    out_path = output_dir(size_id) / f"SacramentoRhinestone_{size_id}.ttf"

    generate_one(size_id, verbose=False)
    first_bytes = strip_head_timestamps(out_path.read_bytes())

    generate_one(size_id, verbose=False)
    second_bytes = strip_head_timestamps(out_path.read_bytes())

    assert first_bytes == second_bytes, "Regenerating the same size must be byte-identical (modulo head timestamps)"
    print("PASS: deterministic generation (SS6 regenerated twice, identical output)")


if __name__ == "__main__":
    main()
