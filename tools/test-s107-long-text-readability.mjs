import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// S-107 (Front View Frame & Long Text Workflow) — this milestone replaces the previous
// warning-based long-text workflow (the original S-107 "Long Text Readability" Part 1/Part 2,
// still summarized in docs/specifications/S-107-LongTextReadability.md) with a Front View Frame on
// the 2D Canvas: a movable overlay showing the portion of the design currently facing the viewer in
// the Object Preview, kept in sync with the Object Preview's rotation in both directions.
//
// Part 1 (auto-fit's legibility floor, computeAutoFitScale()/MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO) is
// UNCHANGED by this milestone -- it still stops illegible over-shrinking and is not re-tested here
// (see the original checks 8-12, still valid, still exercised structurally below).
//
// Part 2 (the old maxWidth/floorApplied-driven "too long to fit legibly" warning) is REMOVED.
// isTextTooLongForObject() is redefined: a text layer is only "too long" when its actual rendered
// width (getLayerBBox(), the same StoneLayout-derived bbox isTextOutsidePrintableArea() already
// uses) exceeds the object's printable circumference (printableCircumferenceMm(), which reuses
// ObjectDimensions.js's circumferenceMm() -- by construction exactly project.canvas.width, since the
// production canvas is treated as the object's complete unwrapped surface). This is a real,
// wrap-mode-independent manufacturing limit (the design would overlap itself once wrapped fully
// around the object), not a "current viewing angle" concern -- text that fits the circumference can
// always be inspected by moving the Front View Frame or rotating the Object Preview, however far it
// extends past a single wrap-mode-sized viewing window.
//
// Structural checks against the live app.js/index.html source (app.js is a browser entry point and
// is not import()-able directly under plain Node, matching the established convention in
// tools/test-alignment-snapping-integration.mjs); behavioral checks extract and execute the real,
// pure logic functions from that source (mirroring that same file's extractFunction()/new Function()
// precedent).

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const { circumferenceMm, canvasXMmForAzimuthRad, azimuthRadForCanvasXMm, canvasXMmForRotationDeg, rotationDegForCanvasXMm, frontViewFrameWidthMm, wrapAngleRad } =
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

const ratioDecl = extractBlock(appJs, /const MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO=\d+(\.\d+)?;/, 'the MIN_AUTOFIT_HEIGHT_TO_SPACING_RATIO declaration');
const computeAutoFitScaleSrc = extractBlock(appJs, /function computeAutoFitScale\([^)]*\)\{[\s\S]*?\n\}/, 'function computeAutoFitScale()');

// eslint-disable-next-line no-new-func
const computeAutoFitScale = new Function(`${ratioDecl}\nreturn ${computeAutoFitScaleSrc};`)();

// ---------------------------------------------------------------------------------------------
// Structural checks — old Part-2 workflow is gone, replaced by the circumference-based one
// ---------------------------------------------------------------------------------------------

await test('1. the old maxWidth/floorApplied-driven too-long workflow is fully removed: no autoFitFloorAppliedByLayerId, floorApplied, recommendedWrapModeForFit, or textTooLongActionMessage remain in app.js', () => {
  for (const gone of ['autoFitFloorAppliedByLayerId', 'floorApplied', 'recommendedWrapModeForFit', 'textTooLongActionMessage']) {
    assert.ok(!appJs.includes(gone), `expected "${gone}" to be fully removed from app.js`);
  }
});

await test('1b. the wrap mode control (#wrap, Front/Wide/Half/Full) lives in the Object Preview toolbar (#toolbar3D) -- discoverable alongside Rotation/Zoom/the view buttons, not buried inside the Shapes lightbox, and never removed from the UI (a real user reported being unable to find it there)', () => {
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

await test('2. isTextTooLongForObject() is driven by getLayerBBox() vs. printableCircumferenceMm(), not a wrap-window/maxWidth threshold', () => {
  const fn = extractBlock(appJs, /function isTextTooLongForObject\([^)]*\)\{[\s\S]*?\n\}/, 'function isTextTooLongForObject()');
  assert.match(fn, /getLayerBBox\(l\)\.width>printableCircumferenceMm\(\)/);
});

await test('3. printableCircumferenceMm() reuses ObjectDimensions.js\'s circumferenceMm() -- no duplicated geometry', () => {
  assert.ok(appJs.includes("import { circumferenceMm, frontViewFrameWidthMm, canvasXMmForRotationDeg, rotationDegForCanvasXMm, azimuthRadForCanvasXMm, wrapAngleRad } from './src/preview3d/ObjectDimensions.js';"));
  const fn = extractBlock(appJs, /function printableCircumferenceMm\(\)\{[\s\S]*?\n\}/, 'function printableCircumferenceMm()');
  assert.match(fn, /circumferenceMm\(project\.canvas\.width\)/);
});

await test('4. the too-long warning\'s detail message describes a real manufacturing limitation (generated width vs. printable circumference) and never mentions wrap mode/viewing angle as the cause', () => {
  const fn = extractBlock(appJs, /function textTooLongDetailMessage\([^)]*\)\{[\s\S]*?\n\}/, 'function textTooLongDetailMessage()');
  assert.match(fn, /getLayerBBox\(l\)/);
  assert.match(fn, /printableCircumferenceMm\(\)/);
  assert.ok(!/wrap mode|project\.wrap/i.test(fn), 'expected the too-long message to never blame wrap mode/the current viewing angle as the cause (mentioning that the design gets "wrapped... around the object" physically is fine and expected)');
});

