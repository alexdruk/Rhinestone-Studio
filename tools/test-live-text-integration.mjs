import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-0003.5B3 — verifies app.js is actually wired to the permanent GeometryEngine,
// OpenTypeProvider (via FontProviderRegistry), and FontManager for live text generation,
// and that the legacy bitmap text path is preserved (not deleted) but no longer the thing
// that runs for text layers. These are structural checks against the live app.js source,
// matching the existing convention in tools/test-app-module-migration.mjs, because app.js
// is a browser entry point (uses `fetch`, DOM APIs, import maps) and is not import()-able
// directly under plain Node the way the permanent src/** modules are.

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

await test('1. app.js imports the permanent GeometryEngine from src/geometry/index.js', () => {
  assert.match(appJs, /from\s*['"]\.\/src\/geometry\/index\.js['"]/);
});

await test('2. app.js imports FontManager from src/fonts/index.js', () => {
  assert.match(appJs, /import\s*\{\s*FontManager\s*\}\s*from\s*['"]\.\/src\/fonts\/index\.js['"]/);
});

await test('3. app.js imports createDefaultFontProviderRegistry from src/text/index.js', () => {
  assert.match(appJs, /import\s*\{\s*createDefaultFontProviderRegistry\s*\}\s*from\s*['"]\.\/src\/text\/index\.js['"]/);
});

await test('4. app.js builds a FontManager from the bundled font manifest', () => {
  assert.match(appJs, /FontManager\.fromUrl\(['"]\.\/assets\/fonts\/manifest\.json['"]\)/);
});

await test('5. app.js constructs the permanent GeometryEngine with a fontProviderRegistry', () => {
  assert.match(appJs, /new\s+\w*GeometryEngine\s*\(\s*\{\s*fontProviderRegistry\s*\}\s*\)/);
});

await test('6. app.js calls generateTextLayout for live text generation, not just import-only resolution', () => {
  assert.match(appJs, /permanentTextEngine\.generateTextLayout\(/);
});

await test('7. text-layer generation is async and consumes the awaited result', () => {
  assert.match(appJs, /async\s+generateTextStonesLive\s*\(/, 'expected an async text-generation method');
  assert.match(appJs, /async\s+generate\s*\(\s*project\s*\)/, "expected the app's GeometryEngine.generate to be async");
  assert.match(appJs, /async\s+function\s+updateAll/, 'expected updateAll to be async so it can await live generation');
});

await test('8. the legacy bitmap text path (FONT5 + glyph samplers) is preserved, not deleted', () => {
  assert.ok(appJs.includes('const FONT5={'), 'expected the legacy FONT5 bitmap table to still be present');
  assert.ok(appJs.includes('sampleGlyphFill('), 'expected the legacy fill glyph sampler to still be present');
  assert.ok(appJs.includes('sampleGlyphStroke('), 'expected the legacy stroke glyph sampler to still be present');
});

await test('9. the legacy bitmap text path is no longer called for text layers', () => {
  // generate() must route type 'text' through the live method, not the legacy one.
  assert.match(appJs, /type==='text'\)raw\.push\(\.\.\.await this\.generateTextStonesLive\(l,project\)\)/);
  assert.ok(
    !/type==='text'\)raw\.push\(\.\.\.this\.generateText\(l,project\)\)/.test(appJs),
    'the legacy bitmap generateText() must no longer be invoked for text layers'
  );
});

await test('10. shape generation still uses the legacy engine (unchanged per spec)', () => {
  assert.match(appJs, /type==='circle'\)raw\.push\(\.\.\.this\.generateCircle\(l\)\)/);
  assert.match(appJs, /type==='rectangle'\)raw\.push\(\.\.\.this\.generateRect\(l\)\)/);
});

await test('11. app.js does not import src/core/** (Project/Layer model migration is out of scope)', () => {
  assert.ok(!appJs.includes('src/core/'));
});

await test('12. the #font control in index.html offers the two working bundled fonts', () => {
  assert.match(indexHtml, /<select id="font">/);
  assert.ok(indexHtml.includes('value="courier-prime-regular"'), 'expected a Courier Prime option');
  assert.ok(indexHtml.includes('value="great-vibes-regular"'), 'expected a Great Vibes option');
  assert.ok(!indexHtml.includes('value="roboto-mono-regular"'), 'RobotoMono-Regular.ttf is a non-parseable placeholder and must not be offered');
});

await test('13. the input-listener skipWrite fix is present (typed edits must reach the model)', () => {
  assert.ok(
    !/addEventListener\('input',updateAll\)/.test(appJs),
    "updateAll must not be passed directly as an 'input' listener (the DOM Event would be misread as skipWrite=true)"
  );
});

await test('14. no forbidden file changed', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const forbiddenPrefixes = [
    'src/geometry/',
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

console.log('Live text integration tests passed.');
