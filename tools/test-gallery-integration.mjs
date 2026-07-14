import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-2001 — verifies app.js/index.html are actually wired for the Gallery, that it reuses
// existing infrastructure (validateProject(), the Design Library's own save path, the thumbnail
// pipeline) rather than duplicating it, and that the milestone did not touch any forbidden module.
// Unlike every prior milestone's own guard, `examples/` is legitimately touched here (new
// fixtures + examples/gallery.json), so it is intentionally absent from this test's own forbidden
// list -- see docs/specifications/RS-2001-GalleryAcceptanceSuite.md.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

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

await test('1. index.html exposes a "Gallery" top-menu button', () => {
  assert.match(indexHtml, /<button class="topmenu-btn" id="menuGallery"[^>]*>/);
  assert.match(indexHtml, />Gallery</);
});

await test('2. index.html defines the Gallery lightbox and its preview lightbox', () => {
  // S-105: lightboxGallery is non-modal (see tools/test-ui001-dialog-behavior.mjs test 13);
  // lightboxGalleryPreview is a transient sub-dialog and intentionally stays fully modal.
  assert.match(indexHtml, /<div class="lightbox-overlay non-modal" id="lightboxGallery">/);
  assert.match(indexHtml, /<div class="lightbox-overlay" id="lightboxGalleryPreview">/);
});

await test('3. the Gallery lightbox has search, category filter, and a grid container, and reads as read-only', () => {
  assert.match(indexHtml, /<input id="gallerySearch" type="search"/);
  assert.match(indexHtml, /<select id="galleryCategoryFilter">/);
  assert.match(indexHtml, /<div class="library-grid gallery-grid" id="galleryGrid">/);
  assert.match(indexHtml, /gallery-readonly-hint/);
});

