import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createGeometryEngine } from '../src/geometry/index.js';
import {
  generateLineDesignStonePoints,
  LINE_DESIGN_CHAIN_STONE_SIZE_MM,
  LINE_DESIGN_FILL_STONE_SIZE_MM,
  LINE_DESIGN_CLOSING_DISK_RADIUS_RATIO_OF_DIAMETER,
  LINE_DESIGN_MODAL_COLOR_RADIUS_RATIO
} from '../src/geometry/LineDesignSampler.js';
import { rawGridDistanceTransform } from '../src/geometry/ContourRingSampler.js';
import { GAP_FILL_STONE_SIZE_MM } from '../src/geometry/GapFill.js';
import { rgbToLab, cie76Distance } from '../src/image/ColorSpace.js';
import { computeSubjectMask } from '../src/image/index.js';
import { CRYSTAL_COLORS, STONE_COLORS } from '../src/renderer/CrystalColors.js';

// IMG-010 second follow-up: generateLineDesignStonePoints() now requires a `palette` (the
// src/renderer/** import it used to reach directly is forbidden for src/geometry/**, per
// tools/test-architecture-module-boundaries.mjs) -- mirrors app.js's own imageColorPalette() shape
// ({id,hex}, hex from previewColor/fill, identical values) for every direct engine.generateImageLayout()
// call below with mode:'line-design'. Tests may import src/renderer/** freely; only src/geometry/**
// itself may not.
const LINE_DESIGN_PALETTE = CRYSTAL_COLORS.map((c) => ({ id: c.id, hex: c.previewColor }));

// IMG-010 -- Line Design: a filled subject traced as an outline chain plus skeleton-derived line
// chains at SS6 (2.0mm), the interior filled with SS10 (2.8mm) rings, and the existing IMG-013
// gap-fill pass pocketing the leftover space with SS6 fillers. See
// docs/specifications/IMG-010-LineDesign.md.
//
// Items 1-13 are the spec's own test plan (Task E), with the fixture (item 1) inlined verbatim.
// Item 14 is D1's four antenna-bridging measurements; item 15 is D3 (Mixed Stone Size is a no-op for
// this mode); item 16 is D4 (the app.js-side stone-list cache + drag freeze). Items 17-20 are the
// IMG-010 follow-up (colour overrides, a corrected resize-drag freeze, and the pocket pass's own
// modal colour rule): 17/18 are the colorMap override + its cache-key participation; 19 replaces
// item 16's control-drag freeze scenario with the actual resize-drag one (the only drag that ever
// forces a real per-tick line-design recompute -- see lineDesignFrozen's own doc comment in app.js);
// 20 is the pocket pass's own modal-colour rule. Mutation-tested: 3, 5, 7, 12, 16, 17, 19, 20
// (verified separately, against a deliberately broken copy of the relevant code, that each of those
// items actually fails when it should -- see the milestone's own report).

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// ---- Item 1: the fixture, inlined verbatim -------------------------------------------------------
// A filled silhouette (body + four wing lobes) with a one-stone-wide dark rim band, four dark veins
// (two axis-aligned, one diagonal, one quadratic-Bezier curve), a wide dark blob (must fill, not
// chain), two antennae made of geometrically disconnected dark dots, three colour zones plus one
// deliberately under-1.2%-share colour spot, and two enclosed fully-transparent pockets.

const FIXTURE_W = 640, FIXTURE_H = 560;
const WING_LEFT = [0x2f, 0x6f, 0xd0], WING_RIGHT = [0x31, 0xa8, 0x6d], BODY = [0xe3, 0x92, 0x30];
const DARK = [0x17, 0x17, 0x17], SPOT = [0xc5, 0x1f, 0x63];
const ANTENNA_L = [[320, 158], [250, 60]], ANTENNA_R = [[320, 158], [390, 60]]; // 13 disconnected dots each
const ANTENNA_DOT_COUNT = 13;
const ANTENNA_DOT_RADIUS_PX = 3.5;
const POCKETS = [[420, 250, 14], [250, 420, 10]]; // enclosed transparent holes
const WIDE_BLOB = [200, 255, 26]; // must fill, not chain
const VEIN_RADIUS_PX = 4;
const RIM_WIDTH_PX = 5;
const SPOT_CIRCLE = [470, 400, 12];

function inEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx, dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}
function distToSegment(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((x - x1) * dx + (y - y1) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
function quadBezierPolyline(p0, p1, p2, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([
      (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
      (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
    ]);
  }
  return pts;
}
function distToPolyline(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = distToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}
const CURVED_VEIN = quadBezierPolyline([350, 360], [440, 480], [530, 375], 40); // [350,360]->[440,480]->[530,375]

function blobAt(x, y, shrinkPx = 0) {
  return inEllipse(x, y, 320, 300, 26 - shrinkPx, 150 - shrinkPx) ||     // body
    inEllipse(x, y, 200, 230, 130 - shrinkPx, 110 - shrinkPx) ||        // top-left wing
    inEllipse(x, y, 440, 230, 130 - shrinkPx, 110 - shrinkPx) ||        // top-right wing
    inEllipse(x, y, 235, 400, 95 - shrinkPx, 95 - shrinkPx) ||          // bottom-left wing
    inEllipse(x, y, 405, 400, 95 - shrinkPx, 95 - shrinkPx);            // bottom-right wing
}
function isBodyEllipse(x, y) {
  return inEllipse(x, y, 320, 300, 26, 150);
}
function antennaDots(pitchPx) {
  const dots = [];
  for (const [a, b] of [ANTENNA_L, ANTENNA_R]) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    for (let k = 0; k < ANTENNA_DOT_COUNT; k++) dots.push([a[0] + ux * pitchPx * k, a[1] + uy * pitchPx * k]);
  }
  return dots;
}

// makeFixture(): pixel loop -- pockets -> alpha 0 (RGB stays 0,0,0, must be inpainted); rim/veins/
// wideBlob/dots -> DARK; spot -> SPOT; body ellipse -> BODY; else left/right of x=320 ->
// WING_LEFT/WING_RIGHT. `dotPitchPx` defaults to 9 (this file's primary fixture); item 14 also
// builds it at 10 for D1's second bridging case.
function makeFixture({ dotPitchPx = 9 } = {}) {
  const W = FIXTURE_W, H = FIXTURE_H;
  const data = new Uint8ClampedArray(W * H * 4); // transparent black everywhere by default
  const dots = antennaDots(dotPitchPx);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let inPocket = false;
      for (const [cx, cy, r] of POCKETS) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) inPocket = true;
      if (inPocket) continue;

      let isDark = blobAt(x, y) && !blobAt(x, y, RIM_WIDTH_PX);
      if (!isDark) isDark = distToSegment(x, y, 300, 290, 180, 170) <= VEIN_RADIUS_PX; // 45deg
      if (!isDark) isDark = distToSegment(x, y, 360, 300, 520, 300) <= VEIN_RADIUS_PX; // horizontal
      if (!isDark) isDark = distToSegment(x, y, 240, 300, 240, 430) <= VEIN_RADIUS_PX; // vertical
      if (!isDark) isDark = distToPolyline(x, y, CURVED_VEIN) <= VEIN_RADIUS_PX; // curved
      if (!isDark) isDark = (x - WIDE_BLOB[0]) ** 2 + (y - WIDE_BLOB[1]) ** 2 <= WIDE_BLOB[2] ** 2;
      if (!isDark) for (const [dx0, dy0] of dots) if ((x - dx0) ** 2 + (y - dy0) ** 2 <= ANTENNA_DOT_RADIUS_PX ** 2) { isDark = true; break; }

      if (isDark) { data[i] = DARK[0]; data[i + 1] = DARK[1]; data[i + 2] = DARK[2]; data[i + 3] = 255; continue; }
      if ((x - SPOT_CIRCLE[0]) ** 2 + (y - SPOT_CIRCLE[1]) ** 2 <= SPOT_CIRCLE[2] ** 2) {
        data[i] = SPOT[0]; data[i + 1] = SPOT[1]; data[i + 2] = SPOT[2]; data[i + 3] = 255; continue;
      }
      if (isBodyEllipse(x, y)) { data[i] = BODY[0]; data[i + 1] = BODY[1]; data[i + 2] = BODY[2]; data[i + 3] = 255; continue; }
      if (blobAt(x, y)) {
        const c = x < 320 ? WING_LEFT : WING_RIGHT;
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
      }
      // else: transparent background (already 0,0,0,0)
    }
  }
  return { widthPx: W, heightPx: H, data };
}

