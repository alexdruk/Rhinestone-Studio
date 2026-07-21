import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

// UI Workflows — Text Position (drag/recovery, printable-area warnings, Front View Frame).
//
// Two originally-separate suites (S-104 "Text Position Recovery & Drag Tuning", S-107 "Front View
// Frame & Long Text Workflow"), merged here because both drive the same app.js text-positioning
// surface (drag handling, the "outside the printable area"/"too long to fit" warning family, and the
// Text Lightbox/workspace Inspector controls around them) even though each introduced a distinct
// mechanism. Each section below keeps its original check numbering (restarts per section) since the
// numbers are just log labels, not external identifiers.
//
// Structural checks against the live app.js/index.html source, matching the established convention
// (app.js is a browser entry point, not import()-able directly under plain Node); behavioral checks
// extract and execute the real, pure logic functions from that source via `new Function`.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const { circumferenceMm, canvasXMmForRotationDeg, rotationDegForCanvasXMm, azimuthRadForCanvasXMm, wrapAngleRad } =
  await import('../src/preview3d/ObjectDimensions.js');

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

function extractBlock(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `expected to find ${label} in app.js`);
  return match[0];
}

// ===============================================================================================
// Section A — Drag Tuning & Recovery (originally S-104): (1) move-drag sensitivity is reduced via
// a named constant applied to the pointer delta before it becomes a position change; (2) a
// "Center on Object" action resets only a selected text layer's x/y to the center of the printable
// (safe) area, recovering text dragged fully outside the visible canvas.
// ===============================================================================================

await test('A1. a named LAYER_MOVE_DRAG_SENSITIVITY constant exists and is strictly between 0 and 1 (reduced, not removed or left at 1:1)', () => {
  const match = appJs.match(/const LAYER_MOVE_DRAG_SENSITIVITY=([0-9.]+);/);
  assert.ok(match, 'expected a named LAYER_MOVE_DRAG_SENSITIVITY constant in app.js');
  const value = Number(match[1]);
  assert.ok(value > 0 && value < 1, `expected LAYER_MOVE_DRAG_SENSITIVITY to be in (0,1), got ${value}`);
});

await test('A2. the move-drag pointermove handler scales the pointer delta by LAYER_MOVE_DRAG_SENSITIVITY before snapping/shift-lock/position-apply, not after', () => {
  const handler = appJs.match(/layoutCanvas\.addEventListener\('pointermove',e=>\{[\s\S]*?\n\}\);/);
  assert.ok(handler, 'expected to find the layoutCanvas pointermove handler');
  const body = handler[0];
  assert.match(body, /let dx=rawDx\*LAYER_MOVE_DRAG_SENSITIVITY,dy=rawDy\*LAYER_MOVE_DRAG_SENSITIVITY;/, 'expected dx/dy to be derived from rawDx/rawDy scaled by the sensitivity constant');
  const scaleIndex = body.indexOf('LAYER_MOVE_DRAG_SENSITIVITY');
  const snapIndex = body.indexOf('if(snapEnabled)');
  const applyIndex = body.indexOf('setLayerPosition(l,p0.xMm+dx,p0.yMm+dy)');
  assert.ok(scaleIndex >= 0 && snapIndex > scaleIndex, 'expected the sensitivity scale to happen before snapping');
  assert.ok(applyIndex > snapIndex, 'expected the position to still be applied after snapping/shift-lock, unchanged in structure');
});

await test('A3. resize-drag (mm-under-cursor, not a pointer delta) is untouched by the sensitivity constant', () => {
  const resizeBranch = appJs.match(/\}else if\(drag\.kind==='resize'\)\{[\s\S]*?\n  \}/);
  assert.ok(resizeBranch, 'expected to find the resize-drag branch');
  assert.doesNotMatch(resizeBranch[0], /LAYER_MOVE_DRAG_SENSITIVITY/, 'resize-drag must not be scaled — it maps directly to the pointer mm position, not a delta');
});

await test('A4. the Text lightbox\'s Position section has a "Center on Object" button, placed after the X/Y fields', () => {
  const positionSection = indexHtml.match(/<h3>Position<\/h3>[\s\S]*?<\/div>\s*<p class="hint">/);
  assert.ok(positionSection, 'expected to find the Text lightbox Position field-section');
  const body = positionSection[0];
  assert.match(body, /id="textY"/);
  assert.match(body, /id="centerTextOnObject"/);
  assert.ok(body.indexOf('id="textY"') < body.indexOf('id="centerTextOnObject"'), 'expected the button after the X/Y fields');
  assert.match(body, /Center on Object</);
});

