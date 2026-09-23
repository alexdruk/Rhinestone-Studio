import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseAutoColorCount, prepareAutoColorField } from '../src/image/AutoColourCount.js';
import { prepareImageField } from '../src/image/index.js';
import { createGeometryEngine } from '../src/geometry/index.js';
import { STONE_COLORS } from '../src/renderer/StoneColors.js';

const appJsSource = await readFile(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8');
function readFileSync() { return appJsSource; }

// IMG-012 -- unit tests for the Auto (best fit) colour count: src/image/AutoColourCount.js's
// chooseAutoColorCount()/prepareAutoColorField(), app.js's resolveImageColorCount() + its Auto cache
// (decision 5/D3), the write-site 'auto' round-trip (section B), the D2 maskMode-forwarding fix to
// computeImageColorField(), and the Studio's "Auto: N colours" hint (decision 3). See
// docs/specifications/IMG-012-AutoColourCount.md.
//
// IMG-015 (docs/specifications/IMG-015-DirectCatalogueColour.md, decisions 3 and 7) retired
// IMG-012's k=2..8 mean-ΔE sweep and D1's tie rule: Auto now resolves to max(2, n), n the catalog
// colours clearing the 1.2% share floor capped at 8, and the Studio hint counts the resolved colour
// field's groups. Items 1 and 2 keep their resolved counts, 4 and 6.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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

function parseHex(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const PALETTE = Object.values(STONE_COLORS).map((c) => ({ id: c.id, hex: c.previewColor }));

// ---- Fixtures (spec section E, reproduced verbatim -- {r,g,b,data} with data unconditionally 255,
// i.e. every pixel counted as subject, exactly as chooseAutoColorCount()'s own contract expects a
// pre-quantization field, and exactly how the spec's own Section D/E measurements were taken) ------

function buildFourRegionFixture(widthPx, heightPx, { noise = 6, seed = 1 } = {}) {
  const n = widthPx * heightPx;
  const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
  const data = new Uint8ClampedArray(n).fill(255);
  const colors = ['#9b1c1c', '#2269d3', '#2aa66a', '#f3bd32']; // siam, sapphire, emerald, gold
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let y = 0; y < heightPx; y++) for (let x = 0; x < widthPx; x++) {
    const i = y * widthPx + x;
    const quadrant = (x < widthPx / 2 ? 0 : 1) + (y < heightPx / 2 ? 0 : 2);
    const [cr, cg, cb] = parseHex(colors[quadrant]);
    r[i] = cr + Math.round((rand() - 0.5) * 2 * noise);
    g[i] = cg + Math.round((rand() - 0.5) * 2 * noise);
    b[i] = cb + Math.round((rand() - 0.5) * 2 * noise);
  }
  return { r, g, b, data, widthPx, heightPx };
}

function buildSixRegionFixture(widthPx, heightPx) {
  const n = widthPx * heightPx;
  const r = new Uint8ClampedArray(n), g = new Uint8ClampedArray(n), b = new Uint8ClampedArray(n);
  const data = new Uint8ClampedArray(n).fill(255);
  const cols = 3, rows = 2;
  const colors = ['#9b1c1c', '#d9534f', '#2269d3', '#6fa8dc', '#2aa66a', '#f3bd32'];
  for (let y = 0; y < heightPx; y++) for (let x = 0; x < widthPx; x++) {
    const i = y * widthPx + x;
    const cx = Math.min(cols - 1, Math.floor(x / widthPx * cols));
    const cy = Math.min(rows - 1, Math.floor(y / heightPx * rows));
    const [cr, cg, cb] = parseHex(colors[cy * cols + cx]);
    r[i] = cr; g[i] = cg; b[i] = cb;
  }
  return { r, g, b, data, widthPx, heightPx };
}

// Real RGBA image buffer (not a hand-built {r,g,b,data} field): a centred four-quadrant swatch
// (siam/sapphire/emerald/gold) over a white border. siam/sapphire/emerald are dark enough
// (luminosity < 128) to be "on" under threshold mode; gold's luminosity (~189) is not, so threshold
// mode drops the gold quadrant entirely while subject mode's background route (white border vs.
// each quadrant's large Lab distance) keeps all four -- a genuinely different subject-pixel set
// between the two modes, not just a different pixel count. Also used for STEP 0's own baseline.
function buildFourQuadrantImageBuffer(widthPx, heightPx) {
  const data = new Uint8ClampedArray(widthPx * heightPx * 4);
  const colors = ['#9b1c1c', '#2269d3', '#2aa66a', '#f3bd32'];
  const x0 = Math.round(widthPx * 0.2), x1 = Math.round(widthPx * 0.8);
  const y0 = Math.round(heightPx * 0.2), y1 = Math.round(heightPx * 0.8);
  for (let y = 0; y < heightPx; y++) for (let x = 0; x < widthPx; x++) {
    const i = (y * widthPx + x) * 4;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) {
      const quadrant = (x < widthPx / 2 ? 0 : 1) + (y < heightPx / 2 ? 0 : 2);
      const [cr, cg, cb] = parseHex(colors[quadrant]);
      data[i] = cr; data[i + 1] = cg; data[i + 2] = cb; data[i + 3] = 255;
    } else {
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
    }
  }
  return { widthPx, heightPx, data };
}

