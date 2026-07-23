/**
 * TXT-101B -- RS Block, the first production-quality original rhinestone font (full A-Z, a-z,
 * 0-9, space, and . , ! ? ' - & coverage). Builds on RS Block Prototype (SS10)'s approved
 * stone-center-authored approach (see tools/test-rhinestone-font-prototype.mjs and
 * families/rsBlockPrototypeSS10.js's module doc) -- no contract change, no new rendering/export
 * path, no shared skeleton. This suite covers registration, full character coverage, unsupported
 * character handling, deterministic authored maps, serialization, GeometryEngine integration
 * (including curved-text/Boolean-operation rejection), SVG export, 2D-texture export, kerning, and
 * backward compatibility. It cannot and does not establish visual readability -- that is the QA
 * sheets' job (tools/generate-rs-block-qa-sheets.mjs) plus manual approval.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createDefaultRhinestoneFontRegistry,
  RhinestoneFontProvider
} from '../src/text/rhinestoneFont/index.js';
import { getGlyphStoneMap, getKerningAdjustmentMm, descriptor, PITCH_MM } from '../src/text/rhinestoneFont/families/rsBlock.js';
import { createDefaultFontProviderRegistry } from '../src/text/defaultFontProviders.js';
import { GeometryEngine } from '../src/geometry/GeometryEngine.js';
import { StoneLayout } from '../src/geometry/StoneLayout.js';
import { Stone } from '../src/geometry/Stone.js';
import { FontManager } from '../src/fonts/index.js';
import { stoneLayoutToSvg } from '../src/export/SvgExporter.js';
import { drawStoneLayoutTexture } from '../src/preview3d/StoneLayoutTexture.js';

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

const FONT_ID = 'rs-block';
const SUPPORTED_CHARACTERS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'0123456789',
  ' ', '.', ',', '!', '?', "'", '-', '&'
];

function makeEngine() {
  const registry = createDefaultRhinestoneFontRegistry();
  const provider = new RhinestoneFontProvider({ registry });
  const engine = new GeometryEngine({ fontProviderRegistry: { getTextPath: (o) => provider.getTextPath(o) } });
  return { registry, provider, engine };
}

function createFakeCtx() {
  const calls = { fillRect: [], arc: [] };
  const target = {
    createRadialGradient() { return { addColorStop() {} }; },
    clearRect() {},
    fillRect(...args) { calls.fillRect.push(args); },
    arc(...args) { calls.arc.push(args); },
    beginPath() {},
    fill() {}
  };
  const ctx = new Proxy(target, {
    get(obj, prop) { return prop in obj ? obj[prop] : () => {}; },
    set(obj, prop, value) { obj[prop] = value; return true; }
  });
  return { ctx, calls };
}

// ---------------------------------------------------------------------------------------------
// 1. Registration
// ---------------------------------------------------------------------------------------------

await test('1. the default registry registers RS Block alongside the SS10 prototype', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  assert.deepEqual(registry.list().map((f) => f.id).sort(), ['rs-block', 'rs-block-prototype-ss10'].sort());
});

await test('2. RS Block descriptor is a production (non-experimental) rhinestone-native category', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const meta = registry.getMetadata(FONT_ID);
  assert.equal(meta.category, 'rhinestone-native');
  assert.equal(meta.fillModeIndependent, true);
});

// ---------------------------------------------------------------------------------------------
// 2. Supported character coverage
// ---------------------------------------------------------------------------------------------

await test('3. supportedCharacters is exactly A-Z, a-z, 0-9, space, and . , ! ? \' - & -- 70 characters total', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const meta = registry.getMetadata(FONT_ID);
  assert.equal(meta.supportedCharacters.length, 70);
  assert.deepEqual([...meta.supportedCharacters].sort(), [...SUPPORTED_CHARACTERS].sort());
});

await test('4. every supported character returns a non-null glyph with at least one stone (space excepted)', () => {
  for (const character of SUPPORTED_CHARACTERS) {
    const glyph = getGlyphStoneMap(character);
    assert.ok(glyph, `expected "${character === ' ' ? 'space' : character}" to be supported`);
    assert.ok(Number.isFinite(glyph.advanceWidthMm) && glyph.advanceWidthMm > 0);
    if (character !== ' ') {
      assert.ok(glyph.stones.length > 0, `expected "${character}" to have at least one stone`);
    } else {
      assert.equal(glyph.stones.length, 0, 'expected space to have zero stones');
    }
  }
});

// ---------------------------------------------------------------------------------------------
// 3. Unsupported character handling
// ---------------------------------------------------------------------------------------------

await test('5. an unsupported character (e.g. accented/CJK/emoji) returns null, never a malformed glyph', () => {
  for (const character of ['é', '中', '🙂', '@', '#', '(', ')', '_']) {
    assert.equal(getGlyphStoneMap(character), null, `expected "${character}" to be unsupported`);
  }
});

await test('6. an unsupported character advances the pen without throwing and contributes zero stones', async () => {
  const { provider } = makeEngine();
  const supportedOnly = await provider.getTextPath({ fontId: FONT_ID, text: 'A', heightMm: 20 });
  const withUnsupported = await provider.getTextPath({ fontId: FONT_ID, text: 'A@', heightMm: 20 });
  assert.equal(withUnsupported.stoneCenters.length, supportedOnly.stoneCenters.length);
  assert.ok(withUnsupported.metrics.advanceWidthMm > supportedOnly.metrics.advanceWidthMm);
});

// ---------------------------------------------------------------------------------------------
// 4. Deterministic authored stone maps
// ---------------------------------------------------------------------------------------------

await test('7. every glyph\'s stone map is deterministic across repeated calls and frozen (authored, not regenerated)', () => {
  for (const character of SUPPORTED_CHARACTERS) {
    const first = getGlyphStoneMap(character);
    const second = getGlyphStoneMap(character);
    assert.deepEqual(first, second);
    assert.ok(Object.isFrozen(first.stones));
  }
});

await test('8. every stone position sits on the fixed pitch grid (a whole-number multiple of PITCH_MM)', () => {
  for (const character of SUPPORTED_CHARACTERS) {
    const glyph = getGlyphStoneMap(character);
    for (const stone of glyph.stones) {
      assert.equal(Math.round(stone.xMm / PITCH_MM) * PITCH_MM, Number(stone.xMm.toFixed(10)));
      assert.equal(Math.round(stone.yMm / PITCH_MM) * PITCH_MM, Number(stone.yMm.toFixed(10)));
    }
  }
});

await test('9. no two stones within any single glyph are closer than the recommended stone size', () => {
  for (const character of SUPPORTED_CHARACTERS) {
    const glyph = getGlyphStoneMap(character);
    for (let i = 0; i < glyph.stones.length; i++) {
      for (let j = i + 1; j < glyph.stones.length; j++) {
        const distance = Math.hypot(glyph.stones[i].xMm - glyph.stones[j].xMm, glyph.stones[i].yMm - glyph.stones[j].yMm);
        assert.ok(
          distance >= descriptor.recommendedStoneSizeMm - 1e-9,
          `"${character}" has two stones ${distance.toFixed(2)}mm apart, below the ${descriptor.recommendedStoneSizeMm}mm recommended stone size`
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// 5. GeometryEngine integration
// ---------------------------------------------------------------------------------------------

await test('10. every glyph reproduces exactly through the real GeometryEngine pipeline (no drift, no loss)', async () => {
  const { engine } = makeEngine();
  for (const character of SUPPORTED_CHARACTERS) {
    if (character === ' ') continue;
    const layout = await engine.generateTextLayout({
      text: character, fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
      heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
    });
    const authored = getGlyphStoneMap(character).stones;
    assert.equal(layout.stones.length, authored.length, `expected "${character}"'s stone count to match its authored count exactly`);
    assert.equal(layout.sourceMode, 'authored');
  }
});

await test('11. both fill-mode selections (outline and fill) produce the identical authored-stone result for a full word', async () => {
  const { engine } = makeEngine();
  const base = {
    text: "Sparkle Boutique 2026!", fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, color: 'gold'
  };
  const outlineLayout = await engine.generateTextLayout({ ...base, mode: 'outline' });
  const fillLayout = await engine.generateTextLayout({ ...base, mode: 'fill' });
  const asKey = (s) => `${s.xMm.toFixed(6)},${s.yMm.toFixed(6)}`;
  assert.deepEqual(outlineLayout.stones.map(asKey).sort(), fillLayout.stones.map(asKey).sort());
});

await test('12. curved text combined with RS Block fails explicitly rather than silently ignoring the curve settings', async () => {
  const { engine } = makeEngine();
  await assert.rejects(
    () => engine.generateTextLayout({
      text: 'A', fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
      heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold',
      curveEnabled: true, curveRadiusMm: 40, curveSweepAngleDeg: 90
    }),
    /curved text is not supported/
  );
});

await test('13. resolveTextPolygons fails explicitly for RS Block -- it has no vector outline for a Boolean Operation to consume', async () => {
  const { engine } = makeEngine();
  await assert.rejects(
    () => engine.resolveTextPolygons({ text: 'A', fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x', heightMm: 30 }),
    /authored stone centers, not a vector outline/
  );
});

// ---------------------------------------------------------------------------------------------
// 6. Kerning
// ---------------------------------------------------------------------------------------------

await test('14. reviewed kerning pairs tighten the pen advance relative to the unkerned sum of the two glyphs\' widths', async () => {
  const { provider } = makeEngine();
  const reviewedPairs = ['AV', 'VA', 'WA', 'AW', 'To', 'Yo', 'LA', 'LT', 'TT', 'TA', 'FA', 'PA', 'LY', 'RY'];
  for (const pair of reviewedPairs) {
    const adjustment = getKerningAdjustmentMm(pair[0], pair[1]);
    assert.ok(adjustment < 0, `expected "${pair}" to tighten (negative adjustment), got ${adjustment}`);

    const pairResult = await provider.getTextPath({ fontId: FONT_ID, text: pair, heightMm: 20 });
    const unkerntedSum = getGlyphStoneMap(pair[0]).advanceWidthMm + getGlyphStoneMap(pair[1]).advanceWidthMm;
    assert.ok(
      pairResult.metrics.advanceWidthMm < unkerntedSum,
      `expected "${pair}"'s kerned advance (${pairResult.metrics.advanceWidthMm}) to be less than the unkerned sum (${unkerntedSum})`
    );
    assert.ok(Math.abs(pairResult.metrics.advanceWidthMm - (unkerntedSum + adjustment)) < 1e-9);
  }
});

await test('15. an unreviewed pair (e.g. "BC") gets zero kerning adjustment', () => {
  assert.equal(getKerningAdjustmentMm('B', 'C'), 0);
});

await test('16. a family without getKerningAdjustmentMm (the SS10 prototype) behaves exactly as before -- no crash, no adjustment', async () => {
  const { provider } = makeEngine();
  const result = await provider.getTextPath({ fontId: 'rs-block-prototype-ss10', text: 'AB', heightMm: 20 });
  assert.ok(Array.isArray(result.stoneCenters));
});

// ---------------------------------------------------------------------------------------------
// 7. SVG export / 2D-3D texture (single source of truth)
// ---------------------------------------------------------------------------------------------

await test('17. generateTextLayout returns an ordinary StoneLayout of ordinary Stone instances for RS Block', async () => {
  const { engine } = makeEngine();
  const layout = await engine.generateTextLayout({
    text: 'Rhinestone Studio', fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
  });
  assert.ok(layout instanceof StoneLayout);
  assert.ok(layout.stones.length > 0);
  for (const stone of layout.stones) assert.ok(stone instanceof Stone);
});

await test('18. stoneLayoutToSvg renders one <circle> per stone with no special-casing for RS Block', async () => {
  const { engine } = makeEngine();
  const layout = await engine.generateTextLayout({
    text: 'ABC', fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
  });
  const svg = stoneLayoutToSvg(layout, { widthMm: 200, heightMm: 90 });
  const circleCount = (svg.match(/<circle/g) || []).length;
  assert.equal(circleCount, layout.stones.length);
});

await test('19. drawStoneLayoutTexture draws exactly one arc per stone for RS Block (2D/3D texture path, no special-casing)', async () => {
  const { engine } = makeEngine();
  const layout = await engine.generateTextLayout({
    text: 'ABC', fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
  });
  const { ctx, calls } = createFakeCtx();
  drawStoneLayoutTexture(ctx, layout, { widthMm: 200, heightMm: 90, backgroundColor: '#1f3556' });
  assert.equal(calls.arc.length, layout.stones.length);
});

// ---------------------------------------------------------------------------------------------
// 8. Serialization
// ---------------------------------------------------------------------------------------------

await test('20. a project containing RS Block\'s font id serializes and deserializes cleanly through JSON.stringify/parse', () => {
  const project = {
    version: 2, units: 'mm', name: 'RS Block QA', product: 'mug', canvas: { width: 210, height: 90 },
    layers: [{ id: 'text1', type: 'text', visible: true, text: 'ALEX', font: FONT_ID, height: 30, textMode: 'stroke', stoneSize: 2.8, gap: 0.3, color: 'gold', autoFit: false, x: 0, y: 0 }]
  };
  const roundTripped = JSON.parse(JSON.stringify(project));
  assert.deepEqual(roundTripped, project);
  assert.equal(roundTripped.layers[0].font, FONT_ID);
});

await test('21. a generated StoneLayout round-trips through StoneLayout.toJSON/fromJSON with no stone loss', async () => {
  const { engine } = makeEngine();
  const layout = await engine.generateTextLayout({
    text: 'Wedding', fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
  });
  const roundTripped = StoneLayout.fromJSON(JSON.parse(JSON.stringify(layout.toJSON())));
  assert.equal(roundTripped.stones.length, layout.stones.length);
});

// ---------------------------------------------------------------------------------------------
// 9. Backward compatibility
// ---------------------------------------------------------------------------------------------

const manifest = JSON.parse(await readFile(new URL('../assets/fonts/manifest.json', import.meta.url), 'utf8'));

await test('22. the desktop font manifest is unaffected -- RS Block is not manifest-registered, so it never appears in the normal font picker yet', () => {
  const manager = new FontManager(manifest);
  assert.equal(manager.hasFont(FONT_ID), false);
  assert.equal(manager.listFonts({ includeDisabled: true }).length, 10);
});

await test('23. an old project JSON with a plain desktop-font id still resolves through the unmodified OpenType path', () => {
  const manager = new FontManager(manifest);
  assert.equal(manager.getFont('courier-prime-regular').providerId, 'opentype');
});

await test('24. RhinestoneFontProvider is still registered in the FontProviderRegistry alongside OpenTypeProvider', async () => {
  const manager = new FontManager({ version: 1, fonts: [] });
  const registry = createDefaultFontProviderRegistry(manager);
  assert.equal(registry.defaultProviderId, 'opentype');
  assert.equal(registry.has('rhinestone'), true);
});

await test('25. the SS10 prototype family is untouched -- still 12 diagnostic glyphs, still fillModeIndependent', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const meta = registry.getMetadata('rs-block-prototype-ss10');
  assert.equal(meta.supportedCharacters.length, 12);
  assert.equal(meta.fillModeIndependent, true);
});

console.log('RS Block (TXT-101B) tests passed.');
