import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// SEC-001 — Secure Imported Project Rendering.
//
// layer.id is the one imported-project value that reaches innerHTML unescaped (renderLayerUI(),
// app.js). This suite proves: (1) validateProject() rejects a hostile/malformed layer.id and
// accepts every legacy id shape already in use, (2) escapeHtml() now escapes ' in addition to
// & < > ", (3) renderLayerUI()'s real, extracted HTML output never contains an unescaped hostile
// id even if one reached project.layers by some other path (defense in depth), and (4) every
// internally generated layer id (defaultProject()/duplicateLayer()/the "add layer" handlers)
// still satisfies the new id pattern.
//
// app.js is a browser entry point, not import()-able directly under plain Node (module-level code
// dereferences `document` at load time) — this suite extracts the real functions from app.js via
// regex and executes them with `new Function(...)`, matching the established precedent in
// tools/test-object-template-integration.mjs / tools/test-variable-stone-sizes.mjs.
// See docs/specifications/SEC-001-SecureImportedProjects.md.

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

// --- Extraction (mirrors tools/test-object-template-integration.mjs) ---------------------------

async function extractProjectFunctions() {
  const validateMatch = appJs.match(/function validateProject\(obj\)\{[\s\S]*?\n\}\n/);
  assert.ok(validateMatch, 'expected to find validateProject() in app.js');
  // RS-2010: defaultProject() now computes a `const vessel=...;` before its `return{...}` (the
  // vessel-derived canvas) -- the pattern no longer requires "return{" immediately after "(){".
  const defaultMatch = appJs.match(/function defaultProject\(\)\{[\s\S]*?\}\}\n/);
  assert.ok(defaultMatch, 'expected to find defaultProject() in app.js');

  const constantsStart = appJs.indexOf('const DEFAULT_TEXT_FONT_ID=');
  const source = `${appJs.slice(constantsStart, appJs.indexOf(defaultMatch[0]) + defaultMatch[0].length)}\n${appJs.slice(appJs.indexOf('const SUPPORTED_LAYER_TYPES=new Set'), appJs.indexOf(validateMatch[0]) + validateMatch[0].length)}`;

  const { SHAPE_LIBRARY_KINDS } = await import('../src/geometry/index.js');
  const { getObjectTemplate, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel } = await import('../src/products/index.js');
  // eslint-disable-next-line no-new-func
  return new Function(
    'getObjectTemplate', 'SHAPE_LIBRARY_KINDS', 'getPlateDefaults', 'normalizePlateParams',
    'VESSEL_PRODUCT_IDS', 'getVesselDefaults', 'normalizeVesselParams', 'deriveLegacyVesselParams', 'computeCanvasFromVessel',
    `${source}\nreturn { validateProject, defaultProject, LAYER_ID_PATTERN };`
  )(getObjectTemplate, SHAPE_LIBRARY_KINDS, getPlateDefaults, normalizePlateParams, VESSEL_PRODUCT_IDS, getVesselDefaults, normalizeVesselParams, deriveLegacyVesselParams, computeCanvasFromVessel);
}

function extractEscapeHtml() {
  const match = appJs.match(/function escapeHtml\(s\)\{[\s\S]*?\}(?=\nfunction resizeCanvas)/);
  assert.ok(match, 'expected to find escapeHtml() in app.js');
  // eslint-disable-next-line no-new-func
  return new Function(`${match[0]}\nreturn escapeHtml;`)();
}

function extractRenderLayerUI() {
  const layerLabelMatch = appJs.match(/function layerLabel\(l\)\{[\s\S]*?\}(?=function escapeHtml)/);
  assert.ok(layerLabelMatch, 'expected to find layerLabel() in app.js');
  const escapeHtmlMatch = appJs.match(/function escapeHtml\(s\)\{[\s\S]*?\}(?=\nfunction resizeCanvas)/);
  assert.ok(escapeHtmlMatch, 'expected to find escapeHtml() in app.js');
  const renderMatch = appJs.match(/function renderLayerUI\(\)\{[\s\S]*?\n\}(?=function layerLabel)/);
  assert.ok(renderMatch, 'expected to find renderLayerUI() in app.js');

  const source = `${layerLabelMatch[0]}\n${escapeHtmlMatch[0]}\n${renderMatch[0]}\nreturn renderLayerUI;`;
  // eslint-disable-next-line no-new-func
  return new Function('project', 'selectedLayerId', 'selectedLayerIds', 'el', 'selectedLayer', 'updateObjectTemplateDetail', 'SHAPE_DISPLAY_LABELS', source);
}

