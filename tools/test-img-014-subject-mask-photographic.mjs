import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { computeSubjectMask } from '../src/image/index.js';

// IMG-014 -- unit tests for computeSubjectMask()'s background route: the modal (not mean) border
// colour (decision 1), the border-connected flood fill replacing largest-component reduction
// (decision 2), enclosed background-coloured regions becoming subject (decision 3), and the
// small-component size floor (decision 4). See docs/specifications/IMG-014-SubjectMaskPhotographic.md,
// "Fixtures (pinned verbatim, for the future test file)" -- fixtures a-e below are copied verbatim
// from that section. The alpha route and toleranceDe's existing role are both out of scope and
// confirmed unchanged (Items 6 and 7 below).

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

// ---- Fixtures, copied verbatim from the spec -----------------------------------------------------

function fill(data, widthPx, x0, y0, x1, y1, rgb) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * widthPx + x) * 4;
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
}
function fillCircle(data, widthPx, cx, cy, r, rgb) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * widthPx + x) * 4;
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
}
const BG = [240, 240, 240];
const SUBJ = [40, 90, 200];

// (a) split border: a subject-coloured stripe occupies the whole left edge (columns 0-9, every
// row) of an otherwise-background 40x40 image -- expect coverage 400 (the stripe only).
function buildFixtureA() {
  const W = 40, H = 40;
  const data = new Uint8ClampedArray(W * H * 4);
  fill(data, W, 0, 0, W, H, BG);
  fill(data, W, 0, 0, 10, H, SUBJ);
  return { widthPx: W, heightPx: H, data };
}

// (b) enclosed near-background hole: a 20x20 subject square on a 40x40 background, with a 6x6
// interior square at [234,234,234] (ΔE~4.4 from BG [240,240,240], inside the ΔE-12 default) --
// expect coverage 400 (hole filled), vs the shipped 364 (hole excluded).
function buildFixtureB() {
  const W = 40, H = 40;
  const data = new Uint8ClampedArray(W * H * 4);
  fill(data, W, 0, 0, W, H, BG);
  fill(data, W, 10, 10, 30, 30, SUBJ);
  fill(data, W, 17, 17, 23, 23, [234, 234, 234]);
  return { widthPx: W, heightPx: H, data };
}

// (c) three disconnected subject components of different sizes on a 100x100 background: large
// (r=22, ~1520px/15.2%), medium (r=8, ~201px/2.0%), small (r=3, ~28px/0.28%, still above the 0.05%
// floor) -- expect all three kept (~1743px total), vs the shipped largest-only (~1517px).
function buildFixtureC() {
  const W = 100, H = 100;
  const data = new Uint8ClampedArray(W * H * 4);
  fill(data, W, 0, 0, W, H, BG);
  fillCircle(data, W, 25, 25, 22, SUBJ);
  fillCircle(data, W, 75, 25, 8, SUBJ);
  fillCircle(data, W, 75, 75, 3, SUBJ);
  return { widthPx: W, heightPx: H, data };
}

// (d) isolated single-pixel speckle on an otherwise uniform 100x100 background -- expect coverage
// 0 (below the 0.05%/5px floor), vs the shipped 1 (kept, since it is the only candidate component).
function buildFixtureD() {
  const W = 100, H = 100;
  const data = new Uint8ClampedArray(W * H * 4);
  fill(data, W, 0, 0, W, H, BG);
  const i = (50 * W + 50) * 4;
  data[i] = SUBJ[0]; data[i + 1] = SUBJ[1]; data[i + 2] = SUBJ[2]; data[i + 3] = 255;
  return { widthPx: W, heightPx: H, data };
}

// (e) a background-coloured pocket, fully enclosed by a subject wall on 3 sides, reaching the
// right image border (x=99) only through a narrow throat of width runPx. Background otherwise
// dominates the border overwhelmingly (this wall+pocket is ~14 of ~396 border-ring pixels), so the
// modal background colour is unaffected -- only the throat's own seed-eligibility is at stake.
// runPx=3 (<5% of the right side's 100px length): the throat fails the run-length gate, the pocket
// is stranded and becomes subject (coverage 168, vs the shipped 89 which always excludes it).
// runPx=8 (>=5%): the throat seeds normally, the pocket correctly floods as background (coverage
// 74, matching the shipped 74).
function buildFixtureE(runPx) {
  const W = 100, H = 100;
  const data = new Uint8ClampedArray(W * H * 4);
  fill(data, W, 0, 0, W, H, BG);
  fill(data, W, 88, 38, 100, 52, SUBJ);
  fill(data, W, 90, 40, 97, 50, BG);
  fill(data, W, 97, 43, 100, 43 + runPx, BG);
  return { widthPx: W, heightPx: H, data };
}

function countOn(mask) {
  let c = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i] === 1) c++;
  return c;
}
function sha256(arr) {
  return crypto.createHash('sha256').update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)).digest('hex');
}

