import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// PREVIEW-001 — src/renderer/CrystalStoneRenderer.js (2D faceted-crystal drawing) and its wiring
// into CanvasRenderer2D.js's renderStoneLayout(). Uses the same dependency-free fake
// CanvasRenderingContext2D convention as tools/test-render-export-pipeline.mjs, extended to also
// record ellipse()/lineTo() calls so facet/highlight/reflection presence can be asserted directly.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const { drawCrystalStone, renderCrystalStoneLayout, adjustBrightness, sparkleOpacityFor, _brightnessCacheSizeForTesting } =
  await import('../src/renderer/CrystalStoneRenderer.js');
const { getCrystalAppearance, SPARKLE_VARIANT_COUNT } = await import('../src/renderer/CrystalAppearance.js');
const { renderStoneLayout } = await import('../src/renderer/CanvasRenderer2D.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');

const canvasRenderer2DSource = await readFile(path.join(repoRoot, 'src/renderer/CanvasRenderer2D.js'), 'utf8');
const stoneLayoutTextureSource = await readFile(path.join(repoRoot, 'src/preview3d/StoneLayoutTexture.js'), 'utf8');
const svgExporterSource = await readFile(path.join(repoRoot, 'src/export/SvgExporter.js'), 'utf8');
const productionSheetExporterSource = await readFile(path.join(repoRoot, 'src/export/ProductionSheetExporter.js'), 'utf8');

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

function createFakeCtx() {
  const calls = { arc: [], ellipse: [], lineTo: [], moveTo: [] };
  const target = {
    arc(x, y, r, ...rest) { calls.arc.push({ x, y, r, rest }); },
    ellipse(...args) { calls.ellipse.push(args); },
    lineTo(...args) { calls.lineTo.push(args); },
    moveTo(...args) { calls.moveTo.push(args); },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; }
  };
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      return () => {};
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    }
  });
  return { ctx, calls };
}

function makeLayout(stoneParams, layerId = 'layer-1') {
  const stones = stoneParams.map((p, index) => new Stone({ layerId, index, ...p }));
  return new StoneLayout({ layerId, stones });
}

await test('1. drawCrystalStone preserves the exact stone center and radius (body fill + crisp edge)', () => {
  const { ctx, calls } = createFakeCtx();
  const appearance = getCrystalAppearance(new Stone({ xMm: 10, yMm: 5, sizeMm: 3, layerId: 'l', index: 0 }));
  drawCrystalStone(ctx, 42, 17, 6, 'gold', appearance);
  const exactMatches = calls.arc.filter((c) => c.x === 42 && c.y === 17 && c.r === 6);
  assert.equal(exactMatches.length, 2, 'expected exactly the body-fill arc and crisp-edge arc at the true center/radius');
});

await test('2. drawCrystalStone draws more than a flat circle: shadow arc, facet lines, highlight + secondary ellipses', () => {
  const { ctx, calls } = createFakeCtx();
  const appearance = getCrystalAppearance(new Stone({ xMm: 10, yMm: 5, sizeMm: 3, layerId: 'l', index: 0 }));
  drawCrystalStone(ctx, 42, 17, 6, 'gold', appearance);
  assert.equal(calls.arc.length, 4, 'expected shadow + body + lower-edge-shade + crisp-edge arcs');
  assert.ok(calls.ellipse.length >= 2, 'expected at least a primary highlight and a secondary reflection ellipse');
  assert.ok(calls.lineTo.length >= 2, 'expected at least the two contrasting facet chords');
});

// PREVIEW-001A helper: find a stone whose deterministic appearance is sparkle-eligible with a
// specific sparkleVariant, by sweeping candidate positions/indices. Throws if none found within
// the search budget (a real failure, not a flaky test -- with SPARKLE_ELIGIBILITY ~12.5% and 4
// variants, ~3% of samples should match each variant, so 2000 samples is generous headroom).
function findStoneWithVariant(variant, searchBudget = 2000) {
  for (let i = 0; i < searchBudget; i++) {
    const candidate = new Stone({ xMm: i * 1.7, yMm: i * 0.31, sizeMm: 4, layerId: 'l', index: i });
    const appearance = getCrystalAppearance(candidate);
    if (appearance.sparkle && appearance.sparkleVariant === variant) return candidate;
  }
  throw new Error(`No sparkle-eligible stone with sparkleVariant=${variant} found within ${searchBudget} samples`);
}