await test('A4b. the button is styled as a primary (visually prominent) action, not a plain/easily-overlooked secondary control -- a real discoverability audit found the control, while present and functional, was easy to miss since it looked identical to neighboring neutral fields', () => {
  const button = indexHtml.match(/<button[^>]*id="centerTextOnObject"[^>]*>/);
  assert.ok(button, 'expected to find the #centerTextOnObject button tag');
  assert.match(button[0], /class="[^"]*\bprimary\b[^"]*"/, 'expected the button to carry the .primary style so it reads as an action, not a plain field');
});

await test('A5. app.js defines centerSelectedTextOnObject() and wires it to #centerTextOnObject', () => {
  assert.match(appJs, /function centerSelectedTextOnObject\(\)\{/);
  assert.match(appJs, /el\('centerTextOnObject'\)\.onclick=\(\)=>centerSelectedTextOnObject\(\);/);
});

await test('A6. centerSelectedTextOnObject() only ever writes l.x/l.y — no font/size/rotation/curve/spacing/fill/stone-size property is assigned', () => {
  const fn = appJs.match(/function centerSelectedTextOnObject\(\)\{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /l\.x=targetX;l\.y=targetY;/, 'expected the only layer mutation to be x/y');
  const forbiddenAssignments = [
    'l.font=', 'l.text=', 'l.height=', 'l.stoneSize=', 'l.gap=', 'l.color=', 'l.textMode=',
    'l.autoFit=', 'l.curveEnabled=', 'l.curveRadiusMm=', 'l.curveDirection=', 'l.curveStartAngleDeg=',
    'l.curveSweepAngleDeg=', 'l.curveAlignment=', 'l.rotation=', 'l.fillMode='
  ];
  for (const assignment of forbiddenAssignments) {
    assert.doesNotMatch(fn, new RegExp(assignment.replace('.', '\\.')), `centerSelectedTextOnObject() must not touch ${assignment}`);
  }
});

await test('A7. centerSelectedTextOnObject() guards non-text layers, opens one undo step, and re-syncs the UI/history exactly like the existing runAlign/runDistribute/nudgeSelection actions', () => {
  const fn = appJs.match(/function centerSelectedTextOnObject\(\)\{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /if\(!l\|\|l\.type!=='text'\)return;/, 'expected an early return for a non-text or missing selection');
  assert.match(fn, /commitHistory\(\);/);
  assert.ok(fn.indexOf("if(!l||l.type!=='text')return;") < fn.indexOf('commitHistory();'), 'the guard must precede the mutation');
  assert.match(fn, /syncSelectedControlsFromLayer\(\);updateAll\(true\);/, 'expected the same UI-resync pattern runAlign/runDistribute use');
  assert.match(fn, /el\('status'\)\.textContent=/, 'expected a status confirmation, matching every other mutating action');
});

await test('A8. centering targets the printable (safe) area\'s center, not just the raw canvas center — computed via the existing getSafeAreaRectMm(), no new geometry/area logic', () => {
  const fn = appJs.match(/function centerSelectedTextOnObject\(\)\{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /getSafeAreaRectMm\(currentObjectTemplate\(\),project\.canvas\.width,project\.canvas\.height\)/);
  assert.match(fn, /safe\.xMm\+safe\.widthMm\/2-project\.canvas\.width\/2/);
  assert.match(fn, /safe\.yMm\+safe\.heightMm\/2-project\.canvas\.height\/2/);
});

await test('A10. the Text lightbox\'s Position section has an "outside the printable area" warning with the exact required wording, sitting between the X/Y fields and the Center on Object button', () => {
  const positionSection = indexHtml.match(/<h3>Position<\/h3>[\s\S]*?<\/div>\s*<p class="hint">/)[0];
  assert.match(positionSection, /id="textOutsidePrintableWarning"/);
  assert.match(positionSection, /This text is outside the printable area\./, 'expected the exact required warning text');
  assert.ok(
    positionSection.indexOf('id="textY"') < positionSection.indexOf('id="textOutsidePrintableWarning"') &&
    positionSection.indexOf('id="textOutsidePrintableWarning"') < positionSection.indexOf('id="centerTextOnObject"'),
    'expected the warning between the X/Y fields and the Center on Object button'
  );
});

await test('A11. the warning reuses the existing .validation-message alert styling (hidden by default, shown via .visible) already used elsewhere in this same lightbox — no new CSS', () => {
  const warningTag = indexHtml.match(/<p[^>]*id="textOutsidePrintableWarning"[^>]*>/)[0];
  assert.match(warningTag, /class="validation-message"/);
  assert.match(indexHtml, /\.validation-message\{[^}]*display:none/, 'expected the shared hidden-by-default rule to still exist');
  assert.match(indexHtml, /\.validation-message\.visible\{display:block\}/, 'expected the shared reveal rule to still exist');
});

await test('A12. isTextOutsidePrintableArea()/updateTextOutsidePrintableWarning() are pure read+DOM-toggle (no layer/property mutation) and reuse existing geometry (getLayerBBox/getSafeAreaRectMm) — no new geometry, and moving text outside the area is never prevented', () => {
  const fn = appJs.match(/function isTextOutsidePrintableArea\(l\)\{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /getLayerBBox\(l\)/);
  assert.match(fn, /getSafeAreaRectMm\(currentObjectTemplate\(\),project\.canvas\.width,project\.canvas\.height\)/);
  assert.doesNotMatch(fn, /[a-zA-Z0-9_.]+\.[a-zA-Z]+\s*=[^=]/, 'expected a pure read-only computation, no assignment of any kind');
  const updateFn = appJs.match(/function updateTextOutsidePrintableWarning\(\)\{([\s\S]*?)\n\}/)[1];
  // Front View Frame follow-up: the positional warning is still driven by this exact
  // isTextOutsidePrintableArea() result (one shared computation, reused by both warning surfaces) --
  // now additionally gated by `!tooLong` so the structural "too long to fit no matter where it sits"
  // warning (Section B) always takes priority instead of the two ever showing (or disagreeing) at once.
  assert.match(updateFn, /const outside=!tooLong&&isTextOutsidePrintableArea\(l\);/, 'expected one shared computation reused by both warning surfaces');
  assert.match(updateFn, /el\('textOutsidePrintableWarning'\)\.classList\.toggle\('visible',outside\);/);
  assert.match(updateFn, /el\('workspaceTextOutsideWarning'\)\.classList\.toggle\('visible',outside\);/);
});

await test('A12b. the warning uses a partial-overlap-area ratio against the printable safe area (not a full-disjoint/boundary-touch test) — a real mouse-drag audit found a full-disjoint test never fires for text wider than the safe area (the default project\'s own auto-fit text is 199.4mm vs. a 182mm-wide safe area) until literally 100% of it has left, well after a real user can no longer read it', () => {
  const match = appJs.match(/const TEXT_PRINTABLE_VISIBILITY_RATIO=([0-9.]+);/);
  assert.ok(match, 'expected a named TEXT_PRINTABLE_VISIBILITY_RATIO constant');
  const ratio = Number(match[1]);
  assert.ok(ratio > 0 && ratio < 1, `expected the visibility ratio to be a real fraction, got ${ratio}`);
  const fn = appJs.match(/function isTextOutsidePrintableArea\(l\)\{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /overlapWidth\s*\*\s*overlapHeight\s*\)\s*\/\s*bboxArea/, 'expected an overlap-area / bbox-area ratio, not a boundary-only test');
  assert.match(fn, /visibleRatio\s*<\s*TEXT_PRINTABLE_VISIBILITY_RATIO/);
});

await test('A13. the warning is recomputed on every updateAll() call — live during drag (pointermove already calls updateAll() every move), after Undo/Redo, and on every keystroke in #textX/#textY, exactly like every other post-mutation UI refresh (renderLayerUI/drawLayout/updateStats)', () => {
  const updateAllFn = appJs.match(/async function updateAll\([\s\S]*?\n\}/)[0];
  assert.match(updateAllFn, /layout=generated;renderLayerUI\(\);drawLayout\(\);drawCup\(\);updateStats\(\);updateHistoryUI\(\);updateEditingUI\(\);updateViewButtons\(\);updateTextOutsidePrintableWarning\(\);/);
});

await test('A15. the persistent right Inspector panel (never covered by a modal, always visible while dragging on the canvas) has its own "outside the printable area" warning with a "Center Text" action — not inside the Text Lightbox', () => {
  const inspector = indexHtml.match(/<aside class="right-inspector" id="rightInspector"[\s\S]*?<\/aside>/)[0];
  assert.match(inspector, /id="workspaceTextOutsideWarning"/);
  assert.match(inspector, /This text is outside the printable area\./);
  assert.match(inspector, /id="workspaceCenterTextBtn"/);
  assert.match(inspector, /Center Text</);
  assert.ok(
    inspector.indexOf('id="workspaceTextOutsideWarning"') < inspector.indexOf('id="workspaceCenterTextBtn"') &&
    inspector.indexOf('id="workspaceCenterTextBtn"') < inspector.indexOf('id="inspectorPositionSlot"'),
    'expected the warning+button ahead of the rest of the inspector, immediately under the layer name'
  );
});

await test('A16. the workspace "Center Text" button reuses the exact same centerSelectedTextOnObject() the Text Lightbox\'s Center on Object uses — no duplicated recovery logic, so it is guaranteed to only ever touch x/y', () => {
  assert.match(appJs, /el\('workspaceCenterTextBtn'\)\.onclick=\(\)=>centerSelectedTextOnObject\(\);/);
});

await test('A17. the workspace warning reuses the existing .validation-message alert styling and is toggled from the exact same isTextOutsidePrintableArea() result as the Text Lightbox\'s copy (see A12) — both surfaces can never disagree', () => {
  const warningTag = indexHtml.match(/<div class="validation-message" id="workspaceTextOutsideWarning"[^>]*>/);
  assert.ok(warningTag, 'expected #workspaceTextOutsideWarning to carry class="validation-message"');
});

// ===============================================================================================
// Section B — Front View Frame & Long Text Workflow (originally S-107): replaces the previous
// warning-based long-text workflow with a Front View Frame on the 2D Canvas (a movable overlay
// showing the portion of the design currently facing the viewer in the Object Preview, kept in
// sync with the Object Preview's rotation in both directions), and redefines "too long to fit" as
// a real, wrap-mode-independent manufacturing limit: actual rendered width vs. the object's
// printable circumference (reusing ObjectDimensions.js's circumferenceMm()), rather than a
// "current viewing angle" legibility concern.
//
// Part 1 (auto-fit's legibility floor, computeAutoFitScale()/MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO)
// predates this and is unchanged -- it still stops illegible over-shrinking (checks B17-B21 below).
// ===============================================================================================

const ratioDecl = extractBlock(appJs, /const MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO=\d+(\.\d+)?;/, 'the MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO declaration');
const computeAutoFitScaleSrc = extractBlock(appJs, /function computeAutoFitScale\([^)]*\)\{[\s\S]*?\n\}/, 'function computeAutoFitScale()');

// eslint-disable-next-line no-new-func
const computeAutoFitScale = new Function(`${ratioDecl}\nreturn ${computeAutoFitScaleSrc};`)();

await test('B1. the old maxWidth/floorApplied-driven too-long workflow is fully removed: no autoFitFloorAppliedByLayerId, floorApplied, recommendedWrapModeForFit, or textTooLongActionMessage remain in app.js', () => {
  for (const gone of ['autoFitFloorAppliedByLayerId', 'floorApplied', 'recommendedWrapModeForFit', 'textTooLongActionMessage']) {
    assert.ok(!appJs.includes(gone), `expected "${gone}" to be fully removed from app.js`);
  }
});

await test('B1b. the wrap mode control (#wrap, Front/Wide/Half/Full) lives in the Object Preview toolbar (#toolbar3D) -- discoverable alongside Rotation/Zoom/the view buttons, not buried inside the Shapes lightbox, and never removed from the UI (a real user reported being unable to find it there)', () => {
  const toolbarMatch = indexHtml.match(/<div class="toolbar-cluster view3d-toolbar" id="toolbar3D">[\s\S]*?\n {6}<\/div>\n {4}<\/div>/);
  assert.ok(toolbarMatch, 'expected to find #toolbar3D in index.html');
  const toolbar = toolbarMatch[0];
  assert.match(toolbar, /<select id="wrap">/, 'expected #wrap inside #toolbar3D');
  for (const value of ['front', 'wide', 'half', 'full']) {
    assert.ok(toolbar.includes(`value="${value}"`), `expected #toolbar3D's wrap select to offer ${value}`);
  }
  // Exactly one #wrap in the whole document (never duplicated -- app.js's el('wrap') must resolve
  // to a single, unambiguous control).
  assert.equal((indexHtml.match(/id="wrap"/g) || []).length, 1, 'expected exactly one #wrap element in index.html');
});

await test('B2. isTextTooLongForObject() is driven by getLayerBBox() vs. printableCircumferenceMm(), not a wrap-window/maxWidth threshold', () => {
  const fn = extractBlock(appJs, /function isTextTooLongForObject\([^)]*\)\{[\s\S]*?\n\}/, 'function isTextTooLongForObject()');
  assert.match(fn, /getLayerBBox\(l\)\.width>printableCircumferenceMm\(\)/);
});

await test('B3. printableCircumferenceMm() reuses ObjectDimensions.js\'s circumferenceMm() -- no duplicated geometry', () => {
  assert.ok(appJs.includes("import { circumferenceMm, frontViewFrameWidthMm, canvasXMmForRotationDeg, rotationDegForCanvasXMm, azimuthRadForCanvasXMm, wrapAngleRad } from './src/preview3d/ObjectDimensions.js';"));
  const fn = extractBlock(appJs, /function printableCircumferenceMm\(\)\{[\s\S]*?\n\}/, 'function printableCircumferenceMm()');
  assert.match(fn, /circumferenceMm\(project\.canvas\.width\)/);
});

await test('B4. the too-long warning\'s detail message describes a real manufacturing limitation (generated width vs. printable circumference) and never mentions wrap mode/viewing angle as the cause', () => {
  const fn = extractBlock(appJs, /function textTooLongDetailMessage\([^)]*\)\{[\s\S]*?\n\}/, 'function textTooLongDetailMessage()');
  assert.match(fn, /getLayerBBox\(l\)/);
  assert.match(fn, /printableCircumferenceMm\(\)/);
  assert.ok(!/wrap mode|project\.wrap/i.test(fn), 'expected the too-long message to never blame wrap mode/the current viewing angle as the cause (mentioning that the design gets "wrapped... around the object" physically is fine and expected)');
});

await test('B5. index.html\'s too-long warning copy describes the printable circumference, not legibility/viewing angle, in both the Inspector and the Text Lightbox', () => {
  assert.match(indexHtml, /id="workspaceTextTooLongWarning"[\s\S]{0,80}This text exceeds the object's printable circumference\./);
  assert.match(indexHtml, /<p class="validation-message" id="textTooLongWarning" role="status">This text exceeds the object's printable circumference\.<\/p>/);
});

await test('B8. drawFrontViewFrame() is wired into drawLayout() so the frame is always drawn alongside the production layout', () => {
  const drawLayoutFn = extractBlock(appJs, /function drawLayout\(\)\{[\s\S]*?\n\}/, 'function drawLayout()');
  assert.match(drawLayoutFn, /drawFrontViewFrame\(ctx,s,ox,oy,dpr\)/);
});

await test('B9. the frame\'s geometry (frontViewFrameGeometry()) reuses canvasXMmForRotationDeg()/frontViewFrameWidthMm() from ObjectDimensions.js -- the same mm-accurate mapping the object mesh\'s own texture UV uses, so the 2D canvas and Object Preview cannot disagree', () => {
  const fn = extractBlock(appJs, /function frontViewFrameGeometry\(\)\{[\s\S]*?\n\}/, 'function frontViewFrameGeometry()');
  assert.match(fn, /frontViewFrameWidthMm\(project\.wrap,canvasWidthMm\)/);
  assert.match(fn, /canvasXMmForRotationDeg\(rotation,canvasWidthMm\)/);
});

await test('B10. the frame wraps continuously across the canvas\'s left/right edges (requirement 3): drawFrontViewFrame() splits into on-canvas segments modulo canvasWidthMm instead of clipping', () => {
  const fn = extractBlock(appJs, /function drawFrontViewFrame\([^)]*\)\{[\s\S]*?\n\}/, 'function drawFrontViewFrame()');
  assert.match(fn, /%canvasWidthMm/);
  assert.match(fn, /segments\.push/);
});

await test('B11. the frame is visually distinct from the safe-area guide: a different color/fill (drawFrontViewFrame does not reuse drawSafeAreaGuide\'s blue dashed style) and shows its width in millimeters', () => {
  const safeAreaFn = extractBlock(appJs, /function drawSafeAreaGuide\([^)]*\)\{[\s\S]*?\}/, 'function drawSafeAreaGuide()');
  const frameFn = extractBlock(appJs, /function drawFrontViewFrame\([^)]*\)\{[\s\S]*?\n\}/, 'function drawFrontViewFrame()');
  assert.match(safeAreaFn, /rgba\(20,120,255/); // blue, dashed
  assert.match(frameFn, /#ff8c00/); // amber/orange, distinct color
  assert.ok(!frameFn.includes('setLineDash([5'), 'expected a solid (not dashed) frame border, visually distinct from the safe-area guide');
  assert.match(frameFn, /frameWidthMm\.toFixed\(1\)\} mm/, 'expected the frame\'s width to be displayed in millimeters');
});

await test('B12. dragging the Front View Frame rotates the Object Preview (requirement 2), cheaply -- no engine.generate()/updateAll() on every pointermove tick', () => {
  const pointerdownFn = extractBlock(appJs, /layoutCanvas\.addEventListener\('pointerdown',e=>\{[\s\S]*?\n\}\);/, "the layoutCanvas 'pointerdown' handler");
  assert.match(pointerdownFn, /isPointerOnFrontViewFrame\(mm\)/);
  assert.match(pointerdownFn, /kind:'frontFrame'/);

  const pointermoveFn = extractBlock(appJs, /layoutCanvas\.addEventListener\('pointermove',e=>\{[\s\S]*?\n\}\);/, "the layoutCanvas 'pointermove' handler");
  const frameBranchMatch = pointermoveFn.match(/if\(drag\.kind==='frontFrame'\)\{[\s\S]*?\n {4}\}/);
  assert.ok(frameBranchMatch, "expected a drag.kind==='frontFrame' branch in the pointermove handler");
  const frameBranch = frameBranchMatch[0];
  assert.match(frameBranch, /rotationDegForCanvasXMm\(targetXmm,project\.canvas\.width\)/);
  assert.match(frameBranch, /preview3D\.syncView\(rotation,zoom\)/);
  assert.ok(!frameBranch.includes('updateAll'), 'expected the frame-drag branch to never call the full updateAll()/engine.generate() pipeline');
});

await test('B13. rotating the Object Preview moves the Front View Frame (requirement 2): preview3D.onAzimuthChange is wired to update `rotation` and redraw, cheaply -- no updateAll()', () => {
  const match = appJs.match(/preview3D\.onAzimuthChange=deg=>\{[\s\S]*?\n\};/);
  assert.ok(match, 'expected preview3D.onAzimuthChange to be assigned in app.js');
  const handler = match[0];
  assert.match(handler, /rotation=deg;/);
  assert.match(handler, /drawLayout\(\);/);
  assert.ok(!handler.includes('updateAll'), 'expected the live-orbit sync handler to never call the full updateAll() pipeline');
});

await test('B14. Preview3DRenderer.js exposes the live camera azimuth via an OrbitControls \'change\' listener (onAzimuthChange) AND update() no longer accepts/uses a `wrap` option -- the object mesh\'s UV is wrap-mode independent, so update() has nothing wrap-related left to apply', async () => {
  const source = await readFile(path.join(repoRoot, 'src/preview3d/Preview3DRenderer.js'), 'utf8');
  assert.match(source, /this\.controls\.addEventListener\('change'/);
  assert.match(source, /onAzimuthChange/);
  const updateFn = source.match(/update\(stoneLayout, \{[^}]*\}\) \{[\s\S]*?\n {2}\}/);
  assert.ok(updateFn, 'expected to find Preview3DRenderer.update()');
  assert.ok(!/\bwrap\b/.test(updateFn[0].split('\n')[0]), 'expected update()\'s destructured options to no longer include wrap');
  assert.ok(!source.includes('_applyWrapUv'), 'expected no remaining _applyWrapUv call site');
});

await test('B15. ObjectGeometryBuilder.js\'s object mesh texture maps the complete production canvas around the object\'s true, wrap-mode-independent circumference -- applyWrapUv() no longer exists; applyAzimuthUv() is called once at mesh-build time', async () => {
  const source = await readFile(path.join(repoRoot, 'src/preview3d/ObjectGeometryBuilder.js'), 'utf8');
  assert.ok(!source.includes('applyWrapUv'), 'expected applyWrapUv() to no longer exist');
  assert.match(source, /applyAzimuthUv\(bodyGeometry\)/, 'expected applyAzimuthUv() to be called once inside buildObjectMesh()');
  assert.match(source, /0\.5 \+ azimuth \/ \(2 \* Math\.PI\)/, 'expected the true circumference scale formula');
});

await test('B15b. applyAzimuthUv() computes azimuth from each vertex\'s known Lathe column index, not from Math.atan2(position) -- regression guard for the dark-vertical-band defect (atan2\'s branch cut and the r=0 apex\'s signed-zero quirk both used to land on real, connected faces)', async () => {
  const source = await readFile(path.join(repoRoot, 'src/preview3d/ObjectGeometryBuilder.js'), 'utf8');
  const fnMatch = source.match(/function applyAzimuthUv\([^)]*\)\{[\s\S]*?\n\}/) || source.match(/function applyAzimuthUv\([^)]*\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find applyAzimuthUv() in ObjectGeometryBuilder.js');
  assert.ok(!fnMatch[0].includes('Math.atan2'), 'expected applyAzimuthUv() to no longer derive azimuth from Math.atan2(position)');
  assert.match(fnMatch[0], /Math\.floor\(i \/ rowCount\)/);
});

await test('B15c. buildTaperedBodyGeometry()/buildBottleGeometry() build their LatheGeometry with phiStart=-PI -- moves LatheGeometry\'s own unconnected seam to the back (opposite front), where applyAzimuthUv()\'s column-based azimuth also wraps, so no real face ever spans the one unavoidable discontinuity', async () => {
  const source = await readFile(path.join(repoRoot, 'src/preview3d/ObjectGeometryBuilder.js'), 'utf8');
  const matches = source.match(/new THREE\.LatheGeometry\(points, LATHE_SEGMENTS, -Math\.PI, Math\.PI \* 2\)/g) || [];
  assert.equal(matches.length, 2, 'expected both buildTaperedBodyGeometry() and buildBottleGeometry() to use phiStart=-PI, phiLength=2*PI');
});

await test('B16. the too-long warning\'s Inspector panel copy has no misleading "Center Text"/wrap-mode-change affordance -- centering or changing wrap never fixes a genuine circumference overflow', () => {
  const blockMatch = indexHtml.match(/<div class="validation-message" id="workspaceTextTooLongWarning"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(blockMatch, 'expected #workspaceTextTooLongWarning in index.html');
  assert.ok(!blockMatch[0].includes('workspaceCenterTextBtn'), 'the too-long warning must not offer Center Text');
});

// --- Behavioral checks — computeAutoFitScale() (Part 1, predates the Front View Frame, unchanged) ---

const project = { canvas: { width: 210, height: 90 } };

await test('B17. autoFit off never rescales', () => {
  const layer = { autoFit: false, height: 25, stoneSize: 2, gap: 0.3 };
  const { scale } = computeAutoFitScale(layer, project, 1000);
  assert.equal(scale, 1);
});

await test('B18. text that already fits (widthMm <= maxWidth) is never rescaled -- short/medium text is untouched', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  assert.deepEqual(computeAutoFitScale(layer, project, 150), { scale: 1 });
  assert.deepEqual(computeAutoFitScale(layer, project, 200), { scale: 1 }); // exactly at the boundary (maxWidth = 210-10)
});

await test('B19. mild overflow rescales exactly as before (fit-to-width, unaffected by the legibility floor)', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  const { scale } = computeAutoFitScale(layer, project, 250);
  assert.ok(Math.abs(scale - 0.8) < 1e-9, `expected the fit-to-width scale 0.8, got ${scale}`);
});

await test('B20. severe overflow still clamps to the 6x legibility floor instead of collapsing into illegible stone soup', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  const measuredWidthMm = 786.3;
  const fitScale = (project.canvas.width - 10) / measuredWidthMm;
  const { scale } = computeAutoFitScale(layer, project, measuredWidthMm);
  assert.ok(scale > fitScale, 'expected the floor to win over the old, more-aggressive fit-to-width shrink');
  const spacingMm = layer.stoneSize + layer.gap;
  const resultingHeightMm = layer.height * scale;
  assert.ok(resultingHeightMm / spacingMm >= 6 - 1e-9, 'expected the resulting height/spacing ratio to sit at the 6x legibility floor');
});

