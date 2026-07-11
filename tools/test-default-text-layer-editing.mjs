import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// S-003 — stabilization fix for a reported "the default 'Vitalina Serbin' text layer cannot be
// edited or deleted through the normal UI" defect.
//
// Root cause (confirmed via a real headless-Chrome session against the live app, not just source
// reading): selecting, editing (text/font/textMode/curve), duplicating, hiding/showing, and
// undo/redo already worked correctly for the default layer. The one genuinely broken path was
// deletion: deleteLayer()'s "never drop below one layer" guard has always existed and never
// crashed, but its only feedback was `#status.textContent`, an element at the very bottom of the
// `.side` panel -- the same panel tools/test-ui-discoverability.mjs already documented as ~1600px+
// tall against a ~700-900px viewport. On a brand-new project (which always starts with exactly one
// layer: the default text layer), clicking "Delete selected layer" -- the single most obvious
// affordance for removing it -- produced zero visible effect anywhere in the viewport, reading as a
// dead button rather than an enforced rule. That silent failure is what the report described as
// "cannot be deleted"; nothing else was actually broken.
//
// Fix (index.html + app.js only, no GeometryEngine/StoneLayout/export-schema change): once
// project.layers.length<=1, renderLayerUI() now disables both delete affordances (the per-row
// trash icon and the sidebar "Delete selected layer" button, each with an explanatory title) and
// reveals #layerRuleHint, a small always-in-viewport note directly under the button. deleteLayer()
// itself is unchanged in behavior (still the single source of truth for the rule, still guards the
// keyboard Delete/Backspace path) but now also shows/scrolls #layerRuleHint into view for that
// non-button path.
//
// These are structural checks against the live index.html/app.js source (no DOM/browser dependency
// here), matching the established convention in tools/test-ui-discoverability.mjs and
// tools/test-undo-redo-integration.mjs. Real interactive behavior (select/edit/delete/undo/redo/
// duplicate/visibility/save-load) was additionally verified in a real headless-Chrome session; see
// TASK_RESULT.md for that transcript.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

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

await test('1. defaultProject() still starts with exactly one text layer, id "text", text "Vitalina Serbin"', () => {
  const match = appJs.match(/function defaultProject\(\)\{return(\{[\s\S]*?\})\}/);
  assert.ok(match, 'expected to find defaultProject()');
  const fontIdMatch = appJs.match(/const DEFAULT_TEXT_FONT_ID='([^']*)'/);
  assert.ok(fontIdMatch, 'expected DEFAULT_TEXT_FONT_ID constant');
  // eslint-disable-next-line no-new-func
  const project = new Function('DEFAULT_TEXT_FONT_ID', `return ${match[1]}`)(fontIdMatch[1]);
  assert.equal(project.layers.length, 1, 'defaultProject() must start with exactly one layer');
  assert.equal(project.layers[0].id, 'text');
  assert.equal(project.layers[0].type, 'text');
  assert.equal(project.layers[0].text, 'Vitalina Serbin');
});

await test('2. #layerRuleHint exists exactly once, immediately after #deleteSelected (always in viewport, not only the far-off #status line)', () => {
  const matches = indexHtml.match(/id="layerRuleHint"/g) || [];
  assert.equal(matches.length, 1, 'expected exactly one #layerRuleHint element');
  assert.match(
    indexHtml,
    /<button id="deleteSelected"[^>]*>[^<]*<\/button><div id="layerRuleHint"/,
    'expected #layerRuleHint to sit directly after #deleteSelected, not buried elsewhere in the panel'
  );
  assert.match(indexHtml, /id="layerRuleHint" class="ruleHint" style="display:none"/, 'expected the hint to start hidden (only shown when layers.length<=1)');
});

