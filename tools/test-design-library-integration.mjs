import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1015 — verifies app.js/index.html are actually wired for the Design Library, and that the
// milestone did not touch any forbidden module (GeometryEngine/StoneLayout/renderer/exporter/
// editing/history/products/text/fonts/svg/image/preview3d/core/browser/ui remain byte-unchanged,
// per every prior milestone's own "no forbidden files changed" convention -- see
// docs/specifications/RS-1015-DesignLibrary.md). app.js is a browser entry point (top-level DOM
// calls), not import()-able directly under plain Node, so this file uses the same established
// structural-source-check + extract-and-execute-the-real-function technique as
// tools/test-object-template-integration.mjs / tools/test-examples-regression.mjs, rather than
// re-implementing any app.js logic.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

const { getObjectTemplate } = await import('../src/products/index.js');
const { buildProjectFromItem, buildSelectionItemData, createLibraryItem } = await import('../src/library/index.js');
// S-110: validateProject() (and its own extracted slice's SUPPORTED_LAYER_TYPES declaration) now
// references XYWH_SHAPE_TYPES/SHAPE_LIBRARY_KINDS (module-level constants declared well before the
// extracted slice begins) -- both injected as function parameters below, for the same reason
// getObjectTemplate already is.
const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
const XYWH_SHAPE_TYPES = new Set(['rectangle', 'svg', 'image', 'path', ...SHAPE_LIBRARY_KINDS]);

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

// --- 1. Menu / Lightbox wiring --------------------------------------------------------------

await test('1. index.html exposes a "Design Library" top-menu button', () => {
  assert.match(indexHtml, /<button class="topmenu-btn" id="menuLibrary"[^>]*>/);
  assert.match(indexHtml, /Design Library/);
});

await test('2. index.html defines the Design Library lightbox and its delete-confirmation lightbox', () => {
  // S-105: lightboxLibrary is non-modal (see tools/test-ui001-dialog-behavior.mjs test 13);
  // lightboxLibraryConfirm is a transient sub-dialog and intentionally stays fully modal.
  assert.match(indexHtml, /<div class="lightbox-overlay non-modal" id="lightboxLibrary">/);
  assert.match(indexHtml, /<div class="lightbox-overlay" id="lightboxLibraryConfirm">/);
});

await test('3. index.html\'s Design Library lightbox has search, category filter, sort, and a grid container', () => {
  assert.match(indexHtml, /<input id="librarySearch" type="search"/);
  assert.match(indexHtml, /<select id="libraryCategoryFilter">/);
  assert.match(indexHtml, /<select id="librarySort">/);
  assert.match(indexHtml, /<div class="library-grid" id="libraryGrid">/);
  assert.match(indexHtml, /id="libraryEmptyState"/);
  assert.match(indexHtml, /id="libraryNoResults"/);
});

await test('4. index.html\'s Design Library lightbox has Save Whole Project and Save Selection actions', () => {
  assert.match(indexHtml, /<button class="btn primary" id="librarySaveProject"/);
  assert.match(indexHtml, /<button class="btn" id="librarySaveSelection"[^>]*disabled/);
});

