// PERF-005 — lazy stone-size option-availability sweep.
//
// Before this milestone, updateStoneSizeOverlapCapabilityUI() generated a full candidate stone
// layout for every one of the 5 catalog stone sizes on every single HISTORY_TRACKED_CONTROL_IDS
// edit (font pick, fill-mode change, height edit, text edit, ...) -- even when the edit had nothing
// to do with stone size, and even when the selected layer hadn't changed since the last check. This
// is the concrete cost this milestone removes: the per-option "would this size overlap" sweep
// (now updateStoneSizeOptionAvailabilityUI()) only re-runs when the selection itself changes, or
// when #stoneSize is about to be opened -- not on every unrelated edit. The crowding/overlap check
// for the CURRENTLY selected size still runs every time (that's the one piece of this UI that must
// always be fresh), so the guaranteed floor is 1 candidate generation per edit instead of up to 6.
//
// Verified here by counting real calls into a stubbed stonesForCandidateStoneSize() -- not by
// timing (timing is flaky in CI/sandboxes; call count is the actual mechanism, and is what
// determines wall-clock cost in the real app).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listStoneSizes } from '../src/renderer/StoneSizes.js';
import { hasAnyOverlappingStonePair, measureStoneCrowding } from '../src/geometry/StoneLayout.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

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

function sliceBalanced(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const braceStart = source.indexOf('{', start);
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
const stoneSizeAvailabilityStateSrc = appJs.match(/let lastStoneSizeAvailabilityTargetKey=undefined;\nfunction stoneSizeTargetKey\(target\)\{[^\n]*\}/)[0];
const updateAvailabilitySrc = sliceBalanced(appJs, 'async function updateStoneSizeOptionAvailabilityUI(target,currentSizeMm){', 'updateStoneSizeOptionAvailabilityUI()');
const updateFnSrc = sliceBalanced(appJs, 'async function updateStoneSizeOverlapCapabilityUI(){', 'updateStoneSizeOverlapCapabilityUI()');
const thresholdSrc = appJs.match(/const STONE_SIZE_CROWDING_FRACTION_THRESHOLD=[^\n]*\nconst STONE_SIZE_ATTRITION_RATIO_THRESHOLD=[^\n]*/)[0];

// Confirms the focus listener this milestone adds is really wired to the real availability sweep,
// not just present in isolation.
await test("app.js wires #stoneSize's 'focus' listener to updateStoneSizeOptionAvailabilityUI()", () => {
  assert.match(appJs, /el\('stoneSize'\)\.addEventListener\('focus',\(\)=>\{/);
  const focusListenerSrc = appJs.slice(appJs.indexOf("el('stoneSize').addEventListener('focus',"), appJs.indexOf("el('stoneSize').addEventListener('focus',") + 400);
  assert.match(focusListenerSrc, /updateStoneSizeOptionAvailabilityUI\(target,currentSizeMm\)/);
});

function makeClassList() {
  const set = new Set();
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
}

function makeEnv({ layer }) {
  const options = new Map(listStoneSizes().map((s) => [String(s.diameterMm), { value: String(s.diameterMm), disabled: false, title: '' }]));
  const dom = {
    stoneSize: { classList: makeClassList(), querySelector: (sel) => { const m = sel.match(/option\[value="([^"]+)"\]/); return m ? options.get(m[1]) || null : null; } },
    stoneSizeOverlapWarning: { textContent: '', classList: makeClassList() },
    stoneSizeCrowdingHint: { textContent: '', style: { display: 'none' } }
  };
  const el = (id) => dom[id];
  const currentStoneSizeTarget = () => ({ layer, region: null });
  const clearStoneSizeOverlapUI = () => { throw new Error('unreachable in these tests'); };

  let callCount = 0;
  const healthy = { stones: [{ x: 0, y: 0, d: layer.stoneSize }, { x: 10, y: 0, d: layer.stoneSize }, { x: 0, y: 10, d: layer.stoneSize }], outlineStats: { keptCount: 100, rawSampleCount: 100 } };
  // Every candidate generation (current size or any other catalog size) counts -- this is the exact
  // call this milestone is reducing the frequency of, not its correctness.
  const stonesForCandidateStoneSize = async () => { callCount += 1; return healthy; };

  const factory = new Function(
    'el', 'currentStoneSizeTarget', 'clearStoneSizeOverlapUI', 'listStoneSizes',
    'stonesForCandidateStoneSize', 'project', 'hasAnyOverlappingStonePair', 'measureStoneCrowding', 'fontManager',
    `
    let stoneSizeOverlapCheckToken=0;
    ${thresholdSrc}
    ${stoneSizeAvailabilityStateSrc}
    ${findBolderSiblingSrc}
    ${updateAvailabilitySrc}
    ${updateFnSrc}
    return { updateStoneSizeOverlapCapabilityUI, updateStoneSizeOptionAvailabilityUI };
    `
  );
  const api = factory(el, currentStoneSizeTarget, clearStoneSizeOverlapUI, listStoneSizes, stonesForCandidateStoneSize, {}, hasAnyOverlappingStonePair, measureStoneCrowding, null);
  return { dom, ...api, getCallCount: () => callCount, resetCallCount: () => { callCount = 0; } };
}

// waits one microtask tick so the fire-and-forget availability-sweep promise (not awaited by
// updateStoneSizeOverlapCapabilityUI() itself) has a chance to run before we count calls.
const flush = () => new Promise((r) => setTimeout(r, 0));

await test('1. the first check on a freshly-selected layer sweeps every other catalog size (5 total candidate generations: 1 current + 4 others)', async () => {
  const env = makeEnv({ layer: { type: 'circle', stoneSize: 2, gap: 0.3 } });
  await env.updateStoneSizeOverlapCapabilityUI();
  await flush();
  assert.equal(listStoneSizes().length, 5, 'test assumes the catalog has 5 sizes -- update the expected counts below if this changes');
  assert.equal(env.getCallCount(), 5, 'expected 1 (current size) + 4 (the other catalog sizes, swept once for a newly-seen target)');
});

await test('2. a second check on the SAME target (no selection change) only re-checks the current size -- the sweep does not repeat', async () => {
  const env = makeEnv({ layer: { type: 'circle', stoneSize: 2, gap: 0.3 } });
  await env.updateStoneSizeOverlapCapabilityUI();
  await flush();
  env.resetCallCount();
  await env.updateStoneSizeOverlapCapabilityUI(); // same target object every time in this harness
  await flush();
  assert.equal(env.getCallCount(), 1, 'expected only the current size to be re-checked -- this is the actual perf fix: an unrelated edit on an already-selected layer must not re-sweep every other size');
});

await test('3. calling updateStoneSizeOptionAvailabilityUI() directly (what the #stoneSize focus listener does) re-sweeps the other sizes on demand', async () => {
  const env = makeEnv({ layer: { type: 'circle', stoneSize: 2, gap: 0.3 } });
  await env.updateStoneSizeOverlapCapabilityUI();
  await flush();
  env.resetCallCount();
  await env.updateStoneSizeOptionAvailabilityUI({ layer: { type: 'circle', stoneSize: 2, gap: 0.3 }, region: null }, 2);
  assert.equal(env.getCallCount(), 4, 'expected exactly the 4 non-current catalog sizes to be swept on an explicit availability check');
});

console.log('PERF-005 lazy stone-size sweep tests passed.');