const { validateProject, defaultProject, LAYER_ID_PATTERN } = await extractProjectFunctions();
const escapeHtml = extractEscapeHtml();
const makeRenderLayerUI = extractRenderLayerUI();

function minimalTextLayer(id) {
  return { id, type: 'text', text: 'Hi', font: 'courier-prime-regular', height: 25, stoneSize: 2, gap: 0.3, color: 'gold' };
}

function minimalProject(layerId) {
  return { version: 2, canvas: { width: 210, height: 90 }, layers: [minimalTextLayer(layerId)] };
}

// --- 1. Hostile layer id rejected ----------------------------------------------------------------

const HOSTILE_IDS = [
  ['attribute breakout + event handler', 'x" onmouseover="alert(1)'],
  ['angle-bracket element injection', '<img src=x onerror=alert(1)>'],
  ['single-quote breakout', "x' onmouseover='alert(1)"],
  ['ampersand', 'a&b'],
  ['space', 'a b'],
  ['empty after trim-like content', ' '],
  ['over-length (65 chars)', 'a'.repeat(65)],
];

for (const [label, id] of HOSTILE_IDS) {
  await test(`1. validateProject() rejects a hostile layer id (${label})`, () => {
    assert.throws(() => validateProject(minimalProject(id)), /invalid id/i, `expected validateProject() to reject id ${JSON.stringify(id)}`);
  });
}

await test('1. validateProject() error message names the offending id and the pattern', () => {
  try {
    validateProject(minimalProject('bad id'));
    assert.fail('expected validateProject() to throw');
  } catch (error) {
    assert.match(error.message, /layers\[0\]/);
    assert.match(error.message, /bad id/);
  }
});

// --- 2. Valid legacy ids accepted -----------------------------------------------------------------

const LEGACY_VALID_IDS = ['text', 'circle1737384000000', 'path1737384000000', 'svg1737384000000_0', 'a', '64charslong'.repeat(1).padEnd(64, 'x'), 'a-b_c-D9'];

for (const id of LEGACY_VALID_IDS) {
  await test(`2. validateProject() accepts a legacy-shaped id (${JSON.stringify(id)})`, () => {
    const validated = validateProject(minimalProject(id));
    assert.equal(validated.layers[0].id, id);
  });
}

await test('2. every examples/*.rhs fixture layer id satisfies the new LAYER_ID_PATTERN', async () => {
  const entries = (await readdir(path.join(repoRoot, 'examples'))).filter((name) => name.endsWith('.rhs'));
  assert.ok(entries.length > 0, 'expected at least one .rhs fixture to exist');
  for (const name of entries) {
    const raw = JSON.parse(await readFile(path.join(repoRoot, 'examples', name), 'utf8'));
    for (const layer of raw.layers) {
      assert.match(layer.id, LAYER_ID_PATTERN, `${name}: layer id ${JSON.stringify(layer.id)} must satisfy LAYER_ID_PATTERN`);
    }
  }
});

await test('2. defaultProject()\'s own layer id validates cleanly', () => {
  const validated = validateProject(JSON.parse(JSON.stringify(defaultProject())));
  assert.equal(validated.layers[0].id, 'text');
});

// --- 3. escapeHtml() escapes & < > " ' -----------------------------------------------------------

await test('3. escapeHtml() escapes each of & < > " \' individually', () => {
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
});

await test('3. escapeHtml() escapes a combined hostile string (attribute + element breakout)', () => {
  const input = `x" onmouseover='alert(1)'><img src=x onerror=alert(1)>`;
  const escaped = escapeHtml(input);
  assert.ok(!escaped.includes('"'), 'no raw double quote must survive');
  assert.ok(!escaped.includes("'"), 'no raw single quote must survive');
  assert.ok(!escaped.includes('<'), 'no raw < must survive');
  assert.ok(!escaped.includes('>'), 'no raw > must survive');
});

// --- 4. Attribute escaping (renderLayerUI, extracted + executed for real) -------------------------

function makeMockEl() {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) {
      elements.set(id, { _html: '', set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; }, value: '', style: {}, title: '', textContent: '', disabled: false });
    }
    return elements.get(id);
  };
  return { get, elements };
}

