/**
 * FONT-002 -- RS Modern, the second production-quality original rhinestone font (full A-Z, a-z,
 * 0-9, space, and . , ! ? ' - & coverage). Same authored stone-center contract as RS Block (see
 * families/rsModern.js's module doc) -- no contract change, no new rendering/export path, no shared
 * skeleton with RS Block. Mirrors tools/test-rs-block.mjs's structure/coverage exactly (registration,
 * full character coverage, unsupported character handling, deterministic authored maps,
 * serialization, GeometryEngine integration including curved-text/Boolean-operation rejection, SVG
 * export, 2D-texture export, kerning, and backward compatibility). It cannot and does not establish
 * visual readability -- that is the QA sheets' job (tools/generate-rs-modern-qa-sheets.mjs) plus
 * manual approval.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createDefaultRhinestoneFontRegistry,
  RhinestoneFontProvider
} from '../src/text/rhinestoneFont/index.js';
import { getGlyphStoneMap, getKerningAdjustmentMm, descriptor, PITCH_MM } from '../src/text/rhinestoneFont/families/rsModern.js';
import { createDefaultFontProviderRegistry } from '../src/text/defaultFontProviders.js';
import { GeometryEngine } from '../src/geometry/GeometryEngine.js';
import { StoneLayout } from '../src/geometry/StoneLayout.js';
import { Stone } from '../src/geometry/Stone.js';
import { FontManager } from '../src/fonts/index.js';
import { stoneLayoutToSvg } from '../src/export/SvgExporter.js';
import { drawStoneLayoutTexture } from '../src/preview3d/StoneLayoutTexture.js';
import { ALL_CONTENT_STRINGS } from './rsModernQaCorpus.mjs';

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

const manifest = JSON.parse(await readFile(new URL('../assets/fonts/manifest.json', import.meta.url), 'utf8'));

const FONT_ID = 'rs-modern';
const SUPPORTED_CHARACTERS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'0123456789',
  ' ', '.', ',', '!', '?', "'", '-', '&'
];

function makeEngine() {
  const registry = createDefaultRhinestoneFontRegistry();
  const provider = new RhinestoneFontProvider({ registry });
  const engine = new GeometryEngine({
    fontProviderRegistry: {
      getTextPath: (o) => provider.getTextPath(o),
      getKerningAdjustmentMm: (o) => provider.getKerningAdjustmentMm(o.fontId, o.prevChar, o.nextChar)
    }
  });
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

await test('1. the default registry registers RS Modern alongside RS Block and the SS10 prototype', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  assert.deepEqual(
    registry.list().map((f) => f.id).sort(),
    ['rs-block', 'rs-block-prototype-ss10', 'rs-modern'].sort()
  );
});

await test('2. RS Modern descriptor is a production rhinestone-native category, distinct id from RS Block', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const meta = registry.getMetadata(FONT_ID);
  assert.equal(meta.category, 'rhinestone-native');
  assert.equal(meta.fillModeIndependent, true);
  assert.notEqual(meta.id, 'rs-block');
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
    text: "Bright Studio 2026!", fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, color: 'gold'
  };
  const outlineLayout = await engine.generateTextLayout({ ...base, mode: 'outline' });
  const fillLayout = await engine.generateTextLayout({ ...base, mode: 'fill' });
  const asKey = (s) => `${s.xMm.toFixed(6)},${s.yMm.toFixed(6)}`;
  assert.deepEqual(outlineLayout.stones.map(asKey).sort(), fillLayout.stones.map(asKey).sort());
});

await test('12. curved text combined with RS Modern fails explicitly rather than silently ignoring the curve settings', async () => {
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

await test('13. resolveTextPolygons fails explicitly for RS Modern -- it has no vector outline for a Boolean Operation to consume', async () => {
  const { engine } = makeEngine();
  await assert.rejects(
    () => engine.resolveTextPolygons({ text: 'A', fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x', heightMm: 30 }),
    /authored stone centers, not a vector outline/
  );
});

// ---------------------------------------------------------------------------------------------
// 6. Kerning
// ---------------------------------------------------------------------------------------------

await test('14. reviewed kerning pairs tighten the real GeometryEngine-produced layout relative to the unkerned sum of the two glyphs\' widths', async () => {
  const { engine } = makeEngine();
  const reviewedPairs = ['AV', 'VA', 'WA', 'AW', 'To', 'Yo', 'LA', 'LT', 'TT', 'TA', 'FA', 'PA', 'LY', 'RY'];
  for (const pair of reviewedPairs) {
    const adjustment = getKerningAdjustmentMm(pair[0], pair[1]);
    assert.ok(adjustment < 0, `expected "${pair}" to tighten (negative adjustment), got ${adjustment}`);

    const layout = await engine.generateTextLayout({
      text: pair, fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
      heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
    });
    const first = getGlyphStoneMap(pair[0]);
    const second = getGlyphStoneMap(pair[1]);
    const kernedSecondGlyphMinX = first.advanceWidthMm + adjustment;
    assert.ok(
      layout.stones.some((s) => Math.abs(s.xMm - kernedSecondGlyphMinX) < 1e-6),
      `expected "${pair}" to place the second glyph's leftmost stone at ${kernedSecondGlyphMinX.toFixed(3)}mm through the real engine`
    );
    assert.ok(
      !layout.stones.some((s) => Math.abs(s.xMm - first.advanceWidthMm) < 1e-6 && second.stones.some((s2) => s2.xMm === 0)),
      `expected "${pair}" NOT to place any stone at the unkerned position ${first.advanceWidthMm.toFixed(3)}mm`
    );
  }
});

await test('15. an unreviewed pair (e.g. "BC") gets zero kerning adjustment', () => {
  assert.equal(getKerningAdjustmentMm('B', 'C'), 0);
});

await test('16. a family without getKerningAdjustmentMm (the SS10 prototype) renders through the real engine exactly as before -- no crash, no adjustment', async () => {
  const { engine } = makeEngine();
  const layout = await engine.generateTextLayout({
    text: 'AB', fontId: 'rs-block-prototype-ss10', providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: 2.8, gapMm: 0.3, mode: 'outline', color: 'gold'
  });
  assert.ok(layout.stones.length > 0);
});

await test('16b. FontProviderRegistry.getKerningAdjustmentMm() delegates to the resolved provider and returns 0 for a provider without the hook (OpenType, via the real createDefaultFontProviderRegistry wiring)', async () => {
  const manager = new FontManager(manifest);
  const providerRegistry = createDefaultFontProviderRegistry(manager);
  assert.equal(
    providerRegistry.getKerningAdjustmentMm({ providerId: 'opentype', fontId: 'courier-prime-regular', prevChar: 'A', nextChar: 'V' }),
    0,
    'expected OpenTypeProvider (no getKerningAdjustmentMm) to contribute zero kerning adjustment'
  );
  assert.ok(
    providerRegistry.getKerningAdjustmentMm({ providerId: 'rhinestone', fontId: FONT_ID, prevChar: 'A', nextChar: 'V' }) < 0,
    'expected the rhinestone provider to delegate to RS Modern\'s reviewed "AV" kerning adjustment'
  );
});

// ---------------------------------------------------------------------------------------------
// 7. SVG export / 2D-3D texture (single source of truth)
// ---------------------------------------------------------------------------------------------

await test('17. generateTextLayout returns an ordinary StoneLayout of ordinary Stone instances for RS Modern', async () => {
  const { engine } = makeEngine();
  const layout = await engine.generateTextLayout({
    text: 'Rhinestone Studio', fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
  });
  assert.ok(layout instanceof StoneLayout);
  assert.ok(layout.stones.length > 0);
  for (const stone of layout.stones) assert.ok(stone instanceof Stone);
});

await test('18. stoneLayoutToSvg renders one <circle> per stone with no special-casing for RS Modern', async () => {
  const { engine } = makeEngine();
  const layout = await engine.generateTextLayout({
    text: 'ABC', fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
  });
  const svg = stoneLayoutToSvg(layout, { widthMm: 200, heightMm: 90 });
  const circleCount = (svg.match(/<circle/g) || []).length;
  assert.equal(circleCount, layout.stones.length);
});

await test('19. drawStoneLayoutTexture draws the same faceted-crystal treatment (4 arcs/stone) for RS Modern, no special-casing', async () => {
  // PREVIEW-001: drawStoneLayoutTexture() now draws every stone via the shared
  // drawCrystalStone() (shadow + body + lower-edge-shade + crisp-edge arcs), regardless of which
  // font/provider produced it -- "no special-casing" now means RS Modern stones get exactly the
  // same 4-arcs-per-stone treatment as any other stone, not literally 1 arc per stone.
  const { engine } = makeEngine();
  const layout = await engine.generateTextLayout({
    text: 'ABC', fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
  });
  const { ctx, calls } = createFakeCtx();
  drawStoneLayoutTexture(ctx, layout, { widthMm: 200, heightMm: 90, backgroundColor: '#1f3556' });
  assert.equal(calls.arc.length, layout.stones.length * 4);
});

// ---------------------------------------------------------------------------------------------
// 8. Serialization
// ---------------------------------------------------------------------------------------------

await test('20. a project containing RS Modern\'s font id serializes and deserializes cleanly through JSON.stringify/parse', () => {
  const project = {
    version: 2, units: 'mm', name: 'RS Modern QA', product: 'mug', canvas: { width: 210, height: 90 },
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

await test('22. RS Modern is manifest-registered as a production font alongside RS Block, every pre-existing font untouched', () => {
  const manager = new FontManager(manifest);
  assert.equal(manager.hasFont(FONT_ID), true);
  assert.equal(manager.getFont(FONT_ID).family, 'RS Modern');
  assert.equal(manager.getFont(FONT_ID).providerId, 'rhinestone');
  assert.equal(manager.getFont(FONT_ID).enabled, true);
  assert.equal(manager.listFonts({ includeDisabled: true }).length, 12);
  for (const id of ['courier-prime-regular', 'great-vibes-regular', 'anton-regular', 'rs-block']) {
    assert.ok(manager.hasFont(id), `expected pre-existing font id "${id}" to still resolve`);
  }
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

await test('25. RS Block is untouched by RS Modern\'s addition -- still 70 characters, still its own distinct glyph shapes', async () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const rsBlockMeta = registry.getMetadata('rs-block');
  assert.equal(rsBlockMeta.supportedCharacters.length, 70);
  const rsBlock = registry.get('rs-block');
  const rsModern = registry.get('rs-modern');
  // "I" is RS Modern's clearest documented differentiator (no serif) -- confirms the two families
  // are independently authored, not aliases of the same data.
  assert.notDeepEqual(rsBlock.getGlyphStoneMap('I').stones, rsModern.getGlyphStoneMap('I').stones);
});

await test('26. RS Modern resolves end-to-end through the real app.js wiring path (FontManager -> resolveFontProviderId-equivalent -> createDefaultFontProviderRegistry -> GeometryEngine), not just the standalone RhinestoneFontProvider used elsewhere in this suite', async () => {
  const manager = new FontManager(manifest);
  const providerRegistry = createDefaultFontProviderRegistry(manager);
  const engine = new GeometryEngine({ fontProviderRegistry: providerRegistry });
  const resolvedProviderId = manager.getFont(FONT_ID).providerId;
  assert.equal(resolvedProviderId, 'rhinestone');

  const layout = await engine.generateTextLayout({
    text: 'Alex', fontId: FONT_ID, providerId: resolvedProviderId, layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
  });
  assert.ok(layout instanceof StoneLayout);
  assert.ok(layout.stones.length > 0);
  assert.equal(layout.sourceMode, 'authored');
});

// ---------------------------------------------------------------------------------------------
// 10. Corpus-wide automated QA -- mirrors tools/test-rs-block.mjs's section 10 exactly, against
// RS Modern's own corpus (tools/rsModernQaCorpus.mjs, the exact same content the PNGs in tmp/qa/
// are rendered from).
// ---------------------------------------------------------------------------------------------

/** Independently re-derives expected stone positions for `text` by walking the same pen-advance
 * algorithm RhinestoneFontProvider.getTextPath() uses (including kerning), directly against the
 * authored family data -- not by calling the provider -- so this is a real cross-check, not a
 * tautology. */
