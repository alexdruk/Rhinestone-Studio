#!/usr/bin/env python3
"""FONT-CAL-002 -- contiguous span modification: widen / straighten / smooth.

FONT-CAL-001 modified exactly one on-curve point (the sharpest same-contour cusp) and
FONT-DIAG-001 measured that this had *zero* leverage on the production pipeline's driving prune
event -- StoneSampler's RC-004A dedup reads pairwise chord distance between arc-length-resampled
points, and a single moved vertex does not change that distance for the samples that actually
determine the worst gap. This script tests the FONT-CAL-002 hypothesis: does modifying a
*contiguous span* of points around that same cusp (not just the cusp point itself) change enough
of the outline's local shape/arc-length to move the driving prune event?

All three modes locate the same sharpest cusp FONT-CAL-001 used (reusing
`find_sharpest_cusp`/`push_direction` from ../../font-cal-001/python/modify_glyph.py -- read-only
reuse, no re-derivation) and then modify a fixed-radius span of on-curve points centered on it.
Span endpoints are always left unchanged so the modification blends continuously into the rest of
the contour (no new kink introduced at the span boundary).

Modes (three fundamentally different modification classes, matching three of
FONT-CAL-002's listed examples):

  widen      -- push each span point outward along its own local outward normal (same direction
                FONT-CAL-001 used per-point), scaled by a cosine bump that peaks at the cusp and
                tapers to exactly zero at the span edges. Generalizes FONT-CAL-001's single push
                into a smooth region of increased chord distance.
  straighten -- replace all interior span points with points linearly interpolated along the
                straight chord between the span's two (unchanged) endpoints. Removes the cusp's
                direction reversal entirely rather than pushing it further away.
  smooth     -- iterative Laplacian smoothing of the interior span points (endpoints held fixed),
                reducing the turn-angle sharpness gradually. Targets local curvature rather than
                position.

This script never writes a font file itself -- it writes a JSON modification description in the
same schema modify_glyph.py uses, consumed unchanged by
../../font-cal-001/python/build_candidate_font.py.

Usage:
    python3 modify_glyph_span.py --glyph m --mode widen --span-radius 3 --delta 300 \
        --out output/mods/mod-m-widen.json
    python3 modify_glyph_span.py --glyph m --mode straighten --span-radius 3 \
        --out output/mods/mod-m-straighten.json
    python3 modify_glyph_span.py --glyph m --mode smooth --span-radius 3 --iterations 3 \
        --out output/mods/mod-m-smooth.json
"""
import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'font-cal-001' / 'python'))
from modify_glyph import (  # noqa: E402
    SACRAMENTO_PATH, load_commands, on_curve_indices, normalize, find_sharpest_cusp, push_direction
)

from fontTools.ttLib import TTFont  # noqa: E402


def span_indices(n, center_index, radius):
    """Contiguous run of `2*radius + 1` on-curve indices centered on center_index, in order,
    wrapping modulo n (the single closed contour) exactly like find_sharpest_cusp does."""
    return [(center_index + offset) % n for offset in range(-radius, radius + 1)]


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def apply_widen(points, indices, delta):
    radius = (len(indices) - 1) // 2
    modified = list(points)
    for offset, idx in zip(range(-radius, radius + 1), indices):
        r = offset / radius if radius else 0
        weight = math.cos(math.pi / 2 * r)  # 1.0 at the cusp, exactly 0.0 at both span edges
        if weight <= 0:
            continue
        direction = push_direction(points, idx)
        px, py = points[idx]
        modified[idx] = (round(px + direction[0] * delta * weight), round(py + direction[1] * delta * weight))
    return modified


def apply_straighten(points, indices):
    modified = list(points)
    start, end = points[indices[0]], points[indices[-1]]
    steps = len(indices) - 1
    for i, idx in enumerate(indices):
        if i == 0 or i == steps:
            continue
        t = i / steps
        modified[idx] = (round(start[0] + (end[0] - start[0]) * t), round(start[1] + (end[1] - start[1]) * t))
    return modified