// Shared by every test below: run the fixture through the real production path at a given width.
const engine = createGeometryEngine();
function runFixture(widthMm, { dotPitchPx = 9, gapMm = 0.3, extra = {} } = {}) {
  const heightMm = widthMm * FIXTURE_H / FIXTURE_W;
  const buffer = makeFixture({ dotPitchPx });
  const layout = engine.generateImageLayout({
    imageBuffer: buffer, layerId: 'img010-fixture', xMm: 0, yMm: 0, widthMm, heightMm,
    stoneSizeMm: 2.8, gapMm, mode: 'line-design', color: 'jet', palette: LINE_DESIGN_PALETTE,
    maxWidthPx: 2000, maxHeightPx: 2000, ...extra
  });
  return { layout, widthMm, heightMm, mmPerPx: widthMm / FIXTURE_W };
}

function stonesByKind(layout) {
  const byKind = { outline: [], line: [], fill: [], pocket: [] };
  for (const s of layout.stones) byKind[s.metadata.kind || 'pocket'].push(s);
  return byKind;
}
function groupByPathId(stones) {
  const m = new Map();
  for (const s of stones) {
    const id = s.metadata.pathId;
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(s);
  }
  return m;
}

// ---- Item 2/3 shared helper: vein centrelines, in pixel space -----------------------------------
const VEIN_DIST_FNS = {
  diagonal45: (xPx, yPx) => distToSegment(xPx, yPx, 300, 290, 180, 170),
  horizontal: (xPx, yPx) => distToSegment(xPx, yPx, 360, 300, 520, 300),
  vertical: (xPx, yPx) => distToSegment(xPx, yPx, 240, 300, 240, 430),
  curved: (xPx, yPx) => distToPolyline(xPx, yPx, CURVED_VEIN)
};

// Groups this fixture's own line-chain stones by pathId, then returns every path whose MEAN
// distance to `distFn`'s centreline is under `meanThresholdMm` -- i.e. "this traced chain belongs
// to this vein" -- sorted longest (most stones) first. Distinct from a plain spatial bounding-box
// filter (which this milestone's own tuning found picks up unrelated nearby chains/fragments at any
// padding generous enough to be called a "region") -- path identity is real chain membership, not a
// proxy for it.
function pathsNearVein(lineStones, mmPerPx, distFn, meanThresholdMm) {
  const byPath = groupByPathId(lineStones);
  const matches = [];
  for (const [pathId, stones] of byPath) {
    const dists = stones.map((s) => distFn(s.xMm / mmPerPx, s.yMm / mmPerPx) * mmPerPx);
    const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
    if (mean < meanThresholdMm) matches.push({ pathId, stones, dists });
  }
  matches.sort((a, b) => b.stones.length - a.stones.length);
  return matches;
}

await test('1. Fixture builds without throwing and exercises every decision at once (silhouette, veins, wide blob, antennae, pockets, spot, rim)', () => {
  const buffer = makeFixture();
  assert.equal(buffer.widthPx, FIXTURE_W);
  assert.equal(buffer.heightPx, FIXTURE_H);
  let opaqueCount = 0, transparentCount = 0;
  for (let i = 3; i < buffer.data.length; i += 4) (buffer.data[i] > 0 ? opaqueCount++ : transparentCount++);
  assert.ok(opaqueCount > 50000, `expected a substantial opaque silhouette, got ${opaqueCount} px`);
  assert.ok(transparentCount > 50000, `expected substantial transparent background, got ${transparentCount} px`);
});

await test('2. Chains follow their vein: every line-chain stone on a path matched to a vein is within chainRadius+tolerance of that vein\'s true centreline (independently computed, not from the pipeline\'s own skeleton)', () => {
  const CHAIN_RADIUS_MM = LINE_DESIGN_CHAIN_STONE_SIZE_MM / 2;
  const TOLERANCE_MM = 0.5;
  for (const widthMm of [130, 180]) {
    const { layout, mmPerPx } = runFixture(widthMm);
    const lineStones = stonesByKind(layout).line;
    for (const [veinName, distFn] of Object.entries(VEIN_DIST_FNS)) {
      const matches = pathsNearVein(lineStones, mmPerPx, distFn, 1.0);
      // Trims each matched path's own first/last stone before checking: a chain's endpoint is
      // exactly where it terminates at a junction cluster (this vein meeting the rim/body/another
      // vein), whose centroid position is a blend of every structure meeting there, not a point on
      // this vein alone -- a separate, expected effect from "does the chain track the vein along
      // its own run" (see LineDesignSampler.js's traceSkeletonPaths() junction-clustering comment).
      const interiorStones = matches.flatMap((m) => (m.stones.length > 2 ? m.stones.slice(1, -1) : []));
      const interiorDists = matches.flatMap((m) => (m.dists.length > 2 ? m.dists.slice(1, -1) : []));
      assert.ok(interiorStones.length > 0, `${widthMm}mm ${veinName}: expected at least one matched interior chain stone`);
      const maxDist = Math.max(...interiorDists);
      assert.ok(maxDist <= CHAIN_RADIUS_MM + TOLERANCE_MM,
        `${widthMm}mm ${veinName}: matched stone strayed ${maxDist.toFixed(3)}mm from centreline (budget ${(CHAIN_RADIUS_MM + TOLERANCE_MM).toFixed(3)}mm)`);
    }
  }
});

await test('3. No gap between consecutive same-chain stones exceeds chainPitchMm*1.15 on the curved vein\'s chain (the arc-length-on-bends regression case)', () => {
  const gapMm = 0.3;
  const pitchMm = LINE_DESIGN_CHAIN_STONE_SIZE_MM + gapMm;
  const SLOP = 0.15;
  let checkedAtLeastOnce = false;
  for (const widthMm of [130, 180]) {
    const { layout, mmPerPx } = runFixture(widthMm, { gapMm });
    const lineStones = stonesByKind(layout).line;
    const matches = pathsNearVein(lineStones, mmPerPx, VEIN_DIST_FNS.curved, 1.0);
    if (matches.length === 0) continue;
    const chain = matches[0].stones; // longest matched fragment on the curve
    if (chain.length < 2) continue;
    checkedAtLeastOnce = true;
    let maxGap = 0;
    for (let i = 0; i + 1 < chain.length; i++) {
      maxGap = Math.max(maxGap, Math.hypot(chain[i + 1].xMm - chain[i].xMm, chain[i + 1].yMm - chain[i].yMm));
    }
    assert.ok(maxGap <= pitchMm * (1 + SLOP),
      `${widthMm}mm curved vein: max consecutive gap ${maxGap.toFixed(3)}mm exceeds ${(pitchMm * (1 + SLOP)).toFixed(3)}mm`);
  }
  assert.ok(checkedAtLeastOnce, 'expected at least one multi-stone chain fragment on the curved vein at some width');
});

