import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// S-105 (Persistent Movable Lightboxes): every named Lightbox (Text, Shapes, Import, Image Trace,
// Design Library, Export, Production Sheet, Shipping & Handling, Settings, Help, Gallery) becomes
// movable by its header, non-blocking of the 2D canvas/Object Preview/Layers list/Inspector, and
// stays open until the operator explicitly closes it. One primary Lightbox is open at a time (the
// existing FIELD_GROUPS shared-field-DOM relocation in app.js only supports one active owner --
// see docs/specifications/S-105-PersistentMovableLightboxes.md, "Architecture Decision"). The two
// transient sub-dialogs (lightboxLibraryConfirm, lightboxGalleryPreview) are deliberately untouched
// -- still fully modal, still not primary, still non-draggable-position-reset out of scope.
// Structural checks against the live src/ui/Lightbox.js / index.html / app.js source, matching this
// repository's established "check the live source" convention (real interactive drag/clamp/focus
// behavior is verified with a real browser and recorded in TASK_RESULT.md).

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const lightboxSource = await readFile(path.join(repoRoot, 'src/ui/Lightbox.js'), 'utf8');
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

const PRIMARY_OVERLAY_IDS = [
  'lightboxText', 'lightboxShapes', 'lightboxImport', 'lightboxImageTrace', 'lightboxExport',
  'lightboxProdSheet', 'lightboxShipping', 'lightboxSettings', 'lightboxHelp', 'lightboxLibrary',
  'lightboxGallery'
];
const SUB_DIALOG_OVERLAY_IDS = ['lightboxLibraryConfirm', 'lightboxGalleryPreview'];
const PRIMARY_APP_KEYS = ['text', 'shapes', 'importBox', 'imagetrace', 'exportBox', 'prodSheet', 'shipping', 'settings', 'help', 'library', 'gallery'];

// ---------- 1. Non-modal: all 11 named Lightboxes, not the two sub-dialogs ----------

await test('1. all 11 named Lightboxes carry the non-modal overlay class and aria-modal="false"', () => {
  for (const id of PRIMARY_OVERLAY_IDS) {
    assert.match(indexHtml, new RegExp(`<div class="lightbox-overlay non-modal[^"]*" id="${id}">`), `expected #${id} to carry the non-modal overlay class`);
    const re = new RegExp(`id="${id}">[\\s\\S]*?<div class="lightbox[^"]*" role="dialog" aria-modal="false"`);
    assert.match(indexHtml, re, `expected #${id}'s dialog to declare aria-modal="false"`);
  }
});

await test('2. the two sub-dialogs (libraryConfirm, galleryPreview) keep the plain, fully-modal overlay and aria-modal="true" -- out of scope by design', () => {
  for (const id of SUB_DIALOG_OVERLAY_IDS) {
    assert.match(indexHtml, new RegExp(`<div class="lightbox-overlay" id="${id}">`), `expected #${id} to keep the plain overlay class (no non-modal)`);
    const re = new RegExp(`id="${id}">[\\s\\S]*?<div class="lightbox[^"]*" role="dialog" aria-modal="true"`);
    assert.match(indexHtml, re, `expected #${id}'s dialog to still declare aria-modal="true"`);
  }
});

// ---------- 2. Movable: header drag + viewport clamping ----------

await test('3. Lightbox.js wires pointerdown/pointermove/pointerup on the header to drag the dialog, switching it to explicit fixed positioning computed from its current on-screen rect (no visual jump on first drag)', () => {
  assert.match(lightboxSource, /this\.header\.addEventListener\('pointerdown',\s*\(e\)\s*=>\s*this\._handleDragStart\(e\)\)/);
  assert.match(lightboxSource, /this\.header\.addEventListener\('pointermove',\s*\(e\)\s*=>\s*this\._handleDragMove\(e\)\)/);
  assert.match(lightboxSource, /this\.header\.addEventListener\('pointerup',\s*\(e\)\s*=>\s*this\._handleDragEnd\(e\)\)/);
  assert.match(lightboxSource, /getBoundingClientRect\(\)/);
  assert.match(lightboxSource, /this\.dialog\.style\.position\s*=\s*'fixed'/);
  assert.match(lightboxSource, /setPointerCapture/);
  assert.match(lightboxSource, /releasePointerCapture/);
});

await test('4. dragging never initiates from the close button or other interactive header descendants (so the close click still only closes)', () => {
  assert.match(lightboxSource, /e\.target\.closest\('button, a, input, select, textarea, \[data-lightbox-close\]'\)/);
});

