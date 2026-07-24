import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-2012 (Text Gap & Mixed Stone Size UX Polish) — structural + logic proof for:
//   Part 1: Gap (mm) reads as non-editable for authored Rhinestone fonts (spacing is baked in).
//   Part 2: Mixed Stone Size disables/explains ineligible Allowed Sizes and warns when the current
//           configuration would generate zero infill stones.
//   Part 3: Minimum/Maximum Size + Conservative Detail live behind a collapsible "Advanced" section.
// Mirrors tools/test-s200-app-integration.mjs's own convention: app.js is a browser entry point (not
// import()-able directly under plain Node), so DOM-independent logic (mixedSizeEligibleIds()) is
// extracted and run against a minimal fake el(), while DOM-wiring is checked structurally.

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

// --- Part 1: Gap (mm) -----------------------------------------------------------------------

await test('1. index.html has #gapFixedHint next to #gap inside #sharedStoneFields', () => {
  const blockMatch = indexHtml.match(/<div id="sharedStoneFields">([\s\S]*?)<\/div>\s*\n<!--/);
  assert.ok(blockMatch, 'expected to find #sharedStoneFields block');
  assert.match(blockMatch[1], /<input id="gap" type="number"/);
  assert.match(blockMatch[1], /<p class="hint" id="gapFixedHint" style="display:none">/);
});

await test('2. updateTextFontCapabilityUI() disables #gap and shows #gapFixedHint exactly when the selected text layer uses an authored font', () => {
  const fnSource = appJs.slice(
    appJs.indexOf('function updateTextFontCapabilityUI'),
    appJs.indexOf('\nfunction mixedSizeEligibleIds')
  );
  assert.match(fnSource, /el\('gap'\)\.disabled=authored;/);
  assert.match(fnSource, /el\('gapFixedHint'\)\.style\.display=authored\?'block':'none';/);
  // Gap must stay untouched for non-text layers and legacy/unknown fonts -- `authored` is only ever
  // true when `known` (isFontKnown) is also true, so a non-text layer or an unrecognized font id
  // can never disable Gap.
  assert.match(fnSource, /const authored=known&&isAuthoredStoneFontId\(fontId\);/);
});

// --- Part 2: Mixed Stone Size eligibility -----------------------------------------------------

// Builds a minimal fake el() returning {value} objects keyed by id, sufficient for
// mixedSizeEligibleIds() (the pure eligibility rule) which only ever reads .value.
function runMixedSizeEligibleIds({ stoneSize, minSize, maxSize }) {
  const checkboxesSource = appJs.slice(
    appJs.indexOf('const MIXED_ALLOWED_SIZE_CHECKBOXES='),
    appJs.indexOf('];', appJs.indexOf('const MIXED_ALLOWED_SIZE_CHECKBOXES=')) + 2
  );
  const fnSource = appJs.slice(
    appJs.indexOf('function mixedSizeEligibleIds'),
    appJs.indexOf('\nfunction updateMixedSizeCapabilityUI')
  );
  const run = new Function('el', `${checkboxesSource}\n${fnSource}\nreturn mixedSizeEligibleIds();`);
  const fakeValues = { stoneSize, mixedMinSize: minSize, mixedMaxSize: maxSize };
  const el = (id) => ({ value: fakeValues[id] });
  return run(el);
}

await test('3. mixedSizeEligibleIds() mirrors MixedSizeGenerator.normalizeMixedSizeParams()\'s rule: value < stoneSizeMm && value >= minSizeMm && value <= maxSizeMm', () => {
  // Primary = SS16 (4.0mm), full [min,max] range -- SS6/SS10 eligible, SS16 itself and everything
  // larger is not (never a stone as large as or larger than primary).
  const ids = runMixedSizeEligibleIds({ stoneSize: '4.0', minSize: '2.0', maxSize: '6.4' });
  assert.deepEqual([...ids].sort(), ['mixedAllowedSs10', 'mixedAllowedSs6'].sort());
});

await test('4. mixedSizeEligibleIds() excludes sizes below Minimum Size', () => {
  const ids = runMixedSizeEligibleIds({ stoneSize: '4.0', minSize: '2.8', maxSize: '6.4' });
  assert.deepEqual([...ids], ['mixedAllowedSs10']);
});

await test('5. mixedSizeEligibleIds() excludes sizes above Maximum Size', () => {
  const ids = runMixedSizeEligibleIds({ stoneSize: '6.4', minSize: '2.0', maxSize: '4.0' });
  assert.deepEqual([...ids].sort(), ['mixedAllowedSs10', 'mixedAllowedSs16', 'mixedAllowedSs6'].sort());
});