await test('3. every sparkle variant (0-3) draws something extra beyond the non-sparkle baseline', () => {
  for (let variant = 0; variant < SPARKLE_VARIANT_COUNT; variant++) {
    const stone = findStoneWithVariant(variant);
    const appearance = getCrystalAppearance(stone);
    assert.equal(appearance.sparkleVariant, variant);

    const { ctx: ctxNoSparkle, calls: callsNoSparkle } = createFakeCtx();
    drawCrystalStone(ctxNoSparkle, 0, 0, 8, 'gold', { ...appearance, sparkle: false });

    const { ctx: ctxSparkle, calls: callsSparkle } = createFakeCtx();
    drawCrystalStone(ctxSparkle, 0, 0, 8, 'gold', appearance);

    if (variant === 0 || variant === 1) {
      // Cross (0) / diagonal (1): two extra soft-edged lines -> two extra lineTo calls.
      assert.equal(callsSparkle.lineTo.length, callsNoSparkle.lineTo.length + 2, `variant ${variant} should add exactly 2 lineTo calls`);
      assert.equal(callsSparkle.arc.length, callsNoSparkle.arc.length, `variant ${variant} should not add any arc calls`);
    } else {
      // Point glint (2) / brighter-highlight-no-star (3): one extra soft radial glow -> one extra arc call, no lineTo.
      assert.equal(callsSparkle.arc.length, callsNoSparkle.arc.length + 1, `variant ${variant} should add exactly 1 arc call`);
      assert.equal(callsSparkle.lineTo.length, callsNoSparkle.lineTo.length, `variant ${variant} should not add any lineTo calls`);
    }
  }
});

await test('4. tiny stones never draw a sparkle glint even when sparkle-eligible (any variant)', () => {
  const stone = findStoneWithVariant(0);
  const appearance = getCrystalAppearance(stone);
  const { ctx: ctxTiny, calls: callsTiny } = createFakeCtx();
  drawCrystalStone(ctxTiny, 0, 0, 1.0, 'gold', appearance); // below MIN_SPARKLE_RADIUS_PX
  const { ctx: ctxLarge, calls: callsLarge } = createFakeCtx();
  drawCrystalStone(ctxLarge, 0, 0, 8, 'gold', appearance);
  assert.ok(callsLarge.lineTo.length > callsTiny.lineTo.length, 'a tiny radius should suppress the sparkle glint');
});

await test('3b. sparkle cross/diagonal arms are shorter than the pre-PREVIEW-001A 0.85*radius cross', () => {
  const stone = findStoneWithVariant(0);
  const appearance = getCrystalAppearance(stone);
  const radiusPx = 100; // large radius makes the arm-length ratio easy to read back from coordinates
  const { ctx, calls } = createFakeCtx();
  drawCrystalStone(ctx, 0, 0, radiusPx, 'gold', appearance);
  // The horizontal arm's lineTo endpoints are (+-len, 0) relative to stone center (0,0).
  const maxAbsX = Math.max(...calls.lineTo.map(([x]) => Math.abs(x)));
  assert.ok(maxAbsX < radiusPx * 0.85, `arm reach ${maxAbsX} should be well under the old 0.85*radius (${radiusPx * 0.85})`);
  assert.ok(maxAbsX <= radiusPx * 0.6, `arm reach ${maxAbsX} should match the new ~0.55*radius (0.55-0.6*radius) length`);
});

await test('3c. sparkle opacity stays within the PREVIEW-001A target range [0.35,0.50] across the full highlightIntensity domain', () => {
  for (let hi = 0.7; hi <= 1.0; hi += 0.02) {
    const opacity = sparkleOpacityFor(hi);
    assert.ok(opacity >= 0.35 && opacity <= 0.5, `sparkleOpacityFor(${hi})=${opacity} out of [0.35,0.50]`);
  }
  assert.ok(Math.abs(sparkleOpacityFor(0.7) - 0.35) < 1e-9, 'lowest highlightIntensity should map to the opacity floor 0.35');
  assert.ok(Math.abs(sparkleOpacityFor(1.0) - 0.5) < 1e-9, 'highest highlightIntensity should map to the opacity ceiling 0.50');
});

await test('5. renderCrystalStoneLayout is deterministic: same StoneLayout renders identical call sequences', () => {
  const layout = makeLayout([
    { xMm: 1, yMm: 2, sizeMm: 3, color: 'gold' },
    { xMm: -4, yMm: 6, sizeMm: 2, color: 'sapphire' }
  ]);
  const transform = { s: 3, ox: 5, oy: 8 };
  const { ctx: ctxA, calls: callsA } = createFakeCtx();
  const { ctx: ctxB, calls: callsB } = createFakeCtx();
  renderCrystalStoneLayout(ctxA, layout, transform);
  renderCrystalStoneLayout(ctxB, layout, transform);
  assert.deepEqual(callsA, callsB);
});

await test('6. two stones differing only in position render different facet/highlight geometry', () => {
  const layoutA = makeLayout([{ xMm: 1, yMm: 2, sizeMm: 3, color: 'gold' }]);
  const layoutB = makeLayout([{ xMm: 40, yMm: -12, sizeMm: 3, color: 'gold' }]);
  const transform = { s: 1, ox: 0, oy: 0 };
  const { ctx: ctxA, calls: callsA } = createFakeCtx();
  const { ctx: ctxB, calls: callsB } = createFakeCtx();
  renderCrystalStoneLayout(ctxA, layoutA, transform);
  renderCrystalStoneLayout(ctxB, layoutB, transform);
  // Translate layoutB's calls back by the same offset used for its position and compare shape --
  // simplest robust check: the raw ellipse offsets from center should differ (proves the facet
  // angle/seed actually varies, not just the translation).
  const relA = callsA.ellipse[0][0] - 1;
  const relB = callsB.ellipse[0][0] - 40;
  assert.notEqual(relA, relB, 'expected different facet-derived highlight offsets for differently-positioned stones');
});