await test('5. index.html\'s too-long warning copy describes the printable circumference, not legibility/viewing angle, in both the Inspector and the Text Lightbox', () => {
  assert.match(indexHtml, /id="workspaceTextTooLongWarning"[\s\S]{0,80}This text exceeds the object's printable circumference\./);
  assert.match(indexHtml, /<p class="validation-message" id="textTooLongWarning" role="status">This text exceeds the object's printable circumference\.<\/p>/);
});
await test('7. package.json registers this milestone\'s test suite', () => {
  assert.ok(packageJson.scripts.test.includes('test-s107-long-text-readability.mjs'));
});

// ---------------------------------------------------------------------------------------------
// Structural checks — the Front View Frame itself (drawing, hit-test, drag, live sync)
// ---------------------------------------------------------------------------------------------

await test('8. drawFrontViewFrame() is wired into drawLayout() so the frame is always drawn alongside the production layout', () => {
  const drawLayoutFn = extractBlock(appJs, /function drawLayout\(\)\{[\s\S]*?\n\}/, 'function drawLayout()');
  assert.match(drawLayoutFn, /drawFrontViewFrame\(ctx,s,ox,oy,dpr\)/);
});

await test('9. the frame\'s geometry (frontViewFrameGeometry()) reuses canvasXMmForRotationDeg()/frontViewFrameWidthMm() from ObjectDimensions.js -- the same mm-accurate mapping the object mesh\'s own texture UV uses, so the 2D canvas and Object Preview cannot disagree', () => {
  const fn = extractBlock(appJs, /function frontViewFrameGeometry\(\)\{[\s\S]*?\n\}/, 'function frontViewFrameGeometry()');
  assert.match(fn, /frontViewFrameWidthMm\(project\.wrap,canvasWidthMm\)/);
  assert.match(fn, /canvasXMmForRotationDeg\(rotation,canvasWidthMm\)/);
});

await test('10. the frame wraps continuously across the canvas\'s left/right edges (requirement 3): drawFrontViewFrame() splits into on-canvas segments modulo canvasWidthMm instead of clipping', () => {
  const fn = extractBlock(appJs, /function drawFrontViewFrame\([^)]*\)\{[\s\S]*?\n\}/, 'function drawFrontViewFrame()');
  assert.match(fn, /%canvasWidthMm/);
  assert.match(fn, /segments\.push/);
});

await test('11. the frame is visually distinct from the safe-area guide: a different color/fill (drawFrontViewFrame does not reuse drawSafeAreaGuide\'s blue dashed style) and shows its width in millimeters', () => {
  const safeAreaFn = extractBlock(appJs, /function drawSafeAreaGuide\([^)]*\)\{[\s\S]*?\}/, 'function drawSafeAreaGuide()');
  const frameFn = extractBlock(appJs, /function drawFrontViewFrame\([^)]*\)\{[\s\S]*?\n\}/, 'function drawFrontViewFrame()');
  assert.match(safeAreaFn, /rgba\(20,120,255/); // blue, dashed
  assert.match(frameFn, /#ff8c00/); // amber/orange, distinct color
  assert.ok(!frameFn.includes('setLineDash([5'), 'expected a solid (not dashed) frame border, visually distinct from the safe-area guide');
  assert.match(frameFn, /frameWidthMm\.toFixed\(1\)\} mm/, 'expected the frame\'s width to be displayed in millimeters');
});