function expectedStonesForText(text) {
  const stones = [];
  let penXMm = 0;
  let previousCharacter = null;
  for (const character of Array.from(text)) {
    if (previousCharacter !== null) {
      penXMm += getKerningAdjustmentMm(previousCharacter, character);
    }
    const glyph = getGlyphStoneMap(character);
    if (glyph) {
      for (const stone of glyph.stones) stones.push({ xMm: stone.xMm + penXMm, yMm: -stone.yMm });
      penXMm += glyph.advanceWidthMm;
    }
    previousCharacter = character;
  }
  return stones;
}

const stoneKey = (s) => `${s.xMm.toFixed(3)},${s.yMm.toFixed(3)}`;

await test('27. every character in the QA corpus (all 12 sheets, ~200 strings) is a supported character -- zero unexpected unsupported-character markers', () => {
  for (const text of ALL_CONTENT_STRINGS) {
    for (const character of Array.from(text)) {
      assert.ok(getGlyphStoneMap(character) !== null, `expected "${character}" (from corpus string "${text}") to be supported`);
    }
  }
});

await test('28. every corpus string reproduces exactly through the real GeometryEngine pipeline -- no missing/cropped glyphs, no broken counters, no baseline drift', async () => {
  const { engine } = makeEngine();
  for (const text of ALL_CONTENT_STRINGS) {
    const layout = await engine.generateTextLayout({
      text, fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
      heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
    });
    const expected = expectedStonesForText(text);
    assert.equal(layout.stones.length, expected.length, `expected "${text}" to produce exactly ${expected.length} stones, got ${layout.stones.length}`);
    const actualKeys = new Set(layout.stones.map(stoneKey));
    for (const stone of expected) {
      assert.ok(actualKeys.has(stoneKey(stone)), `expected stone ${stoneKey(stone)} for "${text}" to survive unchanged`);
    }
  }
});