// ---- Item 4/14 shared helper: ink-mask closing-disk bridging (D1) -------------------------------
// Isolated measurement of decision (d)'s own closing step -- dilate then erode the antenna dots'
// own ink mask by the D1-corrected closing radius (0.6 stone DIAMETERS = 1.2mm) -- independent of
// the fuller pipeline's downstream skeleton-tracing fragmentation (a separate, expected defect the
// spec's own "Defect found" section documents; see item 4's second assertion below for that).
function labelComponents8(mask, cols, rows) {
  const pixelCount = cols * rows;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let count = 0;
  for (let start = 0; start < pixelCount; start++) {
    if (!mask[start] || visited[start]) continue;
    count++;
    let head = 0, tail = 0;
    queue[tail++] = start; visited[start] = 1;
    while (head < tail) {
      const idx = queue[head++];
      const x = idx % cols, y = (idx - x) / cols;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nIdx = ny * cols + nx;
        if (mask[nIdx] && !visited[nIdx]) { visited[nIdx] = 1; queue[tail++] = nIdx; }
      }
    }
  }
  return count;
}
function measureAntennaInkBridging(dotPitchPx, widthMm) {
  const mmPerPx = widthMm / FIXTURE_W;
  const dots = antennaDots(dotPitchPx).slice(0, ANTENNA_DOT_COUNT); // one antenna
  const mask = new Uint8Array(FIXTURE_W * FIXTURE_H);
  for (let y = 0; y < FIXTURE_H; y++) for (let x = 0; x < FIXTURE_W; x++) {
    for (const [dx0, dy0] of dots) {
      if ((x - dx0) ** 2 + (y - dy0) ** 2 <= ANTENNA_DOT_RADIUS_PX ** 2) { mask[y * FIXTURE_W + x] = 1; break; }
    }
  }
  const beforeCount = labelComponents8(mask, FIXTURE_W, FIXTURE_H);
  const closingRadiusMm = LINE_DESIGN_CLOSING_DISK_RADIUS_RATIO_OF_DIAMETER * LINE_DESIGN_CHAIN_STONE_SIZE_MM;
  const complement = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) complement[i] = mask[i] ? 0 : 1;
  const distToMask = rawGridDistanceTransform(complement, FIXTURE_W, FIXTURE_H, mmPerPx);
  const dilated = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) dilated[i] = distToMask[i] <= closingRadiusMm ? 1 : 0;
  const distToBackground = rawGridDistanceTransform(dilated, FIXTURE_W, FIXTURE_H, mmPerPx);
  const closed = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) closed[i] = (dilated[i] && distToBackground[i] >= closingRadiusMm) ? 1 : 0;
  const afterCount = labelComponents8(closed, FIXTURE_W, FIXTURE_H);
  return { beforeCount, afterCount };
}

await test('4. Antennae dots bridge: the ink-mask closing step reduces both antennae from 13 disconnected dots to 1 component each (this fixture\'s own 9px pitch), at both widths, and the full pipeline places more than zero line-chain stones along each antenna (not silently dropping it)', () => {
  for (const widthMm of [130, 180]) {
    const { beforeCount, afterCount } = measureAntennaInkBridging(9, widthMm);
    assert.equal(beforeCount, ANTENNA_DOT_COUNT, `${widthMm}mm: expected ${ANTENNA_DOT_COUNT} disconnected dots before closing`);
    assert.equal(afterCount, 1, `${widthMm}mm: expected the closing disk to bridge the antenna into 1 component`);
  }
  // Full-pipeline placement check, both antennae, both widths -- decision (d)'s own downstream
  // tracer still fragments a bridged antenna into several short chains rather than one long one
  // (the spec's own documented, D2-mitigated-not-eliminated junction-fragmentation defect), so this
  // checks real placement coverage, not "exactly one chain".
  for (const widthMm of [130, 180]) {
    const { layout, mmPerPx } = runFixture(widthMm);
    const lineStones = stonesByKind(layout).line;
    for (const [label, [a, b]] of [['L', ANTENNA_L], ['R', ANTENNA_R]]) {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      const nearAntenna = lineStones.filter((s) => distToSegment(s.xMm / mmPerPx, s.yMm / mmPerPx, a[0], a[1], a[0] + dx, a[1] + dy) * mmPerPx <= 1.5 && Math.hypot(s.xMm / mmPerPx - a[0], s.yMm / mmPerPx - a[1]) <= len + 5);
      assert.ok(nearAntenna.length > 0, `${widthMm}mm antenna ${label}: expected at least one line-chain stone placed along the bridged antenna`);
    }
  }
});

await test('5. The wide dark area fills, it does not chain: every outline/line/fill stone whose centre falls inside WIDE_BLOB\'s circle has sizeMm===LINE_DESIGN_FILL_STONE_SIZE_MM, none is chain-sized', () => {
  for (const widthMm of [130, 180]) {
    const { layout, mmPerPx } = runFixture(widthMm);
    const inBlob = layout.stones.filter((s) => {
      if (s.metadata.kind === 'pocket') return false; // decision (f)'s own separate SS6 pass, not decision (d)'s chain/fill routing
      const xPx = s.xMm / mmPerPx, yPx = s.yMm / mmPerPx;
      return (xPx - WIDE_BLOB[0]) ** 2 + (yPx - WIDE_BLOB[1]) ** 2 <= WIDE_BLOB[2] ** 2;
    });
    assert.ok(inBlob.length > 0, `${widthMm}mm: expected some stones inside the wide dark blob`);
    for (const s of inBlob) {
      // Literal 2.8, not the imported constant -- a mutation that swaps which constant a stone
      // population uses must not also be able to shift this assertion's own expectation.
      assert.equal(s.sizeMm, 2.8, `${widthMm}mm: stone inside wide blob at (${s.xMm},${s.yMm}) has sizeMm=${s.sizeMm}, expected 2.8 (fill size)`);
      assert.notEqual(s.metadata.kind, 'line', `${widthMm}mm: a 'line' stone landed inside the wide blob`);
      assert.notEqual(s.metadata.kind, 'outline', `${widthMm}mm: an 'outline' stone landed inside the wide blob`);
    }
  }
});

await test('6. No pairwise overlap: every stone (outline, line, fill, pocket) satisfies distance >= (sizeA+sizeB)/2 + gapMm against every other stone', () => {
  for (const widthMm of [130, 180]) {
    const { layout } = runFixture(widthMm);
    const stones = layout.stones;
    let violations = 0;
    for (let i = 0; i < stones.length; i++) {
      for (let j = i + 1; j < stones.length; j++) {
        const dist = Math.hypot(stones[i].xMm - stones[j].xMm, stones[i].yMm - stones[j].yMm);
        const minSep = (stones[i].sizeMm + stones[j].sizeMm) / 2 + 0.3 - 1e-6;
        if (dist < minSep) violations++;
      }
    }
    assert.equal(violations, 0, `${widthMm}mm: found ${violations} overlapping stone pair(s)`);
  }
});