await test('4. renderLayerUI() HTML-escapes layer.id in both the #selectedLayer <option value> and #layersList data-layer attribute', () => {
  // Bypasses validateProject() deliberately -- this proves the escaping fix at the render call
  // site itself is real (defense in depth), independent of the Phase 3 validation gate.
  const hostileId = `x" onmouseover="alert(1)`;
  const project = { layers: [{ id: hostileId, type: 'text', text: 'Hi', visible: true }] };
  const { get } = makeMockEl();
  const renderLayerUI = makeRenderLayerUI(project, hostileId, new Set([hostileId]), get, () => project.layers[0], () => {}, {});
  renderLayerUI();

  const selectedLayerHtml = get('selectedLayer')._html;
  const layersListHtml = get('layersList')._html;
  assert.ok(selectedLayerHtml.includes('&quot;'), 'expected the hostile id\'s embedded quote to be escaped in #selectedLayer');
  assert.ok(!selectedLayerHtml.includes('onmouseover="alert'), '#selectedLayer must not contain an unescaped injected attribute');
  assert.ok(layersListHtml.includes('&quot;'), 'expected the hostile id\'s embedded quote to be escaped in #layersList');
  assert.ok(!layersListHtml.includes('onmouseover="alert'), '#layersList must not contain an unescaped injected attribute');
});

await test('4. renderLayerUI() renders a normal, LAYER_ID_PATTERN-compliant id unchanged', () => {
  const id = 'circle1737384000000';
  const project = { layers: [{ id, type: 'circle', visible: true }] };
  const { get } = makeMockEl();
  const renderLayerUI = makeRenderLayerUI(project, id, new Set([id]), get, () => project.layers[0], () => {}, {});
  renderLayerUI();
  assert.ok(get('selectedLayer')._html.includes(`value="${id}"`));
  assert.ok(get('layersList')._html.includes(`data-layer="${id}"`));
});

// --- 5. HTML escaping (general, existing call sites unaffected) -----------------------------------

await test('5. escapeHtml() leaves ordinary text content unchanged (no over-escaping regression)', () => {
  assert.equal(escapeHtml('Vitalina Serbin'), 'Vitalina Serbin');
  assert.equal(escapeHtml('SS16 — 4.0 mm'), 'SS16 — 4.0 mm');
});

// --- 6. Duplicate/add-layer paths still generate valid ids -----------------------------------------

await test('6. every internally-generated layer id template in app.js (defaultProject/duplicateLayer/add-layer handlers) matches LAYER_ID_PATTERN for a representative Date.now() value', () => {
  // Matches every `id:'<type>'+Date.now()` / `` id:`${l.type}${Date.now()}${i}` `` style literal in
  // app.js and re-derives a representative id the same way the real code would build one, without
  // needing to execute the full app.js DOM/event-handler machinery.
  const idLiteralPattern = /id:'([a-z]+)'\+Date\.now\(\)/g;
  const sampleNow = String(Date.now());
  const foundTypes = new Set();
  let match;
  while ((match = idLiteralPattern.exec(appJs))) {
    foundTypes.add(match[1]);
  }
  assert.ok(foundTypes.size > 0, 'expected to find at least one `id:\'<type>\'+Date.now()` layer-creation literal in app.js');
  for (const type of foundTypes) {
    const sampleId = `${type}${sampleNow}`;
    assert.match(sampleId, LAYER_ID_PATTERN, `generated id for type "${type}" (${sampleId}) must satisfy LAYER_ID_PATTERN`);
  }

  // The drag-duplicate path uses a template literal form: `${l.type}${Date.now()}${i}`.
  assert.match(appJs, /`\$\{l\.type\}\$\{Date\.now\(\)\}\$\{i\}`/, 'expected to find the drag-duplicate id template literal in app.js');
  for (const type of foundTypes) {
    const sampleId = `${type}${sampleNow}0`;
    assert.match(sampleId, LAYER_ID_PATTERN, `drag-duplicate id for type "${type}" (${sampleId}) must satisfy LAYER_ID_PATTERN`);
  }
});

await test('6. duplicateLayer()\'s id template (`l.type+Date.now()`) matches LAYER_ID_PATTERN for every supported layer type', () => {
  assert.match(appJs, /copy\.id=l\.type\+Date\.now\(\)/, 'expected duplicateLayer() to build its copy id from l.type+Date.now()');
  const sampleNow = String(Date.now());
  const layerTypes = ['text', 'circle', 'rectangle', 'svg', 'image', 'path', 'ellipse', 'capsule', 'polygon', 'star', 'heart', 'arrow', 'cross', 'crescent', 'ring'];
  for (const type of layerTypes) {
    assert.match(`${type}${sampleNow}`, LAYER_ID_PATTERN);
  }
});

await test('6. defaultProject()\'s literal id "text" matches LAYER_ID_PATTERN', () => {
  assert.match(defaultProject().layers[0].id, LAYER_ID_PATTERN);
});