// ---- Item 1: fixture (a), split border ------------------------------------------------------------
await test('1. Fixture (a) split border: coverage 400 (the stripe only), backgroundRgb [240,240,240]', () => {
  const result = computeSubjectMask(buildFixtureA(), {});
  assert.equal(countOn(result.mask), 400);
  assert.deepEqual(result.backgroundRgb, [240, 240, 240]);
});

// ---- Item 2: fixture (b), enclosed near-background hole -------------------------------------------
await test('2. Fixture (b) enclosed near-background hole: coverage 400 (the hole is filled, decision 3)', () => {
  const result = computeSubjectMask(buildFixtureB(), {});
  assert.equal(countOn(result.mask), 400);
});

// ---- Item 3: fixture (c), three disconnected components -------------------------------------------
await test('3. Fixture (c) three disconnected components: coverage 1743 (all three kept, decision 4)', () => {
  const result = computeSubjectMask(buildFixtureC(), {});
  assert.equal(countOn(result.mask), 1743);
});

// ---- Item 4: fixture (d), single-pixel speckle -----------------------------------------------------
await test('4. Fixture (d) single-pixel speckle: coverage 0 (dropped by the 0.05%/5px floor, decision 4)', () => {
  const result = computeSubjectMask(buildFixtureD(), {});
  assert.equal(countOn(result.mask), 0);
});

// ---- Item 5: fixture (e), runPx=3 -- border throat below the 5% run-length gate --------------------
await test('5. Fixture (e) runPx=3: below the 5% run-length gate, the pocket is stranded and becomes subject (coverage 168, backgroundRgb [240,240,240])', () => {
  const result = computeSubjectMask(buildFixtureE(3), {});
  assert.equal(countOn(result.mask), 168);
  assert.deepEqual(result.backgroundRgb, [240, 240, 240]);
});

// ---- Item 6: fixture (e), runPx=8 -- border throat at/above the 5% run-length gate -----------------
await test('6. Fixture (e) runPx=8: at/above the 5% run-length gate, the throat seeds normally and the pocket floods as background (coverage 74)', () => {
  const result = computeSubjectMask(buildFixtureE(8), {});
  assert.equal(countOn(result.mask), 74);
});

// ---- Item 7: alpha route is untouched ---------------------------------------------------------------
// A subject circle on a transparent background (>1% transparent pixels) takes the alpha route, byte-
// identical to pristine-tip: digest measured on pristine `develop` before this milestone's changes.
const PRISTINE_ALPHA_MASK_SHA256 = 'e9ce7f53af5ce5b280da4f892a76c53e74a78daf65486ca8424c6aa89b092bfc';
function buildAlphaFixture() {
  const W = 60, H = 60;
  const data = new Uint8ClampedArray(W * H * 4);
  fillCircle(data, W, 30, 30, 20, SUBJ);
  return { widthPx: W, heightPx: H, data };
}
await test('7. Alpha route is untouched: a subject-on-transparent fixture still takes the alpha route and produces the pristine-tip mask byte-for-byte', () => {
  const buffer = buildAlphaFixture();
  let transparentCount = 0;
  for (let i = 3; i < buffer.data.length; i += 4) if (buffer.data[i] === 0) transparentCount++;
  const transparentFraction = transparentCount / (buffer.widthPx * buffer.heightPx);
  assert.ok(transparentFraction > 0.01, `expected >1% transparent pixels, got ${(transparentFraction * 100).toFixed(2)}%`);

  const result = computeSubjectMask(buffer, {});
  assert.equal(result.route, 'alpha');
  assert.equal(sha256(result.mask.data), PRISTINE_ALPHA_MASK_SHA256);
});

// ---- Item 8: toleranceDe is still honoured on the new code -----------------------------------------
// A dedicated fixture: a 40x40 background with a 5px-wide border-touching stripe at gray 210 (ΔE
// 10.598 from BG [240,240,240] -- above BACKGROUND_CLUSTER_DE=8, so it never merges into the modal
// background cluster, keeping backgroundRgb exactly [240,240,240]; between toleranceDe 4 and 12, so
// classification itself differs). At toleranceDe 4 the stripe is background-ineligible and stays
// subject (on=200); at toleranceDe 12 it is eligible, seeds via its full-length border runs, and
// floods as background (on=0).
await test('8. toleranceDe is still honoured: a border-touching near-background stripe gives on=200 at toleranceDe 4 and on=0 at toleranceDe 12', () => {
  const W = 40, H = 40;
  const data = new Uint8ClampedArray(W * H * 4);
  fill(data, W, 0, 0, W, H, BG);
  fill(data, W, 0, 0, 5, H, [210, 210, 210]);
  const buffer = { widthPx: W, heightPx: H, data };

  const tight = computeSubjectMask(buffer, { toleranceDe: 4 });
  assert.equal(countOn(tight.mask), 200);
  assert.deepEqual(tight.backgroundRgb, [240, 240, 240]);

  const loose = computeSubjectMask(buffer, { toleranceDe: 12 });
  assert.equal(countOn(loose.mask), 0);
  assert.deepEqual(loose.backgroundRgb, [240, 240, 240]);
});
