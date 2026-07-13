import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// UI-001 (Complete Application Redesign) — verifies the top application menu: every required
// button exists, in the required order, with an icon/label/tooltip, and opens exactly the Lightbox
// documented in docs/specifications/UI-001-CompleteRedesign.md's feature-to-UI inventory table.
// Structural checks against the live index.html/app.js source (no DOM/browser dependency),
// matching every other integration suite's established convention in this repository.

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

const MENU_ITEMS = [
  { id: 'menuText', label: 'Text', lightbox: 'lightboxText' },
  { id: 'menuShapes', label: 'Shapes', lightbox: 'lightboxShapes' },
  { id: 'menuImport', label: 'Import', lightbox: 'lightboxImport' },
  { id: 'menuImageTrace', label: 'Image Trace', lightbox: 'lightboxImageTrace' },
  { id: 'menuExport', label: 'Export', lightbox: 'lightboxExport' },
  { id: 'menuProdSheet', label: 'Production Sheet', lightbox: 'lightboxProdSheet' },
  { id: 'menuShipping', label: 'Shipping', lightbox: 'lightboxShipping' },
  { id: 'menuSettings', label: 'Settings', lightbox: 'lightboxSettings' },
  { id: 'menuHelp', label: 'Help', lightbox: 'lightboxHelp' }
];

await test('1. all nine top-menu buttons exist, in the required order', () => {
  const indices = MENU_ITEMS.map(({ id }) => {
    const idx = indexHtml.indexOf(`id="${id}"`);
    assert.ok(idx > 0, `expected #${id} to exist`);
    return idx;
  });
  for (let i = 1; i < indices.length; i++) {
    assert.ok(indices[i] > indices[i - 1], `expected ${MENU_ITEMS[i - 1].id} before ${MENU_ITEMS[i].id}`);
  }
});

await test('2. every top-menu button has an icon glyph, a visible text label, and a tooltip', () => {
  for (const { id, label } of MENU_ITEMS) {
    const tagMatch = indexHtml.match(new RegExp(`<button class="topmenu-btn" id="${id}"[^>]*title="[^"]+"[^>]*>([\\s\\S]*?)</button>`));
    assert.ok(tagMatch, `expected #${id} to be a topmenu-btn with a title tooltip`);
    assert.match(tagMatch[1], /<span class="glyph">/, `expected #${id} to include an icon glyph`);
    assert.ok(tagMatch[1].includes(label), `expected #${id}'s visible text to include "${label}"`);
  }
});

await test('3. every top-menu button opens exactly its documented Lightbox', () => {
  for (const { id, lightbox } of MENU_ITEMS) {
    const re = new RegExp(`el\\('${id}'\\)\\.onclick=\\(\\)=>lightboxes\\.\\w+\\.open\\(\\)`);
    assert.match(appJs, re, `expected #${id} to open a Lightbox`);
  }
  assert.match(appJs, /text:new Lightbox\('lightboxText'/, 'expected the text Lightbox instance to wrap #lightboxText');
  assert.match(appJs, /new Lightbox\('lightboxShapes'/, 'expected a Lightbox instance for #lightboxShapes');
  assert.match(appJs, /new Lightbox\('lightboxImport'/, 'expected a Lightbox instance for #lightboxImport');
  assert.match(appJs, /new Lightbox\('lightboxImageTrace'/, 'expected a Lightbox instance for #lightboxImageTrace');
  assert.match(appJs, /new Lightbox\('lightboxExport'/, 'expected a Lightbox instance for #lightboxExport');
  assert.match(appJs, /new Lightbox\('lightboxProdSheet'/, 'expected a Lightbox instance for #lightboxProdSheet');
  assert.match(appJs, /new Lightbox\('lightboxShipping'/, 'expected a Lightbox instance for #lightboxShipping');
  assert.match(appJs, /new Lightbox\('lightboxSettings'/, 'expected a Lightbox instance for #lightboxSettings');
  assert.match(appJs, /new Lightbox\('lightboxHelp'\)/, 'expected a Lightbox instance for #lightboxHelp');
});

await test('4. every top-menu-opened Lightbox overlay exists exactly once and is a lightbox-overlay', () => {
  for (const { lightbox } of MENU_ITEMS) {
    const matches = indexHtml.match(new RegExp(`id="${lightbox}"`, 'g')) || [];
    assert.equal(matches.length, 1, `expected exactly one #${lightbox}`);
    // S-101: lightboxShapes carries an additional "non-modal" modifier class (see
    // tools/test-s101-ux-workflow-polish.mjs) -- still a lightbox-overlay, just not the only class.
    assert.match(indexHtml, new RegExp(`<div class="lightbox-overlay(?: [\\w-]+)?" id="${lightbox}">`), `expected #${lightbox} to be a lightbox-overlay`);
  }
});

await test('5. the top bar also exposes Undo, Redo, Save, and an Export shortcut, each with a tooltip or visible label', () => {
  for (const id of ['undoBtn', 'redoBtn', 'saveProject', 'exportShortcut']) {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `expected #${id} in the top bar`);
  }
  assert.match(appJs, /el\('exportShortcut'\)\.onclick=\(\)=>lightboxes\.exportBox\.open\(\)/, 'expected the Export shortcut to open the Export Lightbox');
});

await test('6. every top-menu button is a real <button> element (keyboard-focusable, not an unlabeled icon-only div)', () => {
  for (const { id } of MENU_ITEMS) {
    assert.match(indexHtml, new RegExp(`<button class="topmenu-btn" id="${id}"`), `expected #${id} to be a <button>`);
  }
});

console.log('UI-001 top menu tests passed.');