await test('5. _clampToViewport keeps the dialog fully inside the current window size whenever it fits, and flush against the near edge (never fully off-screen) when it does not', () => {
  const fnMatch = lightboxSource.match(/_clampToViewport\(left, top\) \{[\s\S]*?\n {2}\}/);
  assert.ok(fnMatch, 'expected a _clampToViewport(left, top) method');
  assert.match(fnMatch[0], /window\.innerWidth/);
  assert.match(fnMatch[0], /window\.innerHeight/);
  assert.match(fnMatch[0], /Math\.max\(0, window\.innerWidth/);
  assert.match(fnMatch[0], /Math\.min\(0, window\.innerWidth/);
});

await test('6. a dragged Lightbox re-clamps to the viewport on open() and on window resize, so it can never become permanently unreachable after the browser window shrinks', () => {
  assert.match(lightboxSource, /this\._reclampToViewport\(\);/);
  assert.match(lightboxSource, /window\.addEventListener\('resize'/);
  assert.match(lightboxSource, /draggedLightboxes/);
});

await test('7. index.html gives the header a grab cursor and the dialog a dragging state (grabbing cursor, no text selection) purely as CSS -- no layout change to the existing centered default', () => {
  assert.match(indexHtml, /\.lightbox-header\{[^}]*cursor:grab[^}]*\}/);
  assert.match(indexHtml, /\.lightbox\.dragging\{[^}]*cursor:grabbing[^}]*\}/);
  assert.match(indexHtml, /\.lightbox\.dragging \.lightbox-header\{[^}]*user-select:none[^}]*\}/);
});

// ---------- 3. Persistent: no backdrop-close for non-modal overlays, position kept across reopen ----------

await test('8. a Lightbox\'s position is not reset on close() -- reopening reuses the last dragged position (re-clamped to the current viewport), not a fresh center', () => {
  const closeMatch = lightboxSource.match(/close\(\) \{[\s\S]*?\n {2}\}/);
  assert.ok(closeMatch, 'expected a close() method');
  assert.ok(!/style\.left\s*=|style\.top\s*=|style\.position\s*=/.test(closeMatch[0]), 'close() must not reset the dialog\'s dragged position/style');
});

