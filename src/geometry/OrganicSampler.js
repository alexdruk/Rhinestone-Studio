/**
 * Bridson Poisson-disk (blue-noise) point sampling for Organic image placement (IMG-003).
 *
 * Pure and field-agnostic: `insideAt(localXMm, localYMm) -> boolean` is supplied by the caller, so
 * this module never reads a density field or knows what "on-field" means -- see
 * src/geometry/StoneSampler.js's sampleOrganicFieldFillPoints() for the field-aware wrapper that
 * builds insideAt() and offsets these local points into placement space. Working in LOCAL mm
 * (0,0-rooted), the same convention computeInwardRingPolygons() uses for its own boundingBox.
 *
 * No src/renderer or src/image imports -- src/geometry does not import either, per
 * docs/ARCHITECTURE.md's directional boundary. mulberry32() below is a private copy of
 * src/renderer/CrystalAppearance.js:29's own function, not an import (that function carries no
 * export keyword there, and this module could not cross that boundary even if it did).
 */

// mulberry32: a tiny seeded PRNG. Deterministic for a given 32-bit seed, which is all this needs
// -- not used anywhere security-sensitive.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_ATTEMPTS = 30;

/**
 * Bridson Poisson-disk sample of a placement box, restricted to points where `insideAt()` returns
 * true. See docs/specifications/IMG-003-OrganicPlacement.md, decision 2, for the exact algorithm
 * this implements (candidate test order, active-point selection, the island re-seed scan, and why
 * each of those choices is pinned rather than left to the implementer).
 *
 * Variable-radius mode (IMG-004, decision 2): when `radiusAt(localXMm, localYMm) -> number` is
 * supplied (with a required `maxRadiusMm` upper bound), each accepted point stores its own radius
 * instead of sharing one module-wide radius. Acceptance rejects a candidate when its distance to a
 * neighbour is below the *larger* of the candidate's own intended radius and the neighbour's
 * already-committed radius, and the neighbourhood search widens to `ceil(maxRadiusMm / cell)` cells
 * so a neighbour with a large stored radius is never missed. The active-point annulus draw uses the
 * active point's own stored radius rather than a single shared one. With `radiusAt` omitted, every
 * one of these reduces to exactly the original fixed-radius arithmetic -- one radius, a 2-cell
 * reach, `d = r * (1 + rand())` -- so this is a strict generalization, not a new code path.
 *
 * @param {object} args
 * @param {(localXMm: number, localYMm: number) => boolean} args.insideAt
 * @param {number} args.widthMm Placement box width (must be positive).
 * @param {number} args.heightMm Placement box height (must be positive).
 * @param {number} args.spacingMm Minimum center distance floor before `spread` is applied (must be positive).
 * @param {number} [args.seed] Integer PRNG seed. Default 1.
 * @param {number} [args.spread] Multiplier >= 1 widening the minimum center distance. Default 1.
 * @param {(localXMm: number, localYMm: number) => number} [args.radiusAt] Per-point radius function.
 *   When given, `maxRadiusMm` is required. Default null (fixed radius `spacingMm * max(1, spread)`).
 * @param {number} [args.maxRadiusMm] Upper bound on `radiusAt`'s output. Required when `radiusAt` is given.
 * @returns {{xMm: number, yMm: number}[]} Accepted points, in acceptance order, local mm.
 */
export function samplePoissonDiskPoints({
  insideAt,
  widthMm,
  heightMm,
  spacingMm,
  seed = 1,
  spread = 1,
  radiusAt = null,
  maxRadiusMm = null
}) {
  if (spacingMm <= 0) {
    throw new RangeError('samplePoissonDiskPoints requires a positive spacingMm.');
  }
  if (radiusAt && !(maxRadiusMm > 0)) {
    throw new RangeError('samplePoissonDiskPoints requires a positive maxRadiusMm when radiusAt is given.');
  }
  if (widthMm <= 0 || heightMm <= 0) {
    return [];
  }

  const rand = mulberry32(seed);
  const rMin = spacingMm * Math.max(1, spread);
  const rTop = radiusAt ? maxRadiusMm : rMin;
  const cell = rMin / Math.sqrt(2);
  const reach = Math.ceil(rTop / cell);
  const cols = Math.ceil(widthMm / cell);
  const rows = Math.ceil(heightMm / cell);
  const grid = new Int32Array(cols * rows).fill(-1);

  const points = [];
  const radii = [];
  const active = [];

  const cellOf = (x, y) => [
    Math.min(cols - 1, Math.floor(x / cell)),
    Math.min(rows - 1, Math.floor(y / cell))
  ];

  const farEnough = (x, y, rc) => {
    const [cx, cy] = cellOf(x, y);
    const minGx = Math.max(0, cx - reach);
    const maxGx = Math.min(cols - 1, cx + reach);
    const minGy = Math.max(0, cy - reach);
    const maxGy = Math.min(rows - 1, cy + reach);
    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const pointIndex = grid[gy * cols + gx];
        if (pointIndex < 0) continue;
        const p = points[pointIndex];
        const dx = p.xMm - x;
        const dy = p.yMm - y;
        const rr = Math.max(rc, radii[pointIndex]);
        if (dx * dx + dy * dy < rr * rr) return false;
      }
    }
    return true;
  };

  const tryAccept = (x, y) => {
    if (!(x >= 0 && y >= 0 && x <= widthMm && y <= heightMm)) return false;
    if (!insideAt(x, y)) return false;
    const rc = radiusAt ? radiusAt(x, y) : rMin;
    if (!farEnough(x, y, rc)) return false;
    const index = points.length;
    points.push({ xMm: x, yMm: y });
    radii.push(rc);
    const [cx, cy] = cellOf(x, y);
    grid[cy * cols + cx] = index;
    active.push(index);
    return true;
  };

  let scanCell = 0;

  for (;;) {
    while (active.length > 0) {
      const ai = Math.floor(rand() * active.length);
      const p = points[active[ai]];
      const rp = radii[active[ai]];
      let accepted = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const ang = rand() * 2 * Math.PI;
        const d = rp * (1 + rand());
        const x = p.xMm + d * Math.cos(ang);
        const y = p.yMm + d * Math.sin(ang);
        if (tryAccept(x, y)) {
          accepted = true;
          break;
        }
      }
      if (!accepted) {
        active[ai] = active[active.length - 1];
        active.pop();
      }
    }

    let seeded = false;
    while (scanCell < grid.length) {
      if (grid[scanCell] >= 0) {
        scanCell++;
        continue;
      }
      const cx = scanCell % cols;
      const cy = Math.floor(scanCell / cols);
      let accepted = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const x = (cx + rand()) * cell;
        const y = (cy + rand()) * cell;
        if (tryAccept(x, y)) {
          accepted = true;
          break;
        }
      }
      scanCell++;
      if (accepted) {
        seeded = true;
        break;
      }
    }

    if (!seeded) break;
  }

  return points;
}