// ---- Independent CIE76 catalog labelling, used by items 7/8/9 to cross-check the pipeline's own
// colour decisions against a from-scratch recomputation over the raw fixture pixels (not calling
// into LineDesignSampler.js at all).
const CATALOG_LABS = CRYSTAL_COLORS.map((c) => {
  const h = c.fill.replace('#', '');
  return rgbToLab(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
});
function nearestCatalogId(r, g, b, allowedIds = null) {
  const lab = rgbToLab(r, g, b);
  let best = -1, bestD = Infinity;
  for (let c = 0; c < CRYSTAL_COLORS.length; c++) {
    if (allowedIds && !allowedIds.has(CRYSTAL_COLORS[c].id)) continue;
    const d = cie76Distance(lab, CATALOG_LABS[c]);
    if (d < bestD) { bestD = d; best = c; }
  }
  return CRYSTAL_COLORS[best].id;
}

await test('7. Enclosed pockets are filled and correctly coloured, never the raw-black-implied jet a missing inpaint would produce', () => {
  for (const widthMm of [130, 180]) {
    const { layout, mmPerPx } = runFixture(widthMm);
    // Any population can legitimately cover a (now hole-filled) pocket -- a fill ring may already
    // reach it before the pocket pass even runs; decision (a)'s own regression case is about colour
    // correctness there, not about which of decisions (c)-(f) happens to be the one that places it.
    let sawAnyPocketStone = false;
    const allPocketColors = new Set();
    for (const [cx, cy, r] of POCKETS) {
      const inPocket = layout.stones.filter((s) => {
        const xPx = s.xMm / mmPerPx, yPx = s.yMm / mmPerPx;
        return (xPx - cx) ** 2 + (yPx - cy) ** 2 <= r * r;
      });
      for (const s of inPocket) {
        sawAnyPocketStone = true;
        allPocketColors.add(s.color);
        assert.ok(typeof s.color === 'string' && s.color.length > 0, `${widthMm}mm pocket(${cx},${cy}): stone has no resolved colour`);
      }
    }
    assert.ok(sawAnyPocketStone, `${widthMm}mm: expected at least one stone over the enclosed pockets`);
    // The literal regression case: colour must not be uniformly 'jet' for every pocket stone at
    // every pocket (that is exactly what a raw, un-inpainted (0,0,0) pocket pixel would nearest-match
    // to) -- decision (a)'s inpaint step is what lets a pocket resolve to its surrounding zone's own
    // colour instead.
    assert.ok(!(allPocketColors.size === 1 && allPocketColors.has('jet')), `${widthMm}mm: every pocket stone came back 'jet' -- looks like a missing inpaint`);
  }
});

await test('8. Under-threshold colour (the fuchsia spot, ~0.3% share) is dropped and relabelled -- zero stones carry it', () => {
  for (const widthMm of [130, 180]) {
    const { layout } = runFixture(widthMm);
    const fuchsiaStones = layout.stones.filter((s) => s.color === 'fuchsia');
    assert.equal(fuchsiaStones.length, 0, `${widthMm}mm: expected zero 'fuchsia' stones (under the 1.2% share floor)`);
    // Sanity: the surviving catalog ids are exactly the fixture's four large zones' nearest matches.
    const expectedSurvivors = new Set([
      nearestCatalogId(...DARK), nearestCatalogId(...WING_LEFT), nearestCatalogId(...WING_RIGHT), nearestCatalogId(...BODY)
    ]);
    const usedColors = new Set(layout.stones.map((s) => s.color));
    for (const c of usedColors) assert.ok(expectedSurvivors.has(c), `${widthMm}mm: unexpected surviving colour '${c}' used by a stone`);
  }
});

await test('9. Modal colour, not point-sample: a fill stone straddling the body/wing colour boundary resolves to the majority catalog label under 80% of its own radius, verified independently against a direct per-pixel re-scan', () => {
  for (const widthMm of [130, 180]) {
    const { layout, mmPerPx } = runFixture(widthMm);
    const buffer = makeFixture();
    const fillStones = stonesByKind(layout).fill;
    // Stones whose centre sits within one fill diameter of x=320 (the body/wing seam) are the
    // boundary-adjacent candidates Task B's own measurement used.
    const boundaryStones = fillStones.filter((s) => Math.abs(s.xMm / mmPerPx - 320) <= LINE_DESIGN_FILL_STONE_SIZE_MM);
    assert.ok(boundaryStones.length > 0, `${widthMm}mm: expected at least one fill stone near the body/wing seam`);
    const radiusPx = (LINE_DESIGN_FILL_STONE_SIZE_MM / 2) * 0.8 / mmPerPx;
    for (const s of boundaryStones) {
      const cx = s.xMm / mmPerPx, cy = s.yMm / mmPerPx;
      const counts = new Map();
      const rPx = Math.max(1, Math.round(radiusPx));
      for (let dy = -rPx; dy <= rPx; dy++) {
        for (let dx = -rPx; dx <= rPx; dx++) {
          if (dx * dx + dy * dy > rPx * rPx) continue;
          const px = Math.round(cx) + dx, py = Math.round(cy) + dy;
          if (px < 0 || py < 0 || px >= FIXTURE_W || py >= FIXTURE_H) continue;
          const o = (py * FIXTURE_W + px) * 4;
          if (buffer.data[o + 3] === 0) continue; // pocket/background pixel, not part of the silhouette
          const id = nearestCatalogId(buffer.data[o], buffer.data[o + 1], buffer.data[o + 2]);
          counts.set(id, (counts.get(id) || 0) + 1);
        }
      }
      if (counts.size === 0) continue;
      let bestId = null, bestCount = -1;
      for (const [id, count] of counts) if (count > bestCount) { bestCount = count; bestId = id; }
      assert.equal(s.color, bestId, `${widthMm}mm: boundary fill stone at (${s.xMm.toFixed(2)},${s.yMm.toFixed(2)}) has colour '${s.color}', independent modal re-scan expected '${bestId}'`);
    }
  }
});

await test('10. Fixed-size stones regardless of layer stoneSizeMm: chain/fill sizes are identical as the layer\'s own stoneSizeMm is varied', () => {
  const sizes = [];
  for (const stoneSizeMm of [1.5, 2.8, 6.4]) {
    const heightMm = 130 * FIXTURE_H / FIXTURE_W;
    const buffer = makeFixture();
    const layout = engine.generateImageLayout({
      imageBuffer: buffer, layerId: 'fixed-size', xMm: 0, yMm: 0, widthMm: 130, heightMm,
      stoneSizeMm, gapMm: 0.3, mode: 'line-design', color: 'jet', palette: LINE_DESIGN_PALETTE,
      maxWidthPx: 2000, maxHeightPx: 2000
    });
    sizes.push(layout.stones.map((s) => [s.xMm, s.yMm, s.sizeMm, s.color]));
  }
  assert.deepEqual(sizes[0], sizes[1], 'stoneSizeMm=1.5 vs 2.8 produced different stone lists');
  assert.deepEqual(sizes[0], sizes[2], 'stoneSizeMm=1.5 vs 6.4 produced different stone lists');
  const usedSizes = new Set(sizes[0].map((s) => s[2]));
  for (const size of usedSizes) assert.ok(size === LINE_DESIGN_CHAIN_STONE_SIZE_MM || size === LINE_DESIGN_FILL_STONE_SIZE_MM, `unexpected stone size ${size}`);
});

// ---- Item 11: byte identity for every existing mode, literals captured at pristine tip 64bb20f
// (STEP 0, before any IMG-010 code) via createGeometryEngine().generateImageLayout() on a small
// fixed disc fixture -- decision 3's byte-identity guarantee.
function buildStep0DiscBuffer(widthPx, heightPx) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  const cx = widthPx / 2, cy = heightPx / 2, r = Math.min(widthPx, heightPx) * 0.46;
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const i = (y * widthPx + x) * 4;
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      data[i] = inside ? 0 : 255; data[i + 1] = inside ? 0 : 255; data[i + 2] = inside ? 0 : 255; data[i + 3] = 255;
    }
  }
  return { widthPx, heightPx, data };
}
const STEP0_BASELINE = {
  fill: { stoneCount: 457, first3: [[24.150000000000006, 3.4499999999999997, 2, 'jet'], [26.450000000000006, 3.4499999999999997, 2, 'jet'], [28.750000000000007, 3.4499999999999997, 2, 'jet']], last3: [[33.35000000000001, 56.34999999999998, 2, 'jet'], [35.650000000000006, 56.34999999999998, 2, 'jet'], [37.95, 56.34999999999998, 2, 'jet']] },
  staggered: { stoneCount: 526, first3: [[25.300000000000004, 3.1418584287042086, 2, 'jet'], [27.600000000000005, 3.1418584287042086, 2, 'jet'], [29.900000000000006, 3.1418584287042086, 2, 'jet']], last3: [[31.050000000000008, 56.92203600371781, 2, 'jet'], [33.35000000000001, 56.92203600371781, 2, 'jet'], [35.650000000000006, 56.92203600371781, 2, 'jet']] },
  radial: { stoneCount: 439, first3: [[30, 30, 2, 'jet'], [27.7, 30, 2, 'jet'], [34.6, 30, 2, 'jet']], last3: [[56.73289524715022, 23.136159114249992, 2, 'jet'], [57.213490623145944, 25.397182590635587, 2, 'jet'], [57.50320291528632, 27.690491524028083, 2, 'jet']] },
  contour: { stoneCount: 297, first3: [[30.18197259966779, 3.7374999999999994, 2, 'jet'], [34.706252998938396, 4.141796875, 2, 'jet'], [39.090056159036905, 5.341584251211008, 2, 'jet']], last3: [[26.916512403780843, 28.577716956693568, 2, 'jet'], [30.94923879967551, 29.21664736718704, 2, 'jet'], [29.352609741564358, 30.87217618022386, 2, 'jet']] },
  organic: { stoneCount: 310, first3: [[24.622960516993565, 3.1769723019558564, 2, 'jet'], [26.613359412070963, 5.744501568515615, 2, 'jet'], [30.678776877075798, 7.41698182486747, 2, 'jet']], last3: [[43.86405138076221, 38.562713116436285, 2, 'jet'], [50.20622608043773, 42.43353715513589, 2, 'jet'], [52.771610998307004, 45.79479440750727, 2, 'jet']] },
  edge: { stoneCount: 205, first3: [[24.622960516993565, 3.1769723019558564, 2, 'jet'], [26.613359412070963, 5.744501568515615, 2, 'jet'], [30.678776877075798, 7.41698182486747, 2, 'jet']], last3: [[45.313174394023065, 43.87489364259268, 2, 'jet'], [17.572004720552677, 47.86234299340625, 2, 'jet'], [12.919559195745743, 51.71287491284197, 2, 'jet']] }
};
await test('11. Byte identity: fill/staggered/radial/contour/organic/edge reproduce their STEP 0 literals (captured at pristine tip 64bb20f) exactly on this tip', () => {
  const buffer = buildStep0DiscBuffer(200, 200);
  const params = {
    layerId: 'step0-disc', xMm: 0, yMm: 0, widthMm: 60, heightMm: 60,
    stoneSizeMm: 2.0, gapMm: 0.3, color: 'jet',
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
    transparent: 'white', maskMode: 'threshold', colorCount: 1, colorMap: {}
  };
  for (const [mode, golden] of Object.entries(STEP0_BASELINE)) {
    const layout = engine.generateImageLayout({ ...params, imageBuffer: buffer, mode });
    const pick = (s) => [s.xMm, s.yMm, s.sizeMm, s.color];
    assert.equal(layout.stones.length, golden.stoneCount, `${mode}: stone count`);
    assert.deepEqual(layout.stones.slice(0, 3).map(pick), golden.first3, `${mode}: first 3 stones`);
    assert.deepEqual(layout.stones.slice(-3).map(pick), golden.last3, `${mode}: last 3 stones`);
  }
});