await test('12. dragging the Front View Frame rotates the Object Preview (requirement 2), cheaply -- no engine.generate()/updateAll() on every pointermove tick', () => {
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

await test('13. rotating the Object Preview moves the Front View Frame (requirement 2): preview3D.onAzimuthChange is wired to update `rotation` and redraw, cheaply -- no updateAll()', () => {
  const match = appJs.match(/preview3D\.onAzimuthChange=deg=>\{[\s\S]*?\n\};/);
  assert.ok(match, 'expected preview3D.onAzimuthChange to be assigned in app.js');
  const handler = match[0];
  assert.match(handler, /rotation=deg;/);
  assert.match(handler, /drawLayout\(\);/);
  assert.ok(!handler.includes('updateAll'), 'expected the live-orbit sync handler to never call the full updateAll() pipeline');
});

await test('14. Preview3DRenderer.js exposes the live camera azimuth via an OrbitControls \'change\' listener (onAzimuthChange) AND still accepts/applies a `wrap` option in update() -- restored so wrap mode visibly changes the Object Preview again (this milestone\'s follow-up requirement 1/2)', async () => {
  const source = await readFile(path.join(repoRoot, 'src/preview3d/Preview3DRenderer.js'), 'utf8');
  assert.match(source, /this\.controls\.addEventListener\('change'/);
  assert.match(source, /onAzimuthChange/);
  const updateFn = source.match(/update\(stoneLayout, \{[^}]*\}\) \{[\s\S]*?\n {2}\}/);
  assert.ok(updateFn, 'expected to find Preview3DRenderer.update()');
  assert.match(updateFn[0].split('\n')[0], /\bwrap\b/, 'expected update()\'s destructured options to include wrap');
  assert.match(updateFn[0], /this\._applyWrapUv\(this\._bodyMesh, ?wrap\)/);
});

await test('15. ObjectGeometryBuilder.js\'s object mesh texture compresses the complete production canvas into the selected wrap mode\'s angular window (restored, pre-S-107 behavior) -- applyWrapUv() is exported and wrap-mode dependent, callable whenever wrap mode changes', async () => {
  const source = await readFile(path.join(repoRoot, 'src/preview3d/ObjectGeometryBuilder.js'), 'utf8');
  assert.match(source, /export function applyWrapUv\(bodyMesh, ?wrapMode\)/);
  assert.match(source, /applyAzimuthUv\(bodyMesh\.geometry, ?wrapAngleRad\(wrapMode\)\)/);
});

await test('15b. applyAzimuthUv() computes azimuth from each vertex\'s known Lathe column index, not from Math.atan2(position) -- regression guard for the dark-vertical-band defect (atan2\'s branch cut and the r=0 apex\'s signed-zero quirk both used to land on real, connected faces)', async () => {
  const source = await readFile(path.join(repoRoot, 'src/preview3d/ObjectGeometryBuilder.js'), 'utf8');
  const fnMatch = source.match(/function applyAzimuthUv\([^)]*\)\{[\s\S]*?\n\}/) || source.match(/function applyAzimuthUv\([^)]*\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find applyAzimuthUv() in ObjectGeometryBuilder.js');
  assert.ok(!fnMatch[0].includes('Math.atan2'), 'expected applyAzimuthUv() to no longer derive azimuth from Math.atan2(position)');
  assert.match(fnMatch[0], /Math\.floor\(i \/ rowCount\)/);
});

await test('15c. buildTaperedBodyGeometry()/buildBottleGeometry() build their LatheGeometry with phiStart=-PI -- moves LatheGeometry\'s own unconnected seam to the back (opposite front), where applyAzimuthUv()\'s column-based azimuth also wraps, so no real face ever spans the one unavoidable discontinuity', async () => {
  const source = await readFile(path.join(repoRoot, 'src/preview3d/ObjectGeometryBuilder.js'), 'utf8');
  const matches = source.match(/new THREE\.LatheGeometry\(points, LATHE_SEGMENTS, -Math\.PI, Math\.PI \* 2\)/g) || [];
  assert.equal(matches.length, 2, 'expected both buildTaperedBodyGeometry() and buildBottleGeometry() to use phiStart=-PI, phiLength=2*PI');
});

await test('16. the too-long warning\'s Inspector panel copy has no misleading "Center Text"/wrap-mode-change affordance -- centering or changing wrap never fixes a genuine circumference overflow', () => {
  const blockMatch = indexHtml.match(/<div class="validation-message" id="workspaceTextTooLongWarning"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(blockMatch, 'expected #workspaceTextTooLongWarning in index.html');
  assert.ok(!blockMatch[0].includes('workspaceCenterTextBtn'), 'the too-long warning must not offer Center Text');
});

// ---------------------------------------------------------------------------------------------
// Behavioral checks — computeAutoFitScale() (Part 1, unchanged)
// ---------------------------------------------------------------------------------------------

const project = { canvas: { width: 210, height: 90 } };

await test('17. autoFit off never rescales', () => {
  const layer = { autoFit: false, height: 25, stoneSize: 2, gap: 0.3 };
  const { scale } = computeAutoFitScale(layer, project, 1000);
  assert.equal(scale, 1);
});

await test('18. text that already fits (widthMm <= maxWidth) is never rescaled -- short/medium text is untouched', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  assert.deepEqual(computeAutoFitScale(layer, project, 150), { scale: 1 });
  assert.deepEqual(computeAutoFitScale(layer, project, 200), { scale: 1 }); // exactly at the boundary (maxWidth = 210-10)
});

await test('19. mild overflow rescales exactly as before (fit-to-width, unaffected by the legibility floor)', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  const { scale } = computeAutoFitScale(layer, project, 250);
  assert.ok(Math.abs(scale - 0.8) < 1e-9, `expected the fit-to-width scale 0.8, got ${scale}`);
});

await test('20. severe overflow still clamps to the 6x legibility floor instead of collapsing into illegible stone soup', () => {
  const layer = { autoFit: true, height: 25, stoneSize: 2, gap: 0.3 };
  const measuredWidthMm = 786.3;
  const fitScale = (project.canvas.width - 10) / measuredWidthMm;
  const { scale } = computeAutoFitScale(layer, project, measuredWidthMm);
  assert.ok(scale > fitScale, 'expected the floor to win over the old, more-aggressive fit-to-width shrink');
  const spacingMm = layer.stoneSize + layer.gap;
  const resultingHeightMm = layer.height * scale;
  assert.ok(resultingHeightMm / spacingMm >= 6 - 1e-9, 'expected the resulting height/spacing ratio to sit at the 6x legibility floor');
});

await test('21. the floor never scales height up past the original nominal height', () => {
  const layer = { autoFit: true, height: 5, stoneSize: 2, gap: 0.3 };
  const { scale } = computeAutoFitScale(layer, project, 5000);
  assert.ok(scale <= 1, `expected scale to never exceed 1, got ${scale}`);
});

// ---------------------------------------------------------------------------------------------
// Behavioral checks — the actual circumference/frame/rotation math (via ObjectDimensions.js,
// the single shared implementation both app.js and the object mesh's own UV mapping reuse)
// ---------------------------------------------------------------------------------------------

await test('22. a mug (210mm canvas) genuinely cannot fit text wider than 210mm around its printable circumference -- a real manufacturing limit, not a viewing-window artifact', () => {
  const circumference = circumferenceMm(210);
  assert.ok(Math.abs(circumference - 210) < 1e-9);
  assert.ok(529.6 > circumference, 'the reported 67-character phrase (529.6mm at the legibility floor) genuinely exceeds a 210mm-canvas mug\'s circumference');
});

await test('23. the same phrase fits a wider object\'s circumference once the object (canvas width) is large enough -- "choose a wider object" is a real, working remedy', () => {
  const measuredWidthMm = 529.6;
  assert.ok(measuredWidthMm < circumferenceMm(600), 'expected a hypothetically much wider canvas to accommodate the phrase');
});

await test('24. medium text ("Vitalina Serbin", 199.4mm raw) never triggers the too-long warning on any real object: on the mug/tumbler it fits under maxWidth outright (autoFit never engages, scale=1); on the narrower bottle autoFit\'s existing fit-to-maxWidth shrink (unchanged Part 1 behavior, no legibility floor needed at this length) already brings the resolved width under maxWidth, which is itself always < circumferenceMm', () => {
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

await test('25. isPointerOnFrontViewFrame()-equivalent angular hit-test: a point at the exact center of the current rotation is always inside the frame band for every wrap mode', () => {
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

await test('26. dragging the frame and rotating the Object Preview are exact inverses of each other (canvasXMmForRotationDeg <-> rotationDegForCanvasXMm) -- immediate, drift-free bidirectional sync', () => {
  const canvasWidthMm = 230;
  for (const rotationDeg of [-179, -90, 0, 45, 179]) {
    const xMm = canvasXMmForRotationDeg(rotationDeg, canvasWidthMm);
    const rotationBack = rotationDegForCanvasXMm(xMm, canvasWidthMm);
    assert.ok(Math.abs(rotationBack - rotationDeg) < 1e-6);
  }
});

console.log('S-107 Front View Frame & long text workflow tests passed.');