const AUTO_FIELD_BASE_PARAMS = { threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400, transparent: 'white' };

// ---- Item 1: Fixture 1 correctness ----------------------------------------------------------------
await test('1. chooseAutoColorCount(buildFourRegionFixture(200,200,{noise:6,seed:1})) resolves to k=4, the strict global minimum', () => {
  const result = chooseAutoColorCount(buildFourRegionFixture(200, 200, { noise: 6, seed: 1 }), PALETTE);
  assert.equal(result.resolvedCount, 4);
});

// ---- Item 2: D1's own worked example (Fixture 2 resolves to 6, not the spec's original 8) --------
await test('2. chooseAutoColorCount(buildSixRegionFixture(240,160)) resolves to 6, not the spec\'s original 8', () => {
  const result = chooseAutoColorCount(buildSixRegionFixture(240, 160), PALETTE);
  assert.equal(result.resolvedCount, 6, 'D1: resolved count is the winner\'s own cluster count');
});

// ---- Item 4: maskMode matters ----------------------------------------------------------------------
await test('4. maskMode matters: a fixture where subject and threshold masks keep different pixel sets resolves to different counts', () => {
  const buffer = buildFourQuadrantImageBuffer(200, 200);
  const subjectField = prepareAutoColorField(buffer, { ...AUTO_FIELD_BASE_PARAMS, maskMode: 'subject' });
  const thresholdField = prepareAutoColorField(buffer, { ...AUTO_FIELD_BASE_PARAMS, maskMode: 'threshold' });
  const subjectResult = chooseAutoColorCount(subjectField, PALETTE);
  const thresholdResult = chooseAutoColorCount(thresholdField, PALETTE);
  assert.equal(subjectResult.resolvedCount, 4, 'subject mode keeps all four quadrants (including gold)');
  assert.equal(thresholdResult.resolvedCount, 3, 'threshold mode drops the gold quadrant (luminosity >= 128)');
  assert.notEqual(subjectResult.resolvedCount, thresholdResult.resolvedCount);
});

// ---- Items 5-10: app.js source -- resolveImageColorCount(), the Auto cache, the write site, the
// Studio hint. Follows this repo's established pattern (see tools/test-img-011-import-defaults.mjs,
// tools/test-rc-005-autosave-crash-recovery.mjs): read app.js as text, slice out the exact source
// span via marker strings, execute it for real via new Function() against minimal/real fakes.

function extractAutoColorCountResolverSource(appJs) {
  const startMarker = 'function autoColorCountKeyParts(layer){';
  const endMarker = 'function computeImageColorField(layer){';
  const start = appJs.indexOf(startMarker);
  assert.ok(start !== -1, 'expected to find autoColorCountKeyParts() in app.js');
  const end = appJs.indexOf(endMarker, start);
  assert.ok(end !== -1, 'expected to find computeImageColorField() after autoColorCountKeyParts() in app.js');
  return appJs.slice(start, end);
}

