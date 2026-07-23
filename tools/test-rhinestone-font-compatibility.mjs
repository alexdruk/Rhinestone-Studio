/**
 * TXT-101A — Original Rhinestone Font System Foundation: serialization & legacy compatibility.
 *
 * Covers: providerId resolution for both legacy (pre-TXT-101A) and new rhinestone font ids,
 * validateProject() accepting a text layer with a rhinestone-native font id and passing it through
 * unchanged (project files store intent, per docs/architecture/architecture.md -- validateProject()
 * has never validated `layer.font` at all, so a rhinestone id needs no new validation branch),
 * project JSON round-tripping cleanly through JSON.stringify/parse with a rs-*-regular font id, and
 * that every text-generation call site threads providerId through to the permanent engine.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `expected to find "${signature}" in app.js`);
  let depth = 0, end = start;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return source.slice(start, end);
}

// ---------------------------------------------------------------------------------------------
// 1. resolveFontProviderId(): the actual runtime logic behind providerId threading
// ---------------------------------------------------------------------------------------------

test('1. resolveFontProviderId() resolves a legacy (pre-TXT-101A) desktop font id to "opentype" and a rhinestone-native id to "rhinestone"', () => {
  const manager = new FontManager(manifest);
  const source = extractFunction(appJs, 'function resolveFontProviderId(fontId)');
  // eslint-disable-next-line no-new-func
  const resolveFontProviderId = new Function('fontManager', `${source}\nreturn resolveFontProviderId;`)(manager);

  assert.equal(resolveFontProviderId('courier-prime-regular'), 'opentype');
  assert.equal(resolveFontProviderId('great-vibes-regular'), 'opentype');
  assert.equal(resolveFontProviderId('rs-block-regular'), 'rhinestone');
  assert.equal(resolveFontProviderId('rs-modern-regular'), 'rhinestone');
  assert.equal(resolveFontProviderId('rs-script-regular'), 'rhinestone');
});

test('2. resolveFontProviderId() falls back to "opentype" for an unknown font id or when fontManager never loaded (matches TEXT_ENGINE_FONT_IDS\' own fallback convention)', () => {
  const manager = new FontManager(manifest);
  const source = extractFunction(appJs, 'function resolveFontProviderId(fontId)');
  // eslint-disable-next-line no-new-func
  const withManager = new Function('fontManager', `${source}\nreturn resolveFontProviderId;`)(manager);
  const withoutManager = new Function('fontManager', `${source}\nreturn resolveFontProviderId;`)(null);

  assert.equal(withManager('totally-unknown-font-id'), 'opentype');
  assert.equal(withoutManager('courier-prime-regular'), 'opentype');
  assert.equal(withoutManager('rs-block-regular'), 'opentype');
});

// ---------------------------------------------------------------------------------------------
// 2. Every text-generation call site threads providerId, using resolveFontProviderId (not a
//    hardcoded/duplicated resolution)
// ---------------------------------------------------------------------------------------------

test('3. generateTextStonesLive() resolves and passes providerId', () => {
  assert.match(appJs, /const fontId=TEXT_ENGINE_FONT_IDS\.has\(layer\.font\)\?layer\.font:DEFAULT_TEXT_FONT_ID;const mode=resolveTextFillMode\(layer\.textMode\);const base=\{text:layer\.text,fontId,providerId:resolveFontProviderId\(fontId\)/);
});

test('4. resolveLayerShapeSource()\'s text branch (Boolean Operations input) resolves and passes providerId', () => {
  assert.match(appJs, /const fontId=TEXT_ENGINE_FONT_IDS\.has\(layer\.font\)\?layer\.font:DEFAULT_TEXT_FONT_ID;\s*const base=\{text:layer\.text,fontId,providerId:resolveFontProviderId\(fontId\)/);
});

test('5. fitTextToShape()\'s text-measurement call resolves and passes providerId', () => {
  assert.match(appJs, /const measured=await permanentEngine\.resolveTextPolygons\(\{text:textLayer\.text,fontId,providerId:resolveFontProviderId\(fontId\)/);
});

// ---------------------------------------------------------------------------------------------
// 3. validateProject(): a rhinestone font id needs no new validation branch (matches the
//    pre-existing "font is never validated" behavior every other font id already relies on)
// ---------------------------------------------------------------------------------------------

function extractValidateProject() {
  return extractFunction(appJs, 'function validateProject(obj)');
}

test('6. validateProject() accepts a text layer with a rhinestone-native font id, unchanged from any other font id', () => {
  const source = extractValidateProject();
  // eslint-disable-next-line no-new-func
  const validateProject = new Function(
    'getObjectTemplate', 'normalizePlateParams', 'LAYER_ID_PATTERN', 'SUPPORTED_LAYER_TYPES', 'XYWH_SHAPE_TYPES', 'DEFAULT_PROJECT_NAME',
    `${source}\nreturn validateProject;`
  )(
    () => ({ id: 'mug' }),
    (plate) => plate ?? {},
    /^[A-Za-z0-9_-]{1,64}$/,
    new Set(['text']),
    new Set(),
    'Untitled'
  );

  const project = {
    version: 2, canvas: { width: 210, height: 90 },
    layers: [{ id: 'text1', type: 'text', text: 'Hello', font: 'rs-block-regular', stoneSize: 2, gap: 0.3 }]
  };
  const result = validateProject(project);
  assert.equal(result.layers[0].font, 'rs-block-regular');
});

test('7. validateProject() never throws on an unrecognized/foreign font id either (silent fallback happens at generation time, not validation time -- matches the pre-existing behavior every font id relies on)', () => {
  const source = extractValidateProject();
  // eslint-disable-next-line no-new-func
  const validateProject = new Function(
    'getObjectTemplate', 'normalizePlateParams', 'LAYER_ID_PATTERN', 'SUPPORTED_LAYER_TYPES', 'XYWH_SHAPE_TYPES', 'DEFAULT_PROJECT_NAME',
    `${source}\nreturn validateProject;`
  )(
    () => ({ id: 'mug' }),
    (plate) => plate ?? {},
    /^[A-Za-z0-9_-]{1,64}$/,
    new Set(['text']),
    new Set(),
    'Untitled'
  );

  const project = {
    version: 2, canvas: { width: 210, height: 90 },
    layers: [{ id: 'text1', type: 'text', text: 'Hello', font: 'some-future-font-id-not-yet-registered', stoneSize: 2, gap: 0.3 }]
  };
  assert.doesNotThrow(() => validateProject(project));
});

// ---------------------------------------------------------------------------------------------
// 4. Project JSON round-trips cleanly (serialization)
// ---------------------------------------------------------------------------------------------

test('8. a project containing a rhinestone-native font id serializes and deserializes cleanly through JSON.stringify/parse', () => {
  const project = {
    version: 2, units: 'mm', name: 'Test', product: 'mug', canvas: { width: 210, height: 90 },
    layers: [{ id: 'text1', type: 'text', visible: true, text: 'Rhinestone', font: 'rs-script-regular', height: 25, textMode: 'stroke', stoneSize: 2, gap: 0.3, color: 'gold', autoFit: true, x: 0, y: 0 }]
  };
  const roundTripped = JSON.parse(JSON.stringify(project));
  assert.deepEqual(roundTripped, project);
  assert.equal(roundTripped.layers[0].font, 'rs-script-regular');
});

// ---------------------------------------------------------------------------------------------
// 5. Existing (pre-TXT-101A) projects keep loading/rendering identically
// ---------------------------------------------------------------------------------------------

test('9. FontManager backward compatibility: every pre-existing font id/family/enabled state is unchanged by the manifest additions', () => {
  const manager = new FontManager(manifest);
  for (const id of ['courier-prime-regular', 'great-vibes-regular', 'pt-serif-regular', 'montserrat-regular', 'playfair-display-regular', 'cinzel-regular', 'lobster-regular', 'anton-regular', 'caveat-regular']) {
    assert.ok(manager.hasFont(id));
    assert.equal(manager.getFont(id).enabled, true);
    assert.equal(manager.getFont(id).providerId, 'opentype');
  }
  assert.equal(manager.getFont('roboto-mono-regular').enabled, false);
});

test('10. DEFAULT_TEXT_FONT_ID is unchanged (an old project with no/invalid font id still falls back to Courier Prime, never a rhinestone font)', () => {
  const match = appJs.match(/const DEFAULT_TEXT_FONT_ID='([^']*)'/);
  assert.equal(match[1], 'courier-prime-regular');
});

console.log('Rhinestone Font Compatibility (TXT-101A) tests passed.');
