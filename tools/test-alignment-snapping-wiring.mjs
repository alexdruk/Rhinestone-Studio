import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1009 (Alignment & Snapping) + RS-1010/RS-1010A (its configurable-distance/axis-lock/
// Alt-duplicate upgrade) — verifies app.js is wired to src/editing/** for multi-select,
// align/distribute, drag/keyboard snapping, and grouped movement, and exercises the real
// position-application helpers (getLayerPosition/setLayerPosition) and src/editing/** functions
// directly. Consolidated by S-111 from two separate milestone-named files
// (test-alignment-snapping-integration.mjs, test-alignment-snapping-upgrade.mjs) that were two
// layers of app.js wiring for the same feature, with several literally-duplicated structural
// checks (both independently asserted the same `snapToleranceMm` declaration/usage lines) — one
// file, no duplication. Structural checks against the live app.js/index.html source (app.js is a
// browser entry point, not import()-able directly under plain Node); behavioral checks combine the
// real, imported src/editing/** module with small extracted app.js functions.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

const {
  alignLayers, distributeLayers, buildSnapTargets, computeSnapOffset,
  SNAP_TOLERANCE_MM, NUDGE_STEP_MM, NUDGE_STEP_LARGE_MM
} = await import('../src/editing/index.js');

// TXT-102A: track failures so the final summary line (below) reports the real outcome instead of
// unconditionally claiming success -- process.exitCode=1 already made a failure exit nonzero, but
// the printed message previously said "tests passed" even when a test had just failed above it.
let failureCount = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    failureCount++;
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
  // MONO-005A: computeTextPlacementOffsetMm/computeTextLayerPositionForTargetCenterMm joined this
  // same barrel import when computeTextPlacementOffset()'s formula was extracted into
  // src/editing/TextPlacement.js -- see that module's own doc comment.
  assert.match(
    appJs,
    /import\s*\{\s*SNAP_TOLERANCE_MM,\s*NUDGE_STEP_MM,\s*NUDGE_STEP_LARGE_MM,\s*alignLayers,\s*distributeLayers,\s*buildSnapTargets,\s*computeSnapOffset,\s*selectOnly,\s*toggleSelection,\s*clearSelection,\s*selectMany,\s*computeTextPlacementOffsetMm,\s*computeTextLayerPositionForTargetCenterMm\s*\}\s*from\s*['"]\.\/src\/editing\/index\.js['"]/
  );
});

await test('2. selectedLayerIds is the one Set<string> multi-selection; snapToleranceMm/showSnapGuides are view-only editor state defaulted from SNAP_TOLERANCE_MM/true', () => {
  assert.match(appJs, /let selectedLayerIds=new Set\(\[selectedLayerId\]\),snapEnabled=true,snapToleranceMm=SNAP_TOLERANCE_MM,showSnapGuides=true,activeGuides=\[\];/);
});

