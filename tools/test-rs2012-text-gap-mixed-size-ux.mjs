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

// --- MONO-006C: Min/Max auto-adjust, impossible-config prevention, secondary-stone-count message --

await test('12. #mixedMinSize/#mixedMaxSize auto-adjust listeners are registered before HISTORY_TRACKED_CONTROL_IDS\' own listener on the same elements', () => {
  const minListenerIdx = appJs.indexOf("el('mixedMinSize').addEventListener('input'");
  const maxListenerIdx = appJs.indexOf("el('mixedMaxSize').addEventListener('input'");
  const historyLoopIdx = appJs.indexOf('for(const id of HISTORY_TRACKED_CONTROL_IDS)');
  assert.ok(minListenerIdx !== -1, 'expected a dedicated #mixedMinSize input listener');
  assert.ok(maxListenerIdx !== -1, 'expected a dedicated #mixedMaxSize input listener');
  assert.ok(minListenerIdx < historyLoopIdx, 'the Min clamp listener must be registered before HISTORY_TRACKED_CONTROL_IDS\' loop (same-element listener order = execution order)');
  assert.ok(maxListenerIdx < historyLoopIdx, 'the Max clamp listener must be registered before HISTORY_TRACKED_CONTROL_IDS\' loop (same-element listener order = execution order)');
});

await test('13. the Min/Max auto-adjust logic actually clamps the other control in both directions', () => {
  const minStatementSrc = appJs.slice(
    appJs.indexOf("el('mixedMinSize').addEventListener('input',"),
    appJs.indexOf('});', appJs.indexOf("el('mixedMinSize').addEventListener('input',")) + 3
  );
  const maxStatementSrc = appJs.slice(
    appJs.indexOf("el('mixedMaxSize').addEventListener('input',"),
    appJs.indexOf('});', appJs.indexOf("el('mixedMaxSize').addEventListener('input',")) + 3
  );
  const setNumericSelectValueStart = appJs.indexOf('function setNumericSelectValue');
  const setNumericSelectValueSrc = appJs.slice(setNumericSelectValueStart, appJs.indexOf('\n', setNumericSelectValueStart));

  const OPTION_VALUES = [2.0, 2.8, 4.0, 4.7, 6.4];
  function makeFakeElements(minValue, maxValue) {
    const elements = {
      mixedMinSize: { value: String(minValue), options: OPTION_VALUES.map((v) => ({ value: String(v) })), _listeners: {}, addEventListener(evt, cb) { this._listeners[evt] = cb } },
      mixedMaxSize: { value: String(maxValue), options: OPTION_VALUES.map((v) => ({ value: String(v) })), _listeners: {}, addEventListener(evt, cb) { this._listeners[evt] = cb } }
    };
    return (id) => elements[id];
  }

  // Minimum raised above Maximum -> Maximum snaps up to match Minimum.
  {
    const el = makeFakeElements(4.7, 2.8);
    const registerAndFire = new Function('el', `${setNumericSelectValueSrc}\n${minStatementSrc}\nel('mixedMinSize')._listeners.input();`);
    registerAndFire(el);
    assert.equal(parseFloat(el('mixedMaxSize').value), 4.7, 'Maximum must snap up to the new Minimum');
  }

  // Maximum lowered below Minimum -> Minimum snaps down to match Maximum.
  {
    const el = makeFakeElements(4.0, 2.0);
    const registerAndFire = new Function('el', `${setNumericSelectValueSrc}\n${maxStatementSrc}\nel('mixedMaxSize')._listeners.input();`);
    registerAndFire(el);
    assert.equal(parseFloat(el('mixedMinSize').value), 2.0, 'Minimum must snap down to the new Maximum');
  }

  // Already-valid pairs are left untouched.
  {
    const el = makeFakeElements(2.0, 4.7);
    const registerAndFire = new Function('el', `${setNumericSelectValueSrc}\n${minStatementSrc}\nel('mixedMinSize')._listeners.input();`);
    registerAndFire(el);
    assert.equal(parseFloat(el('mixedMaxSize').value), 4.7, 'a Minimum below the existing Maximum must not change it');
  }
});

await test('14. updateMixedSizeCapabilityUI() disables the "Mixed" option and auto-switches back to Uniform at the smallest catalog stone size', () => {
  const fnSource = appJs.slice(
    appJs.indexOf('function updateMixedSizeCapabilityUI'),
    appJs.indexOf('\nfunction ', appJs.indexOf('function updateMixedSizeCapabilityUI') + 1)
  );
  assert.match(fnSource, /const smallestStoneSizeMm=Math\.min\(\.\.\.listStoneSizes\(\)\.map\(s=>s\.diameterMm\)\);/, 'expected the smallest-catalog-size computation');
  assert.match(fnSource, /mixedOption\.disabled=atSmallestStone;/, 'expected the Mixed <option> to be disabled at the smallest stone size');
  assert.match(fnSource, /el\('sizeMode'\)\.value='uniform';l\.sizeMode='uniform';/, 'expected an already-Mixed layer to be switched back to Uniform when Stone size drops to the smallest catalog size');
});

await test('15. updateMixedSizeCapabilityUI() reports a positive "no secondary stones required" message when Mixed mode is correctly configured but produced zero secondary stones', () => {
  const fnSource = appJs.slice(
    appJs.indexOf('function updateMixedSizeCapabilityUI'),
    appJs.indexOf('\nfunction ', appJs.indexOf('function updateMixedSizeCapabilityUI') + 1)
  );
  assert.match(fnSource, /mixedSizeSecondaryStoneCountFor\(l\)===0/, 'expected the live-generated secondary stone count to gate this message');
  assert.match(fnSource, /No secondary stones are required for this design\./);
});

await test('16. mixedSizeSecondaryStoneCountFor() counts only stones smaller than the layer\'s own primary stone size, for that layer only', () => {
  // mixedSizeSecondaryStoneCountFor(l) reads the module-level `layout` global by closure (the same
  // already-computed StoneLayout drawLayout()/updateStats() render from) -- supplied here as an
  // outer Function parameter of the same name, which real JS scoping resolves for the extracted
  // function body exactly as it does inside the real app.js module.
  const fnSource = appJs.slice(
    appJs.indexOf('function mixedSizeSecondaryStoneCountFor'),
    appJs.indexOf('}', appJs.indexOf('function mixedSizeSecondaryStoneCountFor')) + 1
  );
  const layer = { id: 'text', stoneSize: 4.0 };
  const layout = {
    stones: [
      { layerId: 'text', sizeMm: 4.0 }, // primary, same layer -- not counted
      { layerId: 'text', sizeMm: 2.8 }, // secondary, same layer -- counted
      { layerId: 'text', sizeMm: 2.0 }, // secondary, same layer -- counted
      { layerId: 'other-layer', sizeMm: 2.0 } // secondary, but a different layer -- not counted
    ]
  };
  const run = new Function('layout', 'l', `${fnSource}\nreturn mixedSizeSecondaryStoneCountFor(l);`);
  assert.equal(run(layout, layer), 2);
  assert.equal(run(null, layer), 0, 'no generated layout yet must be a safe 0, not a crash');
  assert.equal(run(layout, null), 0, 'no selected layer must be a safe 0, not a crash');
});

console.log('RS-2012 Text Gap & Mixed Stone Size UX tests complete.');
