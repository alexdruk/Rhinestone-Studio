// M14 (perf/move-drag-translate-fast-path) — unit test for translateLayoutForMoveDrag().
//
// The move-drag fast path (app.js's layoutCanvas 'pointermove' handler) replaces a per-frame
// engine.generate(project) with a pure translation of the drag-start StoneLayout: the dragged
// layer's stones shift by (dx,dy), every other layer's stones are carried over verbatim, and one
// canonical regeneration runs at drag end. This file pins the pure helper that does the translation.
//
// app.js is a browser entry point (runs document.getElementById() at module scope, not import()-able
// under plain Node), so the helper is sliced from the real source and executed against the real
// Stone/StoneLayout classes -- the established convention (tools/test-font-decision-001-stone-size-ux.mjs,
// tools/test-mono-006b-stale-authored-scale-initial-load-recovery.mjs).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Stone } from '../src/geometry/Stone.js';
import { StoneLayout } from '../src/geometry/StoneLayout.js';

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

const helperSrc = sliceBalanced(appJs, 'function translateLayoutForMoveDrag(', 'translateLayoutForMoveDrag()');
// eslint-disable-next-line no-new-func
const translateLayoutForMoveDrag = new Function('Stone', 'StoneLayout', `${helperSrc}; return translateLayoutForMoveDrag;`)(Stone, StoneLayout);

function makeBaseLayout() {
  return new StoneLayout({
    layerId: 'project',
    sourceMode: 'outline',
    stones: [
      new Stone({ xMm: 10, yMm: 20, sizeMm: 2.8, color: 'gold', layerId: 'text1', index: 0, metadata: { k: 'v' } }),
      new Stone({ xMm: 12, yMm: 22, sizeMm: 2.8, color: 'gold', layerId: 'text1', index: 1 }),
      new Stone({ xMm: 50, yMm: 60, sizeMm: 2.0, color: 'silver', layerId: 'circle9', index: 0 }),
      new Stone({ xMm: 80, yMm: 90, sizeMm: 2.0, color: 'silver', layerId: 'svg7', index: 0 })
    ]
  });
}

await test('moved layer\'s stones are translated by exactly (dx,dy); every other stone is value-identical', () => {
  const base = makeBaseLayout();
  const out = translateLayoutForMoveDrag(base, ['text1'], 3.5, -1.25);
  const byLayer = (l) => out.stones.filter((s) => s.layerId === l);

  assert.deepEqual(byLayer('text1').map((s) => [s.xMm, s.yMm]), [[13.5, 18.75], [15.5, 20.75]]);
  assert.deepEqual(byLayer('circle9').map((s) => [s.xMm, s.yMm]), [[50, 60]]);
  assert.deepEqual(byLayer('svg7').map((s) => [s.xMm, s.yMm]), [[80, 90]]);

  // Non-position fields are preserved on translated stones.
  const t0 = byLayer('text1')[0];
  assert.equal(t0.sizeMm, 2.8);
  assert.equal(t0.color, 'gold');
  assert.equal(t0.index, 0);
  assert.deepEqual(t0.metadata, { k: 'v' });
});

await test('a Set of moved ids is accepted (drag.layerIds is passed straight through)', () => {
  const base = makeBaseLayout();
  const out = translateLayoutForMoveDrag(base, new Set(['text1', 'circle9']), 5, 5);
  assert.deepEqual(out.stones.filter((s) => s.layerId === 'text1').map((s) => [s.xMm, s.yMm]), [[15, 25], [17, 27]]);
  assert.deepEqual(out.stones.filter((s) => s.layerId === 'circle9').map((s) => [s.xMm, s.yMm]), [[55, 65]]);
  assert.deepEqual(out.stones.filter((s) => s.layerId === 'svg7').map((s) => [s.xMm, s.yMm]), [[80, 90]]);
});

await test('total stone count and layout metadata (layerId/sourceMode) are preserved', () => {
  const base = makeBaseLayout();
  const out = translateLayoutForMoveDrag(base, ['text1'], 1, 1);
  assert.equal(out.stones.length, base.stones.length);
  assert.equal(out.layerId, 'project');
  assert.equal(out.sourceMode, 'outline');
  assert.ok(out instanceof StoneLayout);
});

await test('the base layout and its Stone instances are never mutated', () => {
  const base = makeBaseLayout();
  const snapshot = base.stones.map((s) => ({ ...s }));
  const out = translateLayoutForMoveDrag(base, ['text1', 'circle9', 'svg7'], 100, -100);
  base.stones.forEach((s, i) => {
    assert.equal(s.xMm, snapshot[i].xMm, `base stone ${i} xMm mutated`);
    assert.equal(s.yMm, snapshot[i].yMm, `base stone ${i} yMm mutated`);
  });
  // And the output really is a distinct set of Stone objects.
  assert.notEqual(out.stones[0], base.stones[0]);
});

await test('a zero delta produces a value-equal (but fresh) layout', () => {
  const base = makeBaseLayout();
  const out = translateLayoutForMoveDrag(base, ['text1'], 0, 0);
  assert.deepEqual(out.toJSON().stones, base.toJSON().stones);
  assert.notEqual(out.stones[0], base.stones[0]);
});

if (process.exitCode) console.error('\nmove-drag translate helper tests FAILED');
else console.log('\nmove-drag translate helper tests passed.');