await test('B21. the floor never scales height up past the original nominal height', () => {
  const layer = { autoFit: true, height: 5, stoneSize: 2, gap: 0.3 };
  const { scale } = computeAutoFitScale(layer, project, 5000);
  assert.ok(scale <= 1, `expected scale to never exceed 1, got ${scale}`);
});

// --- Behavioral checks — the actual circumference/frame/rotation math (via ObjectDimensions.js, the
// single shared implementation both app.js and the object mesh's own UV mapping reuse) ---

await test('B22. a mug (210mm canvas) genuinely cannot fit text wider than 210mm around its printable circumference -- a real manufacturing limit, not a viewing-window artifact', () => {
  const circumference = circumferenceMm(210);
  assert.ok(Math.abs(circumference - 210) < 1e-9);
  assert.ok(529.6 > circumference, 'the reported 67-character phrase (529.6mm at the legibility floor) genuinely exceeds a 210mm-canvas mug\'s circumference');
});

await test('B23. the same phrase fits a wider object\'s circumference once the object (canvas width) is large enough -- "choose a wider object" is a real, working remedy', () => {
  const measuredWidthMm = 529.6;
  assert.ok(measuredWidthMm < circumferenceMm(600), 'expected a hypothetically much wider canvas to accommodate the phrase');
});

