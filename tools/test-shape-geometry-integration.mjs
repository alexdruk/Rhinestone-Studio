import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-0003.5C1 — verifies app.js is actually wired to the permanent GeometryEngine's
// generateShapeLayout() for circle/rectangle layers, and that the legacy shape generators
// (generateCircle/generateRect) are preserved (not deleted) but no longer the thing that runs
// for shape layers. Structural checks against the live app.js source, matching the existing
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

await test('4. stoneSizeMm, gapMm, and color are forwarded for shape generation', () => {
  assert.match(appJs, /stoneSizeMm:layer\.stoneSize,gapMm:layer\.gap,mode:'outline',color:layer\.color/);
});

await test('5. the legacy generateCircle/generateRect methods are preserved, not deleted', () => {
  assert.ok(appJs.includes('generateCircle(l){'), 'expected the legacy generateCircle() to still be present');
  assert.ok(appJs.includes('generateRect(l){'), 'expected the legacy generateRect() to still be present');
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

await test('7. app.js does not import any new module for this milestone', () => {
  const importLines = appJs.match(/^\s*import\b.*$/gm) || [];
  const allowed = [
    /BrowserDependencyProbe\.js/,
    /from\s*['"]\.\/src\/geometry\/index\.js['"]/,
    /from\s*['"]\.\/src\/fonts\/index\.js['"]/,
    /from\s*['"]\.\/src\/text\/index\.js['"]/
  ];
  assert.equal(importLines.length, 4, `expected exactly the four pre-existing import lines, found ${importLines.length}`);
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

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'index.html']);
  const forbiddenPrefixes = [
    'src/text/',
    'src/fonts/',
    'src/core/',
    'src/renderer/',
    'src/export/',
    'assets/',
    'examples/'
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
