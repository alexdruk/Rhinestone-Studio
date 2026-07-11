import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1002 — verifies app.js is actually wired to src/history/HistoryManager.js for every required
// undoable operation, that continuous edits are coalesced into one undo step per session, that
// history is cleared on Project JSON import and untouched by every export action, and that the
// keyboard shortcuts/toolbar buttons/dirty indicator are wired correctly. Structural checks against
// the live app.js/index.html source, matching the existing convention in
// tools/test-svg-integration.mjs/tools/test-shape-geometry-integration.mjs, because app.js is a
// browser entry point and is not import()-able directly under plain Node.

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

await test('1. app.js imports HistoryManager and constructs it with a configurable maxSize constant', () => {
  assert.match(appJs, /import\s*\{\s*HistoryManager\s*\}\s*from\s*['"]\.\/src\/history\/index\.js['"]/);
  assert.match(appJs, /const HISTORY_MAX_SIZE=\d+/, 'expected a named, configurable history size constant');
  assert.match(appJs, /new HistoryManager\(\{maxSize:HISTORY_MAX_SIZE\}\)/);
});

await test('2. the history wiring functions are defined, and currentSnapshot() never touches generated geometry', () => {
  for (const fn of ['currentSnapshot', 'commitHistory', 'openHistorySession', 'closeHistorySession', 'performUndo', 'performRedo', 'applyHistorySnapshot', 'updateHistoryUI']) {
    assert.match(appJs, new RegExp(`function ${fn}\\s*\\(`), `expected app.js to define ${fn}()`);
  }
  const snapshotMatch = appJs.match(/function currentSnapshot\(\)\{([\s\S]*?)\}\n/);
  assert.ok(snapshotMatch, 'expected to find currentSnapshot() body');
  assert.ok(!snapshotMatch[1].includes('layout'), 'currentSnapshot() must never reference the generated layout/StoneLayout');
  assert.match(snapshotMatch[1], /project:JSON\.parse\(JSON\.stringify\(project\)\)/, 'currentSnapshot() must deep-clone project');
  assert.match(snapshotMatch[1], /selectedLayerId/);
});

await test('3. every discrete mutation site commits history before its first project mutation', () => {
  const duplicate = appJs.match(/function duplicateLayer\(id\)\{([\s\S]*?)\}function deleteLayer/);
  assert.ok(duplicate, 'expected to find duplicateLayer()');
  assert.match(duplicate[1], /commitHistory\(\);const copy=/, 'duplicateLayer must commit history before cloning/pushing');

  const del = appJs.match(/function deleteLayer\(id\)\{([\s\S]*?)\}\nfunction pointerToLayout/);
  assert.ok(del, 'expected to find deleteLayer()');
  assert.match(del[1], /commitHistory\(\);project\.layers=project\.layers\.filter/, 'deleteLayer must commit history before filtering layers');

  assert.match(appJs, /if\(action==='visible'\)\{const l=project\.layers\.find\(x=>x\.id===id\);commitHistory\(\);l\.visible=e\.target\.checked/, 'visibility toggle must commit history before mutating l.visible');

  assert.match(appJs, /el\('addCircle'\)\.onclick=\(\)=>\{const l=selectedLayer\(\);commitHistory\(\);const layer=/, 'addCircle must commit history before constructing the new layer');
  assert.match(appJs, /el\('addRect'\)\.onclick=\(\)=>\{const l=selectedLayer\(\);commitHistory\(\);const layer=/, 'addRect must commit history before constructing the new layer');

  const svgHandler = appJs.match(/el\('importSvgFile'\)\.addEventListener\('change',async e=>\{([\s\S]*?)\}\);/);
  assert.ok(svgHandler, 'expected the importSvgFile change handler body');
  assert.match(svgHandler[1], /commitHistory\(\);project\.layers\.push\(layer\)/, 'SVG import must commit history immediately before pushing the new layer');

  assert.match(appJs, /if\(hit\.kind==='select'\)\{updateAll\(\);return\}commitHistory\(\);drag=\{/, 'the pointerdown drag-start handler must commit history before entering drag mode');
});

await test('4. continuous project-affecting controls open/close a history session; rotation/zoom are excluded', () => {
  const listMatch = appJs.match(/const HISTORY_TRACKED_CONTROL_IDS=\[([\s\S]*?)\];/);
  assert.ok(listMatch, 'expected a HISTORY_TRACKED_CONTROL_IDS constant');
  const ids = JSON.parse(`[${listMatch[1].replace(/'/g, '"')}]`);
  for (const expected of ['text', 'font', 'height', 'stoneSize', 'gap', 'stoneColor', 'cupColor', 'autoFit', 'wrap', 'textMode', 'shapeX', 'shapeY', 'shapeW', 'shapeH', 'svgMode']) {
    assert.ok(ids.includes(expected), `expected HISTORY_TRACKED_CONTROL_IDS to include ${expected}`);
  }
  assert.ok(!ids.includes('rotation'), 'rotation is view-only and must not be history-tracked');
  assert.ok(!ids.includes('zoom'), 'zoom is view-only and must not be history-tracked');

  assert.match(
    appJs,
    /for\(const id of HISTORY_TRACKED_CONTROL_IDS\)\{el\(id\)\.addEventListener\('input',\(\)=>\{openHistorySession\(\);updateAll\(\)\}\);el\(id\)\.addEventListener\('change',\(\)=>closeHistorySession\(\)\)\}/,
    'expected tracked controls to open a session on input and close it on change'
  );
  assert.match(
    appJs,
    /for\(const id of \['rotation','zoom'\]\)el\(id\)\.addEventListener\('input',\(\)=>updateAll\(\)\)/,
    'expected rotation/zoom to keep a plain updateAll()-only input listener'
  );
});

await test('5. Project JSON import clears history instead of committing it, and resets the dirty baseline', () => {
  const handlerMatch = appJs.match(/el\('importProjectFile'\)\.addEventListener\('change',async e=>\{([\s\S]*?)\}\);/);
  assert.ok(handlerMatch, 'expected the importProjectFile change handler body');
  const body = handlerMatch[1];
  assert.match(body, /history\.clear\(\)/, 'Project JSON import must clear history (a fresh project, not an undoable edit)');
  assert.match(body, /cleanProjectJson=JSON\.stringify\(project\)/, 'Project JSON import must reset the dirty baseline');
  assert.ok(!/commitHistory\(\)/.test(body), 'Project JSON import must not commit an undo step');
});

await test('6. every export handler leaves history untouched (history survives exports)', () => {
  const exportSection = appJs.slice(appJs.indexOf("el('exportProject')"), appJs.indexOf('let cupDrag'));
  assert.ok(exportSection.length > 0, 'expected to find the export handlers section');
  for (const id of ['exportLayout', 'exportSVG', 'exportPNG', 'exportCup']) {
    const handlerMatch = exportSection.match(new RegExp(`el\\('${id}'\\)\\.onclick=\\(\\)=>\\{([\\s\\S]*?)\\}\\};`));
    assert.ok(handlerMatch, `expected to find the #${id} handler`);
    assert.ok(!/\bhistory\b/.test(handlerMatch[1]), `#${id} must not reference history in any way`);
  }
  // exportProject legitimately updates the dirty baseline (history.clear()/commit() must still be absent).
  const exportProjectMatch = exportSection.match(/el\('exportProject'\)\.onclick=\(\)=>\{([\s\S]*?)\}\};/);
  assert.ok(exportProjectMatch, 'expected to find the #exportProject handler');
  assert.ok(!/history\.(clear|commit)\(/.test(exportProjectMatch[1]), 'Export Project JSON must not clear or commit history');
  assert.match(exportProjectMatch[1], /cleanProjectJson=JSON\.stringify\(project\)/, 'Export Project JSON should mark the project as saved/clean');
});

await test('7. undo/redo restore regenerates geometry, and updateAll() refreshes the history UI', () => {
  assert.match(
    appJs,
    /function applyHistorySnapshot\(snap\)\{project=snap\.project;selectedLayerId=snap\.selectedLayerId;syncSelectedControlsFromLayer\(\);updateAll\(true\)\}/,
    'applyHistorySnapshot must restore project/selectedLayerId then regenerate via updateAll(true)'
  );
  assert.match(appJs, /updateStats\(\);updateHistoryUI\(\);/, 'updateAll() must refresh undo/redo button state and the dirty indicator after every regeneration');
});

await test('8. the keydown listener handles Ctrl/Cmd+Z, +Shift+Z, and Ctrl/Cmd+Y, each preventing default', () => {
  const handlerMatch = appJs.match(/window\.addEventListener\('keydown',e=>\{([\s\S]*?)\n\}\);/);
  assert.ok(handlerMatch, 'expected the keydown handler body');
  const body = handlerMatch[1];
  assert.match(body, /mod=e\.ctrlKey\|\|e\.metaKey/, 'expected a ctrlKey||metaKey modifier check');
  assert.match(body, /key==='z'\)\{e\.preventDefault\(\);if\(e\.shiftKey\)performRedo\(\);else performUndo\(\)/, 'expected Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z to redo, both preventing default');
  assert.match(body, /key==='y'\)\{e\.preventDefault\(\);performRedo\(\)/, 'expected Ctrl/Cmd+Y to redo, preventing default');
  // The pre-existing Delete/Backspace-deletes-selected-layer behavior must be preserved.
  assert.match(body, /deleteLayer\(selectedLayerId\)/);
});

await test('9. index.html exposes #undoBtn/#redoBtn/#dirtyIndicator, wired to performUndo/performRedo', () => {
  assert.match(indexHtml, /<button id="undoBtn"[^>]*disabled>/);
  assert.match(indexHtml, /<button id="redoBtn"[^>]*disabled>/);
  assert.match(indexHtml, /<span id="dirtyIndicator"/);
  assert.match(appJs, /el\('undoBtn'\)\.onclick=\(\)=>performUndo\(\)/);
  assert.match(appJs, /el\('redoBtn'\)\.onclick=\(\)=>performRedo\(\)/);
  assert.match(appJs, /function updateHistoryUI\(\)\{[\s\S]*?el\('undoBtn'\)[\s\S]*?el\('redoBtn'\)[\s\S]*?el\('dirtyIndicator'\)/);
});

await test('10. no forbidden file changed (this milestone\'s own forbidden list)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  // src/renderer/ is legitimately changed by S-001 (cup rendering/rotation stabilization) — see
  // tools/test-cup-rotation-stabilization.mjs for that milestone's own forbidden-file guard.
  const forbiddenPrefixes = [
    'src/text/', 'src/fonts/', 'src/core/', 'src/browser/', 'src/export/',
    'src/geometry/', 'src/svg/', 'src/products/', 'assets/', 'examples/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Undo/redo integration tests passed.');
