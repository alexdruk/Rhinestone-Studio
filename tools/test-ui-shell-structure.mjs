import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// UI-001 (Complete Application Redesign) + its UI-001A/UI-001B follow-up fixes — verifies the
// application shell: the top menu, every Lightbox's required content, the left panel/right
// inspector split, and the workspace/status UX fixes layered on top. Consolidated by S-111 from
// five separate milestone-named files (test-ui001-topmenu.mjs, test-ui001-lightboxes.mjs,
// test-ui001-leftpanel.mjs, test-ui001b-fixes.mjs) that each grepped a different, non-overlapping
// slice of the same index.html/app.js source with the same technique — one file, one setup, no
// duplicated boilerplate. Structural checks against the live source (app.js is a browser entry
// point, not import()-able directly under plain Node); real interaction (drag/resize, computed
// layout at supported viewport sizes) is covered by manual browser verification per milestone,
// recorded in TASK_RESULT.md, not here.

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

function extractElementHtml(html, id) {
  const openTagMatch = html.match(new RegExp(`<([a-zA-Z]+)[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(openTagMatch, `expected to find an element with id="${id}"`);
  const tag = openTagMatch[1];
  const start = openTagMatch.index + openTagMatch[0].length;
  const openRe = new RegExp(`<${tag}\\b`, 'g');
  const closeRe = new RegExp(`</${tag}>`, 'g');
  let depth = 1;
  let cursor = start;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    assert.ok(nextClose, `unbalanced <${tag}> for id="${id}"`);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) return html.slice(start, nextClose.index);
    }
  }
  throw new Error(`unreachable: failed to extract #${id}`);
}

function section(html, heading) {
  const idx = html.indexOf(`<h2>${heading}</h2>`);
  assert.ok(idx > 0, `expected a left-panel section titled "${heading}"`);
  const next = html.indexOf('<h2>', idx + 1);
  return html.slice(idx, next > 0 ? next : undefined);
}

// === Top menu ===================================================================================

// RS-3011 nav-toggle fix: opening a Lightbox that shows/produces design content (Text, Shapes,
// Import, Image Trace, Export, Production Sheet) now reveals Dual Workspace first, via
// revealDualWorkspaceForLightbox() -- see test 3b below. Shipping/Settings/Help show no
// design/geometry content and deliberately keep the old plain-open behavior.
const MENU_ITEMS = [
  { id: 'menuText', label: 'Text', lightbox: 'lightboxText', revealsDualWorkspace: true },
  { id: 'menuShapes', label: 'Shapes', lightbox: 'lightboxShapes', revealsDualWorkspace: true },
  { id: 'menuImport', label: 'Import', lightbox: 'lightboxImport', revealsDualWorkspace: true },
  { id: 'menuImageTrace', label: 'Image Trace', lightbox: 'lightboxImageTrace', revealsDualWorkspace: true },
  { id: 'menuExport', label: 'Export', lightbox: 'lightboxExport', revealsDualWorkspace: true },
  { id: 'menuProdSheet', label: 'Production Sheet', lightbox: 'lightboxProdSheet', revealsDualWorkspace: true },
  { id: 'menuShipping', label: 'Shipping', lightbox: 'lightboxShipping', revealsDualWorkspace: false },
  { id: 'menuSettings', label: 'Settings', lightbox: 'lightboxSettings', revealsDualWorkspace: false },
  { id: 'menuHelp', label: 'Help', lightbox: 'lightboxHelp', revealsDualWorkspace: false }
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

await test('2. every top-menu button has an icon glyph, a visible text label, and a tooltip, and is a real <button>', () => {
  for (const { id, label } of MENU_ITEMS) {
    const tagMatch = indexHtml.match(new RegExp(`<button class="topmenu-btn" id="${id}"[^>]*title="[^"]+"[^>]*>([\\s\\S]*?)</button>`));
    assert.ok(tagMatch, `expected #${id} to be a topmenu-btn with a title tooltip`);
    assert.match(tagMatch[1], /<span class="glyph">/, `expected #${id} to include an icon glyph`);
    assert.ok(tagMatch[1].includes(label), `expected #${id}'s visible text to include "${label}"`);
  }
});

await test('3. every top-menu button opens exactly its documented Lightbox, and every Lightbox overlay exists exactly once', () => {
  for (const { id, lightbox, revealsDualWorkspace } of MENU_ITEMS) {
    const re = revealsDualWorkspace
      ? new RegExp(`el\\('${id}'\\)\\.onclick=\\(\\)=>\\{revealDualWorkspaceForLightbox\\(\\);lightboxes\\.\\w+\\.open\\(\\)\\}`)
      : new RegExp(`el\\('${id}'\\)\\.onclick=\\(\\)=>lightboxes\\.\\w+\\.open\\(\\)`);
    assert.match(appJs, re, `expected #${id} to open a Lightbox${revealsDualWorkspace ? ', revealing Dual Workspace first' : ''}`);
    const matches = indexHtml.match(new RegExp(`id="${lightbox}"`, 'g')) || [];
    assert.equal(matches.length, 1, `expected exactly one #${lightbox}`);
    assert.match(indexHtml, new RegExp(`<div class="lightbox-overlay(?: [\\w-]+)?" id="${lightbox}">`), `expected #${lightbox} to be a lightbox-overlay`);
  }
});

await test('3b. revealDualWorkspaceForLightbox() actually exits Design (setDrawMode(false)) before reusing the exact setWorkspaceMode(\'dual\')+persistActiveView(\'dual\') pair the Dual Workspace tab itself uses, and is skipped entirely when Dual Workspace is already showing and Design is not active', () => {
  const fnMatch = appJs.match(/function revealDualWorkspaceForLightbox\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected a revealDualWorkspaceForLightbox() function in app.js');
  const body = fnMatch[0];
  assert.match(body, /const exitingDesign=drawingTool\.isActive;/);
  assert.match(body, /if\(exitingDesign\)setDrawMode\(false\);/);
  assert.match(body, /if\(exitingDesign\|\|workspaceMode!=='dual'\)\{/);
  assert.match(body, /if\(workspaceMode!=='dual'\)setWorkspaceMode\('dual'\);/);
  assert.match(body, /persistActiveView\('dual'\);/);
  // setDrawMode(false) must run before the setWorkspaceMode('dual') check, not after -- otherwise
  // Design's own exit-restore (workspaceModeBeforeDrawing) would clobber the freshly-set 'dual'.
  assert.ok(body.indexOf('setDrawMode(false)') < body.indexOf("setWorkspaceMode('dual')"), 'expected setDrawMode(false) to run before forcing workspaceMode to dual');
});

await test('4. the top bar also exposes Undo, Redo, Save, and an Export shortcut, each with a tooltip or visible label', () => {
  for (const id of ['undoBtn', 'redoBtn', 'saveProject', 'exportShortcut']) {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `expected #${id} in the top bar`);
  }
  assert.match(appJs, /el\('exportShortcut'\)\.onclick=\(\)=>\{revealDualWorkspaceForLightbox\(\);lightboxes\.exportBox\.open\(\)\}/, 'expected the Export shortcut to reveal Dual Workspace and open the Export Lightbox');
});

// === Lightbox content ============================================================================

const ALL_LIGHTBOXES = ['lightboxText', 'lightboxShapes', 'lightboxImport', 'lightboxImageTrace', 'lightboxExport', 'lightboxProdSheet', 'lightboxShipping', 'lightboxSettings', 'lightboxHelp'];

await test('5. every Lightbox has a header, a non-modal Escape-closeable dialog role, a close button, and a footer, and is controlled by a real src/ui Lightbox instance', () => {
  for (const id of ALL_LIGHTBOXES) {
    const body = extractElementHtml(indexHtml, id);
    assert.match(body, /<header class="lightbox-header">/, `expected ${id} to have a header`);
    // S-105: all 11 named Lightboxes are non-modal (aria-modal="false") so canvas/Layers-list/
    // Inspector interaction keeps working while any of them stays open.
    assert.match(body, /role="dialog" aria-modal="false"/, `expected ${id}'s dialog to declare aria-modal="false"`);
    assert.match(body, /<button class="lightbox-close" data-lightbox-close aria-label="Close">/, `expected ${id} to have a close button`);
    assert.match(body, /<footer class="lightbox-footer">/, `expected ${id} to have a footer`);
    assert.match(appJs, new RegExp(`new Lightbox\\('${id}'`), `expected app.js to construct a Lightbox for #${id}`);
  }
});

await test('6. Text Lightbox exposes every documented text/curve parameter', () => {
  const body = extractElementHtml(indexHtml, 'lightboxText');
  for (const id of ['text', 'font', 'textMode', 'height', 'autoFit', 'textX', 'textY', 'curveEnabled', 'curveRadiusMm', 'curveDirection', 'curveStartAngleDeg', 'curveSweepAngleDeg', 'curveAlignment']) {
    assert.ok(body.includes(`id="${id}"`), `expected the Text Lightbox to contain #${id}`);
  }
  assert.ok(body.includes('id="textStoneSlot"'), 'expected a stone-fields slot inside the Text Lightbox');
});

await test('7. Shapes Lightbox has two clearly separated sections: Design Shapes and Object Templates (wrap mode lives in the Object Preview toolbar, not here)', () => {
  const body = extractElementHtml(indexHtml, 'lightboxShapes');
  assert.match(body, /<button class="active" id="shapesTabDesign"/, 'expected a Design Shapes tab');
  assert.match(body, /<button id="shapesTabTemplates"/, 'expected an Object Templates tab');
  const designBody = extractElementHtml(indexHtml, 'shapesPanelDesign');
  assert.ok(designBody.includes('id="shapeGrid"'), 'expected the unified Design Shapes creation grid');
  assert.ok(designBody.includes('data-shape-kind="circle"'), 'expected a circle add control in Design Shapes');
  assert.ok(designBody.includes('data-shape-kind="rectangle"'), 'expected a rectangle add control in Design Shapes');
  assert.ok(designBody.includes('id="shapesPositionSlot"'), 'expected a position-fields slot in Design Shapes');
  assert.ok(designBody.includes('id="shapesStoneSlot"'), 'expected a stone-fields slot in Design Shapes');
  const templatesBody = extractElementHtml(indexHtml, 'shapesPanelTemplates');
  assert.ok(templatesBody.includes('id="objectType"'), 'expected #objectType in Object Templates');
  for (const value of ['mug', 'tumbler', 'bottle']) {
    assert.ok(templatesBody.includes(`value="${value}"`), `expected Object Templates to offer ${value}`);
  }
  assert.ok(!templatesBody.includes('id="wrap"'), 'expected wrap mode to no longer live in Object Templates (moved to the Object Preview toolbar)');
});

await test('8. Import Lightbox has two clearly separated tabs: SVG Import and Project Import, and Project Import explains it is not SVG import', () => {
  const body = extractElementHtml(indexHtml, 'lightboxImport');
  assert.match(body, /<button class="active" id="importTabSvg"/, 'expected an SVG Import tab');
  assert.match(body, /<button id="importTabProject"/, 'expected a Project Import tab');
  const svgBody = extractElementHtml(indexHtml, 'importPanelSvg');
  for (const id of ['importSvg', 'importSvgFile', 'svgMode']) {
    assert.ok(svgBody.includes(`id="${id}"`), `expected SVG Import to contain #${id}`);
  }
  assert.ok(svgBody.includes('id="importPositionSlot"') && svgBody.includes('id="importStoneSlot"'), 'expected position/stone slots in SVG Import');
  const projectBody = extractElementHtml(indexHtml, 'importPanelProject');
  for (const id of ['importProject', 'importProjectFile', 'importProjectValidation']) {
    assert.ok(projectBody.includes(`id="${id}"`), `expected Project Import to contain #${id}`);
  }
  assert.ok(/not the same as SVG Import/.test(projectBody), 'expected Project Import to explicitly distinguish itself from SVG Import');
});

await test('9. Image Trace, Export, Production Sheet, Shipping, Settings, and Help Lightboxes each expose their documented content', () => {
  const traceBody = extractElementHtml(indexHtml, 'lightboxImageTrace');
  for (const id of ['importImage', 'importImageFile', 'imgPreviewThreshold', 'imgPreviewInvert', 'imgPreviewBlur', 'imgPreviewMaxWidth', 'imgPreviewMaxHeight', 'imageImportPreviewCanvas', 'imageImportStoneCount', 'imageImportCancel', 'imageImportCommit']) {
    assert.ok(traceBody.includes(`id="${id}"`), `expected the Image Trace Lightbox to contain #${id}`);
  }
  for (const id of ['imgThreshold', 'imgInvert', 'imgBlurRadius', 'imgMaxWidth', 'imgMaxHeight']) {
    assert.ok(traceBody.includes(`id="${id}"`), `expected post-commit editing field #${id} inside the Image Trace Lightbox`);
  }
  assert.ok(traceBody.includes('id="imageTracePositionSlot"') && traceBody.includes('id="imageTraceStoneSlot"'));

  const exportBody = extractElementHtml(indexHtml, 'lightboxExport');
  for (const id of ['exportProject', 'exportLayout', 'exportSVG', 'exportPNG', 'exportCup']) {
    assert.ok(exportBody.includes(`id="${id}"`), `expected the Export Lightbox to contain #${id}`);
  }
  assert.ok(/Project data/.test(exportBody) && /Production geometry/.test(exportBody) && /Visual previews/.test(exportBody));

  const prodSheetBody = extractElementHtml(indexHtml, 'lightboxProdSheet');
  for (const id of ['prodSheetPageSize', 'prodSheetMargin', 'prodSheetMirror', 'prodSheetRegMarks', 'exportProdSheetSVG', 'exportProdSheetPNG', 'exportProdSheetPDF']) {
    assert.ok(prodSheetBody.includes(`id="${id}"`), `expected the Production Sheet Lightbox to contain #${id}`);
  }
  for (const value of ['A4', 'Letter']) assert.ok(prodSheetBody.includes(`value="${value}"`));

  const shippingBody = extractElementHtml(indexHtml, 'lightboxShipping');
  for (const id of ['shipPackageType', 'shipLengthMm', 'shipWidthMm', 'shipHeightMm', 'shipWeightG', 'shipNotes', 'shipFragile']) {
    assert.ok(shippingBody.includes(`id="${id}"`), `expected the Shipping Lightbox to contain #${id}`);
  }
  assert.ok(/session/i.test(shippingBody), 'expected the Shipping Lightbox to disclose its session-only scope');
  assert.ok(/no carrier, rate, label, or tracking integration/i.test(shippingBody));
  assert.ok(!/\bbuy\b|\bpurchase\b|calculate.*(rate|cost)/i.test(shippingBody), 'must not offer any working purchase/calculation action');

  const settingsBody = extractElementHtml(indexHtml, 'lightboxSettings');
  for (const id of ['settingsSafeAreaDefault', 'settingsSnapDefault', 'settingsDefaultStoneSize', 'settingsDefaultGap']) {
    assert.ok(settingsBody.includes(`id="${id}"`), `expected the Settings Lightbox to contain #${id}`);
  }
  assert.ok(/mm \(fixed\)/.test(settingsBody));
  assert.ok(/Light \(fixed\)/.test(settingsBody));

  const helpBody = extractElementHtml(indexHtml, 'lightboxHelp');
  for (const needle of ['Getting started', 'Keyboard shortcuts', 'Import', 'Export', 'Production Sheet', 'About Rhinestone Studio']) {
    assert.ok(helpBody.includes(needle), `expected the Help Lightbox to cover "${needle}"`);
  }
});

await test('10. Cancel never applies edits: every Lightbox\'s Cancel/Close button only closes the dialog, never an id with its own commit side effect', () => {
  for (const id of ALL_LIGHTBOXES) {
    const body = extractElementHtml(indexHtml, id);
    const cancelButtons = [...body.matchAll(/<button class="btn"[^>]*data-lightbox-close[^>]*>(Cancel|Close)<\/button>/g)];
    assert.ok(cancelButtons.length >= 1, `expected ${id} to have a Cancel/Close button that only closes`);
    for (const btn of cancelButtons) {
      assert.ok(!/id="/.test(btn[0]), `expected ${id}'s Cancel/Close button to have no id (so it cannot be an export/apply action)`);
    }
  }
});

// === Left panel / right inspector ===============================================================

const leftPanelMatch = indexHtml.match(/<aside class="left-panel"[^>]*>([\s\S]*?)<\/aside>/);
assert.ok(leftPanelMatch, 'expected an <aside class="left-panel"> element');
const leftPanel = leftPanelMatch[1];

await test('11. the left panel has exactly three sections, in order: Project, Layers, Actions', () => {
  const headings = [...leftPanel.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['Project', 'Layers', 'Actions']);
});

await test('12. Project section: name, rename input, units, template summary', () => {
  const body = section(leftPanel, 'Project');
  assert.ok(body.includes('id="projectName"'), 'expected an editable #projectName input');
  assert.match(body, /<input id="projectName"/, 'expected a real <input>, not a read-only label');
  assert.ok(/Units/.test(body) && /mm/.test(body), 'expected current units shown');
  assert.ok(body.includes('id="projectTemplateSummary"'), 'expected a current object-template summary');
});

await test('13. Layers section: list, delete, no per-layer-type detail forms, no duplicate shape-creation controls', () => {
  const body = section(leftPanel, 'Layers');
  for (const id of ['layersList', 'deleteSelected']) {
    assert.ok(body.includes(`id="${id}"`), `expected #${id} in the Layers section`);
  }
  // S-110: Design Shapes is the one place to create a shape.
  for (const id of ['addCircle', 'addRect']) {
    assert.ok(!body.includes(`id="${id}"`), `expected #${id} (a removed duplicate creation control) NOT in the Layers section`);
  }
  for (const id of ['textControls', 'shapeControls', 'svgControls', 'imageControls']) {
    assert.ok(!body.includes(`id="${id}"`), `expected #${id} (a per-layer-type form) NOT in the Layers section`);
  }
  assert.match(appJs, /data-action="visible"/);
  assert.match(appJs, /data-action="duplicate"/);
  assert.match(appJs, /data-action="delete"/);
  assert.match(appJs, /el\('layersList'\)\.addEventListener\('click'/);
  assert.match(appJs, /if\(e\.shiftKey\)\{selectedLayerIds=toggleSelection/);
});

await test('14. Actions section: Undo, Redo, Duplicate selected, Delete selected, Save Project, mirroring the real history state', () => {
  const body = section(leftPanel, 'Actions');
  for (const id of ['actionUndo', 'actionRedo', 'actionDuplicate', 'actionDelete', 'actionSave']) {
    assert.ok(body.includes(`id="${id}"`), `expected #${id} in the Actions section`);
  }
  assert.match(appJs, /el\('actionUndo'\)\.onclick=\(\)=>performUndo\(\)/);
  assert.match(appJs, /el\('actionRedo'\)\.onclick=\(\)=>performRedo\(\)/);
  assert.match(appJs, /el\('actionDuplicate'\)\.onclick=\(\)=>duplicateLayer\(selectedLayerId\)/);
  assert.match(appJs, /el\('actionDelete'\)\.onclick=\(\)=>deleteLayer\(selectedLayerId\)/);
  assert.match(appJs, /el\('actionSave'\)\.onclick=saveProjectDownload/);
  const historyUi = appJs.match(/function updateHistoryUI\(\)\{([\s\S]*?)\n\}/);
  assert.ok(historyUi, 'expected updateHistoryUI()');
  assert.match(historyUi[1], /actionUndoBtn\.disabled=!history\.canUndo/);
  assert.match(historyUi[1], /actionRedoBtn\.disabled=!history\.canRedo/);
});

await test('15. the right inspector is a compact quick-edit surface, not a second complete parameter editor, and More Options opens the Lightbox matching the selected layer\'s type', () => {
  const rightMatch = indexHtml.match(/<aside class="right-inspector"[^>]*>([\s\S]*?)<\/aside>/);
  assert.ok(rightMatch, 'expected a right-inspector aside');
  const body = rightMatch[1];
  assert.ok(body.includes('id="inspectorLayerName"'));
  assert.ok(body.includes('id="inspectorPositionSlot"') && body.includes('id="inspectorStoneSlot"'));
  assert.ok(body.includes('id="moreOptionsBtn"'));
  for (const id of ['text', 'font', 'curveEnabled', 'svgMode', 'imgThreshold', 'objectType']) {
    assert.ok(!body.includes(`id="${id}"`), `expected #${id} (a complete-editor-only field) NOT to be duplicated in the right inspector`);
  }
  assert.match(appJs, /el\('moreOptionsBtn'\)\.onclick=\(\)=>\{/);
  assert.match(appJs, /const target=lightboxForLayerType\(selectedLayer\(\)\.type\);/);
  const fnMatch = appJs.match(/function lightboxForLayerType\(t\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected a lightboxForLayerType(t) function in app.js');
  assert.match(fnMatch[0], /if\(t==='text'\)return lightboxes\.text/);
  assert.match(fnMatch[0], /if\(t==='path'\|\|SHAPE_LAYER_TYPES\.has\(t\)\)return lightboxes\.shapes/);
  assert.match(fnMatch[0], /if\(t==='svg'\)return lightboxes\.importBox/, 'expected More Options to open the Import Lightbox for svg layers');
  assert.match(fnMatch[0], /if\(t==='image'\)return lightboxes\.imagetrace/);
});

await test('16. shared position/stone fields are one physical DOM node each (no duplicate ids across inspector and Lightboxes)', () => {
  for (const id of ['shapeX', 'shapeY', 'shapeW', 'shapeH', 'stoneSize', 'gap', 'stoneColor']) {
    const matches = indexHtml.match(new RegExp(`id="${id}"`, 'g')) || [];
    assert.equal(matches.length, 1, `expected exactly one #${id} in the DOM (relocated, never duplicated), found ${matches.length}`);
  }
});

// === Workspace & status UX (UI-001A/UI-001B follow-up fixes) ===================================

await test('17. Project Import failure/success feedback is visible in the Import Lightbox itself, not only #status', () => {
  assert.match(indexHtml, /id="importProjectValidation"/);
  const handler = appJs.match(/el\('importProjectFile'\)\.addEventListener\('change',[\s\S]*?\}\);/);
  assert.ok(handler, 'expected to find the #importProjectFile change handler in app.js');
  const body = handler[0];
  assert.match(body, /importProjectValidation/, 'expected the handler to reference #importProjectValidation, not just #status');
  assert.match(body, /catch\(error\)\{[\s\S]*validationEl\.textContent=/, 'expected the failure branch to write the error into the validation element');
  assert.match(body, /lightboxes\.importBox\.close\(\)/, 'expected success to close the Import Lightbox');
  const catchBranch = body.slice(body.indexOf('catch(error)'));
  assert.doesNotMatch(catchBranch, /\.close\(\)/, 'expected the failure branch not to close the dialog');
});

await test('18. runAlign/runDistribute report what they did via #status, only after a real mutation', () => {
  assert.match(appJs, /function runAlign\(direction\)\{[\s\S]*?el\('status'\)\.textContent=/);
  assert.match(appJs, /function runDistribute\(axis\)\{[\s\S]*?el\('status'\)\.textContent=/);
  const alignFn = appJs.match(/function runAlign\(direction\)\{([\s\S]*?)\}\n/)[1];
  assert.match(alignFn, /if\(items\.length<2\)return;/);
  assert.ok(alignFn.indexOf('if(items.length<2)return;') < alignFn.indexOf("el('status')"));
  const distFn = appJs.match(/function runDistribute\(axis\)\{([\s\S]*?)\}\n/)[1];
  assert.match(distFn, /if\(items\.length<3\)return;/);
  assert.ok(distFn.indexOf('if(items.length<3)return;') < distFn.indexOf("el('status')"));
});

await test('19. the workspace has a real three-way view switch (Dual Workspace, 2D Canvas, Object Preview) that persists across a reload, Design is the true first-visit default (not Dual), and a narrow viewport (<900px) always overrides to 2D Canvas only without clobbering the saved preference', () => {
  assert.match(indexHtml, /id="viewTabDual"[^>]*class="tab active"|class="tab active"[^>]*id="viewTabDual"/);
  assert.match(indexHtml, /id="viewTab2D"/);
  assert.match(indexHtml, /id="viewTab3D"/);
  assert.match(appJs, /function setWorkspaceMode\(mode/);
  assert.match(appJs, /el\('viewTabDual'\)\.onclick=\(\)=>\{setWorkspaceMode\('dual'\);persistActiveView\('dual'\)\}/);
  assert.match(appJs, /el\('viewTab2D'\)\.onclick=\(\)=>\{setWorkspaceMode\('2d'\);persistActiveView\('2d'\)\}/);
  assert.match(appJs, /el\('viewTab3D'\)\.onclick=\(\)=>\{setWorkspaceMode\('preview'\);persistActiveView\('preview'\)\}/);

  const panel2D = indexHtml.match(/<section class="canvas-panel[^"]*" id="panel2D"/)[0];
  const panel3D = indexHtml.match(/<section class="canvas-panel[^"]*" id="panel3D"/)[0];
  assert.doesNotMatch(panel2D, /tab-hidden/);
  assert.doesNotMatch(panel3D, /tab-hidden/);
  assert.match(indexHtml, /class="workspace-canvas-area dual"/);
  assert.doesNotMatch(indexHtml, /id="toolbar3D"[^>]*style="display:none"/);

  assert.match(indexHtml, /\.workspace-canvas-area\.dual\{display:flex/);
  assert.match(indexHtml, /\.workspace-canvas-area\.dual \.canvas-panel\{position:relative/);
  assert.match(indexHtml, /\.canvas-panel\.tab-hidden\{visibility:hidden;pointer-events:none\}/);

  // RS-3011 Step 4: active view is persisted to its own localStorage key -- not routed through
  // AutosaveManager (project data only) -- and defaults to Design, not Dual, when nothing is
  // stored yet (first-ever visit).
  assert.match(appJs, /const ACTIVE_VIEW_STORAGE_KEY='rhinestoneStudio\.activeView'/);
  assert.match(appJs, /function loadActiveView\(\)/);
  assert.match(appJs, /function persistActiveView\(value\)/);
  assert.match(appJs, /let bootActiveView=loadActiveView\(\);/);
  assert.match(appJs, /if\(bootActiveView===null\)bootActiveView='design';/);

  // A narrow viewport (<900px) always overrides the resolved view to 2D Canvas only, even over a
  // saved 'design'/'dual' preference, and that override is never written back to storage.
  assert.match(appJs, /window\.matchMedia\('\(min-width: 900px\)'\)/);
  assert.match(appJs, /if\(!window\.matchMedia\('\(min-width: 900px\)'\)\.matches\)bootActiveView='2d';/);
  assert.match(appJs, /if\(bootActiveView!=='design'\)setWorkspaceMode\(bootActiveView,true\);/);

  // Entering Design (the fourth persisted view, via #menuDesign) persists 'design'. #menuDesign no
  // longer toggles -- clicking it while Design is already active is a no-op (matching
  // setDrawTool()'s own same-mode no-op convention), never an exit. There is no direct "exit
  // Design" button; Dual Workspace is reached only by opening one of the Lightboxes above.
  assert.match(appJs, /el\('menuDesign'\)\.onclick=\(\)=>\{\s*if\(drawingTool\.isActive\)return;\s*setDrawTool\('select'\);persistActiveView\('design'\);\s*\};/);
  assert.doesNotMatch(appJs, /el\('menuDesign'\)\.onclick=\(\)=>\{\s*if\(drawingTool\.isActive\)\{setDrawMode\(false\)/, 'expected #menuDesign to no longer have an exit branch');
  // A resolved 'design' boot view settles one real generation cycle (so #layoutStats is already at
  // its final height) before calling setDrawMode -- otherwise Paper.js's canvas resync locks in a
  // pre-generation box that shrinks out from under it moments later, a real regression caught by
  // comparing boot-time vs. click-triggered Design entry (RS-3011 Step 4 verification scenario g).
  // The settle step also visually suppresses .workspace (visibility:hidden, not display:none, so
  // #layoutStats etc. still measure/settle against their real box) for its duration -- CDP
  // screencast verification caught a real ~25-30ms painted flash of Dual Workspace otherwise.
  assert.match(appJs, /if\(bootActiveView==='design'\)\{\s*const workspaceEl=document\.querySelector\('\.workspace'\);\s*if\(workspaceEl\)workspaceEl\.style\.visibility='hidden';\s*setWorkspaceMode\('dual',true\);\s*await updateAll\(true\);\s*setDrawMode\(true,'select'\);\s*if\(workspaceEl\)workspaceEl\.style\.visibility='';\s*\}/);
});

await test('20. editing/rotation keeps updating both canvases regardless of view mode', () => {
  const updateAllFn = appJs.match(/async function updateAll\([\s\S]*?\n\}/)[0];
  assert.match(updateAllFn, /drawLayout\(\)/);
  assert.match(updateAllFn, /drawCup\(\)/);
  assert.doesNotMatch(updateAllFn, /workspaceMode===/, 'drawLayout/drawCup must not be gated on the view mode');
});

console.log('UI shell structure tests passed.');
