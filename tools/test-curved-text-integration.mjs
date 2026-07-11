import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1003 — verifies app.js/index.html are actually wired for curved text: the six new per-text-
// layer fields are present in defaultProject(), forwarded to the permanent engine, read/written by
// the UI sync functions, tracked by undo/redo history, and exposed as real controls in index.html.
// Structural checks against the live source, matching the established convention in
// tools/test-live-text-integration.mjs / tools/test-undo-redo-integration.mjs, because app.js is a
// browser entry point and is not import()-able directly under plain Node. Also proves (by absence
// of change) that this milestone required zero renderer/exporter edits, per
// docs/specifications/RS-1003-CurvedText.md's hard architectural requirement.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

const CURVE_FIELDS = ['curveEnabled', 'curveRadiusMm', 'curveDirection', 'curveStartAngleDeg', 'curveSweepAngleDeg', 'curveAlignment'];

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

await test('1. app.js imports the permanent GeometryEngine and implements no arc math of its own', () => {
  assert.match(appJs, /import\s*\{\s*GeometryEngine\s+as\s+\w+[^}]*\}\s*from\s*['"]\.\/src\/geometry\/index\.js['"]/);
  assert.ok(!appJs.includes('projectPointToArc'), 'app.js must not implement arc projection itself — it only forwards curve fields to the permanent engine');
});

await test('2. defaultProject()\'s text layer carries all six curve fields with valid default values', () => {
  const match = appJs.match(/function defaultProject\(\)\{return\{[\s\S]*?\}\}\n/);
  assert.ok(match, 'expected to find defaultProject()');
  const body = match[0];
  for (const field of CURVE_FIELDS) {
    assert.ok(body.includes(`${field}:`), `expected defaultProject()'s text layer to set ${field}`);
  }
  assert.ok(body.includes('curveEnabled:false'), 'expected curved text to default to off (straight text unchanged by default)');
});

await test('3. generateTextStonesLive() forwards all six curve fields to generateTextLayout()', () => {
  const match = appJs.match(/async generateTextStonesLive\(layer,project\)\{[\s\S]*?const base=\{([\s\S]*?)\};/);
  assert.ok(match, 'expected to find generateTextStonesLive()\'s base params object');
  const body = match[1];
  for (const field of CURVE_FIELDS) {
    assert.ok(body.includes(`${field}:`), `expected the base params object to forward ${field}`);
  }
});

await test('4. HISTORY_TRACKED_CONTROL_IDS includes all six curve control ids (undoable, coalesced edits)', () => {
  const listMatch = appJs.match(/const HISTORY_TRACKED_CONTROL_IDS=\[([\s\S]*?)\];/);
  assert.ok(listMatch, 'expected a HISTORY_TRACKED_CONTROL_IDS constant');
  const ids = JSON.parse(`[${listMatch[1].replace(/'/g, '"')}]`);
  for (const field of CURVE_FIELDS) {
    assert.ok(ids.includes(field), `expected HISTORY_TRACKED_CONTROL_IDS to include ${field}`);
  }
});

await test('5. syncSelectedControlsFromLayer() reads all six curve fields from the layer into the UI', () => {
  const match = appJs.match(/function syncSelectedControlsFromLayer\(\)\{[\s\S]*?if\(isText\)\{([\s\S]*?)\}else\{/);
  assert.ok(match, 'expected to find the isText branch of syncSelectedControlsFromLayer()');
  const body = match[1];
  for (const field of CURVE_FIELDS) {
    assert.ok(body.includes(`el('${field}')`), `expected syncSelectedControlsFromLayer() to sync #${field}`);
  }
  assert.ok(body.includes("el('curveControls').style.display"), 'expected curveControls visibility to be synced from the layer');
});

await test('6. writeSelectedControlsToLayer() writes all six curve fields from the UI into the layer', () => {
  const match = appJs.match(/function writeSelectedControlsToLayer\(\)\{const l=selectedLayer\(\);if\(l\.type==='text'\)\{([\s\S]*?)\}else if\(l\.type==='circle'\)/);
  assert.ok(match, 'expected to find the text branch of writeSelectedControlsToLayer()');
  const body = match[1];
  for (const field of CURVE_FIELDS) {
    assert.ok(body.includes(`l.${field}=`), `expected writeSelectedControlsToLayer() to write l.${field}`);
  }
});

await test('7. index.html exposes all six curve controls plus a curveControls container, inside #textControls', () => {
  const match = indexHtml.match(/<div id="textControls">([\s\S]*?)<\/div>\s*<div id="shapeControls"/);
  assert.ok(match, 'expected to find #textControls in index.html');
  const body = match[1];
  for (const field of CURVE_FIELDS) {
    assert.ok(body.includes(`id="${field}"`), `expected #textControls to contain an element with id="${field}"`);
  }
  assert.ok(body.includes('id="curveControls"'), 'expected a #curveControls container for the detail fields');
  assert.ok(body.includes('id="curveDirection"') && body.includes('value="outside"') && body.includes('value="inside"'), 'expected #curveDirection to offer outside/inside');
  assert.ok(body.includes('id="curveAlignment"') && body.includes('value="start"') && body.includes('value="center"') && body.includes('value="end"'), 'expected #curveAlignment to offer start/center/end');
});

await test('8. duplicateLayer() needs no curve-specific code: its existing deep clone already preserves every field', () => {
  const match = appJs.match(/function duplicateLayer\(id\)\{([\s\S]*?)\}function deleteLayer/);
  assert.ok(match, 'expected to find duplicateLayer()');
  assert.match(match[1], /JSON\.parse\(JSON\.stringify\(l\)\)/, 'expected a full deep clone of the source layer, which preserves curve fields with no extra code');
});

await test('9. validateProject() needs no curve-specific code: it already spreads every layer field verbatim', () => {
  const match = appJs.match(/return\{version:Number\(obj\.version\)\|\|2[\s\S]*?layers:obj\.layers\.map\(l=>\(\{\.\.\.l,visible:l\.visible!==false\}\)\)\}/);
  assert.ok(match, 'expected validateProject() to spread every layer field (...l) so curve fields round-trip with no extra validation code');
});

await test('10. src/renderer/** and src/export/** are byte-for-byte untouched by this milestone', () => {
  const output = execSync('git diff --name-only HEAD', { cwd: repoRoot, encoding: 'utf8' })
    + execSync('git diff --name-only --cached HEAD', { cwd: repoRoot, encoding: 'utf8' })
    + execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3)).join('\n');
  const changedPaths = output.split('\n').map((p) => p.trim()).filter(Boolean);
  for (const changedPath of changedPaths) {
    assert.ok(!changedPath.startsWith('src/renderer/'), `Forbidden file changed: ${changedPath}`);
    assert.ok(!changedPath.startsWith('src/export/'), `Forbidden file changed: ${changedPath}`);
  }
});

await test('11. no other forbidden file changed (src/text, src/fonts, src/core, src/browser, src/svg, src/history, assets, style.css)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css']);
  const forbiddenPrefixes = ['src/text/', 'src/fonts/', 'src/core/', 'src/browser/', 'src/svg/', 'src/history/', 'assets/'];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Curved text integration tests passed.');
