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
const adapterPath = path.join(repoRoot, 'src/browser/OpenTypeBrowserAdapter.js');
const probePath = path.join(repoRoot, 'src/browser/BrowserDependencyProbe.js');
const openTypeProviderPath = path.join(repoRoot, 'src/text/OpenTypeProvider.js');

function extractImportMap(html) {
  const match = html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected index.html to contain a <script type="importmap"> block');
  return JSON.parse(match[1]);
}

// 3. An import map or approved equivalent mapping exists.
await test('index.html contains an import map', () => {
  const importMap = extractImportMap(indexHtml);
  assert.ok(importMap && typeof importMap.imports === 'object', 'expected an "imports" object in the import map');
});

// 4. The mapping resolves the exact bare specifier `opentype.js`.
await test('the import map resolves the exact bare specifier "opentype.js"', () => {
  const importMap = extractImportMap(indexHtml);
  assert.ok(
    Object.prototype.hasOwnProperty.call(importMap.imports, 'opentype.js'),
    'expected the import map to define a mapping for the exact key "opentype.js"'
  );
});

// 5. The mapped target is local and does not use a public CDN.
// 16. No public CDN URL is introduced.
await test('the import map target and browser files are local, not a public CDN', () => {
  const importMap = extractImportMap(indexHtml);
  const target = importMap.imports['opentype.js'];
  const cdnPattern = /^https?:\/\//i;
  assert.ok(!cdnPattern.test(target), `import map target must be local, found: ${target}`);
  assert.ok(target.startsWith('./') || target.startsWith('/'), `import map target must be a local path, found: ${target}`);

  for (const source of [indexHtml, appJs]) {
    assert.ok(!/https?:\/\/(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh|skypack\.dev)/i.test(source),
      'a known public CDN host reference was found');
  }
});

// 22. The import map resolves `opentype.js` to the browser compatibility adapter (not directly to node_modules).
await test('the import map resolves "opentype.js" to the local adapter, not directly to node_modules', () => {
  const importMap = extractImportMap(indexHtml);
  const target = importMap.imports['opentype.js'];
  assert.ok(!target.includes('node_modules'), `import map should target the adapter, not node_modules directly, found: ${target}`);
  assert.ok(/OpenTypeBrowserAdapter\.js$/.test(target), `expected the import map to target the browser adapter, found: ${target}`);
});

// 6. The browser dependency probe exists.
let probeSource;
await test('the browser dependency probe exists', async () => {
  probeSource = await readFile(probePath, 'utf8');
  assert.ok(probeSource.length > 0, 'expected BrowserDependencyProbe.js to have content');
});

// 7. The probe imports `OpenTypeProvider`.
await test('the probe imports OpenTypeProvider', () => {
  assert.match(probeSource, /import\s*\{[^}]*\bOpenTypeProvider\b[^}]*\}\s*from\s*['"][^'"]*text\/index\.js['"]/);
});

// 8. The probe imports `FontManager`.
await test('the probe imports FontManager', () => {
  assert.match(probeSource, /import\s*\{[^}]*\bFontManager\b[^}]*\}\s*from\s*['"][^'"]*fonts\/index\.js['"]/);
});

// 9. The probe imports the permanent text module.
await test('the probe imports the permanent text module', () => {
  assert.match(probeSource, /import\s+\*\s+as\s+\w+\s+from\s*['"][^'"]*text\/index\.js['"]/);
});

// 10. The probe imports the permanent geometry module.
await test('the probe imports the permanent geometry module', () => {
  assert.match(probeSource, /import\s+\*\s+as\s+\w+\s+from\s*['"][^'"]*geometry\/index\.js['"]/);
});

// 12. `OpenTypeProvider` is not instantiated.
await test('OpenTypeProvider is not instantiated anywhere in the probe or app.js', () => {
  assert.ok(!/new\s+OpenTypeProvider\s*\(/.test(probeSource), 'the probe must not instantiate OpenTypeProvider');
  assert.ok(!/new\s+OpenTypeProvider\s*\(/.test(appJs), 'app.js must not instantiate OpenTypeProvider');
});

// 13. `FontManager` is not used for live font loading.
await test('FontManager is not instantiated or used for live font loading in the probe or app.js', () => {
  assert.ok(!/new\s+FontManager\s*\(/.test(probeSource), 'the probe must not instantiate FontManager');
  assert.ok(!/new\s+FontManager\s*\(/.test(appJs), 'app.js must not instantiate FontManager');
  assert.ok(!/\.getFont\s*\(/.test(probeSource), 'the probe must not call FontManager.getFont()');
});

await test('the probe does not instantiate the permanent GeometryEngine or generate stones', () => {
  assert.ok(!/new\s+GeometryEngine\s*\(/.test(probeSource), 'the probe must not instantiate the permanent GeometryEngine');
  assert.ok(!/createGeometryEngine\s*\(/.test(probeSource), 'the probe must not construct the permanent GeometryEngine');
  assert.ok(!/\.generate\s*\(/.test(probeSource), 'the probe must not call any generate() method');
});

await test('the probe touches no DOM, rendering, or export APIs', () => {
  assert.ok(!/\bdocument\.|window\./.test(probeSource), 'the probe must not access window or document');
  assert.ok(!/getContext\s*\(/.test(probeSource), 'the probe must not touch a rendering context');
});

// 11. `app.js` imports or otherwise loads the probe.
await test('app.js imports the browser dependency probe', () => {
  assert.match(appJs, /^\s*import\s+['"]\.\/src\/browser\/BrowserDependencyProbe\.js['"];?\s*$/m);
});

// 19. No forbidden file changed (RS-0003.5B2 forbidden-file list).
await test('no forbidden file changed', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const forbiddenPrefixes = [
    'src/renderer/',
    'src/export/',
    'src/core/',
    'assets/fonts/',
    'examples/',
    'node_modules/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

// 21. `src/text/OpenTypeProvider.js` remains unchanged.
await test('src/text/OpenTypeProvider.js keeps its original default import of opentype.js', async () => {
  const source = await readFile(openTypeProviderPath, 'utf8');
  assert.match(source, /^import opentype from 'opentype\.js';$/m, 'OpenTypeProvider.js must keep its original default import unchanged');
});

// 23. The adapter imports the installed package's local ES-module build.
let adapterSource;
await test('the adapter imports the installed package\'s local ES-module build', async () => {
  adapterSource = await readFile(adapterPath, 'utf8');
  assert.match(adapterSource, /from\s*['"]\.\.\/\.\.\/node_modules\/opentype\.js\/dist\/opentype\.mjs['"]/);
  assert.ok(!/https?:\/\//.test(adapterSource), 'the adapter must not reference a remote URL');
});

// 24. The adapter provides a default export compatible with `OpenTypeProvider`.
await test('the adapter provides a default export with a parse() function', async () => {
  const adapterModule = await import(new URL('../src/browser/OpenTypeBrowserAdapter.js', import.meta.url));
  assert.equal(typeof adapterModule.default, 'object', 'expected the adapter to have a default export object');
  assert.equal(typeof adapterModule.default.parse, 'function', 'expected the adapter default export to expose parse()');
});

// 25. Node tests continue resolving the original package entry point without the browser adapter.
await test('Node still resolves the bare "opentype.js" specifier through its own package entry point', async () => {
  const opentypeModule = await import('opentype.js');
  assert.equal(typeof opentypeModule.default.parse, 'function', 'expected Node\'s own opentype.js resolution to keep working, independent of the browser adapter');
});

console.log('Browser dependency loading tests passed.');