await test('4. the Gallery lightbox has no Save/Rename/Duplicate/Delete actions (read-only) and offers Open Copy + Save to Design Library', () => {
  const galleryLightboxMatch = indexHtml.match(/<div class="lightbox-overlay non-modal" id="lightboxGallery">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(galleryLightboxMatch, 'expected to find the Gallery lightbox markup');
  const markup = galleryLightboxMatch[0];
  assert.ok(!/data-action="delete"/.test(markup), 'the Gallery grid must not offer a delete action');
  assert.ok(!/data-action="rename"/.test(markup), 'the Gallery grid must not offer a rename action');
  assert.ok(!/data-action="duplicate"/.test(markup), 'the Gallery grid must not offer a duplicate action');
  assert.match(indexHtml, /id="galleryPreviewOpenCopy"/);
  assert.match(indexHtml, /id="galleryPreviewSaveToLibrary"/);
});

await test('5. app.js wires the top-menu button to open the Gallery lightbox', () => {
  assert.match(appJs, /el\('menuGallery'\)\.onclick=\(\)=>lightboxes\.gallery\.open\(\)/);
  assert.match(appJs, /gallery:new Lightbox\('lightboxGallery'/);
  assert.match(appJs, /galleryPreview:new Lightbox\('lightboxGalleryPreview'\)/);
});

// --- 2. Import boundary -----------------------------------------------------------------------

await test('6. app.js imports the Gallery only through its own barrel (src/gallery/index.js)', () => {
  assert.match(
    appJs,
    /import\s*\{\s*validateRhsProject,\s*toAppProjectShape,\s*parseCatalog,[\s\S]*?\}\s*from\s*['"]\.\/src\/gallery\/index\.js['"]/,
    'expected one named import statement pulling every Gallery symbol app.js uses from the barrel'
  );
  assert.ok(!appJs.includes("from './src/gallery/RhsFixtureBridge.js'"), 'app.js must not import an internal src/gallery/** file directly');
  assert.ok(!appJs.includes("from './src/gallery/GalleryCatalog.js'"), 'app.js must not import an internal src/gallery/** file directly');
});

// --- 3. Reuse, not duplication ------------------------------------------------------------------

await test('7. opening a Gallery item as a copy reuses the existing validateProject(), does not reimplement validation', () => {
  const fnMatch = appJs.match(/function buildAppProjectFromGalleryFile\(file,title\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find buildAppProjectFromGalleryFile() in app.js');
  assert.match(fnMatch[0], /validateProject\(\{\.\.\.appProjectShape,name:title\}\)/);
  assert.match(fnMatch[0], /toAppProjectShape\(rhsProject\)/);
  assert.match(fnMatch[0], /validateRhsProject\(fixture,file\)/);
});

await test('8. Gallery thumbnail generation reuses generateProjectThumbnail() -- no second thumbnail renderer', () => {
  const fnMatch = appJs.match(/async function generateGalleryThumbnail\(file,title\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find generateGalleryThumbnail() in app.js');
  assert.match(fnMatch[0], /generateProjectThumbnail\(/);
  const thumbFnMatch = appJs.match(/async function generateProjectThumbnail\(tempProject\)\{[\s\S]*?\n\}/);
  assert.ok(thumbFnMatch, 'expected a single generateProjectThumbnail() shared by Library and Gallery');
  assert.match(thumbFnMatch[0], /engine\.generate\(tempProject\)/);
  assert.match(thumbFnMatch[0], /renderProductionLayout\(/);
  assert.ok(!/new\s+GeometryEngine\(/.test(thumbFnMatch[0]), 'must reuse the existing engine bridge, not construct a second one');
});

await test('9. "Open Copy" mirrors the existing Project-Import/Design-Library history-reset shape (history.clear() + dirty baseline reset)', () => {
  const fnMatch = appJs.match(/async function openGalleryItemAsCopy\(file\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find openGalleryItemAsCopy() in app.js');
  assert.match(fnMatch[0], /history\.clear\(\)/);
  assert.match(fnMatch[0], /cleanProjectJson=JSON\.stringify\(project\)/);
});

await test('10. "Save to Design Library" reuses buildProjectItemData()/designLibrary.add(), a second storage/UI system is not introduced', () => {
  const fnMatch = appJs.match(/async function saveGalleryItemToLibrary\(file\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find saveGalleryItemToLibrary() in app.js');
  assert.match(fnMatch[0], /buildProjectItemData\(appProject\)/);
  assert.match(fnMatch[0], /designLibrary\.add\(\{kind:'project'/);
});

await test('11. the Gallery source fixture is never mutated when opening a copy or saving to the Library (deep clone every time)', () => {
  const fnMatch = appJs.match(/function buildAppProjectFromGalleryFile\(file,title\)\{[\s\S]*?\n\}/);
  assert.match(fnMatch[0], /const fixture=galleryFixtures\[file\]/);
  assert.match(fnMatch[0], /validateRhsProject\(fixture,file\)/, 'validateRhsProject() returns a normalized deep clone, never the input object');
});

// --- 4. No new runtime dependency ----------------------------------------------------------------

await test('12. no new npm dependency was introduced', () => {
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), ['opentype.js', 'three']);
});

// --- 5. Forbidden-file guard (this milestone's own; examples/ is intentionally NOT forbidden) -----

await test('13. no forbidden file/prefix changed on this branch (GeometryEngine/StoneLayout/renderer/exporter/editing/history/products/text/fonts/svg/image/preview3d/core/browser/ui/library untouched; style.css/README/LICENSE/CONTRIBUTING untouched)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const forbiddenPrefixes = [
    // RS-2002: assets/fonts/** is legitimately expanded by the Typography & Font Library milestone (new bundled font files + manifest entries).
    'src/geometry/', 'src/renderer/', 'src/export/', 'src/editing/', 'src/history/', 'src/products/', 'src/text/', 'src/fonts/', 'src/svg/', 'src/image/', 'src/preview3d/', 'src/browser/', 'src/ui/', 'src/library/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Gallery integration tests passed.');
