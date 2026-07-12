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
  const moduleScriptTags = scriptTags.filter((tag) => /type="module"/.test(tag));
  assert.equal(moduleScriptTags.length, 1, `expected exactly one type="module" <script> tag, found ${moduleScriptTags.length}`);
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

await test('app.js does not import OpenTypeProvider directly', () => {
  // RS-0003.5B3 requires app.js to drive OpenTypeProvider indirectly, through
  // FontProviderRegistry / the permanent GeometryEngine, so the module boundary from
  // docs/ARCHITECTURE.md ("Text Engine" providers are consumed only via the registry) holds.
  // app.js must never import or reference the provider class itself.
  assert.ok(!appJs.includes('OpenTypeProvider'), 'app.js must not reference OpenTypeProvider directly');
  assert.ok(!appJs.includes("'opentype.js'") && !appJs.includes('"opentype.js"'), 'app.js must not reference the opentype.js bare specifier directly');
});

await test('app.js imports the permanent GeometryEngine for live text generation (RS-0003.5B3)', () => {
  // RS-0003.5C2 also imports Stone/StoneLayout from the same barrel module (generate() now
  // constructs a real StoneLayout), so this only requires GeometryEngine-as-X to appear
  // somewhere in the same import statement's named-import list, not to be its sole member.
  assert.match(
    appJs,
    /import\s*\{\s*GeometryEngine\s+as\s+\w+[^}]*\}\s*from\s*['"]\.\/src\/geometry\/index\.js['"]/,
    'app.js must import the permanent GeometryEngine from src/geometry/index.js'
  );
  assert.ok(appJs.includes('generateTextLayout'), 'app.js must call generateTextLayout for live text generation');
});

await test('app.js only imports the RS-0003.5B2 probe, the RS-0003.5B3 permanent-module entry points, and the RS-0003.5C2 renderer/exporter modules', () => {
  const importLines = appJs.match(/^\s*import\b.*$/gm) || [];
  const allowed = [
    /BrowserDependencyProbe\.js/,
    /from\s*['"]\.\/src\/geometry\/index\.js['"]/,
    /from\s*['"]\.\/src\/fonts\/index\.js['"]/,
    /from\s*['"]\.\/src\/text\/index\.js['"]/,
    /from\s*['"]\.\/src\/renderer\/CanvasRenderer2D\.js['"]/,
    /from\s*['"]\.\/src\/renderer\/CupRenderer\.js['"]/,
    /from\s*['"]\.\/src\/renderer\/StoneColors\.js['"]/,
    /from\s*['"]\.\/src\/export\/SvgExporter\.js['"]/,
    /from\s*['"]\.\/src\/svg\/index\.js['"]/,
    /from\s*['"]\.\/src\/history\/index\.js['"]/,
    // RS-1004: activates the previously-inert src/products/** module (object-template registry).
    /from\s*['"]\.\/src\/products\/index\.js['"]/,
    // RS-1005: Production Sheet export. src/export/** has no barrel index.js (SvgExporter.js above
    // is likewise imported directly), so each individual export module app.js uses is listed here.
    /from\s*['"]\.\/src\/export\/ProductionSheetExporter\.js['"]/,
    // RS-1006: the real 3D preview's own barrel module (see src/preview3d/index.js) -- the only
    // module app.js imports from src/preview3d/**, matching the same "barrel module" shape every
    // other permanent module entry point above already has.
    /from\s*['"]\.\/src\/preview3d\/index\.js['"]/
  ];
  for (const line of importLines) {
    assert.ok(
      allowed.some((pattern) => pattern.test(line)),
      `app.js must only import the browser probe or the permanent geometry/fonts/text/renderer/export barrel modules, found: ${line}`
    );
  }
  assert.ok(!appJs.includes('node_modules'), 'app.js must not import directly from node_modules');
  // A blanket http(s):// scan would false-positive on the SVG exporter's
  // `xmlns="http://www.w3.org/2000/svg"` namespace URI, which is not a network
  // request. Check for actual CDN hostnames instead.
  const cdnHostPattern = /\b(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|jspm\.dev|esm\.sh|skypack\.dev)\b/;
  assert.ok(!cdnHostPattern.test(appJs), 'app.js must not reference a public CDN URL');
});

await test('app.js does not import the permanent src/core Project/Layer model (RS-0003.5B3 out of scope)', () => {
  assert.ok(!appJs.includes('src/core/'), 'app.js must not import src/core/** in this task');
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
    .filter((line) => line.trim().length > 0)
    // Porcelain lines are exactly "XY path" (2 status chars + 1 space); slicing must happen on
    // the untrimmed line, since trimming first (the previous, buggy implementation) eats the
    // leading status character for common single-letter-in-column-2 statuses like " M", silently
    // truncating the path and making this guard a no-op for modified (not new) files.
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const forbiddenPrefixes = [
    // src/geometry/ is legitimately changed by RS-0003.5C1 (permanent shape generation).
    // src/renderer/ and src/export/ are legitimately changed by RS-0003.5C2 (rendering pipeline).
    'src/text/',
    'src/core/',
    'assets/'
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
