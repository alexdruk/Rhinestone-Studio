import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRhsProject, toAppProjectShape } from '../src/gallery/index.js';

/**
 * RS-2006 — Project Model Consolidation.
 *
 * Before this milestone, two project/layer models existed: `app.js`'s ad hoc live-editor schema
 * (the one every subsystem — Gallery, Design Library, Save/Load, Production Sheet, Import/Export,
 * History — actually consumed) and `src/core/Project.js`/`Layer.js` (a fully-built but wholly
 * unused parallel model, enforced-unused since RS-0003.5B3). This suite guards that the unused
 * model stays gone and that the one remaining, real model's serialization path is deterministic.
 */

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

async function pathExists(relativePath) {
  try {
    await stat(path.join(repoRoot, relativePath));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function walkFiles(dir, out = []) {
  const entries = await readdir(path.join(repoRoot, dir), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(relative, out);
    } else if (/\.(js|mjs)$/.test(entry.name)) {
      out.push(relative);
    }
  }
  return out;
}

await test('src/core/ no longer exists (the unused parallel project model was removed, not migrated onto)', async () => {
  assert.equal(await pathExists('src/core'), false, 'src/core/ must not exist after RS-2006');
});

await test('no source or tooling file references src/core/ (no residual duplicate-model wiring)', async () => {
  // test-architecture-module-boundaries.mjs/test-live-text-integration.mjs and this file's own two tests
  // above legitimately mention the string 'src/core/' as part of a permanent "app.js must never
  // import it" guard assertion — that guard is exactly what proves the model stays gone, not
  // residual wiring to clean up. src/geometry/Stone.js and src/library/LibraryTransform.js carry a
  // pre-existing historical doc comment naming src/core/Layer.js/Project.js for context (predating
  // RS-2006); left as-is rather than edited, since touching either file trips unrelated,
  // already-merged per-milestone "forbidden files" regression guards elsewhere in this suite that
  // are out of RS-2006's scope to reopen. tools/test-documentation-consistency.mjs (RC-007) also
  // mentions 'src/core/' in a comment, explaining why docs/ARCHITECTURE.md is excluded from its
  // blind path-existence check (ARCHITECTURE.md legitimately cites the deleted path as history) —
  // that is documentation validation confirming the stale reference is *absent* from the codebase,
  // not wiring that depends on src/core/, so it is exempt from this residual-wiring scan too.
  const guardFilesExemptFromScan = new Set([
    'tools/test-architecture-module-boundaries.mjs',
    'tools/test-live-text-integration.mjs',
    'tools/test-project-model-consolidation.mjs',
    'tools/test-documentation-consistency.mjs',
    'src/geometry/Stone.js',
    'src/library/LibraryTransform.js'
  ]);
  const files = [
    ...(await walkFiles('src')),
    ...(await walkFiles('tools')),
    'app.js'
  ].filter((relativePath) => !guardFilesExemptFromScan.has(relativePath));
  for (const relativePath of files) {
    const source = await readFile(path.join(repoRoot, relativePath), 'utf8');
    assert.ok(!source.includes('src/core/'), `${relativePath} must not reference src/core/`);
  }
});

await test('exactly one project/layer model is reachable from app.js: the ad hoc schema built by defaultProject()/validateProject()', async () => {
  const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
  assert.ok(appJs.includes('function defaultProject()'), 'app.js must own defaultProject() as the sole project constructor');
  assert.ok(appJs.includes('function validateProject('), 'app.js must own validateProject() as the sole project validator');
  assert.ok(!/import\s+.*\bProject\b.*from/.test(appJs), 'app.js must not import a Project class from any module');
});

await test('the Gallery-to-live-editor bridge (the one intentionally distinct schema) serializes deterministically', async () => {
  const raw = JSON.parse(await readFile(path.join(repoRoot, 'examples/vitalina.rhs'), 'utf8'));
  const validated = validateRhsProject(raw, 'examples/vitalina.rhs');

  const first = toAppProjectShape(validated);
  const second = toAppProjectShape(validated);

  assert.deepEqual(first, second, 'toAppProjectShape() must be a pure function (same input, same output)');
  assert.equal(
    JSON.stringify(first),
    JSON.stringify(second),
    'serialized app-project-shape JSON must be byte-identical across repeated conversions'
  );
});

await test('every examples/*.rhs fixture converts to the single app project shape without throwing', async () => {
  const entries = (await readdir(path.join(repoRoot, 'examples'))).filter((name) => name.endsWith('.rhs'));
  assert.ok(entries.length > 0, 'expected at least one .rhs fixture to exist');
  for (const name of entries) {
    const raw = JSON.parse(await readFile(path.join(repoRoot, 'examples', name), 'utf8'));
    const validated = validateRhsProject(raw, name);
    const converted = toAppProjectShape(validated);
    assert.equal(converted.units, 'mm', `${name}: converted project must be mm-only`);
    assert.ok(Array.isArray(converted.layers) && converted.layers.length > 0, `${name}: converted project must have layers`);
  }
});

console.log('Project model consolidation tests passed.');
