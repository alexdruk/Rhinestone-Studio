import assert from 'node:assert/strict';

// RS-1004 — validates src/products/ObjectTemplate.js's registry: shape validation, the three
// required templates (mug/tumbler/bottle), permissive unknown-id fallback (matching this
// codebase's existing style for project.product/cupColor/wrap), and the safe-area rectangle
// derivation used by app.js's editor overlay.

const {
  OBJECT_TEMPLATE_IDS,
  DEFAULT_OBJECT_TEMPLATE_ID,
  WRAP_MODES,
  createObjectTemplate,
  getObjectTemplate,
  getSafeAreaRectMm,
  isValidObjectTemplateId,
  listObjectTemplates
} = await import('../src/products/index.js');

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

function validDef(overrides = {}) {
  return {
    id: 'test-object',
    displayName: 'Test Object',
    productionWidthMm: 200,
    productionHeightMm: 100,
    safeAreaInsetMm: { top: 10, right: 10, bottom: 10, left: 10 },
    wrap: { supported: ['front', 'wide'], default: 'front' },
    preview: { kind: 'mug', topWidthFactor: 0.5, bottomWidthFactor: 0.4, bodyHeightFactor: 0.6, hasHandle: true },
    ...overrides
  };
}

await test('1. the registry contains exactly mug, tumbler, bottle', () => {
  assert.deepEqual([...OBJECT_TEMPLATE_IDS].sort(), ['bottle', 'mug', 'tumbler']);
  assert.equal(listObjectTemplates().length, 3);
});

await test('2. DEFAULT_OBJECT_TEMPLATE_ID is mug, and getObjectTemplate() defaults to it', () => {
  assert.equal(DEFAULT_OBJECT_TEMPLATE_ID, 'mug');
  assert.equal(getObjectTemplate('mug').id, 'mug');
});

await test('3. every registered template passes its own shape validation (round-trips through createObjectTemplate)', () => {
  for (const id of OBJECT_TEMPLATE_IDS) {
    const template = getObjectTemplate(id);
    assert.doesNotThrow(() => createObjectTemplate({ ...template, safeAreaInsetMm: { ...template.safeAreaInsetMm }, wrap: { supported: [...template.wrap.supported], default: template.wrap.default }, preview: { ...template.preview } }));
  }
});

await test('4. every registered template has a positive production size, a non-empty display name, and a valid preview.kind', () => {
  for (const id of OBJECT_TEMPLATE_IDS) {
    const t = getObjectTemplate(id);
    assert.ok(t.displayName.length > 0, `${id}: displayName must be non-empty`);
    assert.ok(t.productionWidthMm > 0 && Number.isFinite(t.productionWidthMm), `${id}: productionWidthMm`);
    assert.ok(t.productionHeightMm > 0 && Number.isFinite(t.productionHeightMm), `${id}: productionHeightMm`);
    assert.ok(['mug', 'tumbler', 'bottle'].includes(t.preview.kind), `${id}: preview.kind`);
  }
});

await test('5. every registered template\'s wrap.default is a member of its own wrap.supported, drawn from the four known wrap modes', () => {
  for (const id of OBJECT_TEMPLATE_IDS) {
    const t = getObjectTemplate(id);
    assert.ok(t.wrap.supported.every((m) => WRAP_MODES.includes(m)), `${id}: wrap.supported must only contain known wrap modes`);
    assert.ok(t.wrap.supported.includes(t.wrap.default), `${id}: wrap.default must be in wrap.supported`);
  }
});

await test('6. every registered template\'s safeAreaInsetMm leaves a positive interior at its own production size', () => {
  for (const id of OBJECT_TEMPLATE_IDS) {
    const t = getObjectTemplate(id);
    const rect = getSafeAreaRectMm(t, t.productionWidthMm, t.productionHeightMm);
    assert.ok(rect.widthMm > 0, `${id}: safe area width must be positive at the template's own production size`);
    assert.ok(rect.heightMm > 0, `${id}: safe area height must be positive at the template's own production size`);
  }
});

await test('7. mug is the only template with a handle; tumbler and bottle have none', () => {
  assert.equal(getObjectTemplate('mug').preview.hasHandle, true);
  assert.equal(getObjectTemplate('tumbler').preview.hasHandle, false);
  assert.equal(getObjectTemplate('bottle').preview.hasHandle, false);
});

await test('8. tumbler is a true cylinder (equal top/bottom width); mug/bottle taper', () => {
  const tumbler = getObjectTemplate('tumbler');
  assert.equal(tumbler.preview.topWidthFactor, tumbler.preview.bottomWidthFactor);
  const mug = getObjectTemplate('mug');
  assert.notEqual(mug.preview.topWidthFactor, mug.preview.bottomWidthFactor);
});

