import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1004 — verifies app.js/index.html are actually wired for multi-object templates: the Object
// type control exists and is discoverable at the top of the sidebar (not buried below the fold,
// matching tools/test-ui-discoverability.mjs's established measurable convention), switching it is
// one discrete/undoable action that resets project.canvas/project.wrap to the new template's
// defaults, an existing Mug Project JSON (no product field) imports/renders identically
// (backward compatibility), product/canvas/wrap round-trip through Project JSON export/import,
// undo/redo restores them together, the merged StoneLayout is deterministic and unaffected by
// object type for unchanged layer inputs, every export button/filename is unchanged, and
// GeometryEngine.js/StoneLayout.js are untouched. Structural checks against the live app.js/
// index.html source (app.js is a browser entry point, not import()-able directly under plain
// Node), matching the established convention in tools/test-curved-text-integration.mjs /
// tools/test-undo-redo-integration.mjs.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

const { getObjectTemplate, OBJECT_TEMPLATE_IDS } = await import('../src/products/index.js');
const { GeometryEngine } = await import('../src/geometry/index.js');
const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');

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

// Extracts the real validateProject()/defaultProject() from app.js and executes them (not
// reimplemented), matching the precedent in tools/test-examples-regression.mjs /
// tools/test-svg-integration.mjs. getObjectTemplate is injected since the extracted source slice
// does not include app.js's top-of-file import.
async function extractProjectFunctions() {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  assert.ok(validateMatch, 'expected to find validateProject() in app.js');
  const defaultMatch = appJs.match(/function defaultProject\(\)\{return\{[\s\S]*?\}\}\n/);
  assert.ok(defaultMatch, 'expected to find defaultProject() in app.js');

  const constantsStart = appJs.indexOf("const TEXT_ENGINE_FONT_IDS=new Set");
  const source = `${appJs.slice(constantsStart, appJs.indexOf(defaultMatch[0]) + defaultMatch[0].length)}\n${appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length)}`;
  // eslint-disable-next-line no-new-func
  return new Function('getObjectTemplate', `${source}\nreturn { validateProject, defaultProject };`)(getObjectTemplate);
}

const { validateProject, defaultProject } = await extractProjectFunctions();

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

// A faithful, minimal port of app.js's own generate()/generateTextStonesLive() merge pipeline,
// scoped to text layers only (matches the default project's single text layer) — enough to prove
// object type never perturbs the generated StoneLayout for unchanged layer inputs, without
// reimplementing app.js's full live-editor state machine.
async function generateMergedLayout(project, engine) {
  const layer = project.layers[0];
  const base = {
    text: layer.text, fontId: layer.font, layerId: layer.id, heightMm: layer.height,
    stoneSizeMm: layer.stoneSize, gapMm: layer.gap, mode: layer.textMode === 'fill' ? 'fill' : 'outline',
    color: layer.color, curveEnabled: Boolean(layer.curveEnabled), curveRadiusMm: layer.curveRadiusMm,
    curveDirection: layer.curveDirection, curveStartAngleDeg: layer.curveStartAngleDeg,
    curveSweepAngleDeg: layer.curveSweepAngleDeg, curveAlignment: layer.curveAlignment
  };
  return engine.generateTextLayout(base);
}

// --- 1. Discoverability -----------------------------------------------------------------------

await test('1. index.html exposes #objectType with mug/tumbler/bottle options', () => {
  assert.match(indexHtml, /<select id="objectType">/);
  for (const value of ['mug', 'tumbler', 'bottle']) {
    assert.ok(indexHtml.includes(`value="${value}"`), `expected an option value="${value}" inside #objectType`);
  }
});

