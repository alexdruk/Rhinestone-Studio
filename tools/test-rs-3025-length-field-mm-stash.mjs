// RS-3025 (fix/units-bare-dom-field-drift): the eight bare-DOM length fields (prodSheetMargin,
// shipLengthMm/Width/HeightMm, monogramWidth/Height/SizeMarginMm, drawSlotWidthMm) have no
// canonical mm store on `project` -- unlike the Plate/Vessel fields, refreshAllLengthFieldDisplays()
// could only re-derive their mm value by parsing the field's own already-2-decimal-rounded display
// string via displayValueToMm(). Every Units toggle (mm<->in) therefore round-tripped through that
// rounded string and drifted a few hundredths of a mm -- e.g. exactly 10mm -> "0.39" in -> 9.91mm,
// a real ~0.09mm loss an operator would see silently baked into their layout after nothing more
// than opening Settings and flipping Units back and forth.
//
// The fix: setLengthField(id,mm) (app.js's single choke point for writing these fields
// programmatically) now also stashes the exact mm value it was given in el(id).dataset.mmValue.
// refreshAllLengthFieldDisplays() prefers that stash (exact, no rounding) over re-deriving from the
// rounded display string, so an untouched field survives any number of Units round trips
// losslessly.
//
// An earlier version of this fix had each field's own 'input' listener simply DELETE the stash the
// instant the operator typed -- which silently broke the fix for exactly the fields most likely to
// be hand-typed: prodSheetMargin, shipLengthMm/Width/HeightMm, drawSlotWidthMm, and
// monogramSizeMarginMm have no writer at all besides direct typing (and monogramWidth/Height lose
// the fix the moment a user hand-edits them too), so deleting the stash on input left those fields
// with no usable stash ever -- the original drift bug, unfixed. The corrected 'input' listeners
// instead call stashTypedLengthField(id), which computes mm from the just-typed display value (in
// the current display unit) BEFORE any display-side rounding, and stashes that -- so a hand-typed
// value gets the exact same lossless-round-trip guarantee as a programmatic setLengthField() write.
// See test 6 below, which specifically exercises this typed-value path (not just setLengthField())
// and would fail against the delete-based version of this fix.
//
// This file extracts and REALLY EXECUTES setLengthField()/stashTypedLengthField()/
// refreshAllLengthFieldDisplays() from the live app.js source (a browser entry point, not
// import()-able directly under plain Node -- see tools/test-alignment-snapping-wiring.mjs's
// extractFunction()-from-app.js precedent, which this follows), combined with the real
// src/units/LengthUnits.js conversion helpers and a minimal fake el()/dataset/project stand-in.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayValueToMm, formatLengthDisplay } from '../src/units/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

let failureCount = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    failureCount++;
    process.exitCode = 1;
  }
}

// ---------- Slice the real app.js source (brace-balanced, matching test-mono-006a's precedent) ----------

function extractLine(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const end = source.indexOf('\n', start);
  assert.ok(end !== -1, `expected a line ending after "${startMarker}" (${label})`);
  return source.slice(start, end);
}

function extractBlock(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" (${label}) in app.js`);
  const end = source.indexOf('\n}', start);
  assert.ok(end !== -1, `expected a closing brace for ${label}`);
  return source.slice(start, end + 2);
}

const setLengthFieldSrc = extractLine(appJs, 'function setLengthField(id,mm){', 'setLengthField()');
assert.match(setLengthFieldSrc, /el\(id\)\.dataset\.mmValue=String\(mm\)/, 'expected setLengthField() to stash the exact mm it was given');

const stashTypedLengthFieldSrc = extractBlock(appJs, 'function stashTypedLengthField(id){', 'stashTypedLengthField()');
assert.match(stashTypedLengthFieldSrc, /displayValueToMm\(el\(id\)\.value,project\.units\)/, 'expected stashTypedLengthField() to compute mm from the just-typed display value');
assert.match(stashTypedLengthFieldSrc, /Number\.isFinite\(mm\)/, 'expected stashTypedLengthField() to only delete the stash for a genuinely unparseable typed value, not unconditionally');

const refreshAllLengthFieldDisplaysSrc = extractBlock(appJs, 'function refreshAllLengthFieldDisplays(previousUnits=project.units){', 'refreshAllLengthFieldDisplays()');
assert.match(refreshAllLengthFieldDisplaysSrc, /dataset\.mmValue/, 'expected refreshAllLengthFieldDisplays() to read the dataset.mmValue stash');

