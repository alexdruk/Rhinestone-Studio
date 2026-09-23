import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createImageBuffer, prepareImageField, computeSubjectMask } from '../src/image/index.js';
import { prepareAutoColorField, chooseAutoColorCount } from '../src/image/AutoColourCount.js';
import { labelCatalogColors, MIN_CATALOG_COLOR_SHARE } from '../src/image/ColorQuantize.js';
import { rgbToLab, cie76Distance } from '../src/image/ColorSpace.js';
import { createGeometryEngine } from '../src/geometry/index.js';
import { fieldLabelAt } from '../src/geometry/StoneSampler.js';
import { LINE_DESIGN_MIN_COLOR_SHARE } from '../src/geometry/LineDesignSampler.js';
import { STONE_COLORS, CRYSTAL_COLORS } from '../src/renderer/CrystalColors.js';

// IMG-015 -- direct catalogue colour. quantizeColors() labels every subject pixel with its nearest
// catalog colour, drops colours under a 1.2% share, keeps at most colorCount of the rest and
// relabels dropped pixels to their nearest kept colour, one group per catalog colour in palette
// order (decisions 1 and 2); Auto resolves to max(2, n), n the colours clearing the floor capped at
// 8, or 1 with no subject pixels (decisions 3 and 7); every stone takes the modal label under its own
// radius (decision 4); the Studio's Auto hint counts the colour field's groups (decision 7). See
// docs/specifications/IMG-015-DirectCatalogueColour.md.
//
// Items 1-5 pin the spec's own fixtures A, B and C (generator code copied verbatim from its
// "Synthetic fixtures" section) against its fixture and decision-7 tables. Items 6-8 are this
// build's own fixtures: D (centre-pixel and modal assignment disagree), E (share order differs from
// palette order) and F (ten catalog colours clear the floor). Item 9 is Line Design parity for the
// moved labeller. Mutation-tested: stone colour back to the centre pixel (item 6), Auto returning n
// (items 1, 2), no share floor (items 3, 9), colorGroups by share (items 7, 8), no 8-colour cap
// (item 8), hint count back to resolvedCount (items 1, 2), dropped colours relabelled to the largest
// kept colour (items 8, 9).

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

const PALETTE = Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor }));

// ---- The spec's fixtures, verbatim --------------------------------------------------------------
const FIXTURE_SIZE_PX = 60;

// Fixture A (distinct claim, two close dark greys): left 60% of columns (20,20,20), right 40% (50,50,50).
function buildCloseGreysBuffer(n = FIXTURE_SIZE_PX) {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    const c = x < n * 0.6 ? [20, 20, 20] : [50, 50, 50];
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { widthPx: n, heightPx: n, data };
}

// Fixture B (distinct claim, mid orange and a darker shade): left 60% (224,142,38), right 40% (170,100,30).
function buildOrangeShadeBuffer(n = FIXTURE_SIZE_PX) {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    const c = x < n * 0.6 ? [224, 142, 38] : [170, 100, 30];
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { widthPx: n, heightPx: n, data };
}

// Fixture C (share floor): rows 0-53 (20,20,20) = 90.0%; rows 54-59 (216,221,228) = 9.0%, except a
// 6x6 (155,28,28) block at the bottom-left = 1.0%, under the 1.2% floor.
function buildFloorBuffer(n = FIXTURE_SIZE_PX) {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    let c = y < 54 ? [20, 20, 20] : [216, 221, 228];
    if (y >= 54 && x < 6) c = [155, 28, 28];
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { widthPx: n, heightPx: n, data };
}

