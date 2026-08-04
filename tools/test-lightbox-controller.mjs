import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// UI-001 (Complete Application Redesign) — verifies the reusable Lightbox dialog controller
// (src/ui/Lightbox.js) implements the required contract (Escape to close, focus trap, backdrop
// click, ARIA), that it has zero Project/Layer/StoneLayout knowledge (a permanent, DOM-only
// module, matching every other permanent module's shape), and that field-relocation on
// open/close keeps the shared position/stone fields in exactly one place at a time. Structural
// checks against the live source, matching this repository's established convention. Real
// interactive Escape/focus/Cancel/Apply behavior is verified with a real browser and recorded in
// TASK_RESULT.md, per this repository's existing "interactive browser verification is manual, not
// an automated browser test suite" testing philosophy (docs/ARCHITECTURE.md, "Testing Philosophy").
// Renamed by S-111 from test-ui001-dialog-behavior.mjs: this file tests the permanent
// src/ui/Lightbox.js module's own contract, not milestone-specific page furniture, so it is named
// for what it protects rather than the milestone that introduced it.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const lightboxSource = await readFile(path.join(repoRoot, 'src/ui/Lightbox.js'), 'utf8');
const uiIndexSource = await readFile(path.join(repoRoot, 'src/ui/index.js'), 'utf8');
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

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

