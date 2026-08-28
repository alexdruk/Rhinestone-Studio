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
const updateFnSrc = sliceBalanced(appJs, 'async function updateStoneSizeOverlapCapabilityUI(){', 'updateStoneSizeOverlapCapabilityUI()');

// The crowding/attrition thresholds are module-level consts outside either slice -- pull them in
// verbatim so this suite would break if a future milestone silently retuned them (test 5's guard).
const thresholdSrc = appJs.match(/const STONE_SIZE_CROWDING_FRACTION_THRESHOLD=[^\n]*\nconst STONE_SIZE_ATTRITION_RATIO_THRESHOLD=[^\n]*/)[0];
assert.match(thresholdSrc, /=0\.25;/);
assert.match(thresholdSrc, /=0\.75;/);

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
    `
    let stoneSizeOverlapCheckToken=0;
    ${thresholdSrc}
    ${findBolderSiblingSrc}
    ${updateFnSrc}
    return { updateStoneSizeOverlapCapabilityUI, findBolderSibling };
    `
  );
  const api = factory(
    el, currentStoneSizeTarget, clearStoneSizeOverlapUI, listStoneSizes,
    stonesForCandidateStoneSize, {}, hasAnyOverlappingStonePair, measureStoneCrowding, fontManager
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
    'Poppins Regular is thin at this stone size — try Poppins SemiBold, a larger stone size, or a taller letter height.',
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
    'Great Vibes is thin at this stone size — try a larger stone size or a taller letter height.'
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