function buildResolveImageColorCount(source, overrides = {}) {
  const resolveImageTransparentMode = overrides.resolveImageTransparentMode
    || ((value) => new Set(['white', 'ignore']).has(value) ? value : 'white');
  const resolveImageMaskMode = overrides.resolveImageMaskMode
    || ((value) => value === 'subject' ? 'subject' : 'threshold');
  const imageBufferCache = overrides.imageBufferCache || new Map();
  const prepareAutoColorFieldFn = overrides.prepareAutoColorField || prepareAutoColorField;
  const chooseAutoColorCountFn = overrides.chooseAutoColorCount || chooseAutoColorCount;
  const imageColorPaletteFn = overrides.imageColorPalette || (() => PALETTE);
  // eslint-disable-next-line no-new-func
  const built = new Function(
    'imageBufferCache', 'resolveImageTransparentMode', 'resolveImageMaskMode', 'prepareAutoColorField', 'chooseAutoColorCount', 'imageColorPalette',
    `${source}\nreturn { resolveImageColorCount, autoColorCountCache, autoColorCountLastResolved, setFrozen: (v) => { autoColorCountFrozen = v; } };`
  )(imageBufferCache, resolveImageTransparentMode, resolveImageMaskMode, prepareAutoColorFieldFn, chooseAutoColorCountFn, imageColorPaletteFn);
  return { ...built, imageBufferCache };
}

function baseAutoLayer(overrides = {}) {
  return {
    type: 'image', id: 'L1', imageSrc: 'img1', colorCount: 'auto', maskMode: 'threshold',
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400, transparent: 'white',
    seed: 1, spread: 1, stoneSize: 2, gap: 0.3, fillMode: 'staggered', colorMap: {},
    ...overrides
  };
}

await test('5. Engine-level: colorCount \'auto\' resolves through the real resolveImageColorCount() into >1 distinct stone colours via engine.generateImageLayout(); the engine itself still throws for the raw unresolved string \'auto\'', () => {
  const appJs = readFileSync();
  const source = extractAutoColorCountResolverSource(appJs);
  const buffer = buildFourQuadrantImageBuffer(200, 200);
  const imageBufferCache = new Map([['img1', buffer]]);
  const { resolveImageColorCount } = buildResolveImageColorCount(source, { imageBufferCache });

  const layer = baseAutoLayer({ maskMode: 'subject' });
  const resolvedCount = resolveImageColorCount(layer);
  assert.ok(resolvedCount > 1, `expected the fixture's Auto-resolved count to exceed 1, got ${resolvedCount}`);

  const engine = createGeometryEngine();
  const engineParams = (colorCount) => ({
    imageBuffer: buffer, layerId: 'L1', xMm: 0, yMm: 0, widthMm: 60, heightMm: 60,
    stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', color: 'jet',
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
    transparent: 'white', maskMode: 'subject', colorCount, palette: PALETTE, colorMap: {}
  });

  const layout = engine.generateImageLayout(engineParams(resolvedCount));
  const distinctColors = new Set(layout.stones.map((s) => s.color));
  assert.ok(distinctColors.size > 1, `expected more than one distinct stone colour, got ${[...distinctColors]}`);

  assert.throws(
    () => engine.generateImageLayout(engineParams('auto')),
    (err) => err instanceof RangeError && /colorCount must be an integer/.test(err.message),
    'expected the engine to still throw ImageFieldPipeline.js\'s RangeError for the raw unresolved colorCount string \'auto\''
  );
});