await test('5. app.js wires the top-menu button to open the Design Library lightbox', () => {
  assert.match(appJs, /el\('menuLibrary'\)\.onclick=\(\)=>lightboxes\.library\.open\(\)/);
  assert.match(appJs, /library:new Lightbox\('lightboxLibrary'/);
  assert.match(appJs, /libraryConfirm:new Lightbox\('lightboxLibraryConfirm'\)/);
});

// --- 2. Import boundary -----------------------------------------------------------------------

await test('6. app.js imports the Design Library only through its own barrel (src/library/index.js)', () => {
  assert.match(
    appJs,
    /import\s*\{\s*DesignLibrary,\s*createLocalStorageAdapter,\s*createMemoryStorageAdapter,\s*buildSelectionItemData,\s*buildProjectItemData,\s*buildProjectFromItem,\s*prepareLayersForInsert,\s*getInsertableLayers\s*\}\s*from\s*['"]\.\/src\/library\/index\.js['"]/,
    'expected one named import statement pulling every Design Library symbol app.js uses from the barrel'
  );
  assert.ok(!appJs.includes("from './src/library/LibraryItem.js'"), 'app.js must not import an internal src/library/** file directly');
  assert.ok(!appJs.includes("from './src/library/DesignLibrary.js'"), 'app.js must not import an internal src/library/** file directly');
  assert.ok(!appJs.includes("from './src/library/LibraryTransform.js'"), 'app.js must not import an internal src/library/** file directly');
  assert.ok(!appJs.includes("from './src/library/LibraryStorageAdapter.js'"), 'app.js must not import an internal src/library/** file directly');
});

// --- 3. Reuse, not duplication ------------------------------------------------------------------

await test('7. "New Project From This" reuses the existing validateProject(), does not reimplement validation', () => {
  assert.match(appJs, /project=validateProject\(built\)/, 'expected createProjectFromLibraryItem() to pass buildProjectFromItem()\'s output through the existing validateProject()');
});

await test('8. thumbnail generation reuses the existing engine.generate()/renderProductionLayout() pipeline (no second rendering pipeline)', () => {
  // RS-2001: generateLibraryThumbnail() was generalized to generateProjectThumbnail() so the
  // Gallery could reuse the exact same function instead of a second thumbnail renderer.
  const fnMatch = appJs.match(/async function generateProjectThumbnail\(tempProject\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find generateProjectThumbnail() in app.js');
  assert.match(fnMatch[0], /engine\.generate\(tempProject\)/);
  assert.match(fnMatch[0], /renderProductionLayout\(/);
  assert.ok(!/new\s+GeometryEngine\(/.test(fnMatch[0]), 'must reuse the existing engine bridge, not construct a second one');
});

await test('9. inserting a library item reuses commitHistory()/updateAll() (undo/redo comes for free, no special-cased geometry path)', () => {
  const fnMatch = appJs.match(/function insertLibraryItem\(id\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find insertLibraryItem() in app.js');
  assert.match(fnMatch[0], /commitHistory\(\)/);
  assert.match(fnMatch[0], /updateAll\(true\)/);
  assert.match(fnMatch[0], /prepareLayersForInsert\(getInsertableLayers\(item\)\)/);
});

await test('10. "New Project From This" mirrors the existing Project-Import history-reset shape (history.clear() + dirty baseline reset)', () => {
  const fnMatch = appJs.match(/function createProjectFromLibraryItem\(id\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find createProjectFromLibraryItem() in app.js');
  assert.match(fnMatch[0], /history\.clear\(\)/);
  assert.match(fnMatch[0], /cleanProjectJson=JSON\.stringify\(project\)/);
});

await test('11. deleting a library item requires confirmation before removal', () => {
  assert.match(appJs, /function requestDeleteLibraryItem\(id\)\{[\s\S]*?lightboxes\.libraryConfirm\.open\(\)/);
  assert.match(appJs, /el\('libraryConfirmDelete'\)\.onclick=\(\)=>\{[\s\S]*?designLibrary\.remove\(pendingLibraryDeleteId\)/);
});

// --- 4. Cross-module compatibility (executable, not just structural) ---------------------------

await test("12. buildProjectFromItem()'s output for a 'project' item passes the app.js-native validateProject()", async () => {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  assert.ok(validateMatch, 'expected to find validateProject() in app.js');
  const constantsStart = appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set');
  const source = appJs.slice(constantsStart, appJs.indexOf(validateMatch[0]) + validateMatch[0].length);
  // eslint-disable-next-line no-new-func
  const { validateProject } = new Function('getObjectTemplate', 'XYWH_SHAPE_TYPES', 'SHAPE_LIBRARY_KINDS', `${source}\nreturn { validateProject };`)(getObjectTemplate, XYWH_SHAPE_TYPES, SHAPE_LIBRARY_KINDS);

  const storedProject = {
    version: 2, units: 'mm', name: 'Saved Project', product: 'mug',
    canvas: { width: 210, height: 90 }, cupColor: '#1f3556', wrap: 'front',
    layers: [{ id: 'text-1', type: 'text', visible: true, text: 'Hi', x: 0, y: 0, stoneSize: 2, gap: 0.3, color: 'gold' }]
  };
  const item = createLibraryItem({ kind: 'project', name: 'Saved Project', data: { project: storedProject } });
  const built = buildProjectFromItem(item, { defaultProduct: 'mug', defaultCupColor: '#1f3556', defaultWrap: 'front', projectVersion: 2 });

  const validated = validateProject(built);
  assert.equal(validated.layers.length, 1);
  assert.equal(validated.layers[0].text, 'Hi');
  assert.deepEqual(validated.canvas, storedProject.canvas);
});

await test("13. buildProjectFromItem()'s output for a 'selection' item also passes validateProject()", async () => {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  const constantsStart = appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set');
  const source = appJs.slice(constantsStart, appJs.indexOf(validateMatch[0]) + validateMatch[0].length);
  // eslint-disable-next-line no-new-func
  const { validateProject } = new Function('getObjectTemplate', 'XYWH_SHAPE_TYPES', 'SHAPE_LIBRARY_KINDS', `${source}\nreturn { validateProject };`)(getObjectTemplate, XYWH_SHAPE_TYPES, SHAPE_LIBRARY_KINDS);

  const layers = [{ id: 'circle-1', type: 'circle', visible: true, cx: 105, cy: 45, r: 18, stoneSize: 2, gap: 0.3, color: 'gold' }];
  const data = buildSelectionItemData(layers, { width: 210, height: 90 });
  const item = createLibraryItem({ kind: 'selection', name: 'Some Shapes', data });
  const built = buildProjectFromItem(item, { defaultProduct: 'mug', defaultCupColor: '#1f3556', defaultWrap: 'front', projectVersion: 2 });

  const validated = validateProject(built);
  assert.equal(validated.layers.length, 1);
  assert.equal(validated.layers[0].type, 'circle');
});

// --- 5. No new runtime dependency ----------------------------------------------------------------

await test('14. no new npm dependency was introduced', () => {
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), ['opentype.js', 'three']);
});

// --- 6. Forbidden-file guard (this milestone's own, mirroring every prior milestone's convention) -
console.log('Design Library integration tests passed.');
