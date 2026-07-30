#!/usr/bin/env python3
"""FONT-CAL-001 -- candidate font generation.

Takes a base TTF plus one or more modify_glyph.py output JSON files (each describing a single
glyph's modified outline commands) and writes a new, temporary candidate TTF: an exact copy of the
source font with only the named glyphs' outlines replaced.

This script does no geometry decisions of its own -- it only replays the commands modify_glyph.py
already computed through a TTGlyphPen and swaps the resulting glyph into a copy of the font's glyf
table. Every other glyph, table, and metric is byte-identical to the source font.

Usage:
    python3 build_candidate_font.py --source fonts/sources/Sacramento/Sacramento.ttf \
        --modification output/mod-m.json --modification output/mod-n.json \
        --out /tmp/sacramento-candidate.ttf
"""
import argparse
import json

from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen


def replay_commands(pen, commands):
    for cmd, cargs in commands:
        points = [tuple(p) if p is not None else None for p in cargs]
        if cmd == 'moveTo':
            pen.moveTo(points[0])
        elif cmd == 'lineTo':
            pen.lineTo(points[0])
        elif cmd == 'qCurveTo':
            pen.qCurveTo(*points)
        elif cmd == 'curveTo':
            pen.curveTo(*points)
        elif cmd == 'closePath':
            pen.closePath()
        else:
            raise ValueError(f'Unsupported recorded command: {cmd}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, help='Base TTF path')
    parser.add_argument('--modification', action='append', required=True, dest='modifications',
                         help='Path to a modify_glyph.py output JSON (repeatable)')
    parser.add_argument('--out', required=True, help='Output candidate TTF path')
    args = parser.parse_args()

    font = TTFont(args.source)
    glyph_set = font.getGlyphSet()
    applied = []

    for mod_path in args.modifications:
        with open(mod_path) as f:
            mod = json.load(f)

        glyph_name = mod['glyphName']
        pen = TTGlyphPen(glyph_set)
        replay_commands(pen, mod['commands'])
        new_glyph = pen.glyph()

        font['glyf'][glyph_name] = new_glyph
        # hmtx (advance width/left-side-bearing) is untouched -- this experiment only moves an
        # existing on-curve point, never changes the glyph's advance width.
        applied.append({'glyph': mod['glyph'], 'glyphName': glyph_name, 'deltaFontUnits': mod['deltaFontUnits']})

    font.save(args.out)
    print(f'Wrote candidate font {args.out} with {len(applied)} modified glyph(s): {applied}')


if __name__ == '__main__':
    main()