await test('9. Escape and the close button still close the dialog (persistence only removes incidental backdrop/outside-click auto-close for non-modal overlays, not deliberate close actions)', () => {
  assert.match(lightboxSource, /if\s*\(e\.key\s*===\s*['"]Escape['"]\)/);
  assert.match(lightboxSource, /closeButtons/);
});

// ---------- 4. One primary Lightbox at a time ----------

await test('10. Lightbox supports an options.primary flag; open() closes any other currently-open primary Lightbox first, and reopening the same already-open Lightbox is still a true no-op (checked before the exclusivity loop runs)', () => {
  assert.match(lightboxSource, /this\.primary\s*=\s*!!options\.primary/);
  const openMatch = lightboxSource.match(/open\(\) \{[\s\S]*?\n {2}\}/);
  assert.ok(openMatch, 'expected an open() method');
  assert.match(openMatch[0], /if\s*\(this\.isOpen\)\s*return;/);
  assert.match(openMatch[0], /if\s*\(this\.primary\)\s*\{[\s\S]*?primaryLightboxes[\s\S]*?lb\.close\(\)/);
  // the isOpen guard must appear before the exclusivity loop so re-opening an already-open dialog never flashes-closes others
  assert.ok(openMatch[0].indexOf('if (this.isOpen) return;') < openMatch[0].indexOf('primaryLightboxes'), 'expected the isOpen no-op guard before the primary-exclusivity loop');
});

await test('11. app.js marks exactly the 11 named Lightboxes primary:true; the two sub-dialogs are not primary', () => {
  for (const key of PRIMARY_APP_KEYS) {
    const re = new RegExp(`${key}:new Lightbox\\('\\w+',\\{primary:true`);
    assert.match(appJs, re, `expected the ${key} Lightbox to be constructed with primary:true`);
  }
  assert.match(appJs, /libraryConfirm:new Lightbox\('lightboxLibraryConfirm'\)/, 'expected libraryConfirm to stay non-primary (no options object)');
  assert.match(appJs, /galleryPreview:new Lightbox\('lightboxGalleryPreview'\)/, 'expected galleryPreview to stay non-primary (no options object)');
});

// ---------- 5. Reopen affordances preserved; reuse, not duplication ----------

await test('12. every named Lightbox overlay id still appears exactly once in index.html (reopening reuses the same DOM node, never a duplicate)', () => {
  for (const id of [...PRIMARY_OVERLAY_IDS, ...SUB_DIALOG_OVERLAY_IDS]) {
    const matches = indexHtml.match(new RegExp(`id="${id}"`, 'g')) || [];
    assert.equal(matches.length, 1, `expected exactly one #${id}`);
  }
});

await test('13. More Options and the top-menu buttons remain the reopen affordances -- unchanged by this milestone', () => {
  assert.match(appJs, /el\('moreOptionsBtn'\)\.onclick=\(\)=>\{/);
  assert.match(appJs, /el\('menuText'\)\.onclick=\(\)=>lightboxes\.text\.open\(\)/);
});

// ---------- 6. Gallery stays disabled from the menu (S-103, untouched) ----------

await test('14. #menuGallery keeps its native disabled/aria-disabled attributes -- Gallery\'s Lightbox becomes non-modal/movable/persistent like the others, but its menu entry point stays unreachable', () => {
  assert.match(indexHtml, /<button class="topmenu-btn" id="menuGallery"[^>]*\bdisabled\b[^>]*aria-disabled="true"[^>]*>/);
});

// ---------- 7. Lightbox.js stays a pure DOM module; forbidden files untouched ----------

await test('15. Lightbox.js still has zero knowledge of Project/Layer/StoneLayout/layer type', () => {
  const codeOnly = lightboxSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const forbidden of ['Project', 'Layer', 'StoneLayout', 'Stone(', 'layer.type', "l.type==='text'", 'import {']) {
    assert.ok(!codeOnly.includes(forbidden), `Lightbox.js's actual code must not reference ${forbidden}`);
  }
});

// ---------- 8. Follow-up: no empty Lightbox on a selection-type mismatch ----------

await test('16. lightboxForLayerType() is the single shared layer-type -> Lightbox mapping, reused by both More Options and the auto-switch (not duplicated)', () => {
  const fnMatch = appJs.match(/function lightboxForLayerType\(t\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected a lightboxForLayerType(t) function in app.js');
  assert.match(fnMatch[0], /t===['"]text['"][\s\S]*?lightboxes\.text/);
  assert.match(fnMatch[0], /circle[\s\S]*?rectangle[\s\S]*?path[\s\S]*?lightboxes\.shapes/);
  assert.match(fnMatch[0], /t===['"]svg['"][\s\S]*?lightboxes\.importBox/);
  assert.match(fnMatch[0], /t===['"]image['"][\s\S]*?lightboxes\.imagetrace/);
  // More Options must call the shared helper, not a second copy of the type->Lightbox branching
  const moreOptionsMatch = appJs.match(/el\('moreOptionsBtn'\)\.onclick=\(\)=>\{[\s\S]*?\n\};/);
  assert.ok(moreOptionsMatch, 'expected the moreOptionsBtn handler');
  assert.match(moreOptionsMatch[0], /lightboxForLayerType\(selectedLayer\(\)\.type\)/);
});

await test('17. syncSelectedControlsFromLayer() auto-switches the open type-specific Lightbox to match a newly selected, incompatible-type layer, so it never sits empty', () => {
  const fnMatch = appJs.match(/function syncSelectedControlsFromLayer\(\)\{[\s\S]*?\n\}(?=\n(?:function|const|let|el\(|\/\/))/);
  assert.ok(fnMatch, 'expected to find syncSelectedControlsFromLayer()');
  assert.match(fnMatch[0], /if\s*\(activeFieldLightbox\s*&&\s*activeFieldLightbox\s*!==\s*['"]shapes['"]\s*&&\s*selectedLayerIds\.size\s*<=\s*1\)\s*\{/, 'expected the auto-switch to be gated on activeFieldLightbox (a type-specific Lightbox is open), excluding Shapes, and a single-layer selection');
  assert.match(fnMatch[0], /const target=lightboxForLayerType\(l\.type\);/);
  assert.match(fnMatch[0], /if\s*\(target\s*&&\s*!target\.isOpen\)\s*target\.open\(\);/, 'expected a no-op guard so an already-correct open Lightbox is never redundantly reopened');
});

await test('18. Shapes is excluded from the auto-switch-away trigger, so Boolean Ops\' mixed-type Shift-click multi-select (S-101) is never disrupted', () => {
  const fnMatch = appJs.match(/function syncSelectedControlsFromLayer\(\)\{[\s\S]*?\n\}(?=\n(?:function|const|let|el\(|\/\/))/);
  assert.match(fnMatch[0], /activeFieldLightbox\s*!==\s*['"]shapes['"]/, 'expected Shapes to be excluded, since a Shift-click multi-select always begins with one plain (single-selection) click that would otherwise trigger a premature switch away');
  assert.match(fnMatch[0], /selectedLayerIds\.size\s*<=\s*1/);
  // Shapes never needs this protection in the first place: its "Add a shape"/"Boolean Operations"
  // sections are unconditionally visible regardless of the selected layer's type (unlike
  // Text/Import/Image Trace, whose entire body content is gated behind a single type check).
  const shapesBody = indexHtml.match(/<div class="lightbox-tab-panel" id="shapesPanelDesign">[\s\S]*?<div id="shapeControls"/);
  assert.ok(shapesBody, 'expected to find the Shapes Design panel up to its type-conditional #shapeControls');
  assert.match(shapesBody[0], /<h3>Add a shape<\/h3>/);
  assert.match(shapesBody[0], /<h3>Boolean Operations<\/h3>/);
});

await test('19. no forbidden file changed (GeometryEngine, StoneLayout, exporters, every renderer, Design Library data layer, Gallery data layer) -- this follow-up is app.js/tools/docs only', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const forbiddenPrefixes = [
    'src/geometry/', 'src/renderer/', 'src/export/', 'src/text/', 'src/fonts/', 'src/browser/',
    'src/svg/', 'src/image/', 'src/history/', 'src/products/', 'src/preview3d/', 'src/library/',
    'src/gallery/', 'src/editing/', 'examples/', 'assets/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('S-105 Persistent Movable Lightboxes tests passed.');