await test('9. bottle preview declares neck/shoulder/cap factors; mug/tumbler do not need them', () => {
  const bottle = getObjectTemplate('bottle');
  for (const field of ['neckWidthFactor', 'neckHeightFactor', 'shoulderHeightFactor', 'capHeightFactor']) {
    assert.ok(typeof bottle.preview[field] === 'number' && bottle.preview[field] > 0, `bottle.preview.${field}`);
  }
});

await test('10. isValidObjectTemplateId() is true only for real ids; getObjectTemplate() falls back to mug for unknown/missing ids (never throws)', () => {
  assert.equal(isValidObjectTemplateId('mug'), true);
  assert.equal(isValidObjectTemplateId('tumbler'), true);
  assert.equal(isValidObjectTemplateId('bottle'), true);
  assert.equal(isValidObjectTemplateId('teapot'), false);
  assert.equal(isValidObjectTemplateId(undefined), false);
  assert.equal(isValidObjectTemplateId(null), false);
  assert.equal(getObjectTemplate('teapot').id, 'mug');
  assert.equal(getObjectTemplate(undefined).id, 'mug');
  assert.equal(getObjectTemplate(null).id, 'mug');
});

await test('11. getObjectTemplate() is deterministic and returns the same template record for the same id', () => {
  assert.equal(getObjectTemplate('bottle'), getObjectTemplate('bottle'));
});

await test('12. template records are frozen (defensive against accidental mutation)', () => {
  const t = getObjectTemplate('mug');
  assert.throws(() => { t.displayName = 'Hacked'; }, /Cannot assign|read only|read-only/i);
  assert.ok(Object.isFrozen(t));
  assert.ok(Object.isFrozen(t.preview));
  assert.ok(Object.isFrozen(t.wrap));
  assert.ok(Object.isFrozen(t.safeAreaInsetMm));
});

await test('13. createObjectTemplate() rejects missing/invalid required fields with a specific TypeError', () => {
  assert.throws(() => createObjectTemplate(validDef({ id: '' })), /id/);
  assert.throws(() => createObjectTemplate(validDef({ displayName: '' })), /displayName/);
  assert.throws(() => createObjectTemplate(validDef({ productionWidthMm: 0 })), /productionWidthMm/);
  assert.throws(() => createObjectTemplate(validDef({ productionWidthMm: NaN })), /productionWidthMm/);
  assert.throws(() => createObjectTemplate(validDef({ productionHeightMm: -5 })), /productionHeightMm/);
});

await test('14. createObjectTemplate() rejects a safe-area inset that leaves no positive interior', () => {
  assert.throws(
    () => createObjectTemplate(validDef({ safeAreaInsetMm: { top: 60, right: 10, bottom: 60, left: 10 } })),
    /interior height/
  );
  assert.throws(
    () => createObjectTemplate(validDef({ safeAreaInsetMm: { top: 10, right: 120, bottom: 10, left: 120 } })),
    /interior width/
  );
});

await test('15. createObjectTemplate() rejects an unsupported wrap mode and a default not in the supported set', () => {
  assert.throws(() => createObjectTemplate(validDef({ wrap: { supported: ['sideways'], default: 'sideways' } })), /unknown wrap mode/);
  assert.throws(() => createObjectTemplate(validDef({ wrap: { supported: ['front'], default: 'wide' } })), /wrap\.default/);
});

await test('16. createObjectTemplate() rejects an unknown preview.kind, and requires bottle-only fields only when kind is bottle', () => {
  assert.throws(() => createObjectTemplate(validDef({ preview: { ...validDef().preview, kind: 'teapot' } })), /preview\.kind/);
  assert.doesNotThrow(() => createObjectTemplate(validDef({ preview: { kind: 'tumbler', topWidthFactor: 0.4, bottomWidthFactor: 0.4, bodyHeightFactor: 0.7, hasHandle: false } })));
  assert.throws(
    () => createObjectTemplate(validDef({ preview: { kind: 'bottle', topWidthFactor: 0.4, bottomWidthFactor: 0.4, bodyHeightFactor: 0.6, hasHandle: false } })),
    /neckWidthFactor/
  );
});

await test('17. getSafeAreaRectMm() scales with the canvas size actually passed, not just the template\'s own production defaults', () => {
  const mug = getObjectTemplate('mug');
  const small = getSafeAreaRectMm(mug, 100, 60);
  const large = getSafeAreaRectMm(mug, 300, 150);
  assert.ok(large.widthMm > small.widthMm);
  assert.ok(large.heightMm > small.heightMm);
  // Inset is a fixed mm margin, so xMm/yMm (the inset itself) do not change with canvas size.
  assert.equal(small.xMm, mug.safeAreaInsetMm.left);
  assert.equal(small.yMm, mug.safeAreaInsetMm.top);
  assert.equal(large.xMm, mug.safeAreaInsetMm.left);
});

console.log('Object template tests passed.');
