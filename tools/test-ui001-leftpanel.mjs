import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// UI-001 (Complete Application Redesign) — verifies the left panel is scoped to exactly
// Project / Layers / Actions (per docs/specifications/UI-001-CompleteRedesign.md), that every
// required field/control exists inside the right section, and that the right inspector is a
// compact quick-edit surface (not a second complete parameter editor). Structural checks against
// the live index.html/app.js source, matching this repository's established convention.
//
// Critical-controls-visible-at-supported-viewport-size assertions (1280x800/1366x768/1440x900/
// 1920x1080) require an actual layout engine and are performed by real-browser verification
// instead, recorded in TASK_RESULT.md — this file only checks the DOM structure, not computed CSS.

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

function section(html, heading) {
  const idx = html.indexOf(`<h2>${heading}</h2>`);
  assert.ok(idx > 0, `expected a left-panel section titled "${heading}"`);
  const next = html.indexOf('<h2>', idx + 1);
  return html.slice(idx, next > 0 ? next : undefined);
}

const leftPanelMatch = indexHtml.match(/<aside class="left-panel"[^>]*>([\s\S]*?)<\/aside>/);
assert.ok(leftPanelMatch, 'expected an <aside class="left-panel"> element');
const leftPanel = leftPanelMatch[1];

await test('1. Project section: name, rename input, units, template summary', () => {
  const body = section(leftPanel, 'Project');
  assert.ok(body.includes('id="projectName"'), 'expected an editable #projectName input');
  assert.match(body, /<input id="projectName"/, 'expected a real <input>, not a read-only label');
  assert.ok(/Units/.test(body) && /mm/.test(body), 'expected current units shown');
  assert.ok(body.includes('id="projectTemplateSummary"'), 'expected a current object-template summary');
});

await test('2. Layers section: list, add shortcuts, delete, no per-layer-type detail forms', () => {
  const body = section(leftPanel, 'Layers');
  for (const id of ['layersList', 'addCircle', 'addRect', 'deleteSelected', 'layerRuleHint']) {
    assert.ok(body.includes(`id="${id}"`), `expected #${id} in the Layers section`);
  }
  for (const id of ['textControls', 'shapeControls', 'svgControls', 'imageControls']) {
    assert.ok(!body.includes(`id="${id}"`), `expected #${id} (a per-layer-type form) NOT in the Layers section`);
  }
});

await test('3. layer rows support visibility, selection, duplicate, delete, and (via app.js) multi-selection', () => {
  assert.match(appJs, /data-action="visible"/);
  assert.match(appJs, /data-action="duplicate"/);
  assert.match(appJs, /data-action="delete"/);
  assert.match(appJs, /el\('layersList'\)\.addEventListener\('click'/);
  assert.match(appJs, /if\(e\.shiftKey\)\{selectedLayerIds=toggleSelection/);
});

await test('4. Actions section: Undo, Redo, Duplicate selected, Delete selected, Save Project', () => {
  const body = section(leftPanel, 'Actions');
  for (const id of ['actionUndo', 'actionRedo', 'actionDuplicate', 'actionDelete', 'actionSave']) {
    assert.ok(body.includes(`id="${id}"`), `expected #${id} in the Actions section`);
  }
  assert.match(appJs, /el\('actionUndo'\)\.onclick=\(\)=>performUndo\(\)/);
  assert.match(appJs, /el\('actionRedo'\)\.onclick=\(\)=>performRedo\(\)/);
  assert.match(appJs, /el\('actionDuplicate'\)\.onclick=\(\)=>duplicateLayer\(selectedLayerId\)/);
  assert.match(appJs, /el\('actionDelete'\)\.onclick=\(\)=>deleteLayer\(selectedLayerId\)/);
  assert.match(appJs, /el\('actionSave'\)\.onclick=saveProjectDownload/);
});

await test('5. Actions Undo/Redo buttons mirror the real history state (never a second independent history)', () => {
  const body = appJs.match(/function updateHistoryUI\(\)\{([\s\S]*?)\n\}/);
  assert.ok(body, 'expected updateHistoryUI()');
  assert.match(body[1], /actionUndoBtn\.disabled=!history\.canUndo/);
  assert.match(body[1], /actionRedoBtn\.disabled=!history\.canRedo/);
});

await test('6. the left panel has exactly three sections, in order: Project, Layers, Actions', () => {
  const headings = [...leftPanel.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['Project', 'Layers', 'Actions']);
});

await test('7. the right inspector is a compact quick-edit surface, not a second complete parameter editor: it shows only the shared position/stone field groups plus a name and a More Options shortcut, never a duplicate id', () => {
  const rightMatch = indexHtml.match(/<aside class="right-inspector"[^>]*>([\s\S]*?)<\/aside>/);
  assert.ok(rightMatch, 'expected a right-inspector aside');
  const body = rightMatch[1];
  assert.ok(body.includes('id="inspectorLayerName"'));
  assert.ok(body.includes('id="inspectorPositionSlot"') && body.includes('id="inspectorStoneSlot"'));
  assert.ok(body.includes('id="moreOptionsBtn"'));
  for (const id of ['text', 'font', 'curveEnabled', 'svgMode', 'imgThreshold', 'objectType']) {
    assert.ok(!body.includes(`id="${id}"`), `expected #${id} (a complete-editor-only field) NOT to be duplicated in the right inspector`);
  }
});

await test('8. More Options opens the Lightbox matching the selected layer\'s type', () => {
  // S-105 follow-up: the type->Lightbox mapping moved into the shared lightboxForLayerType()
  // helper (also used by syncSelectedControlsFromLayer()'s auto-switch, so a type-specific Lightbox
  // left open never goes empty across a selection change) instead of being repeated inline here.
  // See tools/test-s105-persistent-movable-lightboxes.mjs.
  assert.match(appJs, /el\('moreOptionsBtn'\)\.onclick=\(\)=>\{/);
  assert.match(appJs, /const target=lightboxForLayerType\(selectedLayer\(\)\.type\);/);
  const fnMatch = appJs.match(/function lightboxForLayerType\(t\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected a lightboxForLayerType(t) function in app.js');
  assert.match(fnMatch[0], /if\(t==='text'\)return lightboxes\.text/);
  // RS-1012 extended this branch to also open Shapes for 'path' layers (Boolean Operation results,
  // edited the same way circle/rectangle are) -- see tools/test-path-boolean-integration.mjs.
  assert.match(fnMatch[0], /if\(t==='circle'\|\|t==='rectangle'\|\|t==='path'\)return lightboxes\.shapes/);
  assert.match(fnMatch[0], /if\(t==='svg'\)return lightboxes\.importBox/, 'expected More Options to open the Import Lightbox for svg layers');
  assert.match(fnMatch[0], /if\(t==='image'\)return lightboxes\.imagetrace/);
});

await test('9. shared position/stone fields are one physical DOM node each (no duplicate ids across inspector and Lightboxes)', () => {
  for (const id of ['shapeX', 'shapeY', 'shapeW', 'shapeH', 'stoneSize', 'gap', 'stoneColor']) {
    const matches = indexHtml.match(new RegExp(`id="${id}"`, 'g')) || [];
    assert.equal(matches.length, 1, `expected exactly one #${id} in the DOM (relocated, never duplicated), found ${matches.length}`);
  }
});

console.log('UI-001 left panel / inspector tests passed.');