await test('2. #objectType appears before #selectedLayer and #cupColor (top of the panel, zero-scroll discoverable, matching tools/test-ui-discoverability.mjs\'s convention)', () => {
  const objectTypeIndex = indexHtml.indexOf('id="objectType"');
  const selectedLayerIndex = indexHtml.indexOf('id="selectedLayer"');
  const cupColorIndex = indexHtml.indexOf('id="cupColor"');
  assert.ok(objectTypeIndex > 0 && selectedLayerIndex > 0 && cupColorIndex > 0);
  assert.ok(objectTypeIndex < selectedLayerIndex, 'expected #objectType before #selectedLayer');
  assert.ok(objectTypeIndex < cupColorIndex, 'expected #objectType before #cupColor');
});

await test('3. #objectType is not duplicated (exactly one element)', () => {
  const matches = indexHtml.match(/id="objectType"/g) || [];
  assert.equal(matches.length, 1);
});

// --- 2. Wiring ---------------------------------------------------------------------------------

await test('4. app.js imports getObjectTemplate/getSafeAreaRectMm from the products barrel', () => {
  assert.match(appJs, /import\s*\{\s*getObjectTemplate\s*,\s*getSafeAreaRectMm\s*\}\s*from\s*['"]\.\/src\/products\/index\.js['"]/);
});

await test('5. switching #objectType commits history before mutating project.product/canvas/wrap', () => {
  const handlerMatch = appJs.match(/el\('objectType'\)\.addEventListener\('change',\(\)=>\{([\s\S]*?)\}\);/);
  assert.ok(handlerMatch, 'expected an #objectType change handler');
  const body = handlerMatch[1];
  assert.match(body, /^commitHistory\(\);/, 'expected commitHistory() to run before any mutation');
  assert.match(body, /project\.product=template\.id/);
  assert.match(body, /project\.canvas=\{width:template\.productionWidthMm,height:template\.productionHeightMm\}/);
  assert.match(body, /project\.wrap=template\.wrap\.default/);
  assert.match(body, /updateAll\(true\)/, 'expected updateAll(true) so writeSelectedControlsToLayer() does not overwrite the just-set project fields');
});

await test('6. syncSelectedControlsFromLayer() resyncs #objectType from project.product', () => {
  assert.match(appJs, /el\('objectType'\)\.value=project\.product/);
});

await test('7. drawCup() forwards the active object template to the 3D preview (RS-1006: preview3D.update(), not renderCup())', () => {
  assert.match(appJs, /preview3D\.update\(layout,\{[^}]*objectTemplate:currentObjectTemplate\(\)/);
});

await test('8. a safe-area guide is drawn as an app.js editor overlay (not inside CanvasRenderer2D.js)', () => {
  assert.match(appJs, /function drawSafeAreaGuide\(/, 'expected an app.js-local drawSafeAreaGuide() helper');
  assert.match(appJs, /drawSafeAreaGuide\(ctx,s,ox,oy,dpr,getSafeAreaRectMm\(currentObjectTemplate\(\),project\.canvas\.width,project\.canvas\.height\)\)/);
});

// --- 3. Backward compatibility ------------------------------------------------------------------

await test('9. defaultProject() defaults to the mug template (product:\'mug\', canvas 210x90)', () => {
  const project = defaultProject();
  assert.equal(project.product, 'mug');
  assert.equal(project.canvas.width, 210);
  assert.equal(project.canvas.height, 90);
  assert.deepEqual(project.canvas, { width: getObjectTemplate('mug').productionWidthMm, height: getObjectTemplate('mug').productionHeightMm });
});

await test('10. a Project JSON with no product field at all validates and defaults to mug (pre-RS-1004 files)', () => {
  const legacyProject = { version: 2, canvas: { width: 210, height: 90 }, layers: [{ id: 'text', type: 'text', text: 'Hi', font: 'courier-prime-regular', height: 25, stoneSize: 2, gap: 0.3, color: 'gold' }] };
  const validated = validateProject(legacyProject);
  assert.equal(validated.product, 'mug');
});

await test('11. an unrecognized product value falls back to mug instead of throwing', () => {
  const project = { version: 2, product: 'spaceship', canvas: { width: 210, height: 90 }, layers: [{ id: 'text', type: 'text', text: 'Hi', font: 'courier-prime-regular', height: 25, stoneSize: 2, gap: 0.3, color: 'gold' }] };
  const validated = validateProject(project);
  assert.equal(validated.product, 'mug');
});

await test('12. the default project (mug) is byte-for-byte unchanged in shape (RS-1004 added no new default text-layer fields)', () => {
  const project = defaultProject();
  assert.equal(project.layers.length, 1);
  assert.equal(project.layers[0].id, 'text');
  assert.equal(project.layers[0].text, 'Vitalina Serbin');
  assert.equal(project.wrap, 'front');
  assert.equal(project.cupColor, '#1f3556');
});

// --- 4. Save/load round-trip + undo/redo ---------------------------------------------------------

await test('13. product/canvas/wrap round-trip through validateProject() for every template', () => {
  for (const id of OBJECT_TEMPLATE_IDS) {
    const template = getObjectTemplate(id);
    const project = { version: 2, product: id, canvas: { width: template.productionWidthMm, height: template.productionHeightMm }, wrap: template.wrap.default, cupColor: '#1f3556', layers: [{ id: 'text', type: 'text', text: 'Hi', font: 'courier-prime-regular', height: 25, stoneSize: 2, gap: 0.3, color: 'gold' }] };
    const validated = validateProject(JSON.parse(JSON.stringify(project)));
    assert.equal(validated.product, id, `${id}: product must round-trip exactly`);
    assert.deepEqual(validated.canvas, project.canvas, `${id}: canvas must round-trip exactly`);
    assert.equal(validated.wrap, project.wrap, `${id}: wrap must round-trip exactly`);
  }
});

await test('14. applyHistorySnapshot() restores the whole project (including product/canvas/wrap) from one JSON snapshot, exactly like every other field', () => {
  assert.match(appJs, /function applyHistorySnapshot\(snap\)\{project=snap\.project;selectedLayerId=snap\.selectedLayerId;syncSelectedControlsFromLayer\(\);updateAll\(true\)\}/);
  const snapshotMatch = appJs.match(/function currentSnapshot\(\)\{([\s\S]*?)\}\n/);
  assert.ok(snapshotMatch);
  assert.match(snapshotMatch[1], /project:JSON\.parse\(JSON\.stringify\(project\)\)/, 'currentSnapshot() must deep-clone the whole project object, which already includes product/canvas/wrap -- no RS-1004-specific history code is needed');
});

// --- 5. Deterministic StoneLayout / unchanged geometry ---------------------------------------------

await test('15. the merged StoneLayout for a fixed text layer is identical across all three object templates (object type never perturbs geometry)', async () => {
  const engine = await buildPermanentEngine();
  const project = defaultProject();
  const results = {};
  for (const id of OBJECT_TEMPLATE_IDS) {
    const withTemplate = { ...project, product: id };
    const layout = await generateMergedLayout(withTemplate, engine);
    results[id] = layout.toJSON();
  }
  const [first, ...rest] = OBJECT_TEMPLATE_IDS;
  for (const id of rest) {
    assert.deepEqual(results[id].stones, results[first].stones, `${id}: stone positions must be identical to ${first}'s (StoneLayout is object-agnostic)`);
    assert.equal(results[id].count, results[first].count);
  }
});

await test('16. generation is deterministic across two independent runs for the same object template', async () => {
  const engine = await buildPermanentEngine();
  const project = defaultProject();
  const a = await generateMergedLayout(project, engine);
  const b = await generateMergedLayout(project, engine);
  assert.deepEqual(a.toJSON(), b.toJSON());
});

await test('17. switching object type and back leaves layer geometry fields untouched (only project.canvas/wrap/product change)', () => {
  const project = defaultProject();
  const originalLayer = JSON.parse(JSON.stringify(project.layers[0]));
  // Simulate the #objectType handler's own mutation exactly (product/canvas/wrap only).
  const tumbler = getObjectTemplate('tumbler');
  project.product = tumbler.id;
  project.canvas = { width: tumbler.productionWidthMm, height: tumbler.productionHeightMm };
  project.wrap = tumbler.wrap.default;
  const mug = getObjectTemplate('mug');
  project.product = mug.id;
  project.canvas = { width: mug.productionWidthMm, height: mug.productionHeightMm };
  project.wrap = mug.wrap.default;
  assert.deepEqual(project.layers[0], originalLayer, 'layer fields must be untouched by an object-type round-trip');
  assert.deepEqual(project.canvas, { width: 210, height: 90 }, 'canvas must return to the original mug default');
});

// --- 6. GeometryEngine/StoneLayout untouched, export compatibility --------------------------------

await test('18. StoneLayout.js is untouched by this milestone (GeometryEngine.js is now legitimately changed by RS-1008A)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output.split('\n').filter((l) => l.trim().length > 0).map((l) => l.slice(3).trim());
  // RS-1008A (Image Trace Architecture Correction) legitimately adds
  // GeometryEngine.generateImageLayout() -- see tools/test-image-trace-regression.mjs.
  for (const changedPath of changedPaths) {
    assert.notEqual(changedPath, 'src/geometry/StoneLayout.js', 'this milestone must not touch StoneLayout.js');
  }
});

await test('19. every export button id and downloaded filename is unchanged, including the Object Preview PNG (still exportCup / rhinestone-cup-preview.png)', () => {
  assert.match(appJs, /el\('exportProject'\)\.onclick=/);
  assert.match(appJs, /el\('exportLayout'\)\.onclick=/);
  assert.match(appJs, /el\('exportSVG'\)\.onclick=/);
  assert.match(appJs, /el\('exportPNG'\)\.onclick=/);
  assert.match(appJs, /el\('exportCup'\)\.onclick=/);
  assert.ok(appJs.includes("'rhinestone-project.json'"));
  assert.ok(appJs.includes("'rhinestone-generated-layout.json'"));
  assert.ok(appJs.includes("'rhinestone-layout.svg'"));
  assert.ok(appJs.includes("'rhinestone-layout.png'"));
  assert.ok(appJs.includes("'rhinestone-cup-preview.png'"), 'the Object Preview PNG export filename must stay byte-identical for export compatibility');
});

await test('20. the #cup canvas id and #cupColor control id are unchanged; only their human-facing labels were generalized', () => {
  assert.match(indexHtml, /<canvas id="cup">/);
  assert.match(indexHtml, /<select id="cupColor">/);
  assert.ok(indexHtml.includes('Object Preview'), 'expected the panel header to be relabeled to object-generic wording');
  assert.ok(indexHtml.includes('Preview background'), 'expected the cupColor label to be relabeled to object-generic wording');
});

await test('21. no forbidden file changed (this milestone\'s own forbidden list)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output.split('\n').filter((l) => l.trim().length > 0).map((l) => l.slice(3).trim());
  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  // src/renderer/StoneColors.js is legitimately changed by RS-1007 (Crystal Color Library — it
  // became a compatibility re-export shim over the new src/renderer/CrystalColors.js catalog) —
  // see tools/test-crystal-color-catalog.mjs / tools/test-crystal-color-integration.mjs for that
  // milestone's own forbidden-file guard.
  const forbiddenExactWithinPrefix = new Set(['src/renderer/CanvasRenderer2D.js']);
  // src/export/ is legitimately changed by RS-1005 (Production Sheet export) — see
  // tools/test-production-sheet-exporter.mjs for that milestone's own forbidden-file guard.
  // src/geometry/ is legitimately changed by RS-1008A (Image Trace Architecture Correction) — see
  // tools/test-image-trace-regression.mjs for that milestone's own forbidden-file guard.
  const forbiddenPrefixes = ['src/text/', 'src/fonts/', 'src/core/', 'src/browser/', 'src/svg/', 'src/history/', 'assets/', 'examples/'];
  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(!forbiddenExactWithinPrefix.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(!forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)), `Forbidden file changed: ${changedPath}`);
  }
});

console.log('Object template integration tests passed.');
