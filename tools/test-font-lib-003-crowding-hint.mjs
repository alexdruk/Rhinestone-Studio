// FONT-LIB-003 — Font-aware crowding hint for thin-stroke text.
//
// updateStoneSizeOverlapCapabilityUI() already renders #stoneSizeCrowdingHint whenever the current
// layer's current font+size+height crosses the crowding/attrition thresholds (a thin-stroke script
// font at a small stone size does exactly this). FONT-LIB-003 changes ONLY the hint's wording for a
// text layer: it names the font family and, when the family has a heavier enabled sibling than the
// current style, suggests that bolder weight by name -- plus "a larger stone size" / "a taller
// letter height". Non-text layers keep the original generic wording. No new thresholds, no change
// to when the hint fires.
//
// app.js is a browser entry point (document.getElementById() at module scope), so the two functions
// under test are sliced verbatim from app.js and really executed against stub el()/target and a real
// FontManager -- the same source-extraction convention as tools/test-font-decision-001-stone-size-ux.mjs
// and tools/test-typography-font-library.mjs. The crowding *measurement* is driven by a stubbed
// stonesForCandidateStoneSize() returning canned stones/outlineStats, so `crowded` is forced
// deterministically without running real geometry (which this UI-only milestone must not touch).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { listStoneSizes } from '../src/renderer/StoneSizes.js';
import { hasAnyOverlappingStonePair, measureStoneCrowding } from '../src/geometry/StoneLayout.js';
import { findStoneSizeByDiameterMm } from '../src/renderer/StoneSizes.js';
// READ-004 Part B moved the stroke-narrower-than-one-stone arithmetic and its fill-mode gate out of
// app.js into this shared module. app.js's textStrokeNarrowerThanOneStone() (sliced below) now calls
// the real predicate, so it is passed into the factory like every other app.js dependency.
import { strokeNarrowerThanOneStone, INTERIOR_FILL_MODES } from '../src/text/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

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

// ---------- Slice the real app.js source (same convention as FONT-DECISION-001 / TXT-103) ----------

// A future app.js refactor that removes one of these patterns should fail with a named error
// ("app.js no longer contains X"), not a null dereference on `.match(...)[0]`.
function matchOne(source, regex, label) {
  const m = source.match(regex);
  if (!m) throw new Error(`app.js no longer contains ${label} (pattern: ${regex})`);
  return m[0];
}