await test('B24. medium text ("Vitalina Serbin", 199.4mm raw) never triggers the too-long warning on any real object: on the mug/tumbler it fits under maxWidth outright (autoFit never engages, scale=1); on the narrower bottle autoFit\'s existing fit-to-maxWidth shrink (unchanged Part 1 behavior, no legibility floor needed at this length) already brings the resolved width under maxWidth, which is itself always < circumferenceMm', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  for (const canvasWidthMm of [210, 230, 180]) {
    const proj = { canvas: { width: canvasWidthMm, height: 90 } };
    const { scale } = computeAutoFitScale(layer, proj, 199.4);
    const resolvedWidthMm = 199.4 * scale;
    const maxWidth = canvasWidthMm - 10;
    assert.ok(resolvedWidthMm <= maxWidth + 1e-9, `expected resolved width <= maxWidth at canvasWidthMm=${canvasWidthMm}, got ${resolvedWidthMm} > ${maxWidth}`);
    assert.ok(maxWidth < circumferenceMm(canvasWidthMm), `expected maxWidth < circumference at canvasWidthMm=${canvasWidthMm}`);
    assert.ok(resolvedWidthMm < circumferenceMm(canvasWidthMm), `expected the resolved width to fit within the printable circumference at canvasWidthMm=${canvasWidthMm}`);
  }
});

