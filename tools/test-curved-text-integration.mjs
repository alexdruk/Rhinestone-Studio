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

// UI-001 (Complete Application Redesign) moved #textControls into the Text Lightbox and
// #shapeControls into the Shapes Lightbox -- they are no longer adjacent siblings, so the original
// `/<div id="textControls">([\s\S]*?)<\/div>\s*<div id="shapeControls"/` non-greedy regex no longer
// bounds its capture to #textControls itself: it now expands across the entire rest of the document
// looking for any later `</div><div id="shapeControls"` adjacency (which still exists, coincidentally,
// inside the unrelated Shapes Lightbox), so test 7 below used to "pass" without actually checking
// only #textControls's own content. This tag-depth-aware helper extracts exactly one element's inner
// HTML regardless of what follows it.
function extractElementHtml(html, id) {
  const openTagMatch = html.match(new RegExp(`<([a-zA-Z]+)[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(openTagMatch, `expected to find an element with id="${id}"`);
  const tag = openTagMatch[1];
  const start = openTagMatch.index + openTagMatch[0].length;
  const openRe = new RegExp(`<${tag}\\b`, 'g');
  const closeRe = new RegExp(`</${tag}>`, 'g');
  let depth = 1;
  let cursor = start;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    assert.ok(nextClose, `unbalanced <${tag}> for id="${id}"`);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) return html.slice(start, nextClose.index);
    }
  }
  throw new Error(`unreachable: failed to extract #${id}`);
}

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
  const body = extractElementHtml(indexHtml, 'textControls');
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

await test('10. src/export/** was byte-for-byte untouched through RS-1003 (src/renderer/** was correctly forbidden at RS-1003 time but is now legitimately generalized by RS-1004\'s multi-object preview support — see tools/test-object-template-integration.mjs for that milestone\'s own forbidden-file guard; src/export/** is likewise now legitimately changed by RS-1005\'s Production Sheet export — see tools/test-production-sheet-exporter.mjs for that milestone\'s own forbidden-file guard)', () => {
  const output = execSync('git diff --name-only HEAD', { cwd: repoRoot, encoding: 'utf8' })
    + execSync('git diff --name-only --cached HEAD', { cwd: repoRoot, encoding: 'utf8' })
    + execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3)).join('\n');
  const changedPaths = output.split('\n').map((p) => p.trim()).filter(Boolean);
  const allowedDespitePrefix = new Set([
    'src/export/ProductionSheetExporter.js',
    'src/export/PdfDocument.js',
    'src/export/SvgExporter.js',
    'src/export/README.md'
  ]);
  for (const changedPath of changedPaths) {
    if (changedPath.startsWith('src/export/') && allowedDespitePrefix.has(changedPath)) continue;
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