function sliceBalanced(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const braceStart = source.indexOf('{', start);
  assert.ok(braceStart !== -1, `expected an opening brace after "${startMarker}" (${label})`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces slicing "${startMarker}" (${label})`);
}

const findBolderSiblingSrc = sliceBalanced(appJs, 'function findBolderSibling(fontManager,font){', 'findBolderSibling()');
// FONT-LIB-004 / READ-003: the crowding hint defers to whichever stronger readability signal owns
// #heightBelowReadableWarning -- READ-003 stroke-narrower-than-one-stone, or FONT-LIB-004
// height-below-the-ratio-floor. Slice both predicates in (plus READ-003's fill-mode gate helpers)
// so this harness exercises the real precedence rule rather than a stubbed stand-in.
const textModeMapSrc = matchOne(appJs, /const TEXT_MODE_TO_ENGINE_MODE=\{[^}]*\};/, 'TEXT_MODE_TO_ENGINE_MODE');
const resolveTextFillModeSrc = matchOne(appJs, /function resolveTextFillMode\(textMode\)\{[^}]*\}/, 'resolveTextFillMode()');
const strokePredicateSrc = sliceBalanced(appJs, 'function textStrokeNarrowerThanOneStone(layer){', 'textStrokeNarrowerThanOneStone()');
const heightPredicateSrc = sliceBalanced(appJs, 'function textHeightBelowReadableMinimum(layer){', 'textHeightBelowReadableMinimum()');
// READ-008: textHeightBelowReadableMinimum() now closes over MIN_HEIGHT_TO_STONE_RATIO -- extract
// its value and inject it into the factory like every other app.js dependency.
const MIN_HEIGHT_TO_STONE_RATIO = Number(
  matchOne(appJs, /const MIN_HEIGHT_TO_STONE_RATIO=\d+(?:\.\d+)?;/, 'MIN_HEIGHT_TO_STONE_RATIO').match(/=([\d.]+);/)[1]
);
// PERF-005: updateStoneSizeOverlapCapabilityUI() now calls out to these two module-level pieces
// (the availability-sweep function, and its own target-key tracking) instead of doing the full
// catalog sweep inline -- sliced in verbatim alongside it so this harness keeps exercising the real
// source, not a pre-PERF-005 shape of it.
const stoneSizeAvailabilityStateSrc = matchOne(appJs, /let lastStoneSizeAvailabilityTargetKey=undefined;\nfunction stoneSizeTargetKey\(target\)\{[^\n]*\}/, 'stoneSizeTargetKey() + its state');
const updateAvailabilitySrc = sliceBalanced(appJs, 'async function updateStoneSizeOptionAvailabilityUI(target,currentSizeMm){', 'updateStoneSizeOptionAvailabilityUI()');
const updateFnSrc = sliceBalanced(appJs, 'async function updateStoneSizeOverlapCapabilityUI(){', 'updateStoneSizeOverlapCapabilityUI()');

// The crowding/attrition thresholds are module-level consts outside either slice -- pull them in
// verbatim so this suite would break if a future milestone silently retuned them (test 5's guard).
const thresholdSrc = matchOne(appJs, /const STONE_SIZE_CROWDING_FRACTION_THRESHOLD=[^\n]*\nconst STONE_SIZE_ATTRITION_RATIO_THRESHOLD=[^\n]*/, 'the crowding/attrition thresholds');
assert.match(thresholdSrc, /=0\.25;/);
assert.match(thresholdSrc, /=0\.75;/);

// READ-004 Part B: the fill-mode gate that used to live in app.js as READ_003_INTERIOR_FILL_MODES
// now lives in src/text/StrokeWidthGate.js. Pin the policy where it moved to -- this is what the
// deleted `interiorFillModesSrc` slice was implicitly guarding.
assert.deepEqual([...INTERIOR_FILL_MODES].sort(), ['contour', 'fill', 'radial', 'staggered'],
  'INTERIOR_FILL_MODES must be exactly {fill, staggered, radial, contour}');

const GENERIC_TEXT = 'This stone size may pack tightly on this shape — try a smaller size for more even spacing.';

// ---------- Minimal DOM / dependency stubs ----------

function makeClassList() {
  const set = new Set();
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c), _set: set };
}

function makeEnv({ layer, currentStones, currentOutlineStats }) {
  const options = new Map(listStoneSizes().map((s) => [String(s.diameterMm), { value: String(s.diameterMm), disabled: false, title: '' }]));
  const dom = {
    stoneSize: {
      classList: makeClassList(),
      querySelector: (sel) => {
        const m = sel.match(/option\[value="([^"]+)"\]/);
        return m ? options.get(m[1]) || null : null;
      }
    },
    stoneSizeOverlapWarning: { textContent: '', classList: makeClassList() },
    stoneSizeCrowdingHint: { textContent: '', style: { display: 'none' } }
  };
  const el = (id) => dom[id];
  const currentStoneSizeTarget = () => ({ layer, region: null });
  const clearStoneSizeOverlapUI = () => { throw new Error('clearStoneSizeOverlapUI() should not be reached -- a target is always present in these tests'); };
  const healthy = { stones: [{ x: 0, y: 0, d: layer.stoneSize }, { x: 10, y: 0, d: layer.stoneSize }, { x: 0, y: 10, d: layer.stoneSize }], outlineStats: { keptCount: 100, rawSampleCount: 100 } };
  const current = { stones: currentStones, outlineStats: currentOutlineStats };
  const stonesForCandidateStoneSize = async (target, diameterMm) => (diameterMm === layer.stoneSize ? current : healthy);

  const factory = new Function(
    'el', 'currentStoneSizeTarget', 'clearStoneSizeOverlapUI', 'listStoneSizes',
    'stonesForCandidateStoneSize', 'project', 'hasAnyOverlappingStonePair', 'measureStoneCrowding', 'fontManager',
    'isAuthoredStoneFontId', 'isFontKnown', 'findStoneSizeByDiameterMm', 'strokeNarrowerThanOneStone', 'MIN_HEIGHT_TO_STONE_RATIO',
    `
    let stoneSizeOverlapCheckToken=0;
    ${thresholdSrc}
    ${stoneSizeAvailabilityStateSrc}
    ${findBolderSiblingSrc}
    ${textModeMapSrc}
    ${resolveTextFillModeSrc}
    ${strokePredicateSrc}
    ${heightPredicateSrc}
    ${updateAvailabilitySrc}
    ${updateFnSrc}
    return { updateStoneSizeOverlapCapabilityUI, findBolderSibling };
    `
  );
  const api = factory(
    el, currentStoneSizeTarget, clearStoneSizeOverlapUI, listStoneSizes,
    stonesForCandidateStoneSize, {}, hasAnyOverlappingStonePair, measureStoneCrowding, fontManager,
    (id) => ['rs-block','rs-modern'].includes(id), (id) => fontManager.hasFont(id), findStoneSizeByDiameterMm, strokeNarrowerThanOneStone, MIN_HEIGHT_TO_STONE_RATIO
  );
  return { dom, ...api };
}

// A layout of three well-separated stones -- never overlapping, never "crowded" by rim-gap; only the
// outlineStats attrition ratio decides `crowded` in these fixtures.
const SEPARATED = (d) => [{ x: 0, y: 0, d }, { x: 10, y: 0, d }, { x: 0, y: 10, d }];

// ---------- 1. Text layer, thin script font, crowded -> font-aware hint names the family ----------

await test('1. a crowded text layer on a thin single-style script font gets a font-aware hint naming the family (not the generic wording)', async () => {
  const env = makeEnv({
    layer: { type: 'text', font: 'great-vibes-regular', stoneSize: 2, gap: 0.3 },
    currentStones: SEPARATED(2),
    currentOutlineStats: { keptCount: 60, rawSampleCount: 100 } // 0.60 < 0.75 -> crowded
  });
  await env.updateStoneSizeOverlapCapabilityUI();
  const text = env.dom.stoneSizeCrowdingHint.textContent;
  assert.equal(env.dom.stoneSizeCrowdingHint.style.display, 'block', 'the hint must still fire for this crowded fixture');
  assert.notEqual(text, GENERIC_TEXT, 'a text layer must not get the generic wording');
  assert.match(text, /Great Vibes/, 'the hint must name the font family');
});

// ---------- 2. Bolder sibling exists -> named specifically ----------

await test('2. Poppins Regular crowded (Poppins SemiBold/Bold available) -> the hint suggests the lightest heavier sibling by name', async () => {
  const env = makeEnv({
    layer: { type: 'text', font: 'poppins-regular', stoneSize: 2, gap: 0.3 },
    currentStones: SEPARATED(2),
    currentOutlineStats: { keptCount: 60, rawSampleCount: 100 }
  });
  await env.updateStoneSizeOverlapCapabilityUI();
  const text = env.dom.stoneSizeCrowdingHint.textContent;
  assert.equal(
    text,
    "Poppins Regular's strokes are narrow at this stone size — a heavier weight (Poppins SemiBold), a larger stone size, or a taller letter height would each give more even coverage.",
    'expected the exact font-aware "try <bolder>" wording, naming SemiBold (weight 600, the lightest sibling heavier than 400)'
  );
});

await test('2b. findBolderSibling() returns the lightest heavier enabled sibling, or null when none exists', async () => {
  const env = makeEnv({
    layer: { type: 'text', font: 'poppins-regular', stoneSize: 2, gap: 0.3 },
    currentStones: SEPARATED(2),
    currentOutlineStats: { keptCount: 100, rawSampleCount: 100 }
  });
  assert.equal(env.findBolderSibling(fontManager, fontManager.getFont('poppins-regular')).id, 'poppins-semibold');
  assert.equal(env.findBolderSibling(fontManager, fontManager.getFont('poppins-semibold')).id, 'poppins-bold');
  assert.equal(env.findBolderSibling(fontManager, fontManager.getFont('poppins-bold')), null, 'the heaviest style has no bolder sibling');
  assert.equal(env.findBolderSibling(fontManager, fontManager.getFont('great-vibes-regular')), null, 'a single-style family has no bolder sibling');
});

// ---------- 3. No bolder sibling -> "try X" clause omitted, family still named ----------

await test('3. a crowded single-style family (Great Vibes) omits the "try <bolder>" clause but still names the font and suggests stone size / letter height', async () => {
  const env = makeEnv({
    layer: { type: 'text', font: 'great-vibes-regular', stoneSize: 2, gap: 0.3 },
    currentStones: SEPARATED(2),
    currentOutlineStats: { keptCount: 60, rawSampleCount: 100 }
  });
  await env.updateStoneSizeOverlapCapabilityUI();
  const text = env.dom.stoneSizeCrowdingHint.textContent;
  assert.equal(
    text,
    "Great Vibes's strokes are narrow at this stone size — a larger stone size or a taller letter height would give more even coverage."
  );
  assert.ok(!/ try Great Vibes /.test(text), 'no self-referential "try Great Vibes <style>" clause');
});

// ---------- 4. Non-text layers keep the original generic wording (the key regression guard) ----------

for (const type of ['shape', 'path', 'svg', 'image']) {
  await test(`4. a crowded ${type} layer still gets the original generic wording, unchanged`, async () => {
    const env = makeEnv({
      layer: { type, font: 'great-vibes-regular', stoneSize: 2, gap: 0.3 }, // font field present but must be ignored for non-text
      currentStones: SEPARATED(2),
      currentOutlineStats: { keptCount: 60, rawSampleCount: 100 }
    });
    await env.updateStoneSizeOverlapCapabilityUI();
    assert.equal(env.dom.stoneSizeCrowdingHint.textContent, GENERIC_TEXT);
    assert.equal(env.dom.stoneSizeCrowdingHint.style.display, 'block');
  });
}

await test('4b. a text layer whose font id cannot be resolved (legacy/unknown) falls back to the generic wording', async () => {
  const env = makeEnv({
    layer: { type: 'text', font: 'some-legacy-font-not-in-manifest', stoneSize: 2, gap: 0.3 },
    currentStones: SEPARATED(2),
    currentOutlineStats: { keptCount: 60, rawSampleCount: 100 }
  });
  await env.updateStoneSizeOverlapCapabilityUI();
  assert.equal(env.dom.stoneSizeCrowdingHint.textContent, GENERIC_TEXT);
});

// ---------- 5. The firing condition itself is unaffected by this milestone ----------

await test('5. firing threshold unchanged: attrition ratio >= 0.75 with healthy spacing does NOT fire (text or non-text), and the non-text fired text is byte-identical to pre-milestone', async () => {
  // Not crowded: ratio 0.80 >= 0.75, spacing healthy.
  for (const type of ['text', 'circle']) {
    const env = makeEnv({
      layer: { type, font: 'great-vibes-regular', stoneSize: 2, gap: 0.3 },
      currentStones: SEPARATED(2),
      currentOutlineStats: { keptCount: 80, rawSampleCount: 100 }
    });
    await env.updateStoneSizeOverlapCapabilityUI();
    assert.equal(env.dom.stoneSizeCrowdingHint.style.display, 'none', `${type}: hint must stay hidden just above the attrition threshold`);
    assert.equal(env.dom.stoneSizeCrowdingHint.textContent, '');
  }
  // Just crowded: ratio 0.74 < 0.75 -> fires. Non-text wording must match the exact pre-FONT-LIB-003 string.
  const env = makeEnv({
    layer: { type: 'circle', stoneSize: 2, gap: 0.3 },
    currentStones: SEPARATED(2),
    currentOutlineStats: { keptCount: 74, rawSampleCount: 100 }
  });
  await env.updateStoneSizeOverlapCapabilityUI();
  assert.equal(env.dom.stoneSizeCrowdingHint.style.display, 'block');
  assert.equal(env.dom.stoneSizeCrowdingHint.textContent, GENERIC_TEXT, 'non-text crowded wording is unchanged from pre-milestone');
});

await test('5c. FONT-LIB-004 precedence: when the layer\'s height is below the ratio floor for its stone diameter, the crowding hint stays silent -- the height warning owns that case, and blaming the font there would send the user after a fix that cannot work', async () => {
  const SS6_MM = findStoneSizeByDiameterMm(2).diameterMm;
  const floorMm = SS6_MM * MIN_HEIGHT_TO_STONE_RATIO; // READ-008 ratio floor for a 2mm stone (32mm)
  // Crowded fixture with a height below the ratio floor (a stronger signal owns it).
  const below = makeEnv({
    layer: { type: 'text', font: 'great-vibes-regular', stoneSize: SS6_MM, gap: 0.3, height: floorMm - 10 },
    currentStones: SEPARATED(SS6_MM),
    currentOutlineStats: { keptCount: 60, rawSampleCount: 100 }
  });
  await below.updateStoneSizeOverlapCapabilityUI();
  assert.equal(below.dom.stoneSizeCrowdingHint.textContent, '', 'expected no crowding message while a stronger readability signal is the root cause');
  assert.equal(below.dom.stoneSizeCrowdingHint.style.display, 'none', 'an empty message must not render as a blank gap');

  // A crowded fixture with NEITHER readability signal active (Poppins Regular's stroke is wider than
  // one SS6 stone at this height, and the height is at/above the ratio floor) still gets the
  // font-aware message -- proving the suppression is the precedence rule, not a blanket disable.
  const inRange = makeEnv({
    layer: { type: 'text', font: 'poppins-regular', stoneSize: SS6_MM, gap: 0.3, height: floorMm + 5 },
    currentStones: SEPARATED(SS6_MM),
    currentOutlineStats: { keptCount: 60, rawSampleCount: 100 }
  });
  const ratio = fontManager.getFont('poppins-regular').stemWidthRatio;
  assert.ok(ratio * (floorMm + 5) >= SS6_MM, 'test setup: Poppins Regular stroke must be >= one SS6 stone here');
  await inRange.updateStoneSizeOverlapCapabilityUI();
  assert.match(inRange.dom.stoneSizeCrowdingHint.textContent, /Poppins/, 'expected the font-aware message once no stronger signal is active');
});

await test('5d. READ-003 precedence: a fill-mode layer whose stroke is narrower than one stone (even at an in-range height) keeps the crowding hint silent -- #heightBelowReadableWarning already owns it with the accurate stroke message', async () => {
  const SS16_MM = findStoneSizeByDiameterMm(4).diameterMm;
  const inRangeHeight = SS16_MM * MIN_HEIGHT_TO_STONE_RATIO + 6; // above the READ-008 ratio floor (64mm) for a 4mm stone
  const ratio = fontManager.getFont('great-vibes-regular').stemWidthRatio;
  assert.ok(ratio * inRangeHeight < SS16_MM, 'test setup: Great Vibes stroke must be narrower than one SS16 stone at this height');
  // textMode 'radial' -> an interior-filling mode, so the READ-003 gate is in scope.
  const env = makeEnv({
    layer: { type: 'text', font: 'great-vibes-regular', textMode: 'radial', stoneSize: SS16_MM, gap: 0.3, height: inRangeHeight },
    currentStones: SEPARATED(SS16_MM),
    currentOutlineStats: { keptCount: 60, rawSampleCount: 100 }
  });
  await env.updateStoneSizeOverlapCapabilityUI();
  assert.equal(env.dom.stoneSizeCrowdingHint.textContent, '', 'the stroke-impossible signal is stronger -- crowding hint stays silent');
  assert.equal(env.dom.stoneSizeCrowdingHint.style.display, 'none');

  // The same fixture in Outline mode: READ-003 does not apply, and the height is in range, so the
  // font-aware crowding hint is free to fire -- proving the suppression was the fill-mode stroke
  // gate, not a blanket disable.
  const outline = makeEnv({
    layer: { type: 'text', font: 'great-vibes-regular', textMode: 'stroke', stoneSize: SS16_MM, gap: 0.3, height: inRangeHeight },
    currentStones: SEPARATED(SS16_MM),
    currentOutlineStats: { keptCount: 60, rawSampleCount: 100 }
  });
  await outline.updateStoneSizeOverlapCapabilityUI();
  assert.match(outline.dom.stoneSizeCrowdingHint.textContent, /Great Vibes/, 'Outline mode: no stronger signal, so the font-aware crowding hint shows');
});

await test('5b. genuine overlap still suppresses the crowding hint entirely (mutual exclusivity unchanged)', async () => {
  const env = makeEnv({
    layer: { type: 'text', font: 'great-vibes-regular', stoneSize: 2, gap: 0.3 },
    // two stones closer than (d1+d2)/2 -> hasAnyOverlappingStonePair() true for the current size
    currentStones: [{ x: 0, y: 0, d: 2 }, { x: 0.5, y: 0, d: 2 }],
    currentOutlineStats: { keptCount: 10, rawSampleCount: 100 }
  });
  await env.updateStoneSizeOverlapCapabilityUI();
  assert.equal(env.dom.stoneSizeCrowdingHint.style.display, 'none', 'overlap is the more severe, actionable problem -- crowding hint stays hidden');
  assert.equal(env.dom.stoneSizeCrowdingHint.textContent, '');
});

// ---------- index.html doc-comment wiring ----------

await test('index.html #stoneSizeCrowdingHint comment documents the FONT-LIB-003 font-aware text wording', () => {
  const commentMatch = indexHtml.match(/Crowding\/attrition warning:[\s\S]*?-->/);
  assert.ok(commentMatch, 'expected the crowding-hint comment block');
  assert.match(commentMatch[0], /FONT-LIB-003/);
  assert.match(commentMatch[0], /font-aware/);
});

console.log('FONT-LIB-003 crowding-hint tests passed.');