await test('B25. isPointerOnFrontViewFrame()-equivalent angular hit-test: a point at the exact center of the current rotation is always inside the frame band for every wrap mode', () => {
  const canvasWidthMm = 210;
  for (const rotationDeg of [-170, -45, 0, 45, 170]) {
    const centerXmm = canvasXMmForRotationDeg(rotationDeg, canvasWidthMm);
    const az = azimuthRadForCanvasXMm(centerXmm, canvasWidthMm);
    const rotRad = (rotationDeg * Math.PI) / 180;
    let delta = az - rotRad;
    delta = ((delta % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    for (const wrap of ['front', 'wide', 'half', 'full']) {
      assert.ok(Math.abs(delta) <= wrapAngleRad(wrap) / 2 + 1e-9, `expected the frame's own center to be inside its own band for wrap=${wrap}`);
    }
  }
});

await test('B26. dragging the frame and rotating the Object Preview are exact inverses of each other (canvasXMmForRotationDeg <-> rotationDegForCanvasXMm) -- immediate, drift-free bidirectional sync', () => {
  const canvasWidthMm = 230;
  for (const rotationDeg of [-179, -90, 0, 45, 179]) {
    const xMm = canvasXMmForRotationDeg(rotationDeg, canvasWidthMm);
    const rotationBack = rotationDegForCanvasXMm(xMm, canvasWidthMm);
    assert.ok(Math.abs(rotationBack - rotationDeg) < 1e-6);
  }
});

await test('Z. this file is registered in test:integration and the default suite (via tools/test-groups.mjs + tools/run-tests.mjs, not a literal package.json chain)', () => {
  assertTestRegistered({
    filename: 'test-text-position-workflow.mjs',
    group: 'integration',
    includedInDefault: true,
  });
});

console.log('Text Position Workflow (drag/recovery, printable-area, Front View Frame) tests passed.');