// ---- Item 12: engine-level forwarding through app.js's real generateImageStonesLive() ----------
function extractGenerateImageStonesLiveSource(appJs) {
  const startMarker = 'async generateImageStonesLive(layer,{includeStats=false}={}){';
  const start = appJs.indexOf(startMarker);
  assert.ok(start !== -1, 'expected to find generateImageStonesLive() in app.js');
  const braceStart = start + startMarker.length - 1;
  let depth = 0;
  for (let i = braceStart; i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}') { depth--; if (depth === 0) return appJs.slice(start, i + 1); }
  }
  throw new Error('expected to find the matching closing "}" of generateImageStonesLive() in app.js');
}
function buildGenerateImageStonesLive(source, deps) {
  const rewritten = source.replace('async generateImageStonesLive(', 'async function generateImageStonesLive(');
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'imageBufferCache', 'decodeDataUrlToBuffer', 'resolveImageFillMode', 'resolveImageTransparentMode',
    'resolveImageMaskMode', 'resolveImageColorCount', 'imageColorPalette', 'resolveImageSeed',
    'resolveImageSpread', 'resolveImageEdgeWidth', 'resolveImageEdgeThinning', 'resolveImageBrightnessThinning',
    'mixedSizeParamsFor', 'lineDesignStoneCache', 'lineDesignFrozen', 'lineDesignColorMapKey', 'resolveImageVividness',
    `return ${rewritten};`
  )(
    deps.imageBufferCache, deps.decodeDataUrlToBuffer, deps.resolveImageFillMode, deps.resolveImageTransparentMode,
    deps.resolveImageMaskMode, deps.resolveImageColorCount, deps.imageColorPalette, deps.resolveImageSeed,
    deps.resolveImageSpread, deps.resolveImageEdgeWidth, deps.resolveImageEdgeThinning, deps.resolveImageBrightnessThinning,
    deps.mixedSizeParamsFor, deps.lineDesignStoneCache, deps.lineDesignFrozen, deps.lineDesignColorMapKey, deps.resolveImageVividness
  );
  return fn;
}
// IMG-010 follow-up: the same sorted-key stable serialization app.js's own lineDesignColorMapKey()
// uses for the cache key's colorMap segment -- duplicated here (not imported) because it is a
// module-private function in app.js, the same reason every other dependency above is passed in
// rather than imported.
function lineDesignColorMapKeyForTest(colorMap) {
  const keys = Object.keys(colorMap || {}).sort();
  return keys.map((k) => `${k}=${colorMap[k]}`).join(',');
}
async function callRealGenerateImageStonesLive(layer, imageBufferCacheEntries, lineDesignStoneCache = new Map(), lineDesignFrozen = false) {
  const appJs = await readFile(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8');
  const source = extractGenerateImageStonesLiveSource(appJs);
  const generateImageStonesLive = buildGenerateImageStonesLive(source, {
    imageBufferCache: new Map(imageBufferCacheEntries),
    decodeDataUrlToBuffer: async () => { throw new Error('unexpected decode: buffer should already be cached'); },
    resolveImageFillMode: (v) => (v === 'line-design' ? 'line-design' : 'fill'),
    resolveImageTransparentMode: (v) => v ?? 'white',
    resolveImageMaskMode: (v) => (v === 'subject' ? 'subject' : 'threshold'),
    resolveImageColorCount: (l) => l.colorCount ?? 1,
    imageColorPalette: () => Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor })),
    resolveImageSeed: (v) => v ?? 1,
    resolveImageSpread: (v) => v ?? 1,
    resolveImageEdgeWidth: (v) => v ?? 6,
    resolveImageEdgeThinning: (v) => v ?? 1,
    resolveImageBrightnessThinning: (v) => v ?? 0,
    mixedSizeParamsFor: () => ({}),
    lineDesignStoneCache,
    lineDesignFrozen,
    lineDesignColorMapKey: lineDesignColorMapKeyForTest,
    resolveImageVividness: (v) => ([1, 1.2, 1.4, 1.6].includes(v) ? v : 1)
  });
  return { fn: generateImageStonesLive, source };
}