const FIXTURE_FIELD_PARAMS = { threshold: 255, invert: false, blurRadiusPx: 0, maxWidthPx: 60, maxHeightPx: 60, transparent: 'white', maskMode: 'threshold' };
const FIXTURE_LAYOUT_PARAMS = { layerId: 'img015', xMm: 0, yMm: 0, widthMm: 30, heightMm: 30, stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', color: 'gold', colorMap: {} };

// ---- This build's fixtures ----------------------------------------------------------------------
function buildFromPixelRule(pixelAt, n = FIXTURE_SIZE_PX) {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    const c = pixelAt(x, y, n);
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { widthPx: n, heightPx: n, data };
}

// Fixture D (modal vs centre pixel): left half (20,20,20) and right half (216,221,228), each with a
// single-pixel dot of the other colour wherever x and y are both multiples of 3 -- the "fur tip"
// outlier a stone centre can land on.
function buildSpeckleBuffer(n = FIXTURE_SIZE_PX) {
  return buildFromPixelRule((x, y) => {
    const dot = x % 3 === 0 && y % 3 === 0;
    return ((x < n / 2) !== dot) ? [20, 20, 20] : [216, 221, 228];
  }, n);
}

// Fixture E (share order vs palette order): rows 0-35 (216,221,228) 60%, rows 36-50 (155,28,28)
// 25%, rows 51-59 (20,20,20) 15% -- descending share silver, siam, jet; palette order jet, siam,
// silver.
function buildShareOrderBuffer(n = FIXTURE_SIZE_PX) {
  return buildFromPixelRule((x, y) => (y < 36 ? [216, 221, 228] : y < 51 ? [155, 28, 28] : [20, 20, 20]), n);
}

// Fixture F (8-colour cap): ten vertical bands, each exactly one catalog colour's preview RGB, widths
// 9..3 columns -- every band clears the 1.2% floor (the narrowest is 5%). The cap drops the two
// narrowest, light-sapphire and gold, whose nearest kept colours are silver and topaz, not jet (the
// widest band).
const CAP_BANDS = [['jet', 9], ['siam', 8], ['sapphire', 7], ['emerald', 7], ['topaz', 6], ['amethyst', 6], ['silver', 5], ['aquamarine', 5], ['light-sapphire', 4], ['gold', 3]];
function buildTenBandBuffer(n = FIXTURE_SIZE_PX) {
  const rgbOf = (id) => {
    const hex = PALETTE.find((entry) => entry.id === id).hex.replace('#', '');
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  };
  return buildFromPixelRule((x) => {
    let edge = 0;
    for (const [id, width] of CAP_BANDS) { edge += width; if (x < edge) return rgbOf(id); }
    return [255, 255, 255];
  }, n);
}

function buildBlankBuffer(n = FIXTURE_SIZE_PX) {
  return buildFromPixelRule(() => [255, 255, 255], n);
}

// ---- Shared helpers ----------------------------------------------------------------------------
const engine = createGeometryEngine();
const PLACEMENT = { xMm: FIXTURE_LAYOUT_PARAMS.xMm, yMm: FIXTURE_LAYOUT_PARAMS.yMm, widthMm: FIXTURE_LAYOUT_PARAMS.widthMm, heightMm: FIXTURE_LAYOUT_PARAMS.heightMm };

function autoCountOf(buffer) {
  return chooseAutoColorCount(prepareAutoColorField(buffer, FIXTURE_FIELD_PARAMS), PALETTE).resolvedCount;
}
function colorFieldOf(buffer, colorCount) {
  return prepareImageField(buffer, { ...FIXTURE_FIELD_PARAMS, colorCount, palette: PALETTE });
}
function layoutOf(buffer, colorCount) {
  return engine.generateImageLayout({ ...FIXTURE_LAYOUT_PARAMS, ...FIXTURE_FIELD_PARAMS, imageBuffer: buffer, colorCount, palette: PALETTE });
}
function colourCounts(stones) {
  const counts = {};
  for (const s of stones) counts[s.color] = (counts[s.color] || 0) + 1;
  return counts;
}
function groupsSummary(colorGroups) {
  return colorGroups.map((g) => ({ id: g.nearestId, rgb: g.rgb, share: (g.pixelShare * 100).toFixed(2) }));
}
// Centre-pixel rule (IMG-002 decision 1, retired by IMG-015 decision 4), reconstructed independently
// to count how many stones the modal rule moves.
function centrePixelColours(field, stones) {
  return stones.map((s) => field.colorGroups[fieldLabelAt(field, PLACEMENT, s.xMm, s.yMm)].nearestId);
}

// The Studio's Auto hint, executed from app.js's own source (renderImageStudio()).
const appJs = await readFile(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8');
function extractAutoHintSource() {
  const startMarker = "const autoHintEl=el('imgColorCountAuto');";
  const endMarker = '\n  for(let i=0;i<8;i++){';
  const start = appJs.indexOf(startMarker);
  assert.ok(start !== -1, 'expected renderImageStudio() to build the #imgColorCountAuto hint');
  const end = appJs.indexOf(endMarker, start);
  assert.ok(end !== -1, 'expected the Colours row loop right after the Auto hint');
  return appJs.slice(start, end);
}
function autoHintText(colorField, resolvedCount) {
  const hintEl = { textContent: '', style: {} };
  // eslint-disable-next-line no-new-func
  new Function('el', 'l', 'resolveImageColorCount', 'colorField', extractAutoHintSource())(
    () => hintEl, { colorCount: 'auto' }, () => resolvedCount, colorField
  );
  return hintEl.textContent;
}

// ---- Items 1-5: the spec's fixtures A, B and C --------------------------------------------------
await test('1. Fixture A (close greys) under Auto: Auto 2, one group jet (32,32,32) 100.00%, 169 jet stones, hint "Auto: 1 colour"', () => {
  const buffer = createImageBuffer(buildCloseGreysBuffer());
  const auto = autoCountOf(buffer);
  assert.equal(auto, 2);
  const field = colorFieldOf(buffer, auto);
  assert.deepEqual(groupsSummary(field.colorGroups), [{ id: 'jet', rgb: [32, 32, 32], share: '100.00' }]);
  const layout = layoutOf(buffer, auto);
  assert.equal(layout.stones.length, 169);
  assert.deepEqual(colourCounts(layout.stones), { jet: 169 });
  assert.equal(field.colorGroups.length, 1, 'decision 7: hint count');
  assert.equal(autoHintText(field, auto), 'Auto: 1 colour');
});

await test('2. Fixture B (orange + shade) under Auto: Auto 2, one group topaz (202,125,35) 100.00%, 169 topaz stones, hint "Auto: 1 colour"', () => {
  const buffer = createImageBuffer(buildOrangeShadeBuffer());
  const auto = autoCountOf(buffer);
  assert.equal(auto, 2);
  const field = colorFieldOf(buffer, auto);
  assert.deepEqual(groupsSummary(field.colorGroups), [{ id: 'topaz', rgb: [202, 125, 35], share: '100.00' }]);
  const layout = layoutOf(buffer, auto);
  assert.equal(layout.stones.length, 169);
  assert.deepEqual(colourCounts(layout.stones), { topaz: 169 });
  assert.equal(field.colorGroups.length, 1, 'decision 7: hint count');
  assert.equal(autoHintText(field, auto), 'Auto: 1 colour');
});

await test('3. Fixture C (share floor): Auto 2; colorCount 3 and Auto both give jet (21,20,20) 91.00% + silver (216,221,228) 9.00%, 169 stones jet 157 silver 12, hint "Auto: 2 colours"', () => {
  const buffer = createImageBuffer(buildFloorBuffer());
  const auto = autoCountOf(buffer);
  assert.equal(auto, 2);
  for (const colorCount of [3, auto]) {
    const field = colorFieldOf(buffer, colorCount);
    assert.deepEqual(groupsSummary(field.colorGroups), [
      { id: 'jet', rgb: [21, 20, 20], share: '91.00' },
      { id: 'silver', rgb: [216, 221, 228], share: '9.00' }
    ], `colorCount ${colorCount}: groups`);
    assert.deepEqual(field.colorGroups.map((g) => g.pixelShare), [3276 / 3600, 324 / 3600], `colorCount ${colorCount}: exact shares`);
    const layout = layoutOf(buffer, colorCount);
    assert.equal(layout.stones.length, 169);
    assert.deepEqual(colourCounts(layout.stones), { jet: 157, silver: 12 }, `colorCount ${colorCount}: stones`);
  }
  const autoField = colorFieldOf(buffer, auto);
  assert.equal(autoField.colorGroups.length, 2, 'decision 7: hint count');
  assert.equal(autoHintText(autoField, auto), 'Auto: 2 colours');
});

await test('4. No subject pixels: Auto still resolves to 1, and the hint falls back to the resolved count', () => {
  const buffer = createImageBuffer(buildBlankBuffer());
  const auto = autoCountOf(buffer);
  assert.equal(auto, 1);
  assert.deepEqual(colorFieldOf(buffer, 2).colorGroups, []);
  assert.equal(autoHintText(null, auto), 'Auto: 1 colour');
});

await test('5. Fixtures A, B and C: centre-pixel and modal assignment agree on every stone', () => {
  for (const [name, build, colorCount] of [['A', buildCloseGreysBuffer, 2], ['B', buildOrangeShadeBuffer, 2], ['C', buildFloorBuffer, 3]]) {
    const buffer = createImageBuffer(build());
    const field = colorFieldOf(buffer, colorCount);
    const { stones } = layoutOf(buffer, colorCount);
    const centre = centrePixelColours(field, stones);
    assert.equal(stones.filter((s, i) => s.color !== centre[i]).length, 0, `fixture ${name}`);
  }
});

// ---- Items 6-8: this build's fixtures -----------------------------------------------------------
await test('6. Fixture D (speckle): the modal rule moves 16 of 169 stones off their centre pixel\'s colour -- modal jet 91 silver 78, centre pixel jet 99 silver 70', () => {
  const buffer = createImageBuffer(buildSpeckleBuffer());
  const auto = autoCountOf(buffer);
  assert.equal(auto, 2);
  const field = colorFieldOf(buffer, auto);
  assert.deepEqual(groupsSummary(field.colorGroups), [
    { id: 'jet', rgb: [20, 20, 20], share: '50.00' },
    { id: 'silver', rgb: [216, 221, 228], share: '50.00' }
  ]);
  const { stones } = layoutOf(buffer, auto);
  assert.equal(stones.length, 169);
  assert.deepEqual(colourCounts(stones), { jet: 91, silver: 78 });
  const centre = centrePixelColours(field, stones);
  assert.deepEqual(colourCounts(centre.map((color) => ({ color }))), { jet: 99, silver: 70 });
  assert.equal(stones.filter((s, i) => s.color !== centre[i]).length, 16);
});

await test('7. Fixture E (share order vs palette order): colorGroups come out jet, siam, silver (palette order), not silver, siam, jet (share order)', () => {
  const buffer = createImageBuffer(buildShareOrderBuffer());
  const auto = autoCountOf(buffer);
  assert.equal(auto, 3);
  const field = colorFieldOf(buffer, auto);
  assert.deepEqual(groupsSummary(field.colorGroups), [
    { id: 'jet', rgb: [20, 20, 20], share: '15.00' },
    { id: 'siam', rgb: [155, 28, 28], share: '25.00' },
    { id: 'silver', rgb: [216, 221, 228], share: '60.00' }
  ]);
  const { stones } = layoutOf(buffer, auto);
  assert.equal(stones.length, 169);
  assert.deepEqual(colourCounts(stones), { silver: 104, siam: 39, jet: 26 });
});

await test('8. Fixture F (ten colours clear the floor): Auto caps at 8; light-sapphire and gold drop and relabel to their nearest kept colours, silver and topaz', () => {
  const buffer = createImageBuffer(buildTenBandBuffer());
  const autoField = prepareAutoColorField(buffer, FIXTURE_FIELD_PARAMS);
  const uncapped = labelCatalogColors({ ...autoField, eligible: autoField.data.map((v) => (v >= 128 ? 1 : 0)), palette: PALETTE });
  assert.deepEqual(uncapped.keptIds.map((c) => PALETTE[c].id), ['jet', 'siam', 'amethyst', 'sapphire', 'light-sapphire', 'aquamarine', 'emerald', 'topaz', 'gold', 'silver'], 'expected ten colours to clear the floor before the cap');
  const auto = autoCountOf(buffer);
  assert.equal(auto, 8);
  const field = colorFieldOf(buffer, auto);
  assert.deepEqual(groupsSummary(field.colorGroups), [
    { id: 'jet', rgb: [20, 20, 20], share: '15.00' },
    { id: 'siam', rgb: [155, 28, 28], share: '13.33' },
    { id: 'amethyst', rgb: [126, 63, 152], share: '10.00' },
    { id: 'sapphire', rgb: [34, 105, 211], share: '11.67' },
    { id: 'aquamarine', rgb: [63, 193, 176], share: '8.33' },
    { id: 'emerald', rgb: [42, 166, 106], share: '11.67' },
    { id: 'topaz', rgb: [230, 158, 42], share: '15.00' },
    { id: 'silver', rgb: [169, 197, 224], share: '15.00' }
  ]);
  const { stones } = layoutOf(buffer, auto);
  assert.equal(stones.length, 169);
  assert.deepEqual(colourCounts(stones), { jet: 26, siam: 26, sapphire: 13, emerald: 26, topaz: 26, amethyst: 13, silver: 13, aquamarine: 26 });
});

// ---- Item 9: Line Design parity (decision 1) ----------------------------------------------------
// IMG-010's makeFixture() image, copied verbatim from tools/test-img-010-line-design.mjs.
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

// buildLabelField() as it stood in src/geometry/LineDesignSampler.js at 35302bb, before IMG-015
// moved it into src/image/ColorQuantize.js as labelCatalogColors() -- copied verbatim, with the
// share constant it read bound to its value there.
const pristineBuildLabelField = (() => {
  const LINE_DESIGN_MIN_COLOR_SHARE = 0.012;
  function buildLabelField({ filledMask, inpaintedR, inpaintedG, inpaintedB, widthPx, heightPx, catalogLabs }) {
    const pixelCount = widthPx * heightPx;
    const rawLabel = new Uint8Array(pixelCount).fill(255);
    const labL = new Float64Array(pixelCount);
    const labA = new Float64Array(pixelCount);
    const labB = new Float64Array(pixelCount);
    const counts = new Array(catalogLabs.length).fill(0);
    let silhouettePixelCount = 0;
  
    for (let i = 0; i < pixelCount; i++) {
      if (!filledMask[i]) continue;
      silhouettePixelCount++;
      const lab = rgbToLab(inpaintedR[i], inpaintedG[i], inpaintedB[i]);
      labL[i] = lab[0]; labA[i] = lab[1]; labB[i] = lab[2];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < catalogLabs.length; c++) {
        const d = cie76Distance(lab, catalogLabs[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      rawLabel[i] = best;
      counts[best]++;
    }
  
    let survivingIds = [];
    for (let c = 0; c < counts.length; c++) {
      if (silhouettePixelCount > 0 && counts[c] / silhouettePixelCount >= LINE_DESIGN_MIN_COLOR_SHARE) survivingIds.push(c);
    }
    if (survivingIds.length === 0) {
      // Degenerate fixture (no colour clears the floor, or an empty silhouette) -- fall back to every
      // observed label rather than producing an unlabellable field.
      survivingIds = counts.map((count, c) => (count > 0 ? c : -1)).filter((c) => c >= 0);
    }
    const survivingSet = new Set(survivingIds);
  
    const finalLabel = new Uint8Array(pixelCount).fill(255);
    for (let i = 0; i < pixelCount; i++) {
      if (!filledMask[i]) continue;
      const raw = rawLabel[i];
      if (survivingSet.has(raw)) { finalLabel[i] = raw; continue; }
      const lab = [labL[i], labA[i], labB[i]];
      let best = survivingIds[0], bestD = Infinity;
      for (const c of survivingIds) {
        const d = cie76Distance(lab, catalogLabs[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      finalLabel[i] = best;
    }
  
    return { finalLabel, survivingIds, silhouettePixelCount };
  }
  return buildLabelField;
})();

await test('9. Line Design parity: the moved labeller reproduces buildLabelField()\'s previous output on IMG-010\'s makeFixture() image, and the Line Design stone list is unchanged', () => {
  assert.equal(MIN_CATALOG_COLOR_SHARE, 0.012);
  assert.equal(LINE_DESIGN_MIN_COLOR_SHARE, MIN_CATALOG_COLOR_SHARE);

  const buffer = createImageBuffer(makeFixture());
  const { widthPx, heightPx } = buffer;
  const pixelCount = widthPx * heightPx;
  const eligible = computeSubjectMask(buffer, {}).mask.data;
  const r = new Uint8ClampedArray(pixelCount), g = new Uint8ClampedArray(pixelCount), b = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i++) { r[i] = buffer.data[i * 4]; g[i] = buffer.data[i * 4 + 1]; b[i] = buffer.data[i * 4 + 2]; }
  const catalogLabs = PALETTE.map((entry) => {
    const h = entry.hex.replace('#', '');
    return rgbToLab(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
  });

  const previous = pristineBuildLabelField({ filledMask: eligible, inpaintedR: r, inpaintedG: g, inpaintedB: b, widthPx, heightPx, catalogLabs });
  const moved = labelCatalogColors({ r, g, b, eligible, palette: PALETTE, minShare: LINE_DESIGN_MIN_COLOR_SHARE });
  assert.deepEqual(moved.keptIds, previous.survivingIds);
  assert.equal(moved.eligibleCount, previous.silhouettePixelCount);
  assert.ok(Buffer.from(moved.labels).equals(Buffer.from(previous.finalLabel)), 'expected identical per-pixel labels');
  const relabelled = moved.rawCounts.map((count, c) => (count > 0 && !moved.keptIds.includes(c) ? PALETTE[c].id : null)).filter(Boolean);
  assert.ok(relabelled.length > 0, 'expected the fixture to exercise the relabel path');

  const layout = engine.generateImageLayout({
    imageBuffer: buffer, layerId: 'p', xMm: 0, yMm: 0, widthMm: 120, heightMm: 120 * FIXTURE_H / FIXTURE_W,
    stoneSizeMm: 2.8, gapMm: 0.3, mode: 'line-design', color: 'jet', palette: CRYSTAL_COLORS.map((c) => ({ id: c.id, hex: c.previewColor })),
    maxWidthPx: 2000, maxHeightPx: 2000
  });
  assert.equal(layout.stones.length, 545);
  const hash = crypto.createHash('sha256').update(JSON.stringify(layout.stones.map((s) => [s.xMm, s.yMm, s.sizeMm, s.color]))).digest('hex');
  assert.equal(hash, '17b4d26911d115add0345f57127402f365631c8d7fda497e488254332385f029', 'Line Design stone list at 120mm, measured on 35302bb');
});

console.log('IMG-015 direct catalogue colour tests passed.');