def apply_smooth(points, indices, iterations, alpha=0.5):
    current = {idx: points[idx] for idx in indices}
    interior = indices[1:-1]
    for _ in range(iterations):
        nxt = dict(current)
        for i, idx in enumerate(indices):
            if idx not in interior:
                continue
            prev_pt = current[indices[i - 1]]
            next_pt = current[indices[i + 1]]
            midx = (prev_pt[0] + next_pt[0]) / 2
            midy = (prev_pt[1] + next_pt[1]) / 2
            px, py = current[idx]
            nxt[idx] = (px + alpha * (midx - px), py + alpha * (midy - py))
        current = nxt
    modified = list(points)
    for idx in interior:
        x, y = current[idx]
        modified[idx] = (round(x), round(y))
    return modified


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--glyph', required=True, help='Single character to modify (e.g. "m")')
    parser.add_argument('--mode', required=True, choices=['widen', 'straighten', 'smooth'])
    parser.add_argument('--span-radius', type=int, default=3,
                         help='Span is 2*radius+1 on-curve points centered on the sharpest cusp (default: 3)')
    parser.add_argument('--delta', type=float, default=300.0, help='Font units, widen mode only (default: 300)')
    parser.add_argument('--iterations', type=int, default=3, help='Smoothing passes, smooth mode only (default: 3)')
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
    n = len(on_curve_points)
    if args.span_radius * 2 + 1 > n:
        raise SystemExit(f'--span-radius {args.span_radius} spans more points than the contour has ({n})')

    cusp_index, turn_dot = find_sharpest_cusp(on_curve_points)
    indices = span_indices(n, cusp_index, args.span_radius)

    if args.mode == 'widen':
        modified_points = apply_widen(on_curve_points, indices, args.delta)
    elif args.mode == 'straighten':
        modified_points = apply_straighten(on_curve_points, indices)
    else:
        modified_points = apply_smooth(on_curve_points, indices, args.iterations)

    max_displacement = max(dist(on_curve_points[i], modified_points[i]) for i in indices)

    modified_commands = [(cmd, list(cargs)) for cmd, cargs in commands]
    for idx in indices:
        ci, ti = locations[idx]
        cmd_name, cmd_args = modified_commands[ci]
        cmd_args[ti] = modified_points[idx]
        modified_commands[ci] = (cmd_name, tuple(cmd_args))

    result = {
        'glyph': args.glyph,
        'glyphName': glyph_name,
        'source': args.source,
        'unitsPerEm': font['head'].unitsPerEm,
        'mode': args.mode,
        'cuspIndex': cusp_index,
        'cuspTurnDot': turn_dot,
        'spanRadius': args.span_radius,
        'spanIndices': indices,
        'spanOldPoints': [on_curve_points[i] for i in indices],
        'spanNewPoints': [modified_points[i] for i in indices],
        # Characteristic displacement magnitude for this modification, in the same units/field
        # build_candidate_font.py's summary log already reads for single-vertex modifications --
        # for straighten/smooth this is measured (max span displacement), not a literal input delta.
        'deltaFontUnits': round(max_displacement, 1),
        'deltaFontUnitsInput': args.delta if args.mode == 'widen' else None,
        'iterations': args.iterations if args.mode == 'smooth' else None,
        'commands': [[cmd, list(cargs)] for cmd, cargs in modified_commands]
    }

    with open(args.out, 'w') as f:
        json.dump(result, f, indent=2)

    print(f'{args.glyph} ({glyph_name}) mode={args.mode}: span radius={args.span_radius} around cusp '
          f'turn_dot={turn_dot:.3f}, max displacement={max_displacement:.1f}fu')
    print(f'Wrote {args.out}')


if __name__ == '__main__':
    main()
