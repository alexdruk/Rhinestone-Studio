import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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

const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

await test('index.html contains exactly one application module entry point', () => {
  const scriptTags = indexHtml.match(/<script\b[^>]*>/g) || [];
  assert.equal(scriptTags.length, 1, `expected exactly one <script> tag, found ${scriptTags.length}`);
  assert.ok(/type="module"/.test(scriptTags[0]), 'expected the script tag to be type="module"');
});

await test('the entry point is ./app.js', () => {
  assert.match(indexHtml, /<script\s+type="module"\s+src="\.\/app\.js"><\/script>/);
});

await test('the previous large inline application script is absent', () => {
  assert.ok(!indexHtml.includes('class GeometryEngine'), 'index.html must not contain the legacy inline GeometryEngine class');
  assert.ok(!indexHtml.includes('STONE_COLORS'), 'index.html must not contain legacy inline application state');
  assert.ok(!indexHtml.includes('function updateAll'), 'index.html must not contain legacy inline application logic');
});

await test('app.js contains the live startup logic', () => {
  assert.ok(appJs.includes('class GeometryEngine'), 'app.js must own the legacy GeometryEngine implementation');
  assert.ok(appJs.includes('syncSelectedControlsFromLayer();updateAll(true);'), 'app.js must invoke startup on load');
});

await test('DOM IDs referenced by app.js exist in index.html', () => {
  const idPattern = /\bel\('([^']+)'\)/g;
  const referencedIds = new Set();
  let match;
  while ((match = idPattern.exec(appJs))) {
    referencedIds.add(match[1]);
  }
  assert.ok(referencedIds.size > 10, 'expected app.js to reference a meaningful number of DOM IDs');

  for (const id of referencedIds) {
    const idAttr = new RegExp(`id="${id}"`);
    assert.ok(idAttr.test(indexHtml), `index.html is missing an element with id="${id}" referenced by app.js`);
  }
});

await test('app.js does not import OpenTypeProvider', () => {
  assert.ok(!appJs.includes('OpenTypeProvider'), 'app.js must not reference OpenTypeProvider in this migration task');
  assert.ok(!appJs.includes('opentype.js'), 'app.js must not reference opentype.js in this migration task');
});

await test('app.js does not import src/geometry/GeometryEngine.js', () => {
  assert.ok(!appJs.includes('src/geometry/GeometryEngine'), 'app.js must not import the permanent vector-text GeometryEngine yet');
  assert.ok(!/^\s*import\b/m.test(appJs), 'app.js must not import any module in this migration task');
});

await test('the three updated legacy guard tests no longer reject app.js or index.html', async () => {
  const guardFiles = [
    'tools/test-opentype-provider.mjs',
    'tools/test-stone-color.mjs',
    'tools/test-geometry-engine.mjs'
  ];

  for (const relativePath of guardFiles) {
    const source = await readFile(path.join(repoRoot, relativePath), 'utf8');
    assert.ok(!/forbiddenExact\s*=\s*new Set\(\[[^\]]*'app\.js'/.test(source), `${relativePath} must no longer forbid app.js`);
    assert.ok(!/forbiddenExact\s*=\s*new Set\(\[[^\]]*'index\.html'/.test(source), `${relativePath} must no longer forbid index.html`);
    assert.ok(/forbiddenExact\s*=\s*new Set\(\[[^\]]*'style\.css'/.test(source), `${relativePath} must still forbid style.css`);
  }
});

await test('no forbidden files changed', () => {
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

console.log('App module migration tests passed.');
