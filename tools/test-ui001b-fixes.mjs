import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// UI-001A/UI-001B — verifies the three fixes/additions made on top of the UI-001 redesign:
// (1) Project Import failure/success feedback is actually visible while the Import Lightbox
//     (a full-viewport overlay) is open, not written only to the now-hidden #status element;
// (2) Align/Distribute report what they did, matching every other mutating action;
// (3) Dual Workspace (2D Canvas + Object Preview shown together) is the default desktop layout,
//     with a real three-way switch (Dual / 2D only / Preview only) for smaller screens, and the
//     "grid always on" label reads clearly without requiring the tooltip.
// Structural checks against the live app.js/index.html source, matching the established
// convention in tools/test-alignment-snapping-integration.mjs (app.js is a browser entry point,
// not import()-able directly under plain Node).

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
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

await test('1. the Import Lightbox has a dedicated #importProjectValidation element, and app.js actually writes into it on both the success and failure paths of the Project Import handler', () => {
  assert.match(indexHtml, /id="importProjectValidation"/);
  const handler = appJs.match(/el\('importProjectFile'\)\.addEventListener\('change',[\s\S]*?\}\);/);
  assert.ok(handler, 'expected to find the #importProjectFile change handler in app.js');
  const body = handler[0];
  assert.match(body, /importProjectValidation/, 'expected the handler to reference #importProjectValidation, not just #status');
  assert.match(body, /catch\(error\)\{[\s\S]*validationEl\.textContent=/, 'expected the failure branch to write the error into the validation element');
});

await test('2. a failed Project Import leaves the dialog open (so the visible error can be read) and a successful import closes it (so the imported project is immediately visible)', () => {
  const handler = appJs.match(/el\('importProjectFile'\)\.addEventListener\('change',[\s\S]*?\}\);/)[0];
  assert.match(handler, /lightboxes\.importBox\.close\(\)/, 'expected success to close the Import Lightbox');
  const catchBranch = handler.slice(handler.indexOf('catch(error)'));
  assert.doesNotMatch(catchBranch, /\.close\(\)/, 'expected the failure branch not to close the dialog');
});

