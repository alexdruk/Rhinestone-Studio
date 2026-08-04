import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

await test('app.js only imports the browser probe, permanent-module barrels (src/*/index.js), or a direct file inside a barrel-less permanent directory (src/renderer/**, src/export/**)', () => {
  // Structural rule, not a per-milestone enumeration: docs/ARCHITECTURE.md requires every
  // permanent module to be "consumed only through its index.js barrel" except src/renderer/**
  // and src/export/**, which have no barrel of their own (see ARCHITECTURE.md's "Orchestration
  // Layer" section) and are therefore imported file-by-file. A new permanent module adding its
  // own barrel needs no update here; only a genuinely new *exception* to the barrel rule would.
  const importLines = appJs.match(/^\s*import\b.*$/gm) || [];
  const isProbe = (line) => /BrowserDependencyProbe\.js/.test(line);
  const isBarrel = (line) => /from\s*['"]\.\/src\/[\w-]+\/index\.js['"]/.test(line);
  const isBarrelLessDirectFile = (line) => /from\s*['"]\.\/src\/(renderer|export)\/[\w.-]+\.js['"]/.test(line);
  // The one documented exception: ObjectDimensions.js is deliberately imported directly rather
  // than through src/preview3d/index.js (which is Three.js-lazy-loading-only), so app.js and
  // ObjectGeometryBuilder.js share the exact same mm<->azimuth math — see
  // docs/specifications/S-107-LongTextReadability.md.
  const isDocumentedDirectFileException = (line) => /from\s*['"]\.\/src\/preview3d\/ObjectDimensions\.js['"]/.test(line);

  for (const line of importLines) {
    assert.ok(
      isProbe(line) || isBarrel(line) || isBarrelLessDirectFile(line) || isDocumentedDirectFileException(line),
      `app.js must only import the browser probe, a permanent module's src/*/index.js barrel, or a direct file inside src/renderer/**|src/export/**, found: ${line}`
    );
  }
  assert.ok(!appJs.includes('node_modules'), 'app.js must not import directly from node_modules');
  assert.ok(!appJs.includes('src/core/'), 'app.js must not import src/core/** — it was removed by RS-2006, not migrated onto');
  // A blanket http(s):// scan would false-positive on the SVG exporter's
  // `xmlns="http://www.w3.org/2000/svg"` namespace URI, which is not a network
  // request. Check for actual CDN hostnames instead.
  const cdnHostPattern = /\b(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|jspm\.dev|esm\.sh|skypack\.dev)\b/;
  assert.ok(!cdnHostPattern.test(appJs), 'app.js must not reference a public CDN URL');
});

console.log('App module migration tests passed.');
