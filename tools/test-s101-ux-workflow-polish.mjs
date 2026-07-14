import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// S-101 (UX & Workflow Polish) -- verifies the four small, high-value workflow fixes from the
// RS-2000A post-MVP audit:
//   1. The Shapes lightbox is non-modal so its own Boolean Ops hint ("select layers on the canvas,
//      or in the Layers list") is actually followable while the dialog stays open.
//   2. Curved text defaults to a 180 deg arc, not a closed 360 deg circle, on first enable.
//   3. The shared shape position/size fields use plain, non-technical wording (no raw SVG "CX"/"CY"
//      jargon) and adapt to the selected shape type (Radius for circles, no stray Height field).
//   4. Layer rows in the Layers list expose a native title tooltip with the full (possibly
//      truncated) layer name.
// Structural checks against the live index.html/app.js source, matching this repository's
// established convention (app.js is a browser entry point, not import()-able under plain Node).

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
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

// ---------- 1. Boolean Ops / non-modal Shapes lightbox ----------

await test('1. lightboxShapes overlay carries the non-modal modifier class and a click-through, transparent backdrop', () => {
  assert.match(indexHtml, /<div class="lightbox-overlay non-modal" id="lightboxShapes">/);
  assert.match(indexHtml, /\.lightbox-overlay\.non-modal\{background:transparent;pointer-events:none\}/);
  assert.match(indexHtml, /\.lightbox-overlay\.non-modal \.lightbox\{pointer-events:auto\}/);
});

await test('2. lightboxShapes\' own non-modal markup (the S-101 fix) is still present verbatim -- S-105 later generalized the same .non-modal treatment to the other 10 named Lightboxes (see tools/test-ui001-dialog-behavior.mjs test 13 and tools/test-s105-persistent-movable-lightboxes.mjs), so this test only re-confirms Shapes\' own markup was not regressed, not that it is still the sole exception', () => {
  assert.match(indexHtml, /<div class="lightbox-overlay non-modal" id="lightboxShapes">/, 'expected #lightboxShapes to still carry the non-modal overlay class');
  assert.match(indexHtml, /<div class="lightbox wide" role="dialog" aria-modal="false" aria-labelledby="lightboxShapesTitle"/, 'expected #lightboxShapes\' dialog to still declare aria-modal="false"');
});

await test('3. the Boolean Ops hint text still matches the now-functional workflow (select via canvas or Layers list)', () => {
  assert.match(indexHtml, /id="booleanOpsHint">Select two or more layers \(Shift-click on the canvas, or in the Layers list\)/);
});

// ---------- 2. Curved text default arc, not a closed circle ----------

await test('4. defaultProject()\'s text layer defaults curveSweepAngleDeg to 180 (a half-circle arc), not 360 (a closed circle)', () => {
  const match = appJs.match(/function defaultProject\(\)\{return\{[\s\S]*?\}\}\n/);
  assert.ok(match, 'expected to find defaultProject()');
  assert.ok(match[0].includes('curveSweepAngleDeg:180'), 'expected the default text layer to set curveSweepAngleDeg:180');
  assert.ok(!match[0].includes('curveSweepAngleDeg:360'), 'defaultProject() must not default to a closed 360deg circle');
});

await test('5. syncSelectedControlsFromLayer()\'s fallback for a missing curveSweepAngleDeg is 180, matching the new default (only affects layers that never had the field set -- existing saved projects keep whatever explicit value they already stored)', () => {
  assert.match(appJs, /el\('curveSweepAngleDeg'\)\.value=l\.curveSweepAngleDeg\?\?180/);
});

await test('6. writeSelectedControlsToLayer()\'s parse-failure fallback for curveSweepAngleDeg is 180, matching the new default', () => {
  assert.match(appJs, /l\.curveSweepAngleDeg=parseFloat\(el\('curveSweepAngleDeg'\)\.value\)\|\|180/);
});

await test('7. index.html\'s curveSweepAngleDeg input pre-fills 180, and a hint explains what raising it toward 360 does', () => {
  assert.match(indexHtml, /<label for="curveSweepAngleDeg">Sweep angle \(deg\)<\/label><input id="curveSweepAngleDeg" type="number" step="1" value="180">/);
  assert.match(indexHtml, /180° arcs the text halfway around the curve, like a banner\. Raise it toward 360° to wrap text into a closed circle\./);
});

// ---------- 3. Shape field terminology ----------

await test('8. shape X/Y position labels use plain wording, not raw SVG-attribute jargon (CX/CY)', () => {
  assert.match(indexHtml, /<label for="shapeX">X \(mm\)<\/label>/);
  assert.match(indexHtml, /<label for="shapeY">Y \(mm\)<\/label>/);
  assert.ok(!indexHtml.includes('X / CX'), 'must not expose raw "CX" SVG jargon to the user');
  assert.ok(!indexHtml.includes('Y / CY'), 'must not expose raw "CY" SVG jargon to the user');
});

await test('9. the shared Width/Radius label has a stable id so it can be retitled per shape type, and the Height field has a wrapper id so it can be hidden for circles (which have no independent height)', () => {
  assert.match(indexHtml, /<label for="shapeW" id="shapeWLabel">Width \(mm\)<\/label>/);
  assert.match(indexHtml, /<div class="field" id="shapeHField"><label for="shapeH">Height \(mm\)<\/label>/);
});

await test('10. syncSelectedControlsFromLayer() retitles shapeWLabel to "Radius (mm)" and hides shapeHField for circles, and restores "Width (mm)"/visible for every other shape type', () => {
  assert.match(appJs, /el\('shapeWLabel'\)\.textContent=l\.type==='circle'\?'Radius \(mm\)':'Width \(mm\)';el\('shapeHField'\)\.style\.display=l\.type==='circle'\?'none':''/);
});

// ---------- 4. Layer list name tooltip ----------

await test('11. each Layers-list row exposes the full layer name as a native title tooltip (helps when the visible name is truncated by CSS ellipsis)', () => {
  assert.match(appJs, /<div class="name" data-action="select" title="\$\{escapeHtml\(layerLabel\(l\)\)\}">\$\{escapeHtml\(layerLabel\(l\)\)\}<\/div>/);
});

console.log('S-101 UX & Workflow Polish tests passed.');
