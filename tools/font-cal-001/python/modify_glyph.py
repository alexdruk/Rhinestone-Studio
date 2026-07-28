#!/usr/bin/env python3
"""FONT-CAL-001 -- targeted outline modification: single-vertex cusp widening.

Diagnosis (diagnose.mjs, grounded in src/geometry/StoneSampler.js's own documented RC-004A
same-contour dedup behavior) found that Sacramento's connected-cursive glyphs fragment into
multiple StoneLayout clusters at SS30 because a tight cusp -- a point where the outline reverses
direction sharply (e.g. the base of a stroke where it turns back up into the next hump) -- gets
pruned by the outline sampler's minimum-separation dedupe once the stone pitch is coarse enough
relative to that cusp's tightness.

This script implements ONE minimal, targeted modification: find the single on-curve point with the
sharpest direction reversal in a glyph's contour, and push that one point outward -- away from the
rest of the contour, along the direction it is already pointing -- by a fixed number of font units.
No other point moves. This is glyph-specific by construction (each glyph's sharpest cusp is at a
different location and angle) and deliberately does not attempt a general "smooth the whole glyph"
transform.

Reads the real Sacramento.ttf outline via fontTools (read-only). Writes a JSON description of the
modification (which glyph, which point, old/new coordinates, delta used) -- this script never
writes a font file itself; build_candidate_font.py consumes its output to assemble a candidate TTF.

Usage:
    python3 modify_glyph.py --glyph m --delta 70 --out output/mod-m.json
"""
import argparse
import json
import math

from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

SACRAMENTO_PATH = "fonts/sources/Sacramento/Sacramento.ttf"


def load_commands(glyph_set, glyph_name):
    pen = RecordingPen()
    glyph_set[glyph_name].draw(pen)
    return list(pen.value)


def on_curve_indices(commands):
    """Returns a list of (command_index, tuple_index) locating each on-curve point in `commands`,
    in contour order. moveTo's single point and every other command's last point are on-curve
    (confirmed against Sacramento's actual command stream -- see contour_counts.py's inspection)."""
    locations = []
    for ci, (cmd, args) in enumerate(commands):
        if cmd == 'moveTo':
            locations.append((ci, 0))
        elif cmd in ('lineTo', 'qCurveTo', 'curveTo'):
            locations.append((ci, len(args) - 1))
    return locations


def normalize(vx, vy):
    length = math.hypot(vx, vy)
    if length == 0:
        return (0.0, 0.0)
    return (vx / length, vy / length)


def find_sharpest_cusp(points):
    """points: ordered list of (x, y) on-curve points around one closed contour.
    Returns (index, turn_dot) for the point whose incoming/outgoing unit tangents are most
    nearly opposite (turn_dot closest to -1 = sharpest direction reversal)."""
    n = len(points)
    best_index = None
    best_dot = 2.0  # dot product is in [-1, 1]; start above the valid range
    for i in range(n):
        prev_pt = points[(i - 1) % n]
        cur_pt = points[i]
        next_pt = points[(i + 1) % n]
        incoming = normalize(cur_pt[0] - prev_pt[0], cur_pt[1] - prev_pt[1])
        outgoing = normalize(next_pt[0] - cur_pt[0], next_pt[1] - cur_pt[1])
        dot = incoming[0] * outgoing[0] + incoming[1] * outgoing[1]
        if dot < best_dot:
            best_dot = dot
            best_index = i
    return best_index, best_dot


def push_direction(points, index):
    n = len(points)
    prev_pt = points[(index - 1) % n]
    cur_pt = points[index]
    next_pt = points[(index + 1) % n]
    incoming = normalize(cur_pt[0] - prev_pt[0], cur_pt[1] - prev_pt[1])
    outgoing = normalize(next_pt[0] - cur_pt[0], next_pt[1] - cur_pt[1])
    # At a sharp cusp, outgoing ~= -incoming; (incoming - outgoing) doubles down on the direction
    # the tip is already pointing, extending the spike further away from the rest of the contour.
    return normalize(incoming[0] - outgoing[0], incoming[1] - outgoing[1])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--glyph', required=True, help='Single character to modify (e.g. "m")')
    parser.add_argument('--delta', type=float, required=True, help='Font units to push the cusp point outward')
    parser.add_argument('--source', default=SACRAMENTO_PATH, help='Source TTF path (default: Sacramento)')
    parser.add_argument('--out', required=True, help='Output JSON path describing the modification')
    args = parser.parse_args()

    font = TTFont(args.source)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    glyph_name = cmap.get(ord(args.glyph))
    if not glyph_name:
        raise SystemExit(f'No cmap entry for character "{args.glyph}"')

    commands = load_commands(glyph_set, glyph_name)
    locations = on_curve_indices(commands)
    on_curve_points = [commands[ci][1][ti] for ci, ti in locations]

    cusp_index, turn_dot = find_sharpest_cusp(on_curve_points)
    direction = push_direction(on_curve_points, cusp_index)
    old_point = on_curve_points[cusp_index]
    new_point = (
        round(old_point[0] + direction[0] * args.delta),
        round(old_point[1] + direction[1] * args.delta)
    )

    # Apply the single coordinate change to a fresh copy of the command list.
    modified_commands = [(cmd, list(cargs)) for cmd, cargs in commands]
    target_ci, target_ti = locations[cusp_index]
    cmd_name, cmd_args = modified_commands[target_ci]
    cmd_args[target_ti] = new_point
    modified_commands[target_ci] = (cmd_name, tuple(cmd_args))

    result = {
        'glyph': args.glyph,
        'glyphName': glyph_name,
        'source': args.source,
        'unitsPerEm': font['head'].unitsPerEm,
        'cuspTurnDot': turn_dot,
        'cuspOldPoint': old_point,
        'cuspNewPoint': new_point,
        'pushDirection': direction,
        'deltaFontUnits': args.delta,
        'commands': [[cmd, list(cargs)] for cmd, cargs in modified_commands]
    }

    with open(args.out, 'w') as f:
        json.dump(result, f, indent=2)

    print(f'{args.glyph} ({glyph_name}): sharpest cusp turn_dot={turn_dot:.3f} at {old_point} -> {new_point} (delta={args.delta}fu)')
    print(f'Wrote {args.out}')


if __name__ == '__main__':
    main()