await test('3. runAlign/runDistribute report what they did via #status, like every other mutating action', () => {
  assert.match(appJs, /function runAlign\(direction\)\{[\s\S]*?el\('status'\)\.textContent=/);
  assert.match(appJs, /function runDistribute\(axis\)\{[\s\S]*?el\('status'\)\.textContent=/);
});

await test('4. align/distribute status messages only fire after a real mutation (the early-return guards for <2/<3 selected items still exist and precede the status write)', () => {
  const alignFn = appJs.match(/function runAlign\(direction\)\{([\s\S]*?)\}\n/)[1];
  assert.match(alignFn, /if\(items\.length<2\)return;/);
  assert.ok(alignFn.indexOf('if(items.length<2)return;') < alignFn.indexOf("el('status')"));
  const distFn = appJs.match(/function runDistribute\(axis\)\{([\s\S]*?)\}\n/)[1];
  assert.match(distFn, /if\(items\.length<3\)return;/);
  assert.ok(distFn.indexOf('if(items.length<3)return;') < distFn.indexOf("el('status')"));
});

await test('5. the workspace has a real three-way view switch: Dual Workspace, 2D Canvas, Object Preview', () => {
  assert.match(indexHtml, /id="viewTabDual"[^>]*class="tab active"|class="tab active"[^>]*id="viewTabDual"/);
  assert.match(indexHtml, /id="viewTab2D"/);
  assert.match(indexHtml, /id="viewTab3D"/);
  assert.match(appJs, /function setWorkspaceMode\(mode/);
  assert.match(appJs, /el\('viewTabDual'\)\.onclick=\(\)=>setWorkspaceMode\('dual'\)/);
  assert.match(appJs, /el\('viewTab2D'\)\.onclick=\(\)=>setWorkspaceMode\('2d'\)/);
  assert.match(appJs, /el\('viewTab3D'\)\.onclick=\(\)=>setWorkspaceMode\('preview'\)/);
});

await test('6. Dual Workspace is the default: both canvas panels start visible (no tab-hidden class in the static markup) and the canvas area starts with the .dual layout class', () => {
  const panel2D = indexHtml.match(/<section class="canvas-panel[^"]*" id="panel2D"/)[0];
  const panel3D = indexHtml.match(/<section class="canvas-panel[^"]*" id="panel3D"/)[0];
  assert.doesNotMatch(panel2D, /tab-hidden/);
  assert.doesNotMatch(panel3D, /tab-hidden/);
  assert.match(indexHtml, /class="workspace-canvas-area dual"/);
  assert.doesNotMatch(indexHtml, /id="toolbar3D"[^>]*style="display:none"/, 'expected toolbar3D to no longer be hardcoded hidden, since Dual Workspace shows both toolbars');
});

await test('7. a real CSS rule lays the two canvas panels out side by side in Dual mode (not stacked/absolute), so both keep a real non-zero pixel box (no re-introduction of the Export Cup PNG 0x0 regression)', () => {
  assert.match(indexHtml, /\.workspace-canvas-area\.dual\{display:flex/);
  assert.match(indexHtml, /\.workspace-canvas-area\.dual \.canvas-panel\{position:relative/);
  // the single-view fallback (.tab-hidden -> visibility:hidden, never display:none) must still exist
  assert.match(indexHtml, /\.canvas-panel\.tab-hidden\{visibility:hidden;pointer-events:none\}/);
});

await test('8. smaller screens start collapsed to a single view instead of forcing Dual Workspace, without overriding a later manual switch', () => {
  assert.match(appJs, /window\.matchMedia\('\(min-width: 900px\)'\)/);
  assert.match(appJs, /setWorkspaceMode\('2d',true\)/);
});

await test('9. editing/rotation keeps updating both canvases regardless of view mode (no per-mode branch skips drawLayout/drawCup) -- updateAll() is unconditional, matching the pre-existing "both canvases always render" architecture', () => {
  const updateAllFn = appJs.match(/async function updateAll\([\s\S]*?\n\}/)[0];
  assert.match(updateAllFn, /drawLayout\(\)/);
  assert.match(updateAllFn, /drawCup\(\)/);
  assert.doesNotMatch(updateAllFn, /workspaceMode===/, 'drawLayout/drawCup must not be gated on the view mode');
});

await test('10. the grid toolbar label reads clearly on its own, without requiring the tooltip to understand what it means', () => {
  const label = indexHtml.match(/<span class="hint"[^>]*>[^<]*always on[^<]*<\/span>/i);
  assert.ok(label, 'expected to find the grid-always-on label');
  assert.doesNotMatch(label[0], />#&nbsp;always on</, 'the old bare "# always on" label (unexplained "#" glyph) should be gone');
  assert.match(label[0], /grid/i, 'the visible text itself should say "grid", not rely solely on the tooltip');
});

await test('11. no forbidden file changed (GeometryEngine, StoneLayout, exporters, renderer, project schema, and every other prior milestone\'s forbidden list)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  // src/editing/** was UI-001's own forbidden dir ("do not extend Alignment & Snapping" --
  // relocate its UI only) but this guard checks live `git status`, not a diff scoped to UI-001's
  // own commit, so it also has to reflect every later milestone's scope; RS-1010 (Alignment &
  // Snapping Upgrade) legitimately extends src/editing/Selection.js, so it is no longer forbidden
  // here -- see tools/test-alignment-snapping-upgrade.mjs for RS-1010's own guard.
  const forbiddenPrefixes = [
    'src/geometry/', 'src/renderer/', 'src/export/', 'src/text/', 'src/fonts/', 'src/core/',
    'src/browser/', 'src/svg/', 'src/image/', 'src/history/', 'src/products/', 'src/preview3d/',
    'assets/', 'examples/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('UI-001A/UI-001B fix tests passed.');
