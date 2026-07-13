import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-0003.5E1 — Real Production Validation. A permanent regression suite that loads every
// examples/*.rhs fixture, generates its StoneLayout through the permanent GeometryEngine, and
// checks the result against a committed baseline (examples/baselines.json). See
// docs/specifications/RS-0003.5E1-RealProductionValidation.md for the full rationale, including
// why the `.rhs` schema validated here differs from app.js's own ad hoc live-editor schema.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const examplesDir = path.join(repoRoot, 'examples');

const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');
const { GeometryEngine, StoneLayout } = await import('../src/geometry/index.js');
const { stoneLayoutToSvg } = await import('../src/export/SvgExporter.js');
const {
  validateRhsProject,
  generateProjectStoneLayout,
  toAppProjectShape,
  visibleLayerCount
} = await import('./lib/rhsProject.mjs');

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

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// The real validateProject() from app.js, extracted from its literal source and executed (not
// reimplemented), matching the precedent in tools/test-ux-visual-polish.mjs. Proves the app-shape
// translation is genuinely accepted by the live import path's own validation function.
//
// RS-1004: validateProject() now calls the real getObjectTemplate() (imported at the top of
// app.js) to normalize project.product; the extracted source slice below does not include that
// import, so it is injected as a function parameter instead of being reimplemented/stubbed.
async function extractValidateProject() {
  const match = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  assert.ok(match, 'expected to find validateProject() in app.js');
  // RS-1005: validateProject() now also references the top-level DEFAULT_PROJECT_NAME constant
  // (project.name's permissive default), so the extracted slice must start there instead of at
  // SUPPORTED_LAYER_TYPES -- the extra intervening source (defaultProject(), etc.) is harmless.
  const source = appJs.slice(appJs.indexOf('const DEFAULT_PROJECT_NAME='), appJs.indexOf(match[0]) + match[0].length);
  const { getObjectTemplate } = await import('../src/products/index.js');
  // eslint-disable-next-line no-new-func
  return new Function('getObjectTemplate', `${source}\nreturn validateProject;`)(getObjectTemplate);
}