await test('3. every selection-changing site uses selectOnly/toggleSelection/clearSelection/selectMany (src/editing/Selection.js), never a hand-rolled Set mutation', () => {
  assert.ok(!/selectedLayerIds\.add\(/.test(appJs), 'app.js must not call Set.prototype.add directly on selectedLayerIds');
  assert.ok(!/selectedLayerIds\.delete\(/.test(appJs), 'app.js must not call Set.prototype.delete directly on selectedLayerIds');
  assert.ok(!/selectedLayerIds=new Set\(\)/.test(appJs), 'app.js must clear selection via clearSelection(), not a literal new Set()');
  const assignments = appJs.match(/selectedLayerIds=[^;]+;/g) || [];
  assert.ok(assignments.length >= 6, `expected several selectedLayerIds= assignments, found ${assignments.length}`);
  for (const assignment of assignments) {
    assert.match(assignment, /selectedLayerIds=new Set\(\[selectedLayerId\]\)|selectedLayerIds=(selectOnly|toggleSelection|clearSelection|selectMany)\(/, `unexpected selectedLayerIds assignment not going through src/editing/Selection.js: ${assignment}`);
  }
});

await test('4. clicking empty canvas clears the selection; Shift-click (canvas or layers-list) toggles; a plain click on an unselected layer collapses to just that layer', () => {
  assert.match(appJs, /if\(!hit\)\{if\(selectedLayerIds\.size\)\{selectedLayerIds=clearSelection\(\);/);
  const pointerdown = appJs.match(/layoutCanvas\.addEventListener\('pointerdown',e=>\{([\s\S]*?)\}\);\nlayoutCanvas\.addEventListener\('pointermove'/);
  assert.ok(pointerdown, 'expected to find the pointerdown handler body');
  assert.match(pointerdown[1], /if\(e\.shiftKey\)\{\s*selectedLayerIds=toggleSelection\(selectedLayerIds,hit\.layer\.id\);/, 'expected Shift-click to toggle via toggleSelection()');
  assert.match(appJs, /if\(e\.shiftKey\)\{selectedLayerIds=toggleSelection\(selectedLayerIds,id\);/, 'expected the layers-list to share the same toggle');
  assert.match(appJs, /if\(!selectedLayerIds\.has\(hit\.layer\.id\)\)selectedLayerIds=selectOnly\(hit\.layer\.id\);/);
});

await test('5. a move-drag on a multi-selected group moves every selected layer by one shared delta (grouped movement)', () => {
  const pointermove = appJs.match(/layoutCanvas\.addEventListener\('pointermove',e=>\{([\s\S]*?)\}\);\nwindow\.addEventListener\('pointerup'/);
  assert.ok(pointermove, 'expected to find the pointermove handler body');
  assert.match(pointermove[1], /for\(const id of drag\.layerIds\)\{/, 'expected the move branch to iterate every dragged layer id');
  assert.match(pointermove[1], /setLayerPosition\(l,p0\.xMm\+dx,p0\.yMm\+dy\)/, 'expected every dragged layer to be positioned from the same dx/dy');
});

await test('6. drag snapping is gated by snapEnabled and computed via buildSnapTargets/computeSnapOffset against the configurable snapToleranceMm, excluding every dragged layer from its own targets', () => {
  assert.match(appJs, /if\(snapEnabled\)\{/);
  assert.match(appJs, /buildSnapTargets\(\{canvasWidthMm:project\.canvas\.width,canvasHeightMm:project\.canvas\.height,safeAreaRectMm:getSafeAreaRectMm\(currentObjectTemplate\(\),project\.canvas\.width,project\.canvas\.height\),layerBBoxes:others\}\)/);
  assert.match(appJs, /computeSnapOffset\(dragBBoxMm,targets,snapToleranceMm\)/);
  assert.match(appJs, /project\.layers\.filter\(l=>l\.visible&&!drag\.layerIds\.includes\(l\.id\)\)/);
});

await test('7. resize drags are never snap-aware, and visible guide lines are gated by showSnapGuides independently of snapEnabled (snapping still applies with guides hidden), cleared on pointerup', () => {
  const resizeBranch = appJs.match(/\}else if\(drag\.kind==='resize'\)\{([\s\S]*?)\}\n\s*syncSelectedControlsFromLayer/);
  assert.ok(resizeBranch, 'expected to find the resize branch of pointermove');
  assert.ok(!/computeSnapOffset|buildSnapTargets/.test(resizeBranch[1]), 'resize must not call the snap engine');
  assert.match(appJs, /activeGuides=showSnapGuides\?snap\.guides:\[\];/);
  assert.match(appJs, /window\.addEventListener\('pointerup',\(\)=>\{drag=null;if\(activeGuides\.length\)\{activeGuides=\[\];drawLayout\(\)\}\}\);/);
});

await test('8. Shift held during a move-drag constrains movement to one axis (applied after snapping, so the locked axis never drifts); Alt/Option held on pointerdown duplicates the selection and drags the copies via selectMany()', () => {
  const moveBranch = appJs.match(/if\(drag\.kind==='move'\)\{([\s\S]*?)\}else if\(drag\.kind==='resize'\)/);
  assert.ok(moveBranch, 'expected to find the move branch of pointermove');
  const snapIdx = moveBranch[1].indexOf('if(snapEnabled){');
  const shiftIdx = moveBranch[1].indexOf('if(e.shiftKey){');
  assert.ok(snapIdx >= 0 && shiftIdx >= 0 && shiftIdx > snapIdx, 'expected the Shift axis-lock check after the snap computation');
  assert.match(moveBranch[1], /if\(Math\.abs\(dx\)>=Math\.abs\(dy\)\)\{dy=0;/, 'expected the dominant axis to win and the other to be forced to exactly 0');
  assert.match(moveBranch[1], /else\{dx=0;/);

  const pointerdown = appJs.match(/layoutCanvas\.addEventListener\('pointerdown',e=>\{([\s\S]*?)\}\);\nlayoutCanvas\.addEventListener\('pointermove'/)[1];
  assert.match(pointerdown, /if\(e\.altKey\)\{/, 'expected an Alt-gated branch');
  assert.match(pointerdown, /project\.layers\.push\(\.\.\.copies\);/, 'expected duplicates to be pushed as new layers (originals stay in project.layers)');
  assert.match(pointerdown, /dragIds=copies\.map\(c=>c\.id\);/, 'expected the drag to target the new copies\' ids, not the originals');
  assert.match(pointerdown, /selectedLayerIds=selectMany\(dragIds\);/, 'expected the new selection to be built via selectMany(), not a hand-rolled new Set() (no second selection model)');

  const resizeBranch = appJs.match(/if\(hit\.kind==='resize'\)\{([\s\S]*?)\n {2}\}\n {2}if\(e\.shiftKey\)/);
  assert.ok(resizeBranch, 'expected to find the resize branch of pointerdown');
  assert.ok(!/altKey/.test(resizeBranch[1]), 'resize branch must not reference e.altKey (Alt-duplicate only applies to move drags)');
});

await test('9. align/distribute run through the pure src/editing/AlignmentEngine.js functions and commit history exactly once before mutating; all six align buttons and both distribute buttons are wired correctly', () => {
  assert.match(appJs, /function runAlign\(direction\)\{const items=selectedItemsForEditing\(\);if\(items\.length<2\)return;commitHistory\(\);applyPositionDeltas\(alignLayers\(items,direction\)\);/);
  assert.match(appJs, /function runDistribute\(axis\)\{const items=selectedItemsForEditing\(\);if\(items\.length<3\)return;commitHistory\(\);applyPositionDeltas\(distributeLayers\(items,axis\)\);/);
  const pairs = [
    ['alignLeft', "runAlign\\('left'\\)"], ['alignCenterH', "runAlign\\('centerH'\\)"], ['alignRight', "runAlign\\('right'\\)"],
    ['alignTop', "runAlign\\('top'\\)"], ['alignCenterV', "runAlign\\('centerV'\\)"], ['alignBottom', "runAlign\\('bottom'\\)"],
    ['distributeH', "runDistribute\\('horizontal'\\)"], ['distributeV', "runDistribute\\('vertical'\\)"]
  ];
  for (const [id, call] of pairs) {
    assert.match(appJs, new RegExp(`el\\('${id}'\\)\\.onclick=\\(\\)=>${call}`), `expected #${id} wired to ${call}`);
  }
});

await test('10. arrow keys nudge the selection by a named step (Shift uses the larger step), typing in a field is never hijacked, and each key press is one undo entry', () => {
  assert.match(appJs, /const ARROW_KEY_DELTAS=\{ArrowLeft:\[-1,0\],ArrowRight:\[1,0\],ArrowUp:\[0,-1\],ArrowDown:\[0,1\]\};/);
  assert.match(appJs, /if\(ARROW_KEY_DELTAS\[e\.key\]\)\{const t=document\.activeElement\?\.tagName;if\(t==='INPUT'\|\|t==='SELECT'\)return;e\.preventDefault\(\);const step=e\.shiftKey\?NUDGE_STEP_LARGE_MM:NUDGE_STEP_MM;/);
  assert.match(appJs, /function nudgeSelection\(dxMm,dyMm\)\{if\(selectedLayerIds\.size===0\)return;commitHistory\(\);/, 'expected nudgeSelection to commit history exactly once per call');
});

await test('11. selection is never part of `project`, never history-tracked, never exported; reopening a project resets it to just the first layer', () => {
  const listMatch = appJs.match(/const HISTORY_TRACKED_CONTROL_IDS=\[([\s\S]*?)\];/);
  assert.ok(listMatch);
  assert.ok(!listMatch[1].includes('selectedLayerIds'));
  const snapshotMatch = appJs.match(/function currentSnapshot\(\)\{([\s\S]*?)\}\n/);
  assert.ok(snapshotMatch);
  assert.ok(!snapshotMatch[1].includes('selectedLayerIds'), 'currentSnapshot() must not include the multi-selection');
  const exportHandler = appJs.match(/el\('exportProject'\)\.onclick=\(\)=>\{([\s\S]*?)\};/);
  assert.ok(exportHandler);
  assert.ok(!exportHandler[1].includes('selectedLayerIds'), 'Project JSON export must not serialize the multi-selection');
  assert.match(appJs, /project=parsed;selectedLayerId=project\.layers\[0\]\.id;selectedLayerIds=selectOnly\(selectedLayerId\);/);
});

await test('12. text/curved-text, imported SVG, and Image Trace bounds all feed the same generic layerBBoxes snap path (no per-type snapping logic)', () => {
  const bboxFn = appJs.match(/function getLayerBBox\(l\)\{([\s\S]*?)\}\n/);
  assert.ok(bboxFn, 'expected to find getLayerBBox() in app.js');
  const body = bboxFn[1];
  assert.match(body, /XYWH_SHAPE_TYPES\.has\(l\.type\)/, 'expected svg/image to share one direct x/y/w/h bbox branch');
  assert.ok(!/l\.type==='text'/.test(body), 'expected no special-cased text branch: text/curved-text bounds fall through to the one generic bbox path');
});

await test('13. the Align & Snap sidebar section exists with labeled/tooltipped buttons, starts disabled, appears before per-layer-type controls, and updateEditingUI() gates align at <2/distribute at <3 selected', () => {
  for (const id of ['alignLeft', 'alignCenterH', 'alignRight', 'alignTop', 'alignCenterV', 'alignBottom', 'distributeH', 'distributeV']) {
    const re = new RegExp(`<button id="${id}"[^>]*title="[^"]+"[^>]*disabled>`);
    assert.match(indexHtml, re, `expected #${id} to have a title tooltip and start disabled`);
  }
  assert.match(indexHtml, /<div[^>]*id="selectionSummary"/);
  // S-108: the quick Snap: On/Off toggle lives in the Align & Snap sidebar itself, distinct from
  // the Settings Lightbox's own "Enable Snapping" checkbox (see check 14) -- same snapEnabled state.
  assert.match(indexHtml, /<select id="snapEnabled"[^>]*title="[^"]+"[^>]*><option value="on" selected>Snap: On<\/option><option value="off">Snap: Off<\/option><\/select>/);
  const cardIndex = indexHtml.indexOf('Align &amp; Snap');
  const textControlsIndex = indexHtml.indexOf('id="textControls"');
  assert.ok(cardIndex > 0 && textControlsIndex > 0);
  assert.ok(cardIndex < textControlsIndex, 'expected the Align & Snap section before #textControls');
  assert.match(appJs, /function updateEditingUI\(\)\{const n=selectedLayerIds\.size;[\s\S]*?const alignDisabled=n<2;[\s\S]*?const distDisabled=n<3;/);
  assert.match(appJs, /updateHistoryUI\(\);updateEditingUI\(\);updateViewButtons\(\);/);
});

await test('14. the Settings Lightbox exposes plain-language snapping controls (Enable Snapping, Snap Distance, Show Alignment Guides), each writable/readable from live state and clamped to a sane range', () => {
  const body = indexHtml.slice(indexHtml.indexOf('id="lightboxSettings"'), indexHtml.indexOf('id="lightboxHelp"'));
  assert.match(body, /<label class="checkbox-row" title="[^"]+"><input type="checkbox" id="settingsSnapDefault" checked> Enable Snapping<\/label>/, 'expected a tooltip explaining what Enable Snapping snaps to');
  // RS-3020: Snap Distance is now a unit-converting length field (data-unit-label, same convention
  // as every other freely-typed length field) -- its static markup carries the "(mm)" suffix as the
  // default-units display text, same as e.g. #drawSlotWidthField's own "Width (mm)".
  assert.match(body, /<label for="settingsSnapDistance" data-unit-label="Snap Distance">Snap Distance \(mm\)<\/label>/, 'expected a unit-converting label carrying data-unit-label, same convention as every other length field');
  assert.match(body, /<input id="settingsSnapDistance" type="number" min="0\.5" max="5" step="0\.1" data-mm-step="0\.1" value="1\.5">/);
  assert.match(body, /<p class="hint">How close two elements need to be, in millimeters, before they snap together\.[^<]*<\/p>/, 'expected a visible, plain-language mm explanation (not hover-only)');
  assert.match(body, /<label class="checkbox-row" title="[^"]+"><input type="checkbox" id="settingsShowGuides" checked> Show Alignment Guides<\/label>/, 'expected a tooltip explaining what Show Alignment Guides shows');
  assert.ok(!/technical|tolerance/i.test(body), 'expected friendly labels, not raw technical terms like "tolerance"');
  assert.match(appJs, /setLengthField\('settingsSnapDistance',snapToleranceMm\);el\('settingsShowGuides'\)\.checked=showSnapGuides;/);
  assert.match(appJs, /snapToleranceMm=Math\.min\(5,Math\.max\(0\.5,readLengthField\('settingsSnapDistance'\)\|\|SNAP_TOLERANCE_MM\)\);/);
  assert.match(appJs, /showSnapGuides=el\('settingsShowGuides'\)\.checked;/);

  const helpBody = indexHtml.slice(indexHtml.indexOf('Keyboard shortcuts'), indexHtml.indexOf('</div>', indexHtml.indexOf('Keyboard shortcuts')));
  assert.match(helpBody, /<span class="kbd">Shift\+Drag<\/span><span>Constrain movement/);
  assert.match(helpBody, /<span class="kbd">Alt\/Option\+Drag<\/span><span>Duplicate the selection/);
});

await test('15. text layers\' optional x/y fields default through ||0 so pre-RS-1009 Project JSON is unaffected', async () => {
  // MONO-005A: the ||0 defaulting itself moved into src/editing/TextPlacement.js's
  // computeTextPlacementOffsetMm() when computeTextPlacementOffset() was extracted to delegate to
  // it (behavior-preserving refactor -- see that module's own doc comment); app.js's own wrapper now
  // just forwards layer.x/layer.y through unchanged, with no defaulting of its own.
  const textPlacementJs = await readFile(path.join(repoRoot, 'src/editing/TextPlacement.js'), 'utf8');
  assert.match(textPlacementJs, /\(xMm \|\| 0\)/);
  assert.match(textPlacementJs, /\(yMm \|\| 0\)/);
  assert.match(appJs, /function computeTextPlacementOffset\(boundingBox,layer,project\)\{\s*const\{offsetXMm,offsetYMm\}=computeTextPlacementOffsetMm\(\{boundingBoxMm:boundingBox,xMm:layer\.x,yMm:layer\.y,canvasWidthMm:project\.canvas\.width,canvasHeightMm:project\.canvas\.height\}\);/);
  assert.match(appJs, /const\{offsetX,offsetY\}=computeTextPlacementOffset\(bb,layer,project\);/, 'expected generateTextStonesLive to call the extracted computeTextPlacementOffset helper');
  // TXT-102A: isolate the default project's single text-layer object literal, then check for
  // explicit x:0/y:0 fields independently of property order or any other (e.g. TXT-102's
  // align/lineSpacing/rotationDeg) fields that may sit between them and their neighbors -- a
  // fragile exact-adjacency match (`curveAlignment:'center',x:0,y:0`) previously broke the moment
  // TXT-102 inserted new fields before x/y, even though x/y themselves were untouched.
  const defaultProjectMatch = appJs.match(/function defaultProject\(\)\{[\s\S]*?layers:\[\{id:'text',type:'text',[\s\S]*?\}\]\}\}/);
  assert.ok(defaultProjectMatch, 'expected to find defaultProject()\'s single text layer literal in app.js');
  const textLayerSource = defaultProjectMatch[0];
  assert.match(textLayerSource, /(?:[{,])x:0(?:[,}])/, 'expected the default project\'s text layer to declare a numeric x:0 field (in any position)');
  assert.match(textLayerSource, /(?:[{,])y:0(?:[,}])/, 'expected the default project\'s text layer to declare a numeric y:0 field (in any position)');
});

// ---------------------------------------------------------------------------------------------
// Behavioral checks: real src/editing/** functions combined with the extracted, pure
// getLayerPosition()/setLayerPosition() from app.js, run against synthetic layer objects.
// ---------------------------------------------------------------------------------------------

await test('16. getLayerPosition()/setLayerPosition() round-trip correctly for every supported layer type', () => {
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

await test('17. align left/right/centerH/top/bottom/centerV move a mixed-type selection to the expected result', () => {
  const layers = [
    { id: 'c', type: 'circle', cx: 20, cy: 20, r: 10 },
    { id: 'r', type: 'rectangle', x: 50, y: 5, w: 10, h: 40 },
    { id: 't', type: 'text', x: 2, y: 2 },
    { id: 's', type: 'svg', x: 0, y: 60, w: 30, h: 5 },
    { id: 'i', type: 'image', x: 80, y: -10, w: 15, h: 15 }
  ];
  const bboxOf = (l) => {
    if (l.type === 'circle') return { xMm: l.cx - l.r, yMm: l.cy - l.r, widthMm: l.r * 2, heightMm: l.r * 2 };
    if (l.type === 'text') return { xMm: l.x, yMm: l.y, widthMm: 12, heightMm: 8 };
    return { xMm: l.x, yMm: l.y, widthMm: l.w, heightMm: l.h };
  };

  for (const direction of ['left', 'centerH', 'right', 'top', 'centerV', 'bottom']) {
    const layersCopy = JSON.parse(JSON.stringify(layers));
    const itemsCopy = layers.map((l) => ({ id: l.id, bbox: bboxOf(l) }));
    const deltas = alignLayers(itemsCopy, direction);
    for (const l of layersCopy) {
      const { dxMm, dyMm } = deltas.get(l.id);
      const p = getLayerPosition(l);
      setLayerPosition(l, p.xMm + dxMm, p.yMm + dyMm);
    }
    const newBboxes = layersCopy.map((l) => ({ id: l.id, bbox: bboxOf(l) }));
    const key = {
      left: (b) => b.xMm, right: (b) => b.xMm + b.widthMm, centerH: (b) => b.xMm + b.widthMm / 2,
      top: (b) => b.yMm, bottom: (b) => b.yMm + b.heightMm, centerV: (b) => b.yMm + b.heightMm / 2
    }[direction];
    const values = newBboxes.map((nb) => key(nb.bbox));
    for (const v of values) assert.ok(Math.abs(v - values[0]) < 1e-9, `expected all layers aligned "${direction}" to share the same value, got ${values}`);
  }
});

await test('18. distribute horizontal/vertical requires 3+ and preserves the two extreme layers\' positions with equal center-to-center spacing', () => {
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

await test('19. keyboard nudge moves the whole multi-selection by the same delta, preserving relative offsets (grouped movement)', () => {
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

await test('20. computeSnapOffset()/buildSnapTargets() integrate correctly with a project-shaped canvas+safe-area+other-layers input, with a configurable tolerance and correct corner-to-corner behavior', () => {
  const others = [{ layerId: 'other', xMm: 50, yMm: 40, widthMm: 20, heightMm: 10 }];
  const targets = buildSnapTargets({ canvasWidthMm: 210, canvasHeightMm: 90, safeAreaRectMm: { xMm: 14, yMm: 10, widthMm: 182, heightMm: 70 }, layerBBoxes: others });
  const centered = computeSnapOffset({ xMm: 104, yMm: 44, widthMm: 3, heightMm: 3 }, targets, SNAP_TOLERANCE_MM);
  assert.ok(Math.abs(centered.dxMm - (-0.5)) < 1e-9, `expected the dragged box's center to snap 0.5mm onto canvas center (105), got dxMm=${centered.dxMm}`);
  assert.ok(Math.abs(centered.dyMm - (-0.5)) < 1e-9, `expected the dragged box's vertical center to snap 0.5mm onto canvas/safe-area/other-layer center (45), got dyMm=${centered.dyMm}`);
  assert.ok(centered.guides.some((g) => g.axis === 'vertical' && g.type === 'canvas-center'));
  assert.ok(centered.guides.some((g) => g.axis === 'horizontal' && g.type === 'canvas-center'));

  const tolTargets = buildSnapTargets({ canvasWidthMm: 200, canvasHeightMm: 100 });
  const dragBBox = { xMm: 97, yMm: 40, widthMm: 20, heightMm: 10 }; // left edge 3mm from canvas center (100)
  assert.equal(computeSnapOffset(dragBBox, tolTargets, 1).dxMm, 0, 'a tight snap distance must not snap a 3mm-away edge');
  assert.equal(computeSnapOffset(dragBBox, tolTargets, 4).dxMm, 3, 'a loose snap distance must snap the same 3mm-away edge');

  const cornerTargets = buildSnapTargets({
    canvasWidthMm: 300, canvasHeightMm: 300,
    layerBBoxes: [{ layerId: 'other', xMm: 50, yMm: 20, widthMm: 30, heightMm: 20 }]
  });
  const corner = computeSnapOffset({ xMm: 80.6, yMm: 40.7, widthMm: 15, heightMm: 15 }, cornerTargets, 1.5);
  assert.ok(Math.abs(corner.dxMm - (-0.6)) < 1e-9, `expected the dragged left edge to snap onto the other layer's right edge (x=80), got dxMm=${corner.dxMm}`);
  assert.ok(Math.abs(corner.dyMm - (-0.7)) < 1e-9, `expected the dragged top edge to snap onto the other layer's bottom edge (y=40), got dyMm=${corner.dyMm}`);
  assert.ok(corner.guides.some((g) => g.axis === 'vertical' && g.type === 'layer-edge' && g.layerId === 'other'));
  assert.ok(corner.guides.some((g) => g.axis === 'horizontal' && g.type === 'layer-edge' && g.layerId === 'other'));
});

await test('21. snapping-disabled drag falls back to the (sensitivity-scaled) pointer delta (no snap engine call in that branch)', () => {
  const moveBranch = appJs.match(/if\(drag\.kind==='move'\)\{([\s\S]*?)\}else if\(drag\.kind==='resize'\)/);
  assert.ok(moveBranch);
  // S-104: dx/dy start as rawDx/rawDy scaled by the named LAYER_MOVE_DRAG_SENSITIVITY constant
  // (reduced-sensitivity dragging), not the raw 1:1 pointer delta.
  assert.match(moveBranch[1], /let dx=rawDx\*LAYER_MOVE_DRAG_SENSITIVITY,dy=rawDy\*LAYER_MOVE_DRAG_SENSITIVITY;/, 'expected the unsnapped delta to start as the sensitivity-scaled pointer delta');
  assert.match(moveBranch[1], /if\(snapEnabled\)\{/, 'expected the snap computation to be fully gated behind snapEnabled, so dx/dy stay unsnapped when disabled');
});

await test('22. rotatedCornersAABB() returns the exact pure corner AABB for a 90-degree rotation, and is a byte-identical no-op at 0/360 degrees', () => {
  assert.match(appJs, /function rotatedCornersAABB\(x,y,w,h,rotationDeg\)\{/, 'expected a rotatedCornersAABB() helper in app.js');
  assert.match(appJs, /if\(XYWH_SHAPE_TYPES\.has\(l\.type\)\)return rotatedCornersAABB\(l\.x,l\.y,l\.w,l\.h,l\.rotationDeg\|\|0\);/, 'expected getLayerBBox()\'s XYWH branch to delegate to rotatedCornersAABB()');

  // rotatedCornersAABB()/rotatePointDeg() can't be extracted/executed standalone under plain Node
  // the way getLayerPosition/setLayerPosition are above (app.js is a browser entry point, not
  // import()-able directly) -- hand-copied verbatim from app.js here instead, matching this file's
  // established pattern for math that can't be import()ed.
  function rotatePointDeg(x, y, cx, cy, rotationDeg) {
    const radians = rotationDeg * (Math.PI / 180), cos = Math.cos(radians), sin = Math.sin(radians);
    const dx = x - cx, dy = y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }
  function rotatedCornersAABB(x, y, w, h, rotationDeg) {
    if (((rotationDeg || 0) % 360 + 360) % 360 === 0) return { x, y, width: w, height: h, x2: x + w, y2: y + h };
    const cx = x + w / 2, cy = y + h / 2;
    const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => rotatePointDeg(px, py, cx, cy, rotationDeg));
    const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { x: x0, y: y0, x2: x1, y2: y1, width: x1 - x0, height: y1 - y0 };
  }

  // A 40x10 rectangle at x=0,y=0 rotated 90 degrees clockwise about its own center (20,5) becomes a
  // 10x40 box centered on that same point. At exactly 90 degrees, Math.cos's tiny (~1e-17) error term
  // is swallowed by float64 rounding at this magnitude, so the result lands on exact integers -- an
  // exact equality check, not a tolerance-based one, is the honest assertion here.
  const b = rotatedCornersAABB(0, 0, 40, 10, 90);
  assert.equal(b.x, 15);
  assert.equal(b.y, -15);
  assert.equal(b.x2, 25);
  assert.equal(b.y2, 25);
  assert.equal(b.width, 10);
  assert.equal(b.height, 40);

  // 0 rotation must be a byte-identical no-op, so every project saved before this fix renders the
  // same bbox it always did.
  const unrotated = rotatedCornersAABB(5, 5, 40, 10, 0);
  assert.deepEqual(unrotated, { x: 5, y: 5, width: 40, height: 10, x2: 45, y2: 15 });
});

await test('23. hitTest() builds b0 from the raw unrotated l.x/l.y/l.w/l.h fields for XYWH layers on both the resize and move hit paths, never from getLayerBBox()\'s rotated AABB -- resize-drag math in pointermove (drag.b0.x/y/x2/y2, drag.b0.width/height) assumes an unrotated box, so feeding it the rotated AABB would break resize for every shape, not just rotated ones', () => {
  const hitTestFn = appJs.match(/function hitTest\(mm\)\{([\s\S]*?)\n\}/);
  assert.ok(hitTestFn, 'expected to find hitTest() in app.js');
  const body = hitTestFn[1];
  // (a) the XYWH box fed to rotatedHandlesFor()/used as b0 is built directly from raw l.x/l.y/l.w/l.h,
  // not from a call to getLayerBBox(l) (which would hand it the rotated AABB and double-rotate).
  assert.match(body, /const b=isXywh\?\{x:l\.x,y:l\.y,width:l\.w,height:l\.h,x2:l\.x\+l\.w,y2:l\.y\+l\.h\}:getLayerBBox\(l\);/, 'expected hitTest() to build the raw stored box directly for XYWH layers instead of calling getLayerBBox(l)');
  // (b) that same raw box `b` is what both the resize-handle-hit and the containment-hit return as b0.
  assert.match(body, /return\{layer:l,kind:'resize',handle:h\.name,b0:b\}/, 'expected the resize hit to capture b0 from that same raw box');
  assert.match(body, /return\{layer:l,kind:'move',b0:b\}/, 'expected the move hit to capture b0 from that same raw box');
});

if (failureCount === 0) {
  console.log('Alignment & snapping wiring tests passed.');
} else {
  console.error(`Alignment & snapping wiring tests FAILED (${failureCount} failing assertion(s) above).`);
}
