// M14 (perf/move-drag-translate-fast-path) — source-level wiring of the move-drag translation fast
// path in app.js's layoutCanvas drag handlers.
//
// The fast path must: (1) snapshot the drag-start layout, (2) translate a copy of it every
// pointermove for MOVE drags only (never engine.generate()), (3) leave resize/rotate drags on their
// existing per-frame updateAll(true), and (4) run exactly one canonical updateAll(true) on EVERY
// drag-termination path (pointerup + pointercancel) so nothing the fast path shows can persist or
// export. Both preconditions the milestone required be verified before coding must be stated in
// code comments at the relevant site.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const drawingToolJs = await readFile(path.join(repoRoot, 'src/renderer/DrawingCanvasTool.js'), 'utf8').catch(() => '');

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

const pointermove = appJs.match(/layoutCanvas\.addEventListener\('pointermove',e=>\{[\s\S]*?\n\}\);/)[0];
const moveTail = pointermove.slice(pointermove.indexOf("syncSelectedControlsFromLayer();\n"));
const endActiveDrag = sliceBalanced(appJs, 'function endActiveDrag()', 'endActiveDrag()');
const translateHelper = sliceBalanced(appJs, 'function translateLayoutForMoveDrag(', 'translateLayoutForMoveDrag()');

await test('precondition #1 is stated in a code comment: fitTextToShape() is a one-shot action, not a live cross-layer dependency', () => {
  assert.match(appJs, /M14 precondition #1[\s\S]*fitTextToShape\(\)[\s\S]*ONE-SHOT/);
  assert.match(appJs, /applyTextFitPlan\(\) bakes[\s\S]*never from[\s\S]*engine\.generate\(\)/);
});

await test('precondition #2 is stated in a code comment: every drag-termination path was enumerated (pointerup was the only one; pointercancel newly wired; no Escape/blur path)', () => {
  assert.match(appJs, /Precondition #2 \(verified by grepping/);
  assert.match(appJs, /EVERY way a layoutCanvas drag can end runs through here/);
  assert.match(appJs, /no blur\/visibilitychange\/lostpointercapture handler/);
  assert.match(appJs, /pointercancel` was previously unhandled entirely/);
});

await test('drag start snapshots the current module-level layout onto the move drag object as baseLayout', () => {
  assert.match(appJs, /drag=\{kind:'move',layerIds:dragIds,start:mm,l0Map,groupBBox0,baseLayout:layout\}/);
});

await test('translateLayoutForMoveDrag() is a pure helper: returns a new StoneLayout, never calls engine.generate()/dedupeStonesByRadius(), never mutates the base', () => {
  assert.match(translateHelper, /return new StoneLayout\(/);
  assert.match(translateHelper, /baseLayout\.stones\.map\(/);
  assert.ok(!/engine\.generate|dedupeStonesByRadius/.test(translateHelper), 'the helper must not regenerate or re-dedupe');
  assert.ok(!/baseLayout\.stones\[[^\]]*\]\.(xMm|yMm)\s*=/.test(translateHelper), 'the helper must not assign into base stones');
});

await test('the move-drag pointermove tail translates drag.baseLayout and repaints (drawLayout + drawCup) instead of calling updateAll()', () => {
  assert.match(moveTail, /if\(drag\.kind==='move'&&drag\.baseLayout\)\{/);
  assert.match(moveTail, /layout=translateLayoutForMoveDrag\(drag\.baseLayout,drag\.layerIds,p1\.xMm-p0\.xMm,p1\.yMm-p0\.yMm\)/);
  const fastBranch = moveTail
    .match(/if\(base0&&liveLayer\)\{([\s\S]*?)\}else\{/)[1]
    .replace(/^\s*\/\/.*$/gm, ''); // drop line comments before checking for calls
  assert.match(fastBranch, /drawLayout\(\);/);
  assert.match(fastBranch, /drawCup\(\);/);
  assert.ok(!/updateAll\(/.test(fastBranch), 'the move fast path must not call updateAll() on a pointermove');
});

await test('the delta is derived from drag-start positions (l0Map), never accumulated per event', () => {
  assert.match(moveTail, /const base0=drag\.l0Map\.get\(drag\.layerIds\[0\]\)/);
  assert.match(moveTail, /const p0=getLayerPosition\(base0\),p1=getLayerPosition\(liveLayer\)/);
});

await test('resize and rotate drags still call updateAll(true) every pointermove (fast path is move-only)', () => {
  // The non-move branch of the pointermove tail.
  assert.match(moveTail, /\}else\{\s*updateAll\(true\);\s*\}\n\}\);/);
  // And the resize/rotate branches themselves are untouched structurally.
  const resizeBranch = appJs.match(/\}else if\(drag\.kind==='resize'\)\{([\s\S]*?)\}else if\(drag\.kind==='rotate'\)/)[1];
  assert.ok(!/translateLayoutForMoveDrag|baseLayout/.test(resizeBranch), 'resize must not touch the translation fast path');
});

await test('endActiveDrag() is bound to BOTH pointerup and pointercancel, and runs one canonical updateAll(true) for a move drag', () => {
  assert.match(appJs, /window\.addEventListener\('pointerup',endActiveDrag\);/);
  assert.match(appJs, /window\.addEventListener\('pointercancel',endActiveDrag\);/);
  assert.match(endActiveDrag, /const ended=drag;\s*drag=null;/);
  assert.match(endActiveDrag, /if\(ended&&ended\.kind==='move'\)updateAll\(true\);/);
  // No commitHistory() here -> no double commit (it happened once at drag start).
  assert.ok(!/commitHistory/.test(endActiveDrag), 'endActiveDrag must not commit history');
});

await test('the approximation contract (per-layer exact, cross-layer dedupe overlap zones transient) is documented at the fast-path site', () => {
  assert.match(moveTail, /Approximation contract/);
  assert.match(moveTail, /dedupeStonesByRadius\(\) that runs ACROSS layers/);
  assert.match(moveTail, /endActiveDrag\(\) runs exactly one canonical updateAll\(true\) at drag end/);
});

await test('no per-layer generation cache / memoization was introduced (the explicitly rejected option a)', () => {
  assert.ok(!/layerLayoutCache|perLayerCache|memoizeLayer|generatedLayerCache/.test(appJs), 'app.js must not add a per-layer layout cache');
});

await test('the Design-mode drawing board (DrawingCanvasTool.js) is untouched by this fast path', () => {
  if (!drawingToolJs) return; // file path guard only
  assert.ok(!/translateLayoutForMoveDrag|endActiveDrag/.test(drawingToolJs), 'the fast path must live only in app.js layoutCanvas handlers');
});

await test('engine.generate() and dedupeStonesByRadius() themselves were not modified for this milestone', () => {
  // generate() still ends by deduping raw stones and wrapping them in a fresh StoneLayout.
  assert.match(appJs, /const stones=dedupeStonesByRadius\(raw\)\.map\(s=>new Stone\(\{xMm:s\.x,yMm:s\.y,sizeMm:s\.d,color:s\.color,layerId:s\.layerId\}\)\);return new StoneLayout\(\{layerId:'project',stones\}\)/);
});

if (process.exitCode) console.error('\nmove-drag fast-path wiring tests FAILED');
else console.log('\nmove-drag fast-path wiring tests passed.');