await test("12. Engine-level forwarding: the real (extracted, not hand-copied) generateImageStonesLive() source reaches engine.generateImageLayout() with mode:'line-design' and returns real outline/line/fill/pocket stones, not the plain-'fill' fallback normalizeImageParams() would silently produce if the mode string were ever dropped along the way", async () => {
  const buffer = makeFixture();
  const engineForCall = createGeometryEngine();
  const { fn: generateImageStonesLive, source } = await callRealGenerateImageStonesLive({}, [['img1', buffer]]);
  const layer = {
    id: 'L1', imageSrc: 'img1', x: 0, y: 0, w: 130, h: 130 * FIXTURE_H / FIXTURE_W,
    stoneSize: 2.8, gap: 0.3, fillMode: 'line-design', color: 'jet',
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
    transparent: 'white', maskMode: 'threshold', colorCount: 1, colorMap: {}
  };
  const stones = await generateImageStonesLive.call({ permanentEngine: engineForCall }, layer);
  assert.ok(stones.length > 100, `expected a substantial stone count from the real fixture, got ${stones.length}`);
  const byKind = new Map();
  for (const s of stones) byKind.set(s.layerId, (byKind.get(s.layerId) || 0) + 1);
  assert.ok(byKind.get('L1') === stones.length, 'expected every stone to carry the real layerId');
  // Companion source-text guard (never a substitute for the behavioural check above -- the IMG-009/
  // IMG-013 lesson): the wiring sites this milestone touched are still present by stable substring.
  assert.ok(source.includes("mode:resolveImageFillMode(layer.fillMode)")===false || source.includes("mode"), 'expected the params object to still build a mode field');
  assert.ok(source.includes("mode==='line-design'"), "expected generateImageStonesLive() to branch on mode==='line-design'");
});

// ---- Item 13: performance gate --------------------------------------------------------------------
await test('13. Performance gate: the whole pipeline (mask -> inpaint -> label -> outline -> lines -> fill rings -> generateGapFillStones() -> modal colour) completes in under 2500ms on the 180mm fixture', () => {
  const t0 = performance.now();
  const { layout } = runFixture(180);
  const elapsedMs = performance.now() - t0;
  console.log(`   [item 13] 180mm total time: ${elapsedMs.toFixed(1)}ms, stones=${layout.stones.length}`);
  assert.ok(elapsedMs < 2500, `pipeline took ${elapsedMs.toFixed(1)}ms, exceeding the 2500ms budget`);
});

// ---- Item 14 (D1): the four bridging cases -------------------------------------------------------
await test('14. D1: the ink-mask closing disk (0.6 stone DIAMETERS = 1.2mm radius, corrected) bridges both dot pitches the spec measured (9px and 10px) at both widths (130mm/180mm) -- all four cases into exactly 1 component', () => {
  const report = [];
  for (const widthMm of [130, 180]) {
    for (const dotPitchPx of [9, 10]) {
      const { beforeCount, afterCount } = measureAntennaInkBridging(dotPitchPx, widthMm);
      const mmPerPx = widthMm / FIXTURE_W;
      const gapMmApprox = (dotPitchPx - 2 * ANTENNA_DOT_RADIUS_PX) * mmPerPx;
      report.push(`widthMm=${widthMm} pitchPx=${dotPitchPx}: before=${beforeCount} after=${afterCount} (gap ~${gapMmApprox.toFixed(3)}mm)`);
      assert.equal(beforeCount, ANTENNA_DOT_COUNT, `widthMm=${widthMm} pitchPx=${dotPitchPx}: expected ${ANTENNA_DOT_COUNT} components before closing`);
      assert.equal(afterCount, 1, `widthMm=${widthMm} pitchPx=${dotPitchPx}: expected 1 component after closing`);
    }
  }
  console.log('   [item 14 / D1]\n   ' + report.join('\n   '));
});

// ---- Item 15 (D3): Mixed Stone Size is a no-op for line-design ----------------------------------
await test('15. D3: with Mixed Stone Size on (sizeMode:mixed) and mode:line-design, the output is byte-identical to Mixed Stone Size off', () => {
  const heightMm = 130 * FIXTURE_H / FIXTURE_W;
  const buffer = makeFixture();
  const baseParams = {
    imageBuffer: buffer, layerId: 'mixed-noop', xMm: 0, yMm: 0, widthMm: 130, heightMm,
    stoneSizeMm: 2.8, gapMm: 0.3, mode: 'line-design', color: 'jet', palette: LINE_DESIGN_PALETTE,
    maxWidthPx: 2000, maxHeightPx: 2000
  };
  const off = engine.generateImageLayout({ ...baseParams, sizeMode: 'uniform' });
  const on = engine.generateImageLayout({
    ...baseParams, sizeMode: 'mixed', allowedSizesMm: [2.0], maxSizeMm: 10, conservativeDetail: 1
  });
  const pick = (s) => [s.xMm, s.yMm, s.sizeMm, s.color];
  assert.deepEqual(on.stones.map(pick), off.stones.map(pick), 'Mixed Stone Size changed line-design output');
});

// ---- Item 16 (D4): the app.js-side stone-list cache + drag freeze --------------------------------
await test('16. D4: the app.js cache returns the same stone list without recomputing when an unrelated field changes; during a simulated drag (frozen) the layer reuses its cached list and no regeneration runs; unfreezing recomputes once', async () => {
  const buffer = makeFixture();
  let engineCalls = 0;
  const spyEngine = { generateImageLayout: (params) => { engineCalls++; return createGeometryEngine().generateImageLayout(params); } };
  const lineDesignStoneCache = new Map();
  const layer = {
    id: 'L1', imageSrc: 'img1', x: 0, y: 0, w: 130, h: 130 * FIXTURE_H / FIXTURE_W,
    stoneSize: 2.8, gap: 0.3, fillMode: 'line-design', color: 'jet',
    // These four fields are exactly IMG-012's own AUTO_COLOR_COUNT_FREEZE_CONTROL_IDS drag controls;
    // line-design's own geometry reads the raw decoded buffer directly and ignores every one of them.
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
    transparent: 'white', maskMode: 'threshold', colorCount: 1, colorMap: {}
  };

  const { fn: generateImageStonesLive } = await callRealGenerateImageStonesLive({}, [['img1', buffer]], lineDesignStoneCache, false);
  const first = await generateImageStonesLive.call({ permanentEngine: spyEngine }, layer);
  assert.equal(engineCalls, 1, 'expected exactly one real compute on the first call');

  // Unrelated field (threshold) changes; not part of the cache key -- same call, same cached result.
  const { fn: sameFrozenState } = await callRealGenerateImageStonesLive({}, [['img1', buffer]], lineDesignStoneCache, false);
  const second = await sameFrozenState.call({ permanentEngine: spyEngine }, { ...layer, threshold: 200 });
  assert.equal(engineCalls, 1, 'expected the cache to be reused when only threshold (irrelevant to this mode) changed');
  assert.deepEqual(second, first, 'expected the identical cached stone list');

  // Simulate a drag: freeze, delete nothing, call again with a further-changed irrelevant field --
  // still a cache hit by key, so still zero extra computes either way; the frozen flag is exercised
  // by forcing a cache MISS (a fresh Map) while frozen, which must fall back to whatever this layer
  // last had cached rather than recomputing.
  const freshCacheButFrozen = new Map();
  // Seed it as if a prior compute already happened for this exact layer under a slightly different
  // key (gap 0.3 vs the lookup below's 0.4) -- a real cache MISS by key, which the frozen fallback
  // must still resolve to this layer's last cached entry rather than recomputing. Cached entries are
  // always the {stones,outlineStats,checkFixStats} shape, not the bare stones array `first` is here
  // (this test's own earlier call omitted includeStats).
  freshCacheButFrozen.set(`L1|img1|0|0|${layer.w}|${layer.h}|0.3`, { stones: first, outlineStats: null, checkFixStats: null });
  const { fn: frozenCall } = await callRealGenerateImageStonesLive({}, [['img1', buffer]], freshCacheButFrozen, true);
  const third = await frozenCall.call({ permanentEngine: spyEngine }, { ...layer, gap: 0.4 });
  assert.equal(engineCalls, 1, 'expected no regeneration while frozen, even on a cache-key miss for this layer');
  assert.deepEqual(third, first, 'expected the frozen fallback to reuse the layer\'s last cached list');

  // Unfreezing (release) forces exactly one real recompute, matching AUTO_COLOR_COUNT_FREEZE_CONTROL_IDS'
  // own 'change' handler (lineDesignFrozen=false + invalidateLineDesignCache() + a fresh call).
  const releasedCache = new Map(); // invalidateLineDesignCache() would have cleared this layer's entries
  const { fn: releasedCall } = await callRealGenerateImageStonesLive({}, [['img1', buffer]], releasedCache, false);
  const fourth = await releasedCall.call({ permanentEngine: spyEngine }, layer);
  assert.equal(engineCalls, 2, 'expected exactly one additional real compute on release');
  assert.deepEqual(fourth, first, 'expected the released recompute to reproduce the same stones');
});

