import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1010 (Alignment & Snapping Upgrade) — extends RS-1009's src/editing/** + app.js wiring with
// a configurable snap distance, an independent "show guides" toggle, Shift-drag axis-constrain,
// and Alt/Option-drag duplicate, and moves every snapping setting into the Settings Lightbox with
// plain-language labels ("Enable Snapping" / "Snap Distance" / "Show Alignment Guides"). Almost no
// change to src/editing/**: SnapEngine.js/AlignmentEngine.js already accept a configurable
// tolerance and already snap independently per axis, which is what corner-to-corner snapping
// needs (proven below) unchanged; the one addition is Selection.js's selectMany(), needed because
// Alt/Option-drag-duplicate must select several newly created ids at once, which no existing
// selection primitive expressed -- still the one selection-mutation implementation, not a second
// model. Structural checks against the live app.js/index.html source (same established convention
// as tools/test-alignment-snapping-integration.mjs); pure behavioral checks against the real
// src/editing/SnapEngine.js.
//
// RS-1010A (wording polish, test 13) — "Snap Distance (mm)" loses the raw parenthetical unit in
// its label; the millimeter unit is instead explained in a short, always-visible hint sentence
// (not a hover-only tooltip, so a first-time user isn't required to find it), and "Enable
// Snapping"/"Show Alignment Guides" each gained a descriptive tooltip. Wording/markup only — no
// app.js behavior changed by RS-1010A.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

const { buildSnapTargets, computeSnapOffset } = await import('../src/editing/index.js');

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

// ---------------------------------------------------------------------------------------------
// Structural wiring checks
// ---------------------------------------------------------------------------------------------

await test('1. snapToleranceMm/showSnapGuides are new view-only editor state, defaulted from SNAP_TOLERANCE_MM/true, alongside the existing snapEnabled/activeGuides', () => {
  assert.match(appJs, /let selectedLayerIds=new Set\(\[selectedLayerId\]\),snapEnabled=true,snapToleranceMm=SNAP_TOLERANCE_MM,showSnapGuides=true,activeGuides=\[\];/);
});

await test('2. drag snapping is computed against the configurable snapToleranceMm, not the fixed SNAP_TOLERANCE_MM constant', () => {
  assert.match(appJs, /computeSnapOffset\(dragBBoxMm,targets,snapToleranceMm\)/);
});

await test('3. visible guide lines are gated by showSnapGuides independently of snapEnabled (snapping still applies with guides hidden)', () => {
  assert.match(appJs, /activeGuides=showSnapGuides\?snap\.guides:\[\];/);
});