async function buildPermanentEngine() {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  async function loadFontBufferFromRepoRoot(relativePath) {
    const buffer = await readFile(path.join(repoRoot, relativePath));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
  return new GeometryEngine({ fontProviderRegistry });
}

const manifest = JSON.parse(await readFile(path.join(examplesDir, 'manifest.json'), 'utf8'));
const baselineDoc = JSON.parse(await readFile(path.join(examplesDir, 'baselines.json'), 'utf8'));
const baselinesByFile = new Map(baselineDoc.baselines.map((b) => [b.file, b]));

const PRESERVED_CHECKSUMS = {
  'vitalina.rhs': { sha256: 'beb133c2cb5acc12fdc99b57f16d1c346a50f3174fcf03b56bd7dc361284cce6', length: 422 },
  'vitalina-serbin.rhs': { sha256: '58f4b4d0bcc9d3e93e693cf1a126066a275d66d009fa8a48f7fcc5738bc53b26', length: 466 }
};

const engine = await buildPermanentEngine();
const validateProjectFromAppJs = await extractValidateProject();

// Snapshot every example's bytes up front; re-checked at the very end to prove the suite never
// wrote to examples/**.
const exampleFilesOnDisk = (await readdir(examplesDir)).filter((f) => f.endsWith('.rhs')).sort();
const checksumsBefore = new Map();
for (const file of exampleFilesOnDisk) {
  const buf = await readFile(path.join(examplesDir, file));
  checksumsBefore.set(file, sha256(buf));
}

await test('1. every examples/manifest.json entry points to an existing .rhs file, and every .rhs file has a manifest entry (bidirectional coverage)', () => {
  const manifestFiles = new Set(manifest.examples.map((e) => e.file));
  for (const entry of manifest.examples) {
    assert.ok(exampleFilesOnDisk.includes(entry.file), `manifest references missing file: ${entry.file}`);
  }
  for (const file of exampleFilesOnDisk) {
    assert.ok(manifestFiles.has(file), `${file} exists on disk but has no manifest.json entry`);
  }
  assert.ok(exampleFilesOnDisk.length >= 24, `expected at least 24 example files (2 preserved + 15 RS-0003.5E1 + 7 RS-2000), found ${exampleFilesOnDisk.length}`);
});

await test('2. the two preserved legacy fixtures exist and are byte-for-byte unmodified', async () => {
  for (const [file, expected] of Object.entries(PRESERVED_CHECKSUMS)) {
    const buf = await readFile(path.join(examplesDir, file));
    assert.equal(buf.length, expected.length, `${file} length changed`);
    assert.equal(sha256(buf), expected.sha256, `${file} content changed`);
  }
});

await test('3. examples/baselines.json has exactly one entry per example, no orphans', () => {
  for (const file of exampleFilesOnDisk) {
    assert.ok(baselinesByFile.has(file), `missing baseline for ${file}`);
  }
  assert.equal(baselineDoc.baselines.length, exampleFilesOnDisk.length, 'baseline count must equal example file count');
});

// Loaded once, reused by every per-example test below.
const loaded = new Map();
for (const file of exampleFilesOnDisk) {
  const rawText = await readFile(path.join(examplesDir, file), 'utf8');
  const rawJson = JSON.parse(rawText);
  loaded.set(file, rawJson);
}

// RS-2000: an 'image' layer's imageSrc needs a real browser decode (Node has no bundled PNG/
// JPEG/WebP decoder; src/image/ImageDecoder.js is deliberately the one browser-only file in
// src/image/**). Requiring a headless Chrome launch on every routine `npm test` run would be a new
// dependency/latency cost for the whole suite, breaking from this repo's existing pattern of
// keeping browser-dependent tooling (tools/measure-performance.mjs, tools/generate-example-
// baselines.mjs) manual/optional rather than wired into `npm test`. So: every fixture (including
// image ones) still gets full schema/translation/round-trip validation below (tests 1-6), but
// actual GeometryEngine stone regeneration + baseline comparison (tests 7-14) is only run for
// fixtures with no 'image' layer. Image-layer generation correctness is verified instead when
// examples/baselines.json is (re)computed via `node tools/generate-example-baselines.mjs` (which
// does launch a real browser for exactly this) and via RS-2000's own browser-driven end-to-end
// verification pass — see docs/specifications/RS-2000-MVPStabilizationValidation.md.
const filesWithGeneration = exampleFilesOnDisk.filter((file) => {
  const raw = loaded.get(file);
  return !(Array.isArray(raw.layers) && raw.layers.some((l) => l.type === 'image'));
});

await test('4. every example parses as valid JSON and passes validateRhsProject() structural validation', () => {
  for (const file of exampleFilesOnDisk) {
    assert.doesNotThrow(() => validateRhsProject(loaded.get(file), file), `${file} failed validateRhsProject()`);
  }
});

await test('5. every example, translated to app.js\'s ad hoc schema, is accepted by the real validateProject() extracted from app.js', () => {
  for (const file of exampleFilesOnDisk) {
    const project = validateRhsProject(loaded.get(file), file);
    const appShape = toAppProjectShape(project);
    assert.doesNotThrow(() => validateProjectFromAppJs(appShape), `${file}'s app-shape translation was rejected by app.js's real validateProject(): ${(() => { try { validateProjectFromAppJs(appShape); } catch (e) { return e.message; } })()}`);
  }
});

await test('6. every example round-trips through JSON.parse(JSON.stringify(...)) with no data loss, in both .rhs and app-shape form', () => {
  for (const file of exampleFilesOnDisk) {
    const project = validateRhsProject(loaded.get(file), file);
    assert.deepEqual(JSON.parse(JSON.stringify(project)), project, `${file} .rhs-shape round-trip lost data`);
    const appShape = toAppProjectShape(project);
    assert.deepEqual(JSON.parse(JSON.stringify(appShape)), appShape, `${file} app-shape round-trip lost data`);
  }
});

await test('7. every visible layer of every example generates a non-throwing merged StoneLayout via the permanent GeometryEngine', async () => {
  for (const file of filesWithGeneration) {
    const project = validateRhsProject(loaded.get(file), file);
    await assert.doesNotReject(generateProjectStoneLayout(project, engine), `${file} failed to generate`);
  }
});

await test('8. every example produces a deterministic StoneLayout (two independent generations match exactly)', async () => {
  for (const file of filesWithGeneration) {
    const project = validateRhsProject(loaded.get(file), file);
    const a = await generateProjectStoneLayout(project, engine);
    const b = await generateProjectStoneLayout(project, engine);
    assert.deepEqual(a.toJSON(), b.toJSON(), `${file} is non-deterministic across two generation runs`);
  }
});

await test('9. actual stone count and bounding box match the committed baseline (exact count, 0.001mm bounds tolerance)', async () => {
  const eps = 0.001;
  for (const file of filesWithGeneration) {
    const project = validateRhsProject(loaded.get(file), file);
    const layout = await generateProjectStoneLayout(project, engine);
    const baseline = baselinesByFile.get(file);

    assert.equal(project.layers.length, baseline.layerCount, `${file}: layerCount mismatch`);
    assert.equal(visibleLayerCount(project), baseline.visibleLayerCount, `${file}: visibleLayerCount mismatch`);
    assert.equal(layout.count, baseline.stoneCount, `${file}: stoneCount mismatch (got ${layout.count}, expected ${baseline.stoneCount})`);

    const bb = layout.getBoundingBox();
    if (baseline.bounds === null) {
      assert.equal(bb, null, `${file}: expected null bounds`);
    } else {
      assert.ok(bb, `${file}: expected non-null bounds`);
      assert.ok(Math.abs(bb.minXmm - baseline.bounds.minXmm) < eps, `${file}: minXmm ${bb.minXmm} vs ${baseline.bounds.minXmm}`);
      assert.ok(Math.abs(bb.minYmm - baseline.bounds.minYmm) < eps, `${file}: minYmm ${bb.minYmm} vs ${baseline.bounds.minYmm}`);
      assert.ok(Math.abs(bb.maxXmm - baseline.bounds.maxXmm) < eps, `${file}: maxXmm ${bb.maxXmm} vs ${baseline.bounds.maxXmm}`);
      assert.ok(Math.abs(bb.maxYmm - baseline.bounds.maxYmm) < eps, `${file}: maxYmm ${bb.maxYmm} vs ${baseline.bounds.maxYmm}`);
    }
  }
});

await test('10. every stone has finite xMm/yMm and a positive finite sizeMm; no NaN/Infinity anywhere in the layout', async () => {
  for (const file of filesWithGeneration) {
    const project = validateRhsProject(loaded.get(file), file);
    const layout = await generateProjectStoneLayout(project, engine);
    assert.ok(layout.count > 0, `${file}: expected a nonzero stone count`);
    for (const stone of layout.stones) {
      assert.ok(Number.isFinite(stone.xMm), `${file}: stone.xMm not finite`);
      assert.ok(Number.isFinite(stone.yMm), `${file}: stone.yMm not finite`);
      assert.ok(Number.isFinite(stone.sizeMm) && stone.sizeMm > 0, `${file}: stone.sizeMm must be finite and positive`);
      assert.ok(typeof stone.color === 'string' && stone.color.length > 0, `${file}: stone.color must be a non-empty string`);
    }
  }
});

await test('11. observed stone colors match the committed baseline color set for every example', async () => {
  for (const file of filesWithGeneration) {
    const project = validateRhsProject(loaded.get(file), file);
    const layout = await generateProjectStoneLayout(project, engine);
    const baseline = baselinesByFile.get(file);
    const observed = [...new Set(layout.stones.map((s) => s.color))].sort();
    assert.deepEqual(observed, baseline.colors, `${file}: observed colors ${JSON.stringify(observed)} != baseline ${JSON.stringify(baseline.colors)}`);
  }
});

await test('12. StoneLayout.toJSON()/fromJSON() round-trips every example within floating-point tolerance', async () => {
  // Exact deepEqual is too strict here: StoneLayout.toJSON() rounds widthMm/heightMm (derived from
  // un-rounded stone coordinates) to 6 decimals, but fromJSON() rebuilds stones from those
  // already-rounded coordinates, so re-deriving widthMm/heightMm from the *reconstructed* layout
  // can differ from the original by up to 1 unit in the 6th decimal (<=1 nanometer at this scale)
  // — an inherent, pre-existing property of independently rounding twice, not a defect introduced
  // here, and manufacturing-irrelevant. Every other field (stones, count, layerId, sourceMode,
  // boundingBox min/max) is still required to match exactly.
  const eps = 1e-5;
  for (const file of filesWithGeneration) {
    const project = validateRhsProject(loaded.get(file), file);
    const layout = await generateProjectStoneLayout(project, engine);
    const json = layout.toJSON();
    const reconstructed = StoneLayout.fromJSON(json);
    const roundTripped = reconstructed.toJSON();

    assert.equal(roundTripped.layerId, json.layerId, `${file}: layerId mismatch after round-trip`);
    assert.equal(roundTripped.sourceMode, json.sourceMode, `${file}: sourceMode mismatch after round-trip`);
    assert.equal(roundTripped.count, json.count, `${file}: count mismatch after round-trip`);
    assert.deepEqual(roundTripped.stones, json.stones, `${file}: stones mismatch after round-trip`);
    for (const key of ['minXmm', 'minYmm', 'maxXmm', 'maxYmm', 'widthMm', 'heightMm']) {
      assert.ok(Math.abs(roundTripped.boundingBox[key] - json.boundingBox[key]) < eps, `${file}: boundingBox.${key} ${roundTripped.boundingBox[key]} vs ${json.boundingBox[key]}`);
    }
    assert.ok(Math.abs(roundTripped.widthMm - json.widthMm) < eps, `${file}: widthMm ${roundTripped.widthMm} vs ${json.widthMm}`);
    assert.ok(Math.abs(roundTripped.heightMm - json.heightMm) < eps, `${file}: heightMm ${roundTripped.heightMm} vs ${json.heightMm}`);
  }
});

await test('13. stoneLayoutToSvg() produces well-formed SVG whose circle count and coordinates match StoneLayout exactly', async () => {
  for (const file of filesWithGeneration) {
    const project = validateRhsProject(loaded.get(file), file);
    const layout = await generateProjectStoneLayout(project, engine);
    const svg = stoneLayoutToSvg(layout, { widthMm: project.canvas.width, heightMm: project.canvas.height });

    const circleCount = (svg.match(/<circle\b/g) || []).length;
    assert.equal(circleCount, layout.count, `${file}: SVG circle count ${circleCount} != StoneLayout.count ${layout.count}`);

    for (const stone of layout.stones) {
      const needle = `cx="${stone.xMm.toFixed(3)}" cy="${stone.yMm.toFixed(3)}" r="${(stone.sizeMm / 2).toFixed(3)}"`;
      assert.ok(svg.includes(needle), `${file}: expected SVG to contain ${needle}`);
    }

    assert.ok(!/NaN|Infinity/.test(svg), `${file}: SVG output contains NaN/Infinity`);
  }
});

await test('14. no stone lies wildly outside the project canvas (generous manufacturing tolerance, not a tight visual margin)', async () => {
  const TOLERANCE_MM = 50; // generous: catches genuinely broken output (e.g. runaway auto-fit), not tight framing
  for (const file of filesWithGeneration) {
    const project = validateRhsProject(loaded.get(file), file);
    const layout = await generateProjectStoneLayout(project, engine);
    for (const stone of layout.stones) {
      assert.ok(stone.xMm > -TOLERANCE_MM && stone.xMm < project.canvas.width + TOLERANCE_MM, `${file}: stone.xMm ${stone.xMm} far outside canvas width ${project.canvas.width}`);
      assert.ok(stone.yMm > -TOLERANCE_MM && stone.yMm < project.canvas.height + TOLERANCE_MM, `${file}: stone.yMm ${stone.yMm} far outside canvas height ${project.canvas.height}`);
    }
  }
});

await test('15. validateRhsProject() rejects obviously invalid projects (negative stone size, missing layers, bad wrap/type)', () => {
  const base = validateRhsProject(loaded.get('short-name-block.rhs'), 'short-name-block.rhs');

  const noLayers = { ...JSON.parse(JSON.stringify(base)), layers: [] };
  assert.throws(() => validateRhsProject(noLayers), /non-empty array/);

  const negativeSize = JSON.parse(JSON.stringify(base));
  negativeSize.layers[0].stoneSizeMm = -1;
  assert.throws(() => validateRhsProject(negativeSize), /stoneSizeMm/);

  const badType = JSON.parse(JSON.stringify(base));
  badType.layers[0].type = 'triangle';
  assert.throws(() => validateRhsProject(badType), /unsupported type/);

  const badWrap = JSON.parse(JSON.stringify(base));
  badWrap.wrap = 'inside-out';
  assert.throws(() => validateRhsProject(badWrap), /wrap/);

  const nanCanvas = JSON.parse(JSON.stringify(base));
  nanCanvas.canvas.width = NaN;
  assert.throws(() => validateRhsProject(nanCanvas), /canvas\.width/);
});

await test('16. examples were only ever read during this suite — no example file was modified', async () => {
  for (const file of exampleFilesOnDisk) {
    const buf = await readFile(path.join(examplesDir, file));
    assert.equal(sha256(buf), checksumsBefore.get(file), `${file} was modified during the test run`);
  }
});

await test('17. RS-2000: every SUPPORTED_LAYER_TYPES value (text/circle/rectangle/svg/image/path) is exercised by at least one example fixture', async () => {
  const { SUPPORTED_LAYER_TYPES } = await import('./lib/rhsProject.mjs');
  const seenTypes = new Set();
  for (const file of exampleFilesOnDisk) {
    for (const layer of loaded.get(file).layers) seenTypes.add(layer.type);
  }
  for (const type of SUPPORTED_LAYER_TYPES) {
    assert.ok(seenTypes.has(type), `no example fixture exercises layer type "${type}"`);
  }
});

await test('18. RS-2000: every example with an \'image\' layer is excluded from generation tests 7-14 (documented, not silently skipped) and still passes schema/translation validation', () => {
  const imageFiles = exampleFilesOnDisk.filter((file) => loaded.get(file).layers.some((l) => l.type === 'image'));
  assert.ok(imageFiles.length > 0, 'expected at least one image-layer fixture to exist (image-trace-monogram.rhs)');
  for (const file of imageFiles) {
    assert.ok(!filesWithGeneration.includes(file), `${file}: expected to be excluded from filesWithGeneration`);
    // Still fully schema/translation-validated (same as every other fixture, via tests 1-6).
    const project = validateRhsProject(loaded.get(file), file);
    const appShape = toAppProjectShape(project);
    assert.doesNotThrow(() => validateProjectFromAppJs(appShape), `${file}'s app-shape translation was rejected by app.js's real validateProject()`);
  }
});

await test('19. no forbidden file changed (this milestone\'s own forbidden list)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  // app.js, index.html, src/geometry/**, and the new src/svg/** are legitimately changed by
  // RS-1001 (SVG import); everything else this suite originally protected stays forbidden.
  // src/renderer/ is legitimately changed by S-001 (cup rendering/rotation stabilization) — see
  // tools/test-cup-rotation-stabilization.mjs for that milestone's own forbidden-file guard.
  // src/export/ is legitimately changed by RS-1005 (Production Sheet export) — see
  // tools/test-production-sheet-exporter.mjs for that milestone's own forbidden-file guard.
  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const forbiddenPrefixes = [
    // RS-2002: assets/fonts/** is legitimately expanded by the Typography & Font Library milestone (new bundled font files + manifest entries).
    'src/text/', 'src/fonts/', 'src/browser/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(!forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)), `Forbidden file changed: ${changedPath}`);
  }
});

console.log('Examples regression suite passed.');