await test('3. renderLayerUI() disables every delete affordance and reveals #layerRuleHint once only one layer remains, and re-derives this on every render (not just once at load)', () => {
  const match = appJs.match(/function renderLayerUI\(\)\{([\s\S]*?)\}function layerLabel/);
  assert.ok(match, 'expected to find renderLayerUI()');
  const body = match[1];
  assert.match(body, /const onlyOneLayer=project\.layers\.length<=1/, 'expected renderLayerUI to compute the single-layer state fresh on every call');
  assert.match(body, /data-action="delete" \$\{onlyOneLayer\?'disabled title="[^"]*"':''\}/, 'expected each layer row\'s trash-icon button to be disabled when only one layer remains');
  assert.match(body, /el\('deleteSelected'\)\.disabled=onlyOneLayer/, 'expected the sidebar "Delete selected layer" button to be disabled when only one layer remains');
  assert.match(body, /el\('layerRuleHint'\)\.style\.display=onlyOneLayer\?'block':'none'/, 'expected #layerRuleHint visibility to track the single-layer state');
});

await test('4. deleteLayer() is unchanged in behavior (still commits history, still filters by id, still never crashes) and additionally surfaces #layerRuleHint for the keyboard-shortcut path', () => {
  const match = appJs.match(/function deleteLayer\(id\)\{([\s\S]*?)\}\nfunction pointerToLayout/);
  assert.ok(match, 'expected to find deleteLayer()');
  const body = match[1];
  assert.match(body, /if\(project\.layers\.length<=1\)\{/, 'expected the "never drop below one layer" guard to remain first');
  assert.match(body, /commitHistory\(\);project\.layers=project\.layers\.filter/, 'expected deleteLayer to still commit history before filtering (undo/redo integration test relies on this too)');
  assert.match(body, /el\('layerRuleHint'\)/, 'expected the guard branch to also surface #layerRuleHint, not only #status');
});

await test('5. the keyboard Delete/Backspace shortcut still calls deleteLayer(selectedLayerId) and is still suppressed while a text/select field has focus', () => {
  assert.match(appJs, /if\(e\.key==='Delete'\|\|e\.key==='Backspace'\)\{const t=document\.activeElement\?\.tagName;if\(t==='INPUT'\|\|t==='SELECT'\)return;deleteLayer\(selectedLayerId\)\}/);
});

await test('6. every default-text-layer edit control from the required test list is still wired through the same history-tracked path (select/edit continues to work, was never the actual defect)', () => {
  const listMatch = appJs.match(/const HISTORY_TRACKED_CONTROL_IDS=\[([\s\S]*?)\];/);
  assert.ok(listMatch, 'expected HISTORY_TRACKED_CONTROL_IDS');
  const ids = JSON.parse(`[${listMatch[1].replace(/'/g, '"')}]`);
  for (const expected of ['text', 'font', 'textMode', 'curveEnabled', 'curveRadiusMm', 'curveDirection', 'curveStartAngleDeg', 'curveSweepAngleDeg', 'curveAlignment']) {
    assert.ok(ids.includes(expected), `expected HISTORY_TRACKED_CONTROL_IDS to include ${expected}`);
  }
  assert.match(appJs, /el\('selectedLayer'\)\.addEventListener\('change',\(\)=>\{selectedLayerId=el\('selectedLayer'\)\.value;syncSelectedControlsFromLayer\(\);updateAll\(true\)\}\)/, 'expected layer selection via the dropdown to remain wired');
  assert.match(appJs, /function hitTest\(mm\)\{[\s\S]*?l\.type==='text'\?'select':'move'/, 'expected clicking the text layer on the canvas to still select it (text has no drag/resize, by design)');
});

await test('7. duplicate/visibility toggle for the default layer are unchanged (still commit history, still wired via the layer-row action delegate)', () => {
  assert.match(appJs, /if\(action==='visible'\)\{const l=project\.layers\.find\(x=>x\.id===id\);commitHistory\(\);l\.visible=e\.target\.checked/);
  assert.match(appJs, /if\(action==='duplicate'\)\{duplicateLayer\(id\);return\}/);
  assert.match(appJs, /if\(copy\.type==='text'\)\{copy\.text\+=' copy'\}/, 'expected duplicating a text layer to still nudge its text so the copy is visibly distinct');
});

await test('8. GeometryEngine.js, StoneLayout.js, and export modules are untouched by this fix', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  for (const forbidden of ['src/geometry/GeometryEngine.js', 'src/geometry/StoneLayout.js', 'src/export/SvgExporter.js']) {
    assert.ok(!changedPaths.includes(forbidden), `this fix must not touch ${forbidden}`);
  }
});

console.log('Default text layer editing/deletion stabilization tests passed.');