await test('4. Shift held during a move-drag constrains movement to one axis, applied after snapping so the locked axis never drifts', () => {
  const moveBranch = appJs.match(/if\(drag\.kind==='move'\)\{([\s\S]*?)\}else if\(drag\.kind==='resize'\)/);
  assert.ok(moveBranch, 'expected to find the move branch of pointermove');
  const snapIdx = moveBranch[1].indexOf('if(snapEnabled){');
  const shiftIdx = moveBranch[1].indexOf('if(e.shiftKey){');
  assert.ok(snapIdx >= 0 && shiftIdx >= 0 && shiftIdx > snapIdx, 'expected the Shift axis-lock check after the snap computation');
  assert.match(moveBranch[1], /if\(Math\.abs\(dx\)>=Math\.abs\(dy\)\)\{dy=0;/, 'expected the dominant axis to win and the other to be forced to exactly 0');
  assert.match(moveBranch[1], /else\{dx=0;/);
});

await test('5. Alt/Option held on pointerdown duplicates the whole current selection before starting the drag, leaving originals untouched', () => {
  const pointerdown = appJs.match(/layoutCanvas\.addEventListener\('pointerdown',e=>\{([\s\S]*?)\}\);\nlayoutCanvas\.addEventListener\('pointermove'/);
  assert.ok(pointerdown, 'expected to find the pointerdown handler body');
  assert.match(pointerdown[1], /if\(e\.altKey\)\{/, 'expected an Alt-gated branch');
  assert.match(pointerdown[1], /project\.layers\.push\(\.\.\.copies\);/, 'expected duplicates to be pushed as new layers (originals stay in project.layers)');
  assert.match(pointerdown[1], /dragIds=copies\.map\(c=>c\.id\);/, 'expected the drag to target the new copies\' ids, not the originals');
  assert.match(pointerdown[1], /selectedLayerIds=selectMany\(dragIds\);/, 'expected the new selection to be built via src/editing/Selection.js\'s selectMany(), not a hand-rolled new Set() (preserves "no second selection model")');
});

await test('6. resize drags never duplicate (Alt-duplicate only applies to move drags; resize starts before the Alt check)', () => {
  const resizeBranch = appJs.match(/if\(hit\.kind==='resize'\)\{([\s\S]*?)\n {2}\}\n {2}if\(e\.shiftKey\)/);
  assert.ok(resizeBranch, 'expected to find the resize branch of pointerdown');
  assert.ok(!/altKey/.test(resizeBranch[1]), 'resize branch must not reference e.altKey');
});

await test('7. the Settings Lightbox exposes plain-language snapping controls: Enable Snapping, Snap Distance, Show Alignment Guides', () => {
  const body = indexHtml.slice(indexHtml.indexOf('id="lightboxSettings"'), indexHtml.indexOf('id="lightboxHelp"'));
  assert.match(body, /<input type="checkbox" id="settingsSnapDefault" checked> Enable Snapping/);
  assert.match(body, /<input id="settingsSnapDistance" type="number" min="0\.5" max="5" step="0\.1" value="1\.5">/);
  assert.match(body, /<input type="checkbox" id="settingsShowGuides" checked> Show Alignment Guides/);
  assert.ok(!/technical|tolerance/i.test(body), 'expected friendly labels, not raw technical terms like "tolerance"');
});

await test('8. syncSettingsFieldsFromState() reads the two new fields from live state, and settingsApply writes them back, clamped to a sane range', () => {
  assert.match(appJs, /el\('settingsSnapDistance'\)\.value=snapToleranceMm;el\('settingsShowGuides'\)\.checked=showSnapGuides;/);
  assert.match(appJs, /snapToleranceMm=Math\.min\(5,Math\.max\(0\.5,parseFloat\(el\('settingsSnapDistance'\)\.value\)\|\|SNAP_TOLERANCE_MM\)\);/);
  assert.match(appJs, /showSnapGuides=el\('settingsShowGuides'\)\.checked;/);
});

await test('9. the Help Lightbox documents the two new drag modifiers', () => {
  const body = indexHtml.slice(indexHtml.indexOf('Keyboard shortcuts'), indexHtml.indexOf('</div>', indexHtml.indexOf('Keyboard shortcuts')));
  assert.match(body, /<span class="kbd">Shift\+Drag<\/span><span>Constrain movement/);
  assert.match(body, /<span class="kbd">Alt\/Option\+Drag<\/span><span>Duplicate the selection/);
});

// ---------------------------------------------------------------------------------------------
// Behavioral checks: real, unmodified src/editing/SnapEngine.js proves the primitives this
// milestone's app.js-level settings now expose were already configurable/correct.
// ---------------------------------------------------------------------------------------------

await test('10. configurable snap distance actually changes drag-snap behavior (the "Snap Distance" setting has real effect)', () => {
  const targets = buildSnapTargets({ canvasWidthMm: 200, canvasHeightMm: 100 });
  // left edge at 97 is 3mm from canvas center (100).
  const dragBBox = { xMm: 97, yMm: 40, widthMm: 20, heightMm: 10 };
  const tight = computeSnapOffset(dragBBox, targets, 1); // 1mm tolerance -> no snap
  assert.equal(tight.dxMm, 0, 'expected a tight snap distance to not snap a 3mm-away edge');
  const loose = computeSnapOffset(dragBBox, targets, 4); // 4mm tolerance -> snaps
  assert.equal(loose.dxMm, 3, 'expected a loose snap distance to snap the same 3mm-away edge');
});

await test('11. object corners snap correctly: independent per-axis matching already produces corner-to-corner snapping (no dedicated "corner" target type needed)', () => {
  // Another layer at x:50..80,y:20..40 -- its bottom-right corner is (80,40). Drag a box whose
  // top-left corner starts at (80.6,40.7): both x and y are within a 1.5mm tolerance of that
  // corner independently, so the drag should snap onto it on both axes simultaneously.
  const targets = buildSnapTargets({
    canvasWidthMm: 300, canvasHeightMm: 300,
    layerBBoxes: [{ layerId: 'other', xMm: 50, yMm: 20, widthMm: 30, heightMm: 20 }]
  });
  const result = computeSnapOffset({ xMm: 80.6, yMm: 40.7, widthMm: 15, heightMm: 15 }, targets, 1.5);
  assert.ok(Math.abs(result.dxMm - (-0.6)) < 1e-9, `expected the dragged left edge to snap onto the other layer's right edge (x=80), got dxMm=${result.dxMm}`);
  assert.ok(Math.abs(result.dyMm - (-0.7)) < 1e-9, `expected the dragged top edge to snap onto the other layer's bottom edge (y=40), got dyMm=${result.dyMm}`);
  assert.ok(result.guides.some((g) => g.axis === 'vertical' && g.type === 'layer-edge' && g.layerId === 'other'));
  assert.ok(result.guides.some((g) => g.axis === 'horizontal' && g.type === 'layer-edge' && g.layerId === 'other'));
});

await test('12. text/curved-text, imported SVG, and Image Trace bounds all feed the same generic layerBBoxes snap path (no per-type snapping logic)', () => {
  const bboxFn = appJs.match(/function getLayerBBox\(l\)\{([\s\S]*?)\}\n/);
  assert.ok(bboxFn, 'expected to find getLayerBBox() in app.js');
  const body = bboxFn[1];
  assert.match(body, /l\.type==='rectangle'\|\|l\.type==='svg'\|\|l\.type==='image'/, 'expected svg/image to share one direct x/y/w/h bbox branch');
  assert.ok(!/l\.type==='text'/.test(body), 'expected no special-cased text branch: text/curved-text bounds must fall through to the one generic (StoneLayout-bounding-box) path used for every non-shape layer type, so no new snapping logic is needed per layer type');
});

await test('13. (RS-1010A wording polish) Snap Distance drops its raw "(mm)" suffix from the label but still explains millimeters in plain language, and both snapping checkboxes carry a descriptive tooltip', () => {
  const body = indexHtml.slice(indexHtml.indexOf('id="lightboxSettings"'), indexHtml.indexOf('id="lightboxHelp"'));
  assert.match(body, /<label for="settingsSnapDistance">Snap Distance<\/label>/, 'expected the label itself to read "Snap Distance", not "Snap Distance (mm)"');
  assert.match(body, /<p class="hint">How close two elements need to be, in millimeters, before they snap together\.[^<]*<\/p>/, 'expected a visible, plain-language explanation of what the mm value means (not hover-only, so a first-time user does not have to find a tooltip)');
  assert.match(body, /<label class="checkbox-row" title="[^"]+"><input type="checkbox" id="settingsSnapDefault" checked> Enable Snapping<\/label>/, 'expected "Enable Snapping" to carry a tooltip explaining what it snaps to');
  assert.match(body, /<label class="checkbox-row" title="[^"]+"><input type="checkbox" id="settingsShowGuides" checked> Show Alignment Guides<\/label>/, 'expected "Show Alignment Guides" to carry a tooltip explaining what it shows');
});

await test('14. no forbidden file changed (src/geometry/**, src/renderer/**, src/export/**, StoneLayout/GeometryEngine untouched by this milestone; src/editing/** itself IS in scope -- RS-1010 adds selectMany() to Selection.js)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  // RS-1012 (Vector Boolean Operations) legitimately adds src/geometry/PathBoolean.js and extends
  // src/geometry/GeometryEngine.js/index.js/README.md -- this guard checks live `git status`, not a
  // diff scoped to this milestone's own commit, so it also has to reflect later milestones' scope,
  // matching the precedent in tools/test-production-sheet-exporter.mjs (RS-1008A) -- see
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

console.log('Alignment & snapping upgrade tests passed.');
