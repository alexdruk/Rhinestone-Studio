"""IMG-025 reference prototype: stone clean-up for image layers on the staggered (hex) lattice.

This file is the reference the JavaScript build is checked against. It is not app code.

Fixture format (tools/fixtures/img-025/*.grid.txt): a JSON header line, then one text line per lattice
row. Header: {"pitchMm", "x0Mm", "y0Mm", "rowOffset", "colOffset", "box": {xMm, yMm, widthMm, heightMm},
"palette": [catalogue ids in catalogue order]}. Row line k is lattice row r = rowOffset + k; character j
is lattice column c = colOffset + j: '.' = no stone, 'a'.. = palette[index]. A stone at (r, c) sits at
x = x0Mm + c * pitch + (r mod 2) * pitch / 2, y = y0Mm + r * pitch * sqrt(3) / 2 (r mod 2 is 0 or 1).

Steps (all on the lattice; ties always go to the colour earlier in `palette`):
1. Holes: empty lattice points not 6-connected to the outside of the occupied bounding box (grown by one
   row/column) form enclosed holes. Each hole of at most HOLE_MAX points is filled one point at a time:
   the empty point with the most occupied neighbours first (ties: smallest row, then smallest column);
   its colour is the most frequent colour among its occupied neighbours. Holes are processed in the
   row-major order of their first point.
2. Speckle, 2 synchronous rounds: a stone with >= 4 occupied neighbours whose own colour appears on
   0 neighbours while the top neighbour colour appears on >= 3, or on 1 neighbour while the top colour
   appears on >= 4, takes the top colour.
3. Crumbs: 6-connected groups of fewer than CRUMB_MIN stones are removed.
4. Jet outline (optional): a stone with <= 4 occupied neighbours becomes 'jet', unless its centre is
   less than FRAME_PITCHES (1.1) pitches from the placement box edge (the image frame; 1.1 rather than 1
   so the staggered rows' first stones, exactly one pitch in, are never decided by rounding). Neighbour counts are taken before
   any recolouring in this step.
Usage: python3 stone_cleanup_reference.py fixture.grid.txt [--outline]
Prints JSON: counts and the sha256 of the output grid text (same format, header line excluded).
"""
import json, sys, hashlib
from collections import deque

HOLE_MAX = 10
CRUMB_MIN = 4
FRAME_PITCHES = 1.1
SQRT3_2 = 3 ** 0.5 / 2

def nbrs(r, c):
    if r % 2 == 0: return [(r, c - 1), (r, c + 1), (r - 1, c - 1), (r - 1, c), (r + 1, c - 1), (r + 1, c)]
    return [(r, c - 1), (r, c + 1), (r - 1, c), (r - 1, c + 1), (r + 1, c), (r + 1, c + 1)]

def top_colour(colours, order):
    counts = {}
    for c in colours: counts[c] = counts.get(c, 0) + 1
    best = min(counts, key=lambda c: (-counts[c], order[c]))
    return best, counts[best], counts

def fill_holes(g, order):
    rs = [k[0] for k in g]; cs = [k[1] for k in g]
    R0, R1, C0, C1 = min(rs) - 1, max(rs) + 1, min(cs) - 1, max(cs) + 1
    inbox = lambda k: R0 <= k[0] <= R1 and C0 <= k[1] <= C1
    outside = {(R0, C0)}; q = deque([(R0, C0)])
    while q:
        for n in nbrs(*q.popleft()):
            if inbox(n) and n not in g and n not in outside: outside.add(n); q.append(n)
    seen = set(); filled = []
    for r in range(R0, R1 + 1):
        for c in range(C0, C1 + 1):
            k = (r, c)
            if k in g or k in outside or k in seen: continue
            comp = []; q = deque([k]); seen.add(k)
            while q:
                a = q.popleft(); comp.append(a)
                for n in nbrs(*a):
                    if n not in g and n not in outside and n not in seen: seen.add(n); q.append(n)
            if len(comp) > HOLE_MAX: continue
            todo = set(comp)
            while todo:
                best = min(todo, key=lambda p: (-sum(n in g for n in nbrs(*p)), p[0], p[1]))
                g[best] = top_colour([g[n] for n in nbrs(*best) if n in g], order)[0]
                todo.discard(best); filled.append(best)
    return filled

def despeckle(g, order, original):
    for _ in range(2):
        changes = {}
        for k, own_colour in g.items():
            nb = [g[n] for n in nbrs(*k) if n in g]
            if len(nb) < 4: continue
            top, top_n, counts = top_colour(nb, order)
            own = counts.get(own_colour, 0)
            if (own == 0 and top_n >= 3) or (own == 1 and top_n >= 4): changes[k] = top
        if not changes: break
        g.update(changes)
    return sum(1 for k, c in original.items() if k in g and g[k] != c)

def remove_crumbs(g):
    seen = set(); drop = []
    for k in sorted(g):
        if k in seen: continue
        comp = []; q = deque([k]); seen.add(k)
        while q:
            a = q.popleft(); comp.append(a)
            for n in nbrs(*a):
                if n in g and n not in seen: seen.add(n); q.append(n)
        if len(comp) < CRUMB_MIN: drop += comp
    for k in drop: del g[k]
    return len(drop)

def outline(g, h):
    P = h['pitchMm']; F = FRAME_PITCHES * P; b = h['box']; n = 0
    edge = {k: sum(m in g for m in nbrs(*k)) <= 4 for k in g}
    for (r, c), is_edge in edge.items():
        if not is_edge or g[(r, c)] == 'jet': continue
        x = h['x0Mm'] + c * P + (r % 2) * P / 2; y = h['y0Mm'] + r * P * SQRT3_2
        if x - b['xMm'] < F or y - b['yMm'] < F or b['xMm'] + b['widthMm'] - x < F or b['yMm'] + b['heightMm'] - y < F: continue
        g[(r, c)] = 'jet'; n += 1
    return n

def read_grid(path):
    lines = open(path).read().split('\n'); h = json.loads(lines[0]); pal = h['palette']; g = {}
    for k, line in enumerate(l for l in lines[1:] if l != ''):
        for j, ch in enumerate(line):
            if ch != '.': g[(h['rowOffset'] + k, h['colOffset'] + j)] = pal[ord(ch) - 97]
    return h, g

def grid_text(h, g):
    pal = h['palette']; idx = {p: i for i, p in enumerate(pal)}
    rs = [k[0] for k in g]; cs = [k[1] for k in g]
    R0, R1, C0, C1 = min(rs), max(rs), min(cs), max(cs)
    rows = [''.join(chr(97 + idx[g[(r, c)]]) if (r, c) in g else '.' for c in range(C0, C1 + 1)) for r in range(R0, R1 + 1)]
    return f'{R0} {C0}\n' + '\n'.join(rows) + '\n'

def cleanup(h, g, with_outline):
    order = {p: i for i, p in enumerate(h['palette'])}
    original = dict(g)
    filled = fill_holes(g, order)
    recoloured = despeckle(g, order, original)
    removed = remove_crumbs(g)
    outlined = outline(g, h) if with_outline else 0
    return dict(before=len(original), filled=len(filled), recoloured=recoloured, removed=removed, outlined=outlined, after=len(g))

if __name__ == '__main__':
    h, g = read_grid(sys.argv[1])
    stats = cleanup(h, g, '--outline' in sys.argv)
    stats['sha256'] = hashlib.sha256(grid_text(h, g).encode()).hexdigest()
    print(json.dumps(stats))