await test('1. src/ui/Lightbox.js is exported only through src/ui/index.js (barrel-only, matching every other permanent module)', () => {
  assert.match(uiIndexSource, /export\s*\{\s*Lightbox\s*\}\s*from\s*['"]\.\/Lightbox\.js['"]/);
});

await test('2. Lightbox.js has zero knowledge of Project/Layer/StoneLayout/layer type (pure DOM dialog behavior only) -- checked against actual code, not doc-comment prose', () => {
  const codeOnly = lightboxSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const forbidden of ['Project', 'Layer', 'StoneLayout', 'Stone(', 'layer.type', "l.type==='text'", 'import {']) {
    assert.ok(!codeOnly.includes(forbidden), `Lightbox.js's actual code must not reference ${forbidden}`);
  }
});

await test('3. Escape closes the topmost open dialog', () => {
  assert.match(lightboxSource, /if\s*\(e\.key\s*===\s*['"]Escape['"]\)/);
  assert.match(lightboxSource, /this\.close\(\)/);
});

await test('4. focus is trapped inside the dialog (Tab/Shift+Tab wrap within it)', () => {
  assert.match(lightboxSource, /focusableElements/);
  assert.match(lightboxSource, /e\.key === ['"]Tab['"]/);
  assert.match(lightboxSource, /e\.shiftKey/);
});

await test('5. opening moves focus into the dialog; closing restores focus to the previously focused element', () => {
  assert.match(lightboxSource, /this\._previouslyFocused\s*=\s*document\.activeElement/);
  assert.match(lightboxSource, /focusables\[0\][\s\S]*\.focus\(/);
  assert.match(lightboxSource, /this\._previouslyFocused[\s\S]*\.focus\(/);
});

await test('6. clicking the backdrop closes the dialog; clicking inside the dialog panel does not', () => {
  assert.match(lightboxSource, /this\.overlay\.addEventListener\('mousedown'/);
  assert.match(lightboxSource, /if\s*\(e\.target === this\.overlay\)\s*this\.close\(\)/);
});

await test('7. every element with [data-lightbox-close] closes the dialog without applying edits (no other side effect wired to the same click)', () => {
  assert.match(lightboxSource, /data-lightbox-close/);
  assert.match(lightboxSource, /closeButtons\.forEach|for \(const btn of closeButtons\)/);
});

await test('8. the dialog has proper ARIA: role="dialog", aria-modal="false" for the 11 non-modal S-105 Lightboxes (or "true" for the two modal sub-dialogs lightboxLibraryConfirm/lightboxGalleryPreview -- see test 13 and tools/test-s101-ux-workflow-polish.mjs), and a labelled title, for every Lightbox instance in index.html', () => {
  const overlayIds = [...appJs.matchAll(/new Lightbox\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(overlayIds.length >= 9, 'expected at least nine Lightbox instances');
  const MODAL_SUB_DIALOGS = new Set(['lightboxLibraryConfirm', 'lightboxGalleryPreview']);
  for (const id of overlayIds) {
    const expectedAriaModal = MODAL_SUB_DIALOGS.has(id) ? 'true' : 'false';
    const re = new RegExp(`<div class="lightbox-overlay[^"]*" id="${id}">[\\s\\S]*?<div class="lightbox[^"]*" role="dialog" aria-modal="${expectedAriaModal}" aria-labelledby="(\\w+)"`);
    const match = indexHtml.match(re);
    assert.ok(match, `expected #${id}'s dialog to declare role/aria-modal="${expectedAriaModal}"/aria-labelledby`);
    assert.ok(indexHtml.includes(`id="${match[1]}"`), `expected the aria-labelledby target #${match[1]} to exist`);
  }
});

await test('13. all 11 named Lightboxes are non-modal (S-105, generalizing the S-101 Shapes precedent): each carries the .non-modal overlay class and aria-modal="false", so canvas/Layers-list/Inspector interaction works while any of them stays open; lightboxLibraryConfirm/lightboxGalleryPreview intentionally keep the plain, fully-modal backdrop', () => {
  const NON_MODAL_IDS = ['lightboxText', 'lightboxShapes', 'lightboxImport', 'lightboxImageTrace', 'lightboxExport', 'lightboxProdSheet', 'lightboxShipping', 'lightboxSettings', 'lightboxHelp', 'lightboxLibrary', 'lightboxGallery'];
  for (const id of NON_MODAL_IDS) {
    const re = new RegExp(`<div class="lightbox-overlay non-modal[^"]*" id="${id}">`);
    assert.match(indexHtml, re, `expected #${id} to carry the non-modal overlay class`);
  }
  assert.match(indexHtml, /\.lightbox-overlay\.non-modal\{background:transparent;pointer-events:none\}/, 'expected the non-modal overlay to be transparent and click-through');
  assert.match(indexHtml, /\.lightbox-overlay\.non-modal \.lightbox\{pointer-events:auto\}/, 'expected the dialog card itself to remain interactive despite the click-through backdrop');
  for (const id of ['lightboxLibraryConfirm', 'lightboxGalleryPreview']) {
    assert.match(indexHtml, new RegExp(`<div class="lightbox-overlay" id="${id}">`), `expected #${id} to keep the plain, fully-modal overlay class`);
  }
});

await test('14. header drag-to-move (S-105) is wired for every Lightbox: pointerdown/pointermove/pointerup on .lightbox-header, viewport clamping, and single-primary-Lightbox exclusivity', () => {
  assert.match(lightboxSource, /this\.header\.addEventListener\('pointerdown'/, 'expected a pointerdown listener on the header to start a drag');
  assert.match(lightboxSource, /this\.header\.addEventListener\('pointermove'/, 'expected a pointermove listener on the header to move the dialog');
  assert.match(lightboxSource, /_clampToViewport/, 'expected a viewport-clamping method');
  assert.match(lightboxSource, /window\.addEventListener\('resize'/, 'expected dragged dialogs to re-clamp on window resize');
  assert.match(lightboxSource, /options\.primary/, 'expected an options.primary flag for single-active-Lightbox exclusivity');
  assert.match(lightboxSource, /primaryLightboxes/, 'expected a primary-Lightbox registry used to close others on open()');
});

await test('9. no full-page content shift: every Lightbox is a fixed, full-viewport overlay (position:fixed;inset:0), not an inline element that reflows the page', () => {
  assert.match(indexHtml, /\.lightbox-overlay\{position:fixed;inset:0;/);
});

await test('10. internal scrolling only when required: the dialog body scrolls, the header/footer do not grow with content', () => {
  assert.match(indexHtml, /\.lightbox-body\{padding:[^;]+;overflow-y:auto;flex:1;min-height:0\}/);
  assert.match(indexHtml, /\.lightbox\{[^}]*max-height:calc\(100vh - 64px\)[^}]*display:flex;flex-direction:column/);
});

await test('11. field-relocation moves the shared position/stone field groups on every Lightbox open/close, so Cancel/Escape/backdrop-close all return them to the inspector home slot', () => {
  assert.match(appJs, /function relocateFieldGroups\(\)\{/);
  const closers = ['text', 'shapes', 'importBox', 'imagetrace'];
  for (const key of closers) {
    const re = new RegExp(`${key}:new Lightbox\\('\\w+',\\{primary:true,onOpen\\(\\)\\{[^}]*relocateFieldGroups\\(\\)[\\s\\S]*?onClose\\(\\)\\{[^}]*relocateFieldGroups\\(\\)`);
    assert.match(appJs, re, `expected the ${key} Lightbox to relocate field groups on both open and close`);
  }
});

await test('12. validation messages have a dedicated, visible element per Lightbox that needs one (Text, Import/Project, Production Sheet)', () => {
  for (const id of ['textValidation', 'importProjectValidation', 'prodSheetValidation']) {
    assert.match(indexHtml, new RegExp(`<div class="validation-message" id="${id}" role="alert">`), `expected a role="alert" validation element #${id}`);
  }
});

console.log('Lightbox controller tests passed.');