await test('6. Cache correctness: changing a D3 key parameter re-runs the sweep; changing seed/spread/stoneSize/gap/fillMode/a colour pick does not', () => {
  const appJs = readFileSync();
  const source = extractAutoColorCountResolverSource(appJs);

  function withSpy() {
    let sweepCalls = 0;
    const imageBufferCache = new Map([['img1', { widthPx: 1, heightPx: 1, data: new Uint8ClampedArray(4) }]]);
    const prepareAutoColorFieldSpy = () => ({ r: new Uint8ClampedArray(0), g: new Uint8ClampedArray(0), b: new Uint8ClampedArray(0), data: new Uint8ClampedArray(0) });
    const chooseAutoColorCountSpy = () => { sweepCalls++; return { resolvedCount: 3, winnerK: 3, scores: [] }; };
    const built = buildResolveImageColorCount(source, {
      imageBufferCache, prepareAutoColorField: prepareAutoColorFieldSpy, chooseAutoColorCount: chooseAutoColorCountSpy
    });
    return { ...built, getSweepCalls: () => sweepCalls };
  }

  const keyChanges = [
    { threshold: 200 }, { invert: true }, { blurRadiusPx: 2 }, { maxWidthPx: 300 },
    { maxHeightPx: 300 }, { transparent: 'ignore' }, { maskMode: 'subject' }
  ];
  for (const change of keyChanges) {
    const { resolveImageColorCount, getSweepCalls } = withSpy();
    resolveImageColorCount(baseAutoLayer());
    assert.equal(getSweepCalls(), 1);
    resolveImageColorCount(baseAutoLayer(change));
    assert.equal(getSweepCalls(), 2, `expected changing ${JSON.stringify(change)} to re-run the sweep`);
  }

  const { resolveImageColorCount, getSweepCalls } = withSpy();
  resolveImageColorCount(baseAutoLayer());
  assert.equal(getSweepCalls(), 1);
  for (const change of [{ seed: 7 }, { spread: 2 }, { stoneSize: 3 }, { gap: 0.5 }, { fillMode: 'radial' }, { colorMap: { jet: 'siam' } }]) {
    resolveImageColorCount(baseAutoLayer(change));
  }
  assert.equal(getSweepCalls(), 1, 'expected seed/spread/stoneSize/gap/fillMode/colorMap edits to never re-run the sweep');
});

// ---- Item 7: byte identity vs. the pristine-tip baseline (6ed4d55, before any IMG-012 change) ----
// Literals captured at pristine tip via createGeometryEngine().generateImageLayout(params) -- the
// real production path (app.js's generateImageStonesLive() is documented as the only caller of
// generateImageLayout()) -- for the four-quadrant fixture above, colorCount absent and 1..8, both
// maskMode 'subject' and 'threshold'. See the milestone's own STEP 0 capture.
const STEP0_BASELINE = {
  subject: {
    absent: { stoneCount: 256, distinctColors: ['jet'] },
    1: { stoneCount: 256, distinctColors: ['jet'] },
    2: { stoneCount: 256, distinctColors: ['sapphire', 'siam'] },
    3: { stoneCount: 256, distinctColors: ['emerald', 'sapphire', 'siam'] },
    4: { stoneCount: 256, distinctColors: ['emerald', 'gold', 'sapphire', 'siam'] },
    5: { stoneCount: 256, distinctColors: ['emerald', 'gold', 'sapphire', 'siam'] },
    6: { stoneCount: 256, distinctColors: ['emerald', 'gold', 'sapphire', 'siam'] },
    7: { stoneCount: 256, distinctColors: ['emerald', 'gold', 'sapphire', 'siam'] },
    8: { stoneCount: 256, distinctColors: ['emerald', 'gold', 'sapphire', 'siam'] }
  },
  threshold: {
    absent: { stoneCount: 192, distinctColors: ['jet'] },
    1: { stoneCount: 192, distinctColors: ['jet'] },
    2: { stoneCount: 192, distinctColors: ['sapphire', 'siam'] },
    3: { stoneCount: 192, distinctColors: ['emerald', 'sapphire', 'siam'] },
    4: { stoneCount: 192, distinctColors: ['emerald', 'sapphire', 'siam'] },
    5: { stoneCount: 192, distinctColors: ['emerald', 'sapphire', 'siam'] },
    6: { stoneCount: 192, distinctColors: ['emerald', 'sapphire', 'siam'] },
    7: { stoneCount: 192, distinctColors: ['emerald', 'sapphire', 'siam'] },
    8: { stoneCount: 192, distinctColors: ['emerald', 'sapphire', 'siam'] }
  }
};