await test('29. no two stones collide anywhere in the QA corpus (every pairwise stone distance within a rendered string is at least the recommended stone size)', async () => {
  const { engine } = makeEngine();
  for (const text of ALL_CONTENT_STRINGS) {
    const layout = await engine.generateTextLayout({
      text, fontId: FONT_ID, providerId: 'rhinestone', layerId: 'x',
      heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
    });
    for (let i = 0; i < layout.stones.length; i++) {
      for (let j = i + 1; j < layout.stones.length; j++) {
        const distance = Math.hypot(layout.stones[i].xMm - layout.stones[j].xMm, layout.stones[i].yMm - layout.stones[j].yMm);
        assert.ok(
          distance >= descriptor.recommendedStoneSizeMm - 1e-9,
          `collision in "${text}": two stones ${distance.toFixed(2)}mm apart, below the ${descriptor.recommendedStoneSizeMm}mm recommended stone size`
        );
      }
    }
  }
});

await test('30. no pathological (outlier) letter-spacing gap anywhere in the QA corpus -- every adjacent non-space character pair\'s pen-advance gap stays within a sane multiple of the pitch', () => {
  const OUTLIER_THRESHOLD_MM = 10 * PITCH_MM;
  for (const text of ALL_CONTENT_STRINGS) {
    const characters = Array.from(text);
    for (let i = 0; i + 1 < characters.length; i++) {
      const [prev, next] = [characters[i], characters[i + 1]];
      if (prev === ' ' || next === ' ') continue;
      const prevGlyph = getGlyphStoneMap(prev);
      const kerning = getKerningAdjustmentMm(prev, next);
      const gapMm = prevGlyph.advanceWidthMm + kerning;
      assert.ok(
        gapMm <= OUTLIER_THRESHOLD_MM,
        `outlier pen-advance gap in "${text}" between "${prev}" and "${next}": ${gapMm.toFixed(2)}mm (threshold ${OUTLIER_THRESHOLD_MM.toFixed(2)}mm)`
      );
    }
  }
});

console.log('RS Modern (FONT-002) tests passed.');
