import assert from 'node:assert/strict';

// RS-3018 — unit tests for the pure mm<->inches conversion helpers in src/units/LengthUnits.js.
// No DOM, no app.js, no Project/Layer/StoneLayout.

const { MM_PER_INCH, mmToDisplayValue, displayValueToMm, unitSuffix, formatLengthDisplay } = await import('../src/units/LengthUnits.js');

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

await test('1. mm passthrough: mmToDisplayValue/displayValueToMm are no-ops for units==="mm"', () => {
  assert.equal(mmToDisplayValue(25.4, 'mm'), 25.4);
  assert.equal(mmToDisplayValue(0, 'mm'), 0);
  assert.equal(displayValueToMm('12.5', 'mm'), 12.5);
});

await test('2. mm->in conversion uses MM_PER_INCH', () => {
  assert.equal(MM_PER_INCH, 25.4);
  assert.equal(mmToDisplayValue(25.4, 'in'), 1);
  assert.equal(mmToDisplayValue(50.8, 'in'), 2);
  assert.equal(displayValueToMm('1', 'in'), 25.4);
  assert.equal(displayValueToMm('2', 'in'), 50.8);
});

await test('3. mm<->in round-trip within floating-point tolerance', () => {
  for (const mm of [0, 1, 10, 90.125, 210, 999.9]) {
    const roundTripped = displayValueToMm(String(mmToDisplayValue(mm, 'in')), 'in');
    assert.ok(Math.abs(roundTripped - mm) < 1e-9, `expected ${roundTripped} ~= ${mm}`);
  }
});

await test('4. displayValueToMm returns NaN on unparseable input, for both units', () => {
  assert.ok(Number.isNaN(displayValueToMm('', 'mm')));
  assert.ok(Number.isNaN(displayValueToMm('abc', 'mm')));
  assert.ok(Number.isNaN(displayValueToMm('', 'in')));
  assert.ok(Number.isNaN(displayValueToMm('abc', 'in')));
});

await test('5. mmToDisplayValue passes non-finite input straight through', () => {
  assert.ok(Number.isNaN(mmToDisplayValue(NaN, 'in')));
  assert.equal(mmToDisplayValue(Infinity, 'in'), Infinity);
});

await test('6. unitSuffix maps units to the short label', () => {
  assert.equal(unitSuffix('mm'), 'mm');
  assert.equal(unitSuffix('in'), 'in');
  assert.equal(unitSuffix('bogus'), 'mm');
});

await test('7. formatLengthDisplay rounds to the requested decimals in each unit', () => {
  assert.equal(formatLengthDisplay(90.125, 'mm', 2), 90.13);
  assert.equal(formatLengthDisplay(25.4, 'in', 2), 1);
  assert.equal(formatLengthDisplay(10, 'in', 2), 0.39);
  assert.equal(formatLengthDisplay(10, 'in', 4), 0.3937);
});

await test('8. formatLengthDisplay passes non-finite mm straight through', () => {
  assert.ok(Number.isNaN(formatLengthDisplay(NaN, 'mm')));
});
