import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-0003.5C1 — verifies app.js is actually wired to the permanent GeometryEngine's
// generateShapeLayout() for circle/rectangle layers. RS-2000 deleted the legacy shape
// generators (generateCircle/generateRect) entirely once end-to-end + browser validation
// confirmed the permanent engine fully replaced them -- see
// docs/specifications/RS-2000-MVPStabilizationValidation.md. Structural checks against the
// live app.js source, matching the existing
// convention in tools/test-live-text-integration.mjs, because app.js is a browser entry point
// and is not import()-able directly under plain Node the way the permanent src/** modules are.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
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

await test('1. generate() routes circle and rectangle layers through a live shape-generation method', () => {
  assert.match(
    appJs,
    /l\.type==='circle'\|\|l\.type==='rectangle'\)raw\.push\(\.\.\.await this\.generateShapeStonesLive\(l\)\)/,
    'expected generate() to call generateShapeStonesLive for circle/rectangle layers'
  );
});

await test('2. the live shape-generation method calls the permanent engine\'s generateShapeLayout', () => {
  assert.match(appJs, /async generateShapeStonesLive\s*\(/, 'expected an async generateShapeStonesLive method');
  assert.match(appJs, /this\.permanentEngine\.generateShapeLayout\(/, 'expected a call to generateShapeLayout on the permanent engine');
});

await test('3. circle layers pass shape/cxMm/cyMm/radiusMm; rectangle layers pass shape/xMm/yMm/widthMm/heightMm', () => {
  assert.match(appJs, /shape:layer\.type/, 'expected the layer type to be forwarded as the shape parameter');
  assert.match(appJs, /cxMm:layer\.cx,cyMm:layer\.cy,radiusMm:layer\.r/, 'expected circle params to map cx/cy/r to cxMm/cyMm/radiusMm');
  assert.match(appJs, /xMm:layer\.x,yMm:layer\.y,widthMm:layer\.w,heightMm:layer\.h/, 'expected rectangle params to map x/y/w/h to xMm/yMm/widthMm/heightMm');
});

await test('4. stoneSizeMm, gapMm, mode, and color are forwarded for shape generation', () => {
  // RS-1011: mode is now layer.fillMode (resolved through resolveVectorFillMode(), defaulting to
  // 'outline' for any pre-RS-1011 layer with no fillMode field -- see
  // docs/specifications/RS-1011-FillAlgorithms.md) instead of the hard-coded 'outline' this
  // milestone's shape layers used to always pass.
  assert.match(appJs, /stoneSizeMm:layer\.stoneSize,gapMm:layer\.gap,mode:resolveVectorFillMode\(layer\.fillMode\),color:layer\.color/);
});

await test('5. RS-2000: the legacy generateCircle/generateRect methods have been deleted, not merely unused', () => {
  assert.ok(!appJs.includes('generateCircle(l){'), 'expected the legacy generateCircle() to be deleted');
  assert.ok(!appJs.includes('generateRect(l){'), 'expected the legacy generateRect() to be deleted');
});

await test('6. the legacy generateCircle/generateRect methods are no longer called from generate()', () => {
  assert.ok(
    !/type==='circle'\)raw\.push\(\.\.\.this\.generateCircle\(l\)\)/.test(appJs),
    'the legacy generateCircle() must no longer be invoked for circle layers'
  );
  assert.ok(
    !/type==='rectangle'\)raw\.push\(\.\.\.this\.generateRect\(l\)\)/.test(appJs),
    'the legacy generateRect() must no longer be invoked for rectangle layers'
  );
});

await test('7. app.js only imports modules allowed as of this milestone', () => {
  // RS-0003.5C2 legitimately added four more imports (src/renderer/**, src/export/**) for the
  // rendering-pipeline extraction; RS-1001 legitimately added src/svg/index.js for SVG import
  // pre-validation. This assertion checks that every import line matches one of the allowed
  // modules across all of those milestones, rather than a hard-coded count.
  const importLines = appJs.match(/^\s*import\b.*$/gm) || [];
  const allowed = [
    /BrowserDependencyProbe\.js/,
    /from\s*['"]\.\/src\/geometry\/index\.js['"]/,
    /from\s*['"]\.\/src\/fonts\/index\.js['"]/,
    /from\s*['"]\.\/src\/text\/index\.js['"]/,
    /from\s*['"]\.\/src\/renderer\/CanvasRenderer2D\.js['"]/,
    /from\s*['"]\.\/src\/renderer\/CupRenderer\.js['"]/,
    /from\s*['"]\.\/src\/renderer\/StoneColors\.js['"]/,
    // RS-1013: the Stone Library catalog module, mirroring the StoneColors.js entry above.
    /from\s*['"]\.\/src\/renderer\/StoneSizes\.js['"]/,
    /from\s*['"]\.\/src\/export\/SvgExporter\.js['"]/,
    /from\s*['"]\.\/src\/svg\/index\.js['"]/,
    /from\s*['"]\.\/src\/history\/index\.js['"]/,
    // RS-1004: activates the previously-inert src/products/** module (object-template registry).
    /from\s*['"]\.\/src\/products\/index\.js['"]/,
    // RS-1005: Production Sheet export. src/export/** has no barrel index.js (SvgExporter.js above
    // is likewise imported directly), so each individual export module app.js uses is listed here.
    /from\s*['"]\.\/src\/export\/ProductionSheetExporter\.js['"]/,
    // RS-1006: the real 3D preview's own barrel module.
    /from\s*['"]\.\/src\/preview3d\/index\.js['"]/,
    // RS-1008: Image Trace's own barrel module, mirroring the src/svg/index.js entry above.
    /from\s*['"]\.\/src\/image\/index\.js['"]/,
    // RS-1009: Alignment & Snapping's own barrel module.
    /from\s*['"]\.\/src\/editing\/index\.js['"]/,
    // UI-001: the new generic Lightbox/dialog-controller module's own barrel module.
    /from\s*['"]\.\/src\/ui\/index\.js['"]/,
    // RS-1015: the Design Library's own barrel module.
    /from\s*['"]\.\/src\/library\/index\.js['"]/,
    // RS-2001: the Gallery's own barrel module.
    /from\s*['"]\.\/src\/gallery\/index\.js['"]/
  ];
  for (const line of importLines) {
    assert.ok(allowed.some((pattern) => pattern.test(line)), `unexpected import: ${line}`);
  }
});

await test('8. the permanent engine field was renamed from permanentTextEngine to permanentEngine', () => {
  assert.ok(!appJs.includes('permanentTextEngine'), 'expected the text-only field name to be gone');
  assert.match(appJs, /this\.permanentEngine/, 'expected the renamed permanentEngine field to be used');
});

await test('9. no forbidden file changed', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const forbiddenPrefixes = [
    // RS-2002: assets/fonts/** is legitimately expanded by the Typography & Font Library milestone (new bundled font files + manifest entries).
    'src/text/', 'src/fonts/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Shape geometry integration tests passed.');