// Real 'input' listener wiring for the eight fields, verbatim from app.js. Each must call
// stashTypedLengthField(id) (compute-and-stash), NOT unconditionally delete el(id).dataset.mmValue
// -- deleting on every keystroke is the exact regression this file's test 6 was added to catch: it
// silently un-fixes the drift bug for every field with no other writer besides direct typing.
const monogramWidthListenerSrc = extractLine(appJs, "el('monogramWidth').addEventListener('input',", 'monogramWidth input listener');
const monogramHeightListenerSrc = extractLine(appJs, "el('monogramHeight').addEventListener('input',", 'monogramHeight input listener');
const monogramSizeMarginListenerSrc = extractLine(appJs, "el('monogramSizeMarginMm').addEventListener('input',", 'monogramSizeMarginMm input listener');
const drawSlotWidthListenerSrc = extractLine(appJs, "el('drawSlotWidthMm').oninput=", 'drawSlotWidthMm input listener');
const bareFieldListenerLoopSrc = (() => {
  const start = appJs.indexOf("for(const id of['prodSheetMargin','shipLengthMm','shipWidthMm','shipHeightMm']){");
  assert.ok(start !== -1, 'expected the prodSheetMargin/ship* dataset.mmValue-stashing listener loop in app.js');
  const end = appJs.indexOf('\n}', start);
  assert.ok(end !== -1, 'expected a closing brace for the listener loop');
  return appJs.slice(start, end + 2);
})();

for (const [label, src] of [
  ['monogramWidth', monogramWidthListenerSrc], ['monogramHeight', monogramHeightListenerSrc],
  ['monogramSizeMarginMm', monogramSizeMarginListenerSrc], ['drawSlotWidthMm', drawSlotWidthListenerSrc]
]) {
  assert.match(src, /stashTypedLengthField\('[a-zA-Z]+'\)/, `expected ${label}'s 'input' listener to call stashTypedLengthField(), not delete its stash unconditionally`);
  assert.ok(!/delete el\('[a-zA-Z]+'\)\.dataset\.mmValue/.test(src), `expected ${label}'s 'input' listener to no longer unconditionally delete its dataset.mmValue stash`);
}
assert.match(bareFieldListenerLoopSrc, /stashTypedLengthField\(id\)/, 'expected the prodSheetMargin/ship* listener loop to call stashTypedLengthField(id)');
assert.ok(!/delete el\(id\)\.dataset\.mmValue/.test(bareFieldListenerLoopSrc), 'expected the prodSheetMargin/ship* listener loop to no longer unconditionally delete dataset.mmValue');

// ---------- Minimal fake el()/dataset/project harness ----------

function makeFakeDom() {
  const elements = new Map();
  function el(id) {
    if (!elements.has(id)) elements.set(id, { value: '', dataset: {} });
    return elements.get(id);
  }
  return el;
}

function buildSandbox(el, project) {
  const factory = new Function(
    'el', 'project', 'formatLengthDisplay', 'displayValueToMm',
    `
    ${setLengthFieldSrc}
    ${stashTypedLengthFieldSrc}
    ${refreshAllLengthFieldDisplaysSrc}
    return { setLengthField, stashTypedLengthField, refreshAllLengthFieldDisplays };
    `
  );
  return factory(el, project, formatLengthDisplay, displayValueToMm);
}

function makeProject(units) {
  return {
    units,
    plate: { outerDiameterMm: 200, innerWellDiameterMm: 150, overallHeightMm: 10, centerDepthMm: 2 },
    vessel: { bodyDiameterMm: 80, bodyHeightMm: 100, topDiameterMm: 90 }
  };
}

// ---------- Behavioral scenarios ----------

await test('1. setLengthField() stashes the exact mm value in dataset.mmValue alongside the rounded display string', () => {
  const el = makeFakeDom();
  const project = makeProject('mm');
  const { setLengthField } = buildSandbox(el, project);
  setLengthField('monogramWidth', 10);
  assert.equal(el('monogramWidth').value, 10);
  assert.equal(el('monogramWidth').dataset.mmValue, '10');
});

await test('2. an untouched field survives two Units round trips (mm->in->mm) with zero drift, versus the ~0.09mm drift the old display-string-reparse path produced for the same input', () => {
  const el = makeFakeDom();
  const project = makeProject('mm');
  const { setLengthField, refreshAllLengthFieldDisplays } = buildSandbox(el, project);

  // Establish monogramWidth at exactly 10mm via the real choke point, same as
  // updateMonogramFrameSizeBounds()/applyMonogramSizeMargin() do in app.js.
  setLengthField('monogramWidth', 10);

  // Round trip 1: mm -> in (mirrors applyUnitsChange()'s own
  // `project.units=newUnits; refreshAllLengthFieldDisplays(previousUnits)` sequence).
  const previousUnits1 = project.units;
  project.units = 'in';
  refreshAllLengthFieldDisplays(previousUnits1);
  assert.equal(el('monogramWidth').value, 0.39, 'expected the displayed inches value to be the rounded 10mm/25.4 conversion');

  // Round trip 2: in -> mm.
  const previousUnits2 = project.units;
  project.units = 'mm';
  refreshAllLengthFieldDisplays(previousUnits2);

  assert.equal(el('monogramWidth').value, 10, 'expected the field to recover the exact original 10mm with zero drift');

  // Contrast against today's pre-fix behavior: re-deriving mm from the already-rounded "0.39" in
  // display string (the old fallback path, still used once the stash is gone) loses precision.
  const reDerivedFromRoundedDisplay = formatLengthDisplay(displayValueToMm('0.39', 'in'), 'mm');
  assert.equal(reDerivedFromRoundedDisplay, 9.91, 'sanity check: confirms the ~0.09mm drift this fix eliminates');
  assert.ok(Math.abs(reDerivedFromRoundedDisplay - 10) > 0.05, 'the old path really did drift by roughly 0.09mm');
});