await test('7. Byte identity: colorCount absent and 1..8 reproduce the pristine-tip STEP 0 baseline exactly, in both mask modes', () => {
  const buffer = buildFourQuadrantImageBuffer(200, 200);
  const engine = createGeometryEngine();
  const baseParams = (maskMode, colorCount) => {
    const p = {
      imageBuffer: buffer, layerId: 'step0', xMm: 0, yMm: 0, widthMm: 60, heightMm: 60,
      stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', color: 'jet',
      threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
      transparent: 'white', maskMode, palette: PALETTE, colorMap: {}
    };
    if (colorCount !== undefined) p.colorCount = colorCount;
    return p;
  };
  for (const maskMode of ['subject', 'threshold']) {
    for (const colorCount of [undefined, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const label = colorCount === undefined ? 'absent' : colorCount;
      const layout = engine.generateImageLayout(baseParams(maskMode, colorCount));
      const distinctColors = [...new Set(layout.stones.map((s) => s.color))].sort();
      assert.equal(layout.stones.length, STEP0_BASELINE[maskMode][label].stoneCount, `${maskMode}/colorCount=${label}: stone count`);
      assert.deepEqual(distinctColors, STEP0_BASELINE[maskMode][label].distinctColors, `${maskMode}/colorCount=${label}: distinct colours`);
    }
  }
});

// ---- Item 8: write-site round trip -----------------------------------------------------------------
function extractColorCountWriteExpression(appJs) {
  const marker = "l.colorCount=el('imgColorCount').value==='auto'?'auto':Math.max(1,Math.min(8,parseIntOr(el('imgColorCount').value,1)));";
  assert.ok(appJs.includes(marker), "expected writeSelectedControlsToLayer()'s image branch to special-case 'auto' before the parseIntOr clamp");
  return marker;
}

await test("8. Write-site round trip: selecting value 'auto' stores layer.colorCount === 'auto' (not the old parseIntOr(1) fallback)", () => {
  const appJs = readFileSync();
  const expr = extractColorCountWriteExpression(appJs);

  function parseIntOr(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  }
  function run(selectValue) {
    const el = (id) => { assert.equal(id, 'imgColorCount'); return { value: selectValue }; };
    // eslint-disable-next-line no-new-func
    const fn = new Function('el', 'parseIntOr', `const l={};${expr}\nreturn l.colorCount;`);
    return fn(el, parseIntOr);
  }

  assert.equal(run('auto'), 'auto', "expected selecting 'auto' to store layer.colorCount as the string 'auto'");
  assert.equal(run('5'), 5, 'expected selecting a plain number to still store the clamped integer');
  assert.equal(run('bogus'), 1, 'expected an unrecognised value to still fall back to 1, same as before');
});

// ---- Item 9: D2 -- computeImageColorField() matches the production field for the same layer -------
function extractComputeImageColorFieldSource(appJs) {
  const startMarker = 'const imageColorFieldCache=new Map();\nfunction computeImageColorField(layer){';
  const start = appJs.indexOf(startMarker);
  assert.ok(start !== -1, 'expected to find computeImageColorField() in app.js');
  const braceStart = start + startMarker.length - 1;
  let depth = 0;
  for (let i = braceStart; i < appJs.length; i++) {
    if (appJs[i] === '{') depth++;
    else if (appJs[i] === '}') { depth--; if (depth === 0) return appJs.slice(start, i + 1); }
  }
  throw new Error('expected to find the matching closing "}" of computeImageColorField() in app.js');
}

await test("9. D2: computeImageColorField() for a subject-mode layer returns colorGroups matching the production field's colorGroups for the same layer", () => {
  const appJs = readFileSync();
  const resolverSource = extractAutoColorCountResolverSource(appJs);
  const colorFieldSource = extractComputeImageColorFieldSource(appJs);

  const buffer = buildFourQuadrantImageBuffer(200, 200);
  const imageBufferCache = new Map([['img1', buffer]]);
  const resolveImageTransparentMode = (value) => new Set(['white', 'ignore']).has(value) ? value : 'white';
  const resolveImageMaskMode = (value) => value === 'subject' ? 'subject' : 'threshold';
  const imageColorPalette = () => PALETTE;

  // eslint-disable-next-line no-new-func
  const { resolveImageColorCount } = new Function(
    'imageBufferCache', 'resolveImageTransparentMode', 'resolveImageMaskMode', 'prepareAutoColorField', 'chooseAutoColorCount', 'imageColorPalette',
    `${resolverSource}\nreturn { resolveImageColorCount };`
  )(imageBufferCache, resolveImageTransparentMode, resolveImageMaskMode, prepareAutoColorField, chooseAutoColorCount, imageColorPalette);

  // eslint-disable-next-line no-new-func
  const computeImageColorField = new Function(
    'imageBufferCache', 'resolveImageTransparentMode', 'resolveImageMaskMode', 'resolveImageColorCount', 'prepareImageField', 'imageColorPalette',
    `${colorFieldSource}\nreturn computeImageColorField;`
  )(imageBufferCache, resolveImageTransparentMode, resolveImageMaskMode, resolveImageColorCount, prepareImageField, imageColorPalette);

  const layer = { type: 'image', id: 'L1', imageSrc: 'img1', colorCount: 4, maskMode: 'subject', threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400, transparent: 'white' };
  const studioField = computeImageColorField(layer);
  assert.ok(studioField, 'expected computeImageColorField() to return a field for colorCount:4');

  const productionField = prepareImageField(buffer, {
    threshold: 128, invert: false, blurRadiusPx: 0, maxWidthPx: 400, maxHeightPx: 400,
    transparent: 'white', maskMode: 'subject', colorCount: 4, palette: PALETTE
  });

  assert.deepEqual(studioField.colorGroups, productionField.colorGroups, "expected the Studio's field to quantize against the same (subject) mask as production");
});

// ---- Item 10: Studio hint text ----------------------------------------------------------------------
function extractAutoHintSource(appJs) {
  const marker = "const autoHintEl=el('imgColorCountAuto');\n  if(l.colorCount==='auto'){const autoResolvedCount=colorField?colorField.colorGroups.length:resolveImageColorCount(l);autoHintEl.textContent=`Auto: ${autoResolvedCount} ${autoResolvedCount===1?'colour':'colours'}`;autoHintEl.style.display=''}else{autoHintEl.style.display='none'}";
  assert.ok(appJs.includes(marker), 'expected renderImageStudio() to set the #imgColorCountAuto hint text');
  return marker;
}

await test('10. Studio hint text reads exactly "Auto: 4 colours" for fixture 1 (decision 3\'s own literal example, item wording)', () => {
  const appJs = readFileSync();
  const source = extractAutoHintSource(appJs);

  const hintEl = { textContent: '', style: {} };
  const el = (id) => { assert.equal(id, 'imgColorCountAuto'); return hintEl; };
  const resolveImageColorCount = () => 4;
  const colorField = { colorGroups: new Array(4).fill({}) };
  const l = { colorCount: 'auto' };
  // eslint-disable-next-line no-new-func
  new Function('el', 'l', 'resolveImageColorCount', 'colorField', source)(el, l, resolveImageColorCount, colorField);

  assert.equal(hintEl.textContent, 'Auto: 4 colours');
  assert.equal(hintEl.style.display, '');

  // And hides for a non-Auto layer.
  const hiddenEl = { textContent: '', style: {} };
  const elHidden = () => hiddenEl;
  // eslint-disable-next-line no-new-func
  new Function('el', 'l', 'resolveImageColorCount', 'colorField', source)(elHidden, { colorCount: 3 }, resolveImageColorCount, colorField);
  assert.equal(hiddenEl.style.display, 'none');
});

// ---- Item 11: freeze (D3 follow-up) ----------------------------------------------------------------
await test('11. Freeze: while frozen, resolveImageColorCount() returns the earlier count without re-running the sweep; unfreezing re-runs it', () => {
  const appJs = readFileSync();
  const source = extractAutoColorCountResolverSource(appJs);

  let sweepCalls = 0;
  const imageBufferCache = new Map([['img1', { widthPx: 1, heightPx: 1, data: new Uint8ClampedArray(4) }]]);
  const prepareAutoColorFieldSpy = () => ({ r: new Uint8ClampedArray(0), g: new Uint8ClampedArray(0), b: new Uint8ClampedArray(0), data: new Uint8ClampedArray(0) });
  const chooseAutoColorCountSpy = () => { sweepCalls++; return { resolvedCount: 3, winnerK: 3, scores: [] }; };
  const { resolveImageColorCount, setFrozen } = buildResolveImageColorCount(source, {
    imageBufferCache, prepareAutoColorField: prepareAutoColorFieldSpy, chooseAutoColorCount: chooseAutoColorCountSpy
  });

  const layer = baseAutoLayer();
  assert.equal(resolveImageColorCount(layer), 3, 'expected the first resolve to run the sweep and return its result');
  assert.equal(sweepCalls, 1);

  setFrozen(true);
  const changed = baseAutoLayer({ blurRadiusPx: 9 });
  assert.equal(resolveImageColorCount(changed), 3, 'expected the frozen call to return the earlier count regardless of the changed param');
  assert.equal(sweepCalls, 1, 'expected the frozen call to not re-run the sweep');

  setFrozen(false);
  resolveImageColorCount(changed);
  assert.equal(sweepCalls, 2, 'expected unfreezing to allow a fresh sweep for the now-current params');
});

// ---- Item 12: wiring (source check -- item 11 covers the actual freeze behaviour) -------------------
await test('12. Wiring: app.js registers pointerdown/pointerup/change listeners on each freeze-list control that set autoColorCountFrozen as specified, and change also calls updateAll(true)', () => {
  const appJs = readFileSync();
  const marker = "const AUTO_COLOR_COUNT_FREEZE_CONTROL_IDS=['imgThreshold','imgBlurRadius','imgMaxWidth','imgMaxHeight'];\nfor(const id of AUTO_COLOR_COUNT_FREEZE_CONTROL_IDS){\n  el(id).addEventListener('pointerdown',()=>{autoColorCountFrozen=true});\n  el(id).addEventListener('pointerup',()=>{autoColorCountFrozen=false});\n  el(id).addEventListener('change',()=>{autoColorCountFrozen=false;updateAll(true)});\n}";
  assert.ok(appJs.includes(marker), 'expected the exact freeze-control wiring block (pointerdown/pointerup/change on imgThreshold/imgBlurRadius/imgMaxWidth/imgMaxHeight) in app.js');
});

// ---- Item 13: app-path passthrough -------------------------------------------------------------------
await test('13. App-path passthrough: resolveImageColorCount() returns exactly n for colorCount 1..8 and 1 for an absent value, never calling the sweep', () => {
  const appJs = readFileSync();
  const source = extractAutoColorCountResolverSource(appJs);

  let sweepCalls = 0;
  const chooseAutoColorCountSpy = () => { sweepCalls++; return { resolvedCount: 1, winnerK: 1, scores: [] }; };
  const { resolveImageColorCount } = buildResolveImageColorCount(source, { chooseAutoColorCount: chooseAutoColorCountSpy });

  for (let n = 1; n <= 8; n++) {
    assert.equal(resolveImageColorCount(baseAutoLayer({ colorCount: n })), n, `expected colorCount:${n} to pass through unchanged`);
  }
  assert.equal(resolveImageColorCount(baseAutoLayer({ colorCount: undefined })), 1, 'expected an absent colorCount to resolve to 1');
  assert.equal(sweepCalls, 0, 'expected numeric/absent colorCount to never invoke the sweep');
});

// ---- Item 14: hint singular/plural -------------------------------------------------------------------
await test('14. Hint singular/plural: a resolved count of 1 reads "Auto: 1 colour"; 4 reads "Auto: 4 colours"', () => {
  const appJs = readFileSync();
  const source = extractAutoHintSource(appJs);

  function run(resolvedCount) {
    const hintEl = { textContent: '', style: {} };
    const el = () => hintEl;
    const resolveImageColorCount = () => resolvedCount;
    const colorField = { colorGroups: new Array(resolvedCount).fill({}) };
    const l = { colorCount: 'auto' };
    // eslint-disable-next-line no-new-func
    new Function('el', 'l', 'resolveImageColorCount', 'colorField', source)(el, l, resolveImageColorCount, colorField);
    return hintEl.textContent;
  }

  assert.equal(run(1), 'Auto: 1 colour');
  assert.equal(run(4), 'Auto: 4 colours');
});

console.log('IMG-012 auto colour count tests passed.');
