import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression test for the RS-1006 hotfix: a browser `SyntaxError: The requested module
// './SvgExporter.js' does not provide an export named 'stoneCircleSvg'` was reported at startup
// (ProductionSheetExporter.js:23:10). That contract was actually already correct in the committed
// source at the time (verified independently — SvgExporter.js does export stoneCircleSvg, and a
// fresh, cache-disabled browser session reproduced no such error), so the most likely cause was a
// stale cached module in the reporter's browser session, not a defect in this repository's module
// graph. Regardless, this test closes the gap the report correctly identified: nothing previously
// walked the *real* module graph app.js actually loads and confirmed every import/(re-)export
// contract along it. It does that here, using Node's own ES module loader (not a regex simulation
// of one) as the source of truth, starting from every relative import app.js has and following
// both `import ... from` and `export { ... } from` edges transitively. Node's loader itself throws
// a SyntaxError for exactly this class of bug (a missing/renamed named export) the moment a broken
// module is loaded, so this test doubles as a general guard against the *entire* class of "renamed
// or removed an export without updating every importer" mistakes anywhere in the reachable graph,
// not just this one function.
//
// Only same-repository relative imports (starting with './' or '../') are walked; bare specifiers
// ('three', 'opentype.js') are real npm/browser-import-map dependencies covered by their own
// existing tests (tools/test-browser-dependency-loading.mjs) and are not re-validated here.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJsPath = path.join(repoRoot, 'app.js');
const appJs = readFileSync(appJsPath, 'utf8');

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

// Matches both `import {a, b as c} from '...'` / `import Default, {a} from '...'` /
// `import * as ns from '...'` / `import './x.js'` and `export {a, b} from '...'` /
// `export * from '...'`.
const EDGE_RE = /\b(?:import|export)\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*(?:\s+as\s+([\w$]+))?)?\s*(?:from\s*)?['"]([^'"]+)['"]/g;

function parseEdges(source) {
  const edges = [];
  let m;
  EDGE_RE.lastIndex = 0;
  while ((m = EDGE_RE.exec(source))) {
    const [, defaultName, namedRaw, , specifier] = m;
    const named = namedRaw
      ? namedRaw.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+as\s+/)[0].trim())
      : [];
    edges.push({ defaultName, named, specifier });
  }
  return edges;
}

async function walkModuleGraph(startEdges) {
  const visited = new Set();
  const problems = [];
  const queue = [...startEdges.map((edge) => ({ ...edge, fromFile: appJsPath }))];

  while (queue.length > 0) {
    const { defaultName, named, specifier, fromFile } = queue.shift();
    if (!specifier.startsWith('.')) continue; // bare specifier -- not ours to validate here

    const resolved = path.resolve(path.dirname(fromFile), specifier);
    const moduleUrl = `file://${resolved}`;

    let namespaceObject;
    try {
      namespaceObject = await import(moduleUrl);
    } catch (error) {
      problems.push(`${fromFile} imports '${specifier}' (${resolved}), which failed to load: ${error.message}`);
      continue;
    }

    for (const name of named) {
      if (!(name in namespaceObject)) {
        problems.push(`${fromFile} imports named export '${name}' from '${specifier}' (${resolved}), but that module does not provide it.`);
      }
    }
    if (defaultName && !('default' in namespaceObject)) {
      problems.push(`${fromFile} imports a default export from '${specifier}' (${resolved}), but that module has no default export.`);
    }

    if (visited.has(resolved)) continue;
    visited.add(resolved);

    const source = readFileSync(resolved, 'utf8');
    for (const edge of parseEdges(source)) {
      queue.push({ ...edge, fromFile: resolved });
    }
  }

  return { visited, problems };
}

await test('1. every import/(re-)export edge reachable from app.js resolves via Node\'s real ES module loader, with every required named/default binding present', async () => {
  const rootEdges = parseEdges(appJs);
  assert.ok(rootEdges.some((e) => e.specifier === './src/export/ProductionSheetExporter.js'), 'sanity check: expected to find app.js\'s import of ProductionSheetExporter.js');

  const { visited, problems } = await walkModuleGraph(rootEdges);

  assert.ok(visited.size > 20, `expected to walk a substantial module graph from app.js, only visited ${visited.size} files`);
  assert.deepEqual(problems, [], `module graph export/import contract violations found:\n${problems.join('\n')}`);
});

await test('2. src/export/ProductionSheetExporter.js\'s stoneCircleSvg import specifically resolves to a real named export in SvgExporter.js', async () => {
  const svgExporterPath = path.join(repoRoot, 'src/export/SvgExporter.js');
  const namespaceObject = await import(`file://${svgExporterPath}`);
  assert.equal(typeof namespaceObject.stoneCircleSvg, 'function', 'expected SvgExporter.js to export a stoneCircleSvg function');

  const productionSheetExporterSource = readFileSync(path.join(repoRoot, 'src/export/ProductionSheetExporter.js'), 'utf8');
  assert.match(productionSheetExporterSource, /import\s*\{\s*stoneCircleSvg\s*\}\s*from\s*['"]\.\/SvgExporter\.js['"]/);
});

await test('3. src/preview3d/ObjectDimensions.js stays pure: no Three.js import, no Project/Layer coupling', async () => {
  const objectDimensionsSource = readFileSync(path.join(repoRoot, 'src/preview3d/ObjectDimensions.js'), 'utf8');
  assert.ok(!objectDimensionsSource.includes("from 'three'"), 'expected the pure-math module to have no Three.js import');
  assert.ok(!/project\.layers|layer\.type|Project\.js|Layer\.js/.test(objectDimensionsSource));
});

console.log('Module graph export tests passed.');