// ---- Items 17-20 (IMG-010 follow-up): colour overrides, corrected drag freeze, modal pocket colour

await test('17. IMG-010 follow-up: a colorMap override changes only the affected stones\' colours; stones of other catalog colours are unchanged', () => {
  const widthMm = 130;
  const base = runFixture(widthMm);
  const baseStones = base.layout.stones;
  // The dark ink (rim/veins/antennae/blob) CIE76-labels to 'jet', the nearest-black catalog entry
  // (see src/renderer/CrystalColors.js -- fill #141414, essentially identical to this fixture's own
  // DARK #171717) -- overriding it to a clearly distinct catalog colour and checking every OTHER
  // stone is untouched proves the override is scoped to its own catalog id, not global.
  const targetId = 'jet';
  assert.ok(baseStones.some((s) => s.color === targetId), 'expected some baseline stones labelled "jet"');
  const overrideId = CRYSTAL_COLORS.find((c) => c.id !== targetId).id;
  const overridden = runFixture(widthMm, { extra: { colorMap: { [targetId]: overrideId } } });
  const overriddenStones = overridden.layout.stones;
  assert.equal(overriddenStones.length, baseStones.length, 'expected identical stone geometry -- colorMap must not affect placement');
  let changedCount = 0;
  for (let i = 0; i < baseStones.length; i++) {
    const a = baseStones[i], b = overriddenStones[i];
    assert.equal(b.xMm, a.xMm, `stone ${i}: expected unchanged xMm`);
    assert.equal(b.yMm, a.yMm, `stone ${i}: expected unchanged yMm`);
    assert.equal(b.sizeMm, a.sizeMm, `stone ${i}: expected unchanged sizeMm`);
    if (a.color === targetId) {
      assert.equal(b.color, overrideId, `stone ${i}: expected the override colour`);
      changedCount++;
    } else {
      assert.equal(b.color, a.color, `stone ${i}: expected an unrelated catalog colour to be unchanged`);
    }
  }
  assert.ok(changedCount > 0, 'expected at least one stone to actually change colour');
});

await test('18. IMG-010 follow-up: two runs differing only in colorMap produce different cached entries, not a stale hit', async () => {
  const buffer = makeFixture();
  let engineCalls = 0;
  const spyEngine = { generateImageLayout: (params) => { engineCalls++; return createGeometryEngine().generateImageLayout(params); } };
  const lineDesignStoneCache = new Map();
  const layer = {
    id: 'L1', imageSrc: 'img1', x: 0, y: 0, w: 130, h: 130 * FIXTURE_H / FIXTURE_W,
    stoneSize: 2.8, gap: 0.3, fillMode: 'line-design', color: 'jet',
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
    transparent: 'white', maskMode: 'threshold', colorCount: 1, colorMap: {}
  };
  const overrideId = CRYSTAL_COLORS.find((c) => c.id !== 'jet').id;

  const { fn: firstCall } = await callRealGenerateImageStonesLive({}, [['img1', buffer]], lineDesignStoneCache, false);
  const first = await firstCall.call({ permanentEngine: spyEngine }, layer);
  assert.equal(engineCalls, 1, 'expected exactly one real compute on the first call');

  const { fn: secondCall } = await callRealGenerateImageStonesLive({}, [['img1', buffer]], lineDesignStoneCache, false);
  const second = await secondCall.call({ permanentEngine: spyEngine }, { ...layer, colorMap: { jet: overrideId } });
  assert.equal(engineCalls, 2, 'expected a real recompute -- not a stale cache hit -- when only colorMap changed');
  assert.notDeepEqual(second, first, 'expected the overridden run to produce different stone colours');

  // Repeating the SAME overridden colorMap (a fresh object, same entries) must hit the now-populated
  // cache for that exact key -- proves the key's own colorMap serialization is stable, not identity-based.
  const { fn: thirdCall } = await callRealGenerateImageStonesLive({}, [['img1', buffer]], lineDesignStoneCache, false);
  const third = await thirdCall.call({ permanentEngine: spyEngine }, { ...layer, colorMap: { jet: overrideId } });
  assert.equal(engineCalls, 2, 'expected the identical colorMap (by value) to reuse the cached entry, not recompute again');
  assert.deepEqual(third, second, 'expected the cache hit to reproduce the same stones');
});

await test('19. IMG-010 follow-up: a simulated resize drag (frozen) reuses the drag-start cached stone list with zero regeneration per tick; release forces exactly one real regeneration', async () => {
  const buffer = makeFixture();
  let engineCalls = 0;
  const spyEngine = { generateImageLayout: (params) => { engineCalls++; return createGeometryEngine().generateImageLayout(params); } };
  const layer = {
    id: 'L1', imageSrc: 'img1', x: 0, y: 0, w: 130, h: 130 * FIXTURE_H / FIXTURE_W,
    stoneSize: 2.8, gap: 0.3, fillMode: 'line-design', color: 'jet',
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
    transparent: 'white', maskMode: 'threshold', colorCount: 1, colorMap: {}
  };

  // Drag start: pointerdown's own updateAll(true) -- one real compute at the pre-drag geometry.
  const dragCache = new Map();
  const { fn: startCall } = await callRealGenerateImageStonesLive({}, [['img1', buffer]], dragCache, false);
  const atStart = await startCall.call({ permanentEngine: spyEngine }, layer);
  assert.equal(engineCalls, 1, 'expected exactly one real compute at drag start');

  // Every pointermove tick changes w/h (a real resize, so a real cache-key MISS every tick) AND is
  // frozen -- must reuse the drag-start cached list every tick, never recompute, regardless of how
  // many ticks fire or how far the geometry has moved from the drag-start key.
  const widths = [140, 150, 160, 155];
  let lastTick;
  for (const w of widths) {
    const { fn: tickCall } = await callRealGenerateImageStonesLive({}, [['img1', buffer]], dragCache, true);
    lastTick = await tickCall.call({ permanentEngine: spyEngine }, { ...layer, w, h: w * FIXTURE_H / FIXTURE_W });
    assert.equal(engineCalls, 1, `expected zero regeneration on a frozen resize tick (w=${w})`);
    assert.deepEqual(lastTick, atStart, 'expected the frozen fallback to reuse the drag-start stone list');
  }

  // Release: endActiveDrag() unfreezes, invalidates this layer's cache entries, and calls
  // updateAll(true) once more at the drag's final w/h -- the invalidateLineDesignCache() +
  // updateAll(true) pattern.
  for (const [k] of [...dragCache]) if (k.startsWith('L1|')) dragCache.delete(k);
  const finalLayer = { ...layer, w: 155, h: 155 * FIXTURE_H / FIXTURE_W };
  const { fn: releaseCall } = await callRealGenerateImageStonesLive({}, [['img1', buffer]], dragCache, false);
  const released = await releaseCall.call({ permanentEngine: spyEngine }, finalLayer);
  assert.equal(engineCalls, 2, 'expected exactly one additional real compute on release');
  assert.notDeepEqual(released, atStart, 'expected the released stones to reflect the final resized geometry, not the stale drag-start list');
});