await test('6. mixedSizeEligibleIds() is a structural no-op set (empty) when Minimum Size is at or above the primary Stone size', () => {
  const ids = runMixedSizeEligibleIds({ stoneSize: '4.0', minSize: '4.0', maxSize: '6.4' });
  assert.equal(ids.size, 0);
});

await test('7. updateMixedSizeCapabilityUI() disables + dims + explains every ineligible checkbox via title, and drives #mixedNoEligibleHint through the three distinct no-op cases', () => {
  const fnSource = appJs.slice(
    appJs.indexOf('function updateMixedSizeCapabilityUI'),
    appJs.indexOf('\nfunction ', appJs.indexOf('function updateMixedSizeCapabilityUI') + 1)
  );
  assert.match(fnSource, /input\.disabled=!eligible;/);
  assert.match(fnSource, /row\.classList\.toggle\('ineligible',!eligible\);/);
  assert.match(fnSource, /eligibleIds\.size===0/, 'expected the "no size can ever be eligible" case');
  assert.match(fnSource, /!anyChecked/, 'expected the "nothing checked yet" case');
  assert.match(fnSource, /anyCheckedEligible/, 'expected the "checked but none eligible" case');
  assert.match(fnSource, /hint\.classList\.add\('visible'\)/);
  assert.match(fnSource, /hint\.classList\.remove\('visible'\)/);
});

await test('8. updateEditingUI() calls updateMixedSizeCapabilityUI() every time it calls updateTextFontCapabilityUI(), so both react to the same live edits', () => {
  assert.match(appJs, /updateTextFontCapabilityUI\(\);\s*\n\s*updateMixedSizeCapabilityUI\(\);/);
});

await test('9. index.html has .checkbox-row.ineligible and #mixedNoEligibleHint markup for updateMixedSizeCapabilityUI() to drive', () => {
  assert.match(indexHtml, /\.checkbox-row\.ineligible\{color:var\(--color-text-muted\)\}/);
  assert.match(indexHtml, /<p class="validation-message" id="mixedNoEligibleHint" role="status"><\/p>/);
});

// --- Part 3: Advanced collapsible --------------------------------------------------------------

await test('10. index.html moves Minimum/Maximum Size + Conservative Detail inside a <details id="mixedAdvancedSection">, leaving Generation Mode + Allowed Sizes outside it', () => {
  const detailsMatch = indexHtml.match(/<details class="advanced-section" id="mixedAdvancedSection">([\s\S]*?)<\/details>/);
  assert.ok(detailsMatch, 'expected #mixedAdvancedSection <details>');
  assert.match(detailsMatch[1], /<select id="mixedMinSize"/);
  assert.match(detailsMatch[1], /<select id="mixedMaxSize"/);
  assert.match(detailsMatch[1], /<input id="conservativeDetail" type="range"/);
  const beforeDetails = indexHtml.slice(indexHtml.indexOf('<div id="sharedMixedSizeFields">'), indexHtml.indexOf('<details class="advanced-section" id="mixedAdvancedSection">'));
  assert.match(beforeDetails, /<select id="sizeMode"/);
  assert.match(beforeDetails, /<input type="checkbox" id="mixedAllowedSs6"/);
});

await test('11. syncSelectedControlsFromLayer() auto-expands Advanced only in Mixed mode with a non-default min/max/conservativeDetail, never overriding a user\'s manual toggle from the live per-edit path', () => {
  const fnSource = appJs.slice(
    appJs.indexOf('function syncSelectedControlsFromLayer'),
    appJs.indexOf('function writeSelectedControlsToLayer')
  );
  assert.match(fnSource, /el\('mixedAdvancedSection'\)\.open=sizeMode==='mixed'&&hasCustomAdvanced;/);
  // The live, per-edit path (updateMixedSizeCapabilityUI(), called from updateEditingUI() on every
  // keystroke) must never itself touch .open -- only the once-per-selection sync above may.
  const liveFnSource = appJs.slice(
    appJs.indexOf('function updateMixedSizeCapabilityUI'),
    appJs.indexOf('\nfunction ', appJs.indexOf('function updateMixedSizeCapabilityUI') + 1)
  );
  assert.doesNotMatch(liveFnSource, /mixedAdvancedSection/, 'live per-edit path must not reset the Advanced open/closed state');
});

console.log('RS-2012 Text Gap & Mixed Stone Size UX tests complete.');