await test('7. rendering never mutates the StoneLayout/Stone it reads', () => {
  const layout = makeLayout([
    { xMm: 1, yMm: 2, sizeMm: 3, color: 'gold' },
    { xMm: -4, yMm: 6, sizeMm: 2, color: 'sapphire' }
  ]);
  const before = layout.stones.map((s) => s.toJSON());
  const { ctx } = createFakeCtx();
  renderCrystalStoneLayout(ctx, layout, { s: 2, ox: 0, oy: 0 });
  const after = layout.stones.map((s) => s.toJSON());
  assert.deepEqual(after, before);
});

await test('8. CanvasRenderer2D.renderStoneLayout defaults to the crystal path ("layout" style)', () => {
  const layout = makeLayout([{ xMm: 0, yMm: 0, sizeMm: 4, color: 'gold' }]);
  const { ctx, calls } = createFakeCtx();
  renderStoneLayout(ctx, layout, { s: 1, ox: 0, oy: 0 });
  assert.equal(calls.arc.length, 4, 'default style must go through the crystal renderer (4 arcs: shadow, body, lower-edge-shade, edge)');
});

await test('9. CanvasRenderer2D.renderStoneLayout("exact") preserves the original single-arc flat-shaded diagnostic path', () => {
  const layout = makeLayout([
    { xMm: 10, yMm: 5, sizeMm: 2, color: 'gold' },
    { xMm: -3, yMm: 7, sizeMm: 4, color: 'jet' }
  ]);
  const transform = { s: 2, ox: 10, oy: 20 };
  const { ctx, calls } = createFakeCtx();
  renderStoneLayout(ctx, layout, transform, 'exact');
  assert.equal(calls.arc.length, 2, 'the "exact" diagnostic style must draw exactly one arc per stone, no facets/sparkle');
  assert.deepEqual({ x: calls.arc[0].x, y: calls.arc[0].y, r: calls.arc[0].r }, { x: 10 + 10 * 2, y: 20 + 5 * 2, r: Math.max(2, 2 * 2 / 2) });
  assert.deepEqual({ x: calls.arc[1].x, y: calls.arc[1].y, r: calls.arc[1].r }, { x: 10 + -3 * 2, y: 20 + 7 * 2, r: Math.max(2, 4 * 2 / 2) });
});

await test('10. adjustBrightness is memoized per (hex, quantized factor) bucket', () => {
  const sizeBefore = _brightnessCacheSizeForTesting();
  const a = adjustBrightness('#f3bd32', 1.0);
  const sizeAfterFirst = _brightnessCacheSizeForTesting();
  const b = adjustBrightness('#f3bd32', 1.0);
  const sizeAfterSecond = _brightnessCacheSizeForTesting();
  assert.equal(a, b);
  assert.equal(sizeAfterFirst, sizeBefore + 1, 'first call for a new (hex,bucket) pair should add one cache entry');
  assert.equal(sizeAfterSecond, sizeAfterFirst, 'repeat call with the same (hex,bucket) pair must not grow the cache');
});

await test('11. adjustBrightness quantizes nearby factors into the same cache bucket', () => {
  const before = _brightnessCacheSizeForTesting();
  adjustBrightness('#123456', 1.001);
  adjustBrightness('#123456', 1.002);
  const after = _brightnessCacheSizeForTesting();
  assert.equal(after, before + 1, 'factors within the same 0.02 bucket should share one cache entry');
});

await test('12. renderer wiring: CanvasRenderer2D.js and StoneLayoutTexture.js both import the shared crystal modules', () => {
  assert.match(canvasRenderer2DSource, /import\s*\{\s*drawCrystalStone\s*\}\s*from\s*['"]\.\/CrystalStoneRenderer\.js['"]/);
  assert.match(canvasRenderer2DSource, /import\s*\{\s*getCrystalAppearance\s*\}\s*from\s*['"]\.\/CrystalAppearance\.js['"]/);
  assert.match(stoneLayoutTextureSource, /import\s*\{\s*drawCrystalStone\s*\}\s*from\s*['"]\.\.\/renderer\/CrystalStoneRenderer\.js['"]/);
  assert.match(stoneLayoutTextureSource, /import\s*\{\s*getCrystalAppearance\s*\}\s*from\s*['"]\.\.\/renderer\/CrystalAppearance\.js['"]/);
});

await test('13. separation of views: exporters never import the crystal-preview modules', () => {
  for (const [name, source] of [
    ['SvgExporter.js', svgExporterSource],
    ['ProductionSheetExporter.js', productionSheetExporterSource]
  ]) {
    assert.ok(!/CrystalStoneRenderer|CrystalAppearance|drawCrystalStone|getCrystalAppearance/.test(source), `${name} must not reference the decorative crystal-preview modules`);
  }
});

console.log('Crystal stone renderer tests passed.');