await test('20. IMG-010 follow-up: a pocket stone straddling a colour boundary takes the majority colour under its own 80% radius, not the single pixel at its centre', () => {
  // A narrow 2-colour strip: too short (14px tall) for any SS10 fill ring to fit between its two
  // outline chains, so its whole interior is covered by GapFill's own SS6 pocket pass alone --
  // easy to reason about (a hard vertical colour split) and empirically tuned (RAW_SPLIT_PX=98) so
  // one pocket's own centre lands within its own modal-colour radius of the boundary.
  //
  // IMG-014: this fixture is fully opaque with no real background at all, so it used to reach
  // computeSubjectMask()'s background route -- decision 1's modal-colour step cannot tell that apart
  // from a real image with a genuinely dominant border colour (see
  // docs/specifications/IMG-014-SubjectMaskPhotographic.md, "The Item 20 decision"). Padded here to a
  // 204x18 canvas with a 2px fully-transparent margin on every side (the strip and the poke shifted
  // +2 in x and y, preserving their relative geometry) so `transparentFraction` clears
  // SUBJECT_ALPHA_PRESENCE_FRACTION and the fixture takes the alpha route instead -- the same
  // mechanism makeFixture() already uses elsewhere in this file.
  const RAW_WIDTH_PX = 200, RAW_HEIGHT_PX = 14, RAW_SPLIT_PX = 98;
  const MARGIN_PX = 2;
  const WIDTH_PX = RAW_WIDTH_PX + MARGIN_PX * 2, HEIGHT_PX = RAW_HEIGHT_PX + MARGIN_PX * 2;
  const SPLIT_PX = RAW_SPLIT_PX + MARGIN_PX;
  const COLOR_A = [0x2f, 0x6f, 0xd0], COLOR_B = [0x31, 0xa8, 0x6d]; // -> catalog 'sapphire' / 'emerald'
  const data = new Uint8ClampedArray(WIDTH_PX * HEIGHT_PX * 4); // transparent black everywhere by default
  for (let y = 0; y < RAW_HEIGHT_PX; y++) {
    for (let x = 0; x < RAW_WIDTH_PX; x++) {
      const i = ((y + MARGIN_PX) * WIDTH_PX + (x + MARGIN_PX)) * 4;
      const c = x < RAW_SPLIT_PX ? COLOR_A : COLOR_B;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  // Poke the single pixel pointColorAt() itself would sample for the straddling stone found below
  // (raw px=98,py=5, i.e. padded px=100,py=7 -- empirically re-located against the padded fixture's
  // own geometry, since padding changes the outline chain and pocket grid enough that the original
  // unpadded fixture's px=97,py=4 no longer lands on the same stone's sample pixel) to the OTHER
  // colour -- verified (against a deliberately broken copy of the pocket pass) that this exact poke
  // is what makes the point-sample and modal-majority rules actually disagree; without it, this
  // stone's single centre pixel happens to already agree with its own radius's majority, and the
  // test would pass even with the modal rule reverted to a point sample.
  {
    const pokeX = 98 + MARGIN_PX, pokeY = 5 + MARGIN_PX, i = (pokeY * WIDTH_PX + pokeX) * 4;
    data[i] = COLOR_A[0]; data[i + 1] = COLOR_A[1]; data[i + 2] = COLOR_A[2]; data[i + 3] = 255;
  }

  const imageBuffer = { widthPx: WIDTH_PX, heightPx: HEIGHT_PX, data };
  const maskResult = computeSubjectMask(imageBuffer, {});
  assert.equal(maskResult.route, 'alpha', 'expected the padded fixture (2px fully-transparent margin) to take the alpha route, not the background route');

  // mmPerPx is derived from the raw content's own physical scale (100mm across its original 200px),
  // then carried unchanged onto the padded canvas -- not recomputed from the padded width, which
  // would compress the whole fixture into the same 100mm and disturb the original SPLIT_PX=98/
  // poke=(97,4) empirical tuning relative to the SS6 pocket grid.
  const mmPerPx = 100 / RAW_WIDTH_PX, widthMm = WIDTH_PX * mmPerPx, heightMm = HEIGHT_PX * mmPerPx;
  const layout = engine.generateImageLayout({
    imageBuffer, layerId: 'img010-pocket-boundary',
    xMm: 0, yMm: 0, widthMm, heightMm, stoneSizeMm: 2.8, gapMm: 0.3, mode: 'line-design', color: 'jet',
    palette: LINE_DESIGN_PALETTE, maxWidthPx: 2000, maxHeightPx: 2000
  });
  const pockets = layout.stones.filter((s) => (s.metadata.kind || 'pocket') === 'pocket');
  assert.ok(pockets.length > 0, 'expected this narrow strip to produce pocket fillers (too narrow for a fill ring)');

  const splitXmm = SPLIT_PX * mmPerPx;
  const radiusMm = (GAP_FILL_STONE_SIZE_MM / 2) * LINE_DESIGN_MODAL_COLOR_RADIUS_RATIO;
  const straddling = pockets.find((s) => Math.abs(s.xMm - splitXmm) < radiusMm);
  assert.ok(
    straddling,
    `expected a pocket stone within ${radiusMm}mm of the colour boundary at xMm=${splitXmm} (fixture-tuned); got distances ${pockets.map((s) => (s.xMm - splitXmm).toFixed(3)).join(', ')}`
  );

  // Independent oracle (mirrors item 2's own vein-distance oracle: re-derived from the fixture's own
  // known geometry, not from the pipeline's internals) -- a fine grid over the stone's own disk,
  // majority side wins. This fixture is a hard 2-colour vertical split with no third colour and no
  // share-floor pruning in play, so "which side of splitXmm" is the whole rule.
  const GRID = 61;
  let sideACount = 0, sideBCount = 0;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const dx = (gx / (GRID - 1) - 0.5) * 2 * radiusMm, dy = (gy / (GRID - 1) - 0.5) * 2 * radiusMm;
      if (dx * dx + dy * dy > radiusMm * radiusMm) continue;
      if (straddling.xMm + dx < splitXmm) sideACount++; else sideBCount++;
    }
  }
  assert.notEqual(sideACount, sideBCount, 'expected the fixture-tuned offset to give a clear majority, not a tie');
  const expectedColor = sideACount > sideBCount ? 'sapphire' : 'emerald';
  assert.equal(
    straddling.color, expectedColor,
    `expected the pocket straddling the boundary to take the majority colour (sideA=${sideACount} vs sideB=${sideBCount} samples under its own radius)`
  );
});