await test('3. once the operator types into the field, its dataset.mmValue stash is cleared and further Units toggles fall back to converting the field\'s own (now user-authoritative) display value', () => {
  const el = makeFakeDom();
  const project = makeProject('mm');
  const { setLengthField, refreshAllLengthFieldDisplays } = buildSandbox(el, project);

  setLengthField('monogramWidth', 10);
  // Directly force the no-stash state (rather than going through stashTypedLengthField()) to
  // isolate refreshAllLengthFieldDisplays()'s fallback path itself, independent of how the stash
  // came to be absent -- test 6 below exercises the real stashTypedLengthField()-based 'input'
  // listener end to end.
  el('monogramWidth').value = '15';
  delete el('monogramWidth').dataset.mmValue;

  const previousUnits = project.units;
  project.units = 'in';
  refreshAllLengthFieldDisplays(previousUnits);
  assert.equal(el('monogramWidth').value, formatLengthDisplay(displayValueToMm('15', 'mm'), 'in'), 'expected the fallback path to convert from the field\'s own current display value, not a stale stash');
});

await test('4. an empty field is left untouched (no stash, no display value to convert)', () => {
  const el = makeFakeDom();
  const project = makeProject('mm');
  const { refreshAllLengthFieldDisplays } = buildSandbox(el, project);
  el('shipLengthMm').value = '';
  project.units = 'in';
  refreshAllLengthFieldDisplays('mm');
  assert.equal(el('shipLengthMm').value, '', 'expected an empty field to stay empty');
});

await test('5. Plate/Vessel fields (canonical project.plate/vessel mm state) are unaffected by the stash mechanism -- always re-derived from `project` itself, never from a stale dataset.mmValue', () => {
  const el = makeFakeDom();
  const project = makeProject('mm');
  const { refreshAllLengthFieldDisplays } = buildSandbox(el, project);
  refreshAllLengthFieldDisplays('mm');
  assert.equal(el('plateOuterDiameter').value, 200);
  assert.equal(el('vesselBodyDiameter').value, 80);

  // Mutate canonical project state directly (as e.g. the Plate/Vessel form's own Apply handler
  // does) and confirm the next refresh reflects it, proving these fields never trust a stash.
  project.plate.outerDiameterMm = 220;
  refreshAllLengthFieldDisplays('mm');
  assert.equal(el('plateOuterDiameter').value, 220);
});

await test('6. a field with NO setLengthField() writer anywhere in app.js (drawSlotWidthMm/shipLengthMm-shaped -- typing is its only source of a value) still stashes an exact mm value the moment the operator types, via the real stashTypedLengthField(), and survives two Units round trips with zero drift -- the exact regression an unconditional delete-on-input would reintroduce', () => {
  const el = makeFakeDom();
  const project = makeProject('mm');
  const { stashTypedLengthField, refreshAllLengthFieldDisplays } = buildSandbox(el, project);

  // drawSlotWidthMm/prodSheetMargin/shipLengthMm/shipWidthMm/shipHeightMm never go through
  // setLengthField() in real app.js -- the operator typing into the field IS the write. Simulate
  // exactly that: the browser has already applied the keystroke to .value by the time 'input'
  // fires, then the real listener body (stashTypedLengthField(id)) runs.
  el('drawSlotWidthMm').value = '10';
  stashTypedLengthField('drawSlotWidthMm');
  assert.equal(el('drawSlotWidthMm').dataset.mmValue, '10', 'expected the typed value to be stashed as exact mm immediately, before any display rounding');

  // Round trip 1: mm -> in.
  const previousUnits1 = project.units;
  project.units = 'in';
  refreshAllLengthFieldDisplays(previousUnits1);
  assert.equal(el('drawSlotWidthMm').value, 0.39, 'expected the displayed inches value to be the rounded 10mm/25.4 conversion');

  // Round trip 2: in -> mm.
  const previousUnits2 = project.units;
  project.units = 'mm';
  refreshAllLengthFieldDisplays(previousUnits2);
  assert.equal(el('drawSlotWidthMm').value, 10, 'expected the hand-typed value to recover exactly, zero drift -- against the delete-on-input version of this fix this would instead land on 9.91 (the same ~0.09mm drift the fix was supposed to eliminate)');
});

if (failureCount === 0) {
  console.log('RS-3025 length-field mm-stash tests passed.');
} else {
  console.error(`RS-3025 length-field mm-stash tests FAILED (${failureCount} failing assertion(s) above).`);
}
