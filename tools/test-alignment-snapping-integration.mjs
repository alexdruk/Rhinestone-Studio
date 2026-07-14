import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1009 (Alignment & Snapping) — verifies app.js is actually wired to src/editing/** for
// multi-select, align/distribute, drag/keyboard snapping, and grouped movement, and exercises the
// real position-application helpers (getLayerPosition/setLayerPosition) extracted from the live
// app.js source against every supported layer type. Structural checks against the live
// app.js/index.html source (app.js is a browser entry point and is not import()-able directly
// under plain Node, matching the established convention in
// tools/test-undo-redo-integration.mjs/tools/test-svg-integration.mjs); behavioral checks combine
// the real, imported src/editing/** module with small extracted app.js functions, mirroring
// tools/test-object-template-integration.mjs's "faithful, minimal port" precedent for the parts
// that do need a DOM (drag/pointer events) to run for real.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

const {
  alignLayers, distributeLayers, buildSnapTargets, computeSnapOffset,
  selectOnly, toggleSelection, clearSelection,
  SNAP_TOLERANCE_MM, NUDGE_STEP_MM, NUDGE_STEP_LARGE_MM
} = await import('../src/editing/index.js');

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

function extractFunction(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n(?=(function |const |let |el\\(|window\\.|document\\.|layoutCanvas\\.))`))
    || source.match(new RegExp(`function ${name}\\([^)]*\\)\\{.*`));
  assert.ok(match, `expected to find function ${name}() in app.js`);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${match[0].replace(/\n$/, '')}`)();
}

// getLayerPosition/setLayerPosition are pure (no closure over `project`/`layout`), so they can be
// extracted and executed directly against synthetic layer objects for every layer type.
const getLayerPosition = extractFunction(appJs, 'getLayerPosition');
const setLayerPosition = extractFunction(appJs, 'setLayerPosition');

// ---------------------------------------------------------------------------------------------
// Structural wiring checks
// ---------------------------------------------------------------------------------------------

await test('1. app.js imports the src/editing/** barrel with every symbol it uses', () => {
  assert.match(
    appJs,
    /import\s*\{\s*SNAP_TOLERANCE_MM,\s*NUDGE_STEP_MM,\s*NUDGE_STEP_LARGE_MM,\s*alignLayers,\s*distributeLayers,\s*buildSnapTargets,\s*computeSnapOffset,\s*selectOnly,\s*toggleSelection,\s*clearSelection,\s*selectMany\s*\}\s*from\s*['"]\.\/src\/editing\/index\.js['"]/
  );
});

await test('2. selectedLayerIds is the one Set<string> multi-selection, initialized from selectedLayerId', () => {
  assert.match(appJs, /let selectedLayerIds=new Set\(\[selectedLayerId\]\),snapEnabled=true,snapToleranceMm=SNAP_TOLERANCE_MM,showSnapGuides=true,activeGuides=\[\];/);
});

await test('3. every selection-changing site uses selectOnly/toggleSelection/clearSelection (src/editing/Selection.js), never a hand-rolled Set mutation', () => {
  assert.ok(!/selectedLayerIds\.add\(/.test(appJs), 'app.js must not call Set.prototype.add directly on selectedLayerIds');
  assert.ok(!/selectedLayerIds\.delete\(/.test(appJs), 'app.js must not call Set.prototype.delete directly on selectedLayerIds');
  assert.ok(!/selectedLayerIds=new Set\(\)/.test(appJs), 'app.js must clear selection via clearSelection(), not a literal new Set()');
  const assignments = appJs.match(/selectedLayerIds=[^;]+;/g) || [];
  assert.ok(assignments.length >= 6, `expected several selectedLayerIds= assignments, found ${assignments.length}`);
  for (const assignment of assignments) {
    assert.match(assignment, /selectedLayerIds=new Set\(\[selectedLayerId\]\)|selectedLayerIds=(selectOnly|toggleSelection|clearSelection|selectMany)\(/, `unexpected selectedLayerIds assignment not going through src/editing/Selection.js: ${assignment}`);
  }
});

await test('4. clicking empty canvas (no hitTest result) clears the selection', () => {
  assert.match(appJs, /if\(!hit\)\{if\(selectedLayerIds\.size\)\{selectedLayerIds=clearSelection\(\);/);
});

await test('5. Shift-click on the canvas toggles the clicked layer in the selection without starting a drag', () => {
  const pointerdown = appJs.match(/layoutCanvas\.addEventListener\('pointerdown',e=>\{([\s\S]*?)\}\);\nlayoutCanvas\.addEventListener\('pointermove'/);
  assert.ok(pointerdown, 'expected to find the pointerdown handler body');
  assert.match(pointerdown[1], /if\(e\.shiftKey\)\{\s*selectedLayerIds=toggleSelection\(selectedLayerIds,hit\.layer\.id\);/, 'expected Shift-click to toggle via toggleSelection()');
});

await test('6. Shift-click on a layers-list row toggles it too (the same shared toggle, not a second implementation)', () => {
  assert.match(appJs, /if\(e\.shiftKey\)\{selectedLayerIds=toggleSelection\(selectedLayerIds,id\);/);
});

await test('7. a plain click on a layer not already selected collapses the selection to just that layer (preserves single-selection behavior)', () => {
  assert.match(appJs, /if\(!selectedLayerIds\.has\(hit\.layer\.id\)\)selectedLayerIds=selectOnly\(hit\.layer\.id\);/);
});

await test('8. a move-drag on a multi-selected group moves every selected layer by one shared delta (grouped movement)', () => {
  const pointermove = appJs.match(/layoutCanvas\.addEventListener\('pointermove',e=>\{([\s\S]*?)\}\);\nwindow\.addEventListener\('pointerup'/);
  assert.ok(pointermove, 'expected to find the pointermove handler body');
  assert.match(pointermove[1], /for\(const id of drag\.layerIds\)\{/, 'expected the move branch to iterate every dragged layer id');
  assert.match(pointermove[1], /setLayerPosition\(l,p0\.xMm\+dx,p0\.yMm\+dy\)/, 'expected every dragged layer to be positioned from the same dx/dy');
});

await test('9. drag snapping is gated by the snapEnabled toggle and computed via buildSnapTargets/computeSnapOffset against the configurable snapToleranceMm (RS-1010; defaults from SNAP_TOLERANCE_MM)', () => {
  assert.match(appJs, /if\(snapEnabled\)\{/);
  assert.match(appJs, /buildSnapTargets\(\{canvasWidthMm:project\.canvas\.width,canvasHeightMm:project\.canvas\.height,safeAreaRectMm:getSafeAreaRectMm\(currentObjectTemplate\(\),project\.canvas\.width,project\.canvas\.height\),layerBBoxes:others\}\)/);
  assert.match(appJs, /computeSnapOffset\(dragBBoxMm,targets,snapToleranceMm\)/);
});

await test('10. snap targets built for a drag exclude every currently-dragged layer (never snaps a selection to itself)', () => {
  assert.match(appJs, /project\.layers\.filter\(l=>l\.visible&&!drag\.layerIds\.includes\(l\.id\)\)/);
});

await test('11. resize drags are never snap-aware (out of scope; only move drags call the snap engine)', () => {
  const resizeBranch = appJs.match(/\}else if\(drag\.kind==='resize'\)\{([\s\S]*?)\}\n\s*syncSelectedControlsFromLayer/);
  assert.ok(resizeBranch, 'expected to find the resize branch of pointermove');
  assert.ok(!/computeSnapOffset|buildSnapTargets/.test(resizeBranch[1]), 'resize must not call the snap engine');
});

await test('12. temporary guides are cleared on pointerup', () => {
  assert.match(appJs, /window\.addEventListener\('pointerup',\(\)=>\{drag=null;if\(activeGuides\.length\)\{activeGuides=\[\];drawLayout\(\)\}\}\);/);
});

await test('13. align/distribute run through the pure src/editing/AlignmentEngine.js functions and commit history exactly once before mutating', () => {
  assert.match(appJs, /function runAlign\(direction\)\{const items=selectedItemsForEditing\(\);if\(items\.length<2\)return;commitHistory\(\);applyPositionDeltas\(alignLayers\(items,direction\)\);/);
  assert.match(appJs, /function runDistribute\(axis\)\{const items=selectedItemsForEditing\(\);if\(items\.length<3\)return;commitHistory\(\);applyPositionDeltas\(distributeLayers\(items,axis\)\);/);
});

await test('14. all six align buttons and both distribute buttons are wired to runAlign/runDistribute with the correct direction/axis', () => {
  const pairs = [
    ['alignLeft', "runAlign\\('left'\\)"], ['alignCenterH', "runAlign\\('centerH'\\)"], ['alignRight', "runAlign\\('right'\\)"],
    ['alignTop', "runAlign\\('top'\\)"], ['alignCenterV', "runAlign\\('centerV'\\)"], ['alignBottom', "runAlign\\('bottom'\\)"],
    ['distributeH', "runDistribute\\('horizontal'\\)"], ['distributeV', "runDistribute\\('vertical'\\)"]
  ];
  for (const [id, call] of pairs) {
    assert.match(appJs, new RegExp(`el\\('${id}'\\)\\.onclick=\\(\\)=>${call}`), `expected #${id} wired to ${call}`);
  }
});

await test('15. arrow keys nudge the selection by a named step, Shift uses the larger step, and typing in a field is never hijacked', () => {
  assert.match(appJs, /const ARROW_KEY_DELTAS=\{ArrowLeft:\[-1,0\],ArrowRight:\[1,0\],ArrowUp:\[0,-1\],ArrowDown:\[0,1\]\};/);
  assert.match(appJs, /if\(ARROW_KEY_DELTAS\[e\.key\]\)\{const t=document\.activeElement\?\.tagName;if\(t==='INPUT'\|\|t==='SELECT'\)return;e\.preventDefault\(\);const step=e\.shiftKey\?NUDGE_STEP_LARGE_MM:NUDGE_STEP_MM;/);
  assert.match(appJs, /function nudgeSelection\(dxMm,dyMm\)\{if\(selectedLayerIds\.size===0\)return;commitHistory\(\);/, 'expected nudgeSelection to commit history exactly once per call (one key press = one undo entry)');
});

await test('16. selection is never part of `project`, never history-tracked, never exported (view-only editor state, like rotation/zoom)', () => {
  const listMatch = appJs.match(/const HISTORY_TRACKED_CONTROL_IDS=\[([\s\S]*?)\];/);
  assert.ok(listMatch);
  assert.ok(!listMatch[1].includes('selectedLayerIds'));
  const snapshotMatch = appJs.match(/function currentSnapshot\(\)\{([\s\S]*?)\}\n/);
  assert.ok(snapshotMatch);
  assert.ok(!snapshotMatch[1].includes('selectedLayerIds'), 'currentSnapshot() must not include the multi-selection');
  assert.ok(!/project\.[a-zA-Z]*[sS]elpush?ected/.test(appJs), 'selection must never be assigned onto a project field');
  const exportHandler = appJs.match(/el\('exportProject'\)\.onclick=\(\)=>\{([\s\S]*?)\};/);
  assert.ok(exportHandler);
  assert.ok(!exportHandler[1].includes('selectedLayerIds'), 'Project JSON export must not serialize the multi-selection');
});

await test('17. reopening a project (Project JSON import) resets the selection to just the first layer', () => {
  assert.match(appJs, /project=parsed;selectedLayerId=project\.layers\[0\]\.id;selectedLayerIds=selectOnly\(selectedLayerId\);/);
});

await test('18. text layers gained optional x/y fields, defaulted through ||0 so pre-RS-1009 Project JSON is unaffected', () => {
  // RS-1012 extracted this exact formula out of generateTextStonesLive() into a standalone
  // computeTextPlacementOffset(boundingBox,layer,project) function, reused by RS-1012's own
  // resolveLayerShapeSource() (see tools/test-path-boolean-integration.mjs) -- the arithmetic
  // itself, and the ||0 default, are unchanged.
  assert.match(appJs, /function computeTextPlacementOffset\(boundingBox,layer,project\)\{\s*const offsetX=\(boundingBox\?\(project\.canvas\.width-boundingBox\.widthMm\)\/2-boundingBox\.minXmm:0\)\+\(layer\.x\|\|0\);\s*const offsetY=\(boundingBox\?\(project\.canvas\.height-boundingBox\.heightMm\)\/2-boundingBox\.minYmm:0\)\+\(layer\.y\|\|0\);/);
  assert.match(appJs, /const\{offsetX,offsetY\}=computeTextPlacementOffset\(bb,layer,project\);/, 'expected generateTextStonesLive to call the extracted computeTextPlacementOffset helper');
  assert.match(appJs, /curveAlignment:'center',x:0,y:0\}\]\}\}/, 'expected the default project\'s text layer to declare explicit x:0,y:0');
});

await test('19. the Align & Snap sidebar section exists with labeled/tooltipped buttons, starts disabled, and a snap toggle', () => {
  for (const id of ['alignLeft', 'alignCenterH', 'alignRight', 'alignTop', 'alignCenterV', 'alignBottom', 'distributeH', 'distributeV']) {
    const re = new RegExp(`<button id="${id}"[^>]*title="[^"]+"[^>]*disabled>`);
    assert.match(indexHtml, re, `expected #${id} to have a title tooltip and start disabled`);
  }
  // S-108: option labels read "Snap: On"/"Snap: Off" (not bare On/Off) for toolbar clarity; the
  // underlying values/selected state driving snapEnabled are unchanged.
  assert.match(indexHtml, /<select id="snapEnabled"[^>]*title="[^"]+"[^>]*><option value="on" selected>Snap: On<\/option><option value="off">Snap: Off<\/option><\/select>/);
  assert.match(indexHtml, /<div[^>]*id="selectionSummary"/);
});

await test('20. the Align & Snap section appears before any per-layer-type detail controls (visible without scrolling, matching the UI-discoverability precedent)', () => {
  const cardIndex = indexHtml.indexOf('Align &amp; Snap');
  const textControlsIndex = indexHtml.indexOf('id="textControls"');
  assert.ok(cardIndex > 0 && textControlsIndex > 0);
  assert.ok(cardIndex < textControlsIndex, 'expected the Align & Snap section before #textControls');
});

await test('21. updateEditingUI() disables align at <2 selected and distribute at <3 selected, and is called from updateAll()', () => {
  assert.match(appJs, /function updateEditingUI\(\)\{const n=selectedLayerIds\.size;[\s\S]*?const alignDisabled=n<2;[\s\S]*?const distDisabled=n<3;/);
  assert.match(appJs, /updateHistoryUI\(\);updateEditingUI\(\);updateViewButtons\(\);/);
});

// ---------------------------------------------------------------------------------------------
// Behavioral checks: real src/editing/** functions combined with the extracted, pure
// getLayerPosition()/setLayerPosition() from app.js, run against synthetic layer objects.
// ---------------------------------------------------------------------------------------------

await test('22. getLayerPosition()/setLayerPosition() round-trip correctly for every supported layer type', () => {
  const cases = [
    { type: 'text', layer: { type: 'text', x: 3, y: 4 }, expectGet: { xMm: 3, yMm: 4 } },
    { type: 'text (no x/y set yet, defaults to 0,0)', layer: { type: 'text' }, expectGet: { xMm: 0, yMm: 0 } },
    { type: 'curved text (same code path as text)', layer: { type: 'text', curveEnabled: true, x: 5, y: -2 }, expectGet: { xMm: 5, yMm: -2 } },
    { type: 'circle', layer: { type: 'circle', cx: 10, cy: 20, r: 5 }, expectGet: { xMm: 10, yMm: 20 } },
    { type: 'rectangle', layer: { type: 'rectangle', x: 1, y: 2, w: 3, h: 4 }, expectGet: { xMm: 1, yMm: 2 } },
    { type: 'svg', layer: { type: 'svg', x: 6, y: 7, w: 3, h: 4 }, expectGet: { xMm: 6, yMm: 7 } },
    { type: 'image', layer: { type: 'image', x: 8, y: 9, w: 3, h: 4 }, expectGet: { xMm: 8, yMm: 9 } }
  ];
  for (const { type, layer, expectGet } of cases) {
    assert.deepEqual(getLayerPosition(layer), expectGet, `getLayerPosition() mismatch for ${type}`);
    setLayerPosition(layer, 100, 200);
    assert.deepEqual(getLayerPosition(layer), { xMm: 100, yMm: 200 }, `setLayerPosition() round-trip mismatch for ${type}`);
  }
  assert.equal(cases.find((c) => c.type === 'circle').layer.cx, 100, 'setLayerPosition must write cx for circle');
  assert.equal(cases.find((c) => c.type === 'rectangle').layer.x, 100, 'setLayerPosition must write x for rectangle');
});

await test('23. align left/right/centerH/top/bottom/centerV move a mixed-type selection to the expected result', () => {
  // A synthetic mixed-type selection: circle, rectangle, text, svg, image, all at different
  // positions/sizes, exercising alignLayers() + getLayerPosition/setLayerPosition together, the
  // exact composition app.js's runAlign() uses.
  const layers = [
    { id: 'c', type: 'circle', cx: 20, cy: 20, r: 10 },     // bbox x=10,y=10,w=20,h=20
    { id: 'r', type: 'rectangle', x: 50, y: 5, w: 10, h: 40 },
    { id: 't', type: 'text', x: 2, y: 2 },                    // bbox synthesized below
    { id: 's', type: 'svg', x: 0, y: 60, w: 30, h: 5 },
    { id: 'i', type: 'image', x: 80, y: -10, w: 15, h: 15 }
  ];
  const bboxOf = (l) => {
    if (l.type === 'circle') return { xMm: l.cx - l.r, yMm: l.cy - l.r, widthMm: l.r * 2, heightMm: l.r * 2 };
    if (l.type === 'text') return { xMm: l.x, yMm: l.y, widthMm: 12, heightMm: 8 }; // synthetic generated-text bbox
    return { xMm: l.x, yMm: l.y, widthMm: l.w, heightMm: l.h };
  };
  const items = layers.map((l) => ({ id: l.id, bbox: bboxOf(l) }));

  for (const direction of ['left', 'centerH', 'right', 'top', 'centerV', 'bottom']) {
    const layersCopy = JSON.parse(JSON.stringify(layers));
    const itemsCopy = layers.map((l) => ({ id: l.id, bbox: bboxOf(l) }));
    const deltas = alignLayers(itemsCopy, direction);
    for (const l of layersCopy) {
      const { dxMm, dyMm } = deltas.get(l.id);
      const p = getLayerPosition(l);
      setLayerPosition(l, p.xMm + dxMm, p.yMm + dyMm);
    }
    // After aligning, every item's relevant edge/center must be equal across the whole selection.
    const newBboxes = layersCopy.map((l) => ({ id: l.id, bbox: bboxOf(l) }));
    const key = {
      left: (b) => b.xMm, right: (b) => b.xMm + b.widthMm, centerH: (b) => b.xMm + b.widthMm / 2,
      top: (b) => b.yMm, bottom: (b) => b.yMm + b.heightMm, centerV: (b) => b.yMm + b.heightMm / 2
    }[direction];
    const values = newBboxes.map((nb) => key(nb.bbox));
    for (const v of values) assert.ok(Math.abs(v - values[0]) < 1e-9, `expected all layers aligned "${direction}" to share the same value, got ${values}`);
  }
});

await test('24. distribute horizontal/vertical requires 3+ and preserves the two extreme layers\' positions', () => {
  const layers = [
    { id: 'a', type: 'rectangle', x: 0, y: 0, w: 10, h: 10 },
    { id: 'b', type: 'circle', cx: 22, cy: 5, r: 2 },
    { id: 'c', type: 'rectangle', x: 90, y: 0, w: 10, h: 10 }
  ];
  const bboxOf = (l) => l.type === 'circle' ? { xMm: l.cx - l.r, yMm: l.cy - l.r, widthMm: l.r * 2, heightMm: l.r * 2 } : { xMm: l.x, yMm: l.y, widthMm: l.w, heightMm: l.h };
  const items = layers.map((l) => ({ id: l.id, bbox: bboxOf(l) }));
  const deltas = distributeLayers(items, 'horizontal');
  assert.equal(deltas.get('a').dxMm, 0, 'leftmost item stays fixed');
  assert.equal(deltas.get('c').dxMm, 0, 'rightmost item stays fixed');
  for (const l of layers) {
    const { dxMm, dyMm } = deltas.get(l.id);
    const p = getLayerPosition(l);
    setLayerPosition(l, p.xMm + dxMm, p.yMm + dyMm);
  }
  const centers = layers.map((l) => bboxOf(l)).map((b) => b.xMm + b.widthMm / 2);
  assert.ok(Math.abs((centers[1] - centers[0]) - (centers[2] - centers[1])) < 1e-9, 'expected equal center-to-center spacing after distribution');
});

await test('25. keyboard nudge moves the whole multi-selection by the same delta, preserving relative offsets (grouped movement)', () => {
  const layers = [
    { id: 'a', type: 'rectangle', x: 10, y: 10, w: 5, h: 5 },
    { id: 'b', type: 'circle', cx: 40, cy: 40, r: 3 },
    { id: 'c', type: 'text', x: 0, y: 0 }
  ];
  const before = layers.map((l) => ({ id: l.id, ...getLayerPosition(l) }));
  const dxMm = -NUDGE_STEP_MM, dyMm = 0;
  for (const l of layers) {
    const p = getLayerPosition(l);
    setLayerPosition(l, p.xMm + dxMm, p.yMm + dyMm);
  }
  const after = layers.map((l) => ({ id: l.id, ...getLayerPosition(l) }));
  for (let i = 0; i < layers.length; i++) {
    assert.ok(Math.abs((after[i].xMm - before[i].xMm) - dxMm) < 1e-9, `layer ${layers[i].id} did not move by the nudge step`);
  }
  for (let i = 1; i < layers.length; i++) {
    const beforeRelX = before[i].xMm - before[0].xMm, afterRelX = after[i].xMm - after[0].xMm;
    assert.ok(Math.abs(beforeRelX - afterRelX) < 1e-9, `relative x offset between ${layers[0].id} and ${layers[i].id} must be preserved`);
  }
  assert.equal(NUDGE_STEP_LARGE_MM > NUDGE_STEP_MM, true, 'the Shift step must be larger than the plain step');
});

await test('26. computeSnapOffset()/buildSnapTargets() integrate correctly with a project-shaped canvas+safe-area+other-layers input (canvas center/edges, safe area, other layers)', () => {
  const others = [{ layerId: 'other', xMm: 50, yMm: 40, widthMm: 20, heightMm: 10 }];
  const targets = buildSnapTargets({ canvasWidthMm: 210, canvasHeightMm: 90, safeAreaRectMm: { xMm: 14, yMm: 10, widthMm: 182, heightMm: 70 }, layerBBoxes: others });
  // dragged box: left=104, centerH=105.5, right=107 -- centerH is the closest feature to the
  // canvas/safe-area center (105, both coincide here), 0.5mm away.
  const centered = computeSnapOffset({ xMm: 104, yMm: 44, widthMm: 3, heightMm: 3 }, targets, SNAP_TOLERANCE_MM);
  assert.ok(Math.abs(centered.dxMm - (-0.5)) < 1e-9, `expected the dragged box's center to snap 0.5mm onto canvas center (105), got dxMm=${centered.dxMm}`);
  assert.ok(Math.abs(centered.dyMm - (-0.5)) < 1e-9, `expected the dragged box's vertical center to snap 0.5mm onto canvas/safe-area/other-layer center (45, all coincide here), got dyMm=${centered.dyMm}`);
  assert.ok(centered.guides.some((g) => g.axis === 'vertical' && g.type === 'canvas-center'));
  assert.ok(centered.guides.some((g) => g.axis === 'horizontal' && g.type === 'canvas-center'));
});

await test('27. snapping-disabled drag falls back to the (sensitivity-scaled) pointer delta (no snap engine call in that branch)', () => {
  const moveBranch = appJs.match(/if\(drag\.kind==='move'\)\{([\s\S]*?)\}else if\(drag\.kind==='resize'\)/);
  assert.ok(moveBranch);
  // S-104: dx/dy start as rawDx/rawDy scaled by the named LAYER_MOVE_DRAG_SENSITIVITY constant
  // (reduced-sensitivity dragging), not the raw 1:1 pointer delta -- see
  // tools/test-s104-text-position-recovery-drag-tuning.mjs for the dedicated sensitivity checks.
  assert.match(moveBranch[1], /let dx=rawDx\*LAYER_MOVE_DRAG_SENSITIVITY,dy=rawDy\*LAYER_MOVE_DRAG_SENSITIVITY;/, 'expected the unsnapped delta to start as the sensitivity-scaled pointer delta');
  assert.match(moveBranch[1], /if\(snapEnabled\)\{/, 'expected the snap computation to be fully gated behind snapEnabled, so dx/dy stay unsnapped when disabled');
});

await test('28. no forbidden file changed (this milestone\'s own forbidden list)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  // RS-1012 (Vector Boolean Operations) legitimately adds src/geometry/PathBoolean.js and extends
  // src/geometry/GeometryEngine.js/index.js/README.md -- see
  // tools/test-path-boolean-integration.mjs for RS-1012's own forbidden-file guard.
  // RS-1013 (Variable Stone Sizes) legitimately adds src/renderer/StoneSizes.js and changes
  // src/export/ProductionSheetExporter.js's header formatting -- see
  // tools/test-variable-stone-sizes.mjs for that milestone's own forbidden-file guard.
  // RS-1011 (Fill Algorithms) legitimately adds src/geometry/ContourRingSampler.js and extends
  // src/geometry/GeometryEngine.js (already allowed above)/StoneSampler.js -- see
  // tools/test-fill-algorithms.mjs / tools/test-fill-algorithms-integration.mjs for that
  // milestone's own forbidden-file guard.
  const allowedDespitePrefix = new Set(['src/geometry/GeometryEngine.js', 'src/geometry/index.js', 'src/geometry/README.md', 'src/geometry/PathBoolean.js', 'src/geometry/StoneSampler.js', 'src/geometry/ContourRingSampler.js', 'src/renderer/StoneSizes.js', 'src/export/ProductionSheetExporter.js']);
  const forbiddenPrefixes = [
    // RS-2002: assets/fonts/** is legitimately expanded by the Typography & Font Library milestone (new bundled font files + manifest entries).
    'src/geometry/', 'src/renderer/', 'src/export/', 'src/text/', 'src/fonts/', 'src/browser/', 'src/svg/', 'src/image/', 'src/history/', 'src/products/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      allowedDespitePrefix.has(changedPath) ||
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Alignment & snapping integration tests passed.');
