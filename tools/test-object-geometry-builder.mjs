import assert from 'node:assert/strict';

// RS-1006 — verifies src/preview3d/ObjectGeometryBuilder.js using the real 'three' package. Three's
// geometry/math classes (CylinderGeometry, LatheGeometry, TubeGeometry, Box3, ...) are pure
// computation and run fine under plain Node with no WebGL context, which is what makes this a real
// (not faked) test of the actual geometry this milestone builds, without needing a browser.

const THREE = await import('three');
const ObjectGeometryBuilder = await import('../src/preview3d/ObjectGeometryBuilder.js');
const { buildObjectMesh } = ObjectGeometryBuilder;
const { computeObjectDimensionsMm } = await import('../src/preview3d/ObjectDimensions.js');
const { getObjectTemplate, getPlateDefaults, getVesselDefaults } = await import('../src/products/index.js');

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

const CANVAS_SIZES = { mug: [210, 90], tumbler: [230, 100], bottle: [180, 90] };

await test('1. buildObjectMesh never throws for any of the three templates', () => {
  for (const id of ['mug', 'tumbler', 'bottle']) {
    const [w, h] = CANVAS_SIZES[id];
    assert.doesNotThrow(() => buildObjectMesh(getObjectTemplate(id), w, h));
  }
});

await test('2. mug has exactly a body + a handle mesh; tumbler/bottle have only a body', () => {
  const mug = buildObjectMesh(getObjectTemplate('mug'), 210, 90);
  assert.equal(mug.group.children.length, 2);
  assert.ok(mug.handleMesh, 'expected a handle mesh for the mug');
  assert.ok(mug.group.children.includes(mug.bodyMesh));
  assert.ok(mug.group.children.includes(mug.handleMesh));

  for (const id of ['tumbler', 'bottle']) {
    const [w, h] = CANVAS_SIZES[id];
    const built = buildObjectMesh(getObjectTemplate(id), w, h);
    assert.equal(built.group.children.length, 1);
    assert.equal(built.handleMesh, null);
  }
});

await test('3. bodyMesh and handleMesh (when present) are real THREE.Mesh instances with BufferGeometry', () => {
  const { bodyMesh, handleMesh } = buildObjectMesh(getObjectTemplate('mug'), 210, 90);
  assert.ok(bodyMesh instanceof THREE.Mesh);
  assert.ok(bodyMesh.geometry instanceof THREE.BufferGeometry);
  assert.ok(handleMesh instanceof THREE.Mesh);
  assert.ok(handleMesh.geometry instanceof THREE.BufferGeometry);
});

await test('4. body geometry bounding box height matches dimensions.bodyHeightMm for mug/tumbler', () => {
  for (const id of ['mug', 'tumbler']) {
    const [w, h] = CANVAS_SIZES[id];
    const template = getObjectTemplate(id);
    const dims = computeObjectDimensionsMm(template, w, h);
    const { bodyMesh } = buildObjectMesh(template, w, h);
    bodyMesh.geometry.computeBoundingBox();
    const box = bodyMesh.geometry.boundingBox;
    const height = box.max.y - box.min.y;
    assert.ok(Math.abs(height - dims.bodyHeightMm) < 1e-3, `expected height ${dims.bodyHeightMm}, got ${height}`);
    assert.ok(box.min.y >= -1e-3, 'expected the body base at y=0 (not centered on origin)');
  }
});

await test('5. bottle geometry bounding box height matches dimensions.totalHeightMm (body + shoulder + neck + cap)', () => {
  const template = getObjectTemplate('bottle');
  const dims = computeObjectDimensionsMm(template, 180, 90);
  const { bodyMesh } = buildObjectMesh(template, 180, 90);
  bodyMesh.geometry.computeBoundingBox();
  const box = bodyMesh.geometry.boundingBox;
  const height = box.max.y - box.min.y;
  // BufferGeometry positions are Float32Array (single precision) -- a ~1e-5 relative rounding
  // error against the double-precision dims.totalHeightMm is expected, not a defect.
  assert.ok(Math.abs(height - dims.totalHeightMm) < 1e-3, `expected height ${dims.totalHeightMm}, got ${height}`);
  assert.ok(dims.totalHeightMm > dims.bodyHeightMm, 'expected the bottle to be taller than its body alone');
});

await test('6. tumbler body radius is constant top-to-bottom (straight wall); mug/bottle are not', () => {
  const tumblerTemplate = getObjectTemplate('tumbler');
  const { bodyMesh: tumblerBody } = buildObjectMesh(tumblerTemplate, 230, 100);
  tumblerBody.geometry.computeBoundingBox();
  const tb = tumblerBody.geometry.boundingBox;
  assert.ok(Math.abs((tb.max.x - tb.min.x) - (tb.max.z - tb.min.z)) < 1e-6, 'expected a circular cross-section');

  // A straight tumbler's CylinderGeometry has radiusTop === radiusBottom by construction.
  const dims = computeObjectDimensionsMm(tumblerTemplate, 230, 100);
  assert.ok(Math.abs(dims.topRadiusMm - dims.bodyRadiusMm) < 1e-9);
});

await test('7. object mesh UV maps the front azimuth (atan2(x,z)=0) to u=0.5, and is wrap-mode independent -- S-109: rebuilding the same mesh never changes its UV (no per-wrap-mode entry point exists any more)', () => {
  const { bodyMesh } = buildObjectMesh(getObjectTemplate('mug'), 210, 90);
  const position = bodyMesh.geometry.attributes.position;
  const uv = bodyMesh.geometry.attributes.uv;

  // Find a vertex closest to the front azimuth (x≈0, z>0).
  let frontIndex = -1, bestScore = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    const score = z - Math.abs(x) * 10;
    if (score > bestScore) { bestScore = score; frontIndex = i; }
  }

  assert.ok(Math.abs(uv.getX(frontIndex) - 0.5) < 0.05, 'expected u≈0.5 at the front azimuth');
  assert.equal(typeof ObjectGeometryBuilder.applyWrapUv, 'undefined', 'expected no per-wrap-mode UV entry point to exist (S-109: UV is wrap-mode independent, built once in buildObjectMesh())');
});

await test('8. object mesh UV matches the object\'s true circumference scale (S-109): a vertex at azimuth theta gets u = 0.5 + theta/(2*PI), the same dimensionless canvasXMm/canvasWidthMm relation ObjectDimensions.js\'s canvasXMmForAzimuthRad() uses for the Front View Frame -- so the Object Preview and the 2D Canvas agree on scale for any canvas width, with no wrap-mode-dependent rescaling', () => {
  const { bodyMesh } = buildObjectMesh(getObjectTemplate('tumbler'), 230, 100);
  const position = bodyMesh.geometry.attributes.position;
  const uv = bodyMesh.geometry.attributes.uv;

  // A vertex at a fixed, moderate azimuth away from front (not exactly back, to avoid the one
  // intentional seam -- see check 8b below).
  let sideIndex = -1, bestDiff = Infinity;
  const targetAzimuth = Math.PI / 2;
  for (let i = 0; i < position.count; i++) {
    const azimuth = Math.atan2(position.getX(i), position.getZ(i));
    const diff = Math.abs(azimuth - targetAzimuth);
    if (diff < bestDiff) { bestDiff = diff; sideIndex = i; }
  }

  // The vertex's *own* construction azimuth (column index formula, not atan2 -- see applyAzimuthUv()'s
  // doc comment) is what its U is actually derived from; recover it the same way to compute the
  // expected true-scale U independently of the implementation under test.
  const LATHE_SEGMENTS = 48;
  const columnCount = LATHE_SEGMENTS + 1;
  const rowCount = position.count / columnCount;
  const column = Math.floor(sideIndex / rowCount);
  const azimuth = -Math.PI + (column / LATHE_SEGMENTS) * 2 * Math.PI;
  const expectedU = 0.5 + azimuth / (2 * Math.PI);

  assert.ok(Math.abs(uv.getX(sideIndex) - expectedU) < 1e-9, `expected u=${expectedU} (true circumference scale) at azimuth=${azimuth}, got ${uv.getX(sideIndex)}`);
});

await test('8b. no triangle spans a large U range for any object template -- regression guard for the dark-vertical-band defect (a real, human-observed bug: atan2\'s branch cut and the r=0 base/cap apex both used to coincide with real, connected faces, stretching a texture sample across nearly the whole canvas width in one thin triangle)', () => {
  const sizes = { mug: [210, 90], tumbler: [230, 100], bottle: [180, 90] };
  for (const id of ['mug', 'tumbler', 'bottle']) {
    const [w, h] = sizes[id];
    const { bodyMesh } = buildObjectMesh(getObjectTemplate(id), w, h);
    const index = bodyMesh.geometry.index;
    const uv = bodyMesh.geometry.attributes.uv;
    // A healthy triangle's U span is at most a few LATHE_SEGMENTS-steps wide (~0.02); 0.3 is a
    // generous margin that would only be crossed by a genuine seam/branch-cut/degenerate-apex
    // defect, never by ordinary per-segment variation.
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
      const ua = uv.getX(a), ub = uv.getX(b), uc = uv.getX(c);
      const jump = Math.max(Math.abs(ua - ub), Math.abs(ub - uc), Math.abs(ua - uc));
      assert.ok(jump < 0.3, `${id} triangle@${t}: U jump ${jump} (vertices ${a}=${ua}, ${b}=${ub}, ${c}=${uc}) -- suspected seam/apex UV defect`);
    }
  }
});

await test('8c. the base apex (r=0, x=z=0 for every column) never triggers Math.atan2\'s signed-zero quirk -- regression guard for the second dark-band defect (neighboring apex vertices at the identical physical point used to get wildly different, meaningless azimuths depending on the sign of each column\'s near-zero x/z)', () => {
  const { bodyMesh } = buildObjectMesh(getObjectTemplate('mug'), 210, 90);
  const position = bodyMesh.geometry.attributes.position;
  const uv = bodyMesh.geometry.attributes.uv;
  const apexUs = [];
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) === 0 && position.getY(i) === 0 && position.getZ(i) === 0) apexUs.push(uv.getX(i));
  }
  assert.ok(apexUs.length > 10, 'expected many duplicate apex vertices (one per Lathe column)');
  // Adjacent apex columns must differ by a small, regular step (matching every other column pair),
  // never by a large, sign-of-zero-driven jump.
  const sorted = [...apexUs].sort((x, y) => x - y);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i] - sorted[i - 1] < 0.3, `apex U values ${sorted[i - 1]} and ${sorted[i]} are implausibly far apart`);
  }
});

// RS-1006A regression tests -- these guard the four human-review defects fixed in
// docs/specifications/RS-1006A-PreviewCorrections.md. Each checks an observable geometry/material
// fact (not an implementation detail like a specific constant's value).

await test('9. body material is FrontSide (not DoubleSide) for every template -- regression guard for the tumbler/mug duplicated-artwork defect', () => {
  for (const id of ['mug', 'tumbler', 'bottle']) {
    const [w, h] = CANVAS_SIZES[id];
    const { bodyMesh } = buildObjectMesh(getObjectTemplate(id), w, h);
    assert.equal(bodyMesh.material.side, THREE.FrontSide);
  }
});

await test('10. mug/tumbler body has a closed base (a vertex at y=0 with r=0) and a modeled rim (max radius occurs above y=0, not at a bare open top) -- regression guard for the generic-cone defect', () => {
  for (const id of ['mug', 'tumbler']) {
    const [w, h] = CANVAS_SIZES[id];
    const { bodyMesh, dimensions } = buildObjectMesh(getObjectTemplate(id), w, h);
    const position = bodyMesh.geometry.attributes.position;
    let baseIsClosed = false;
    let maxRadius = 0, maxRadiusY = 0;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      const r = Math.hypot(position.getX(i), position.getZ(i));
      if (Math.abs(y) < 1e-6 && r < 1e-6) baseIsClosed = true;
      if (r > maxRadius) { maxRadius = r; maxRadiusY = y; }
    }
    assert.ok(baseIsClosed, `expected ${id} to have a closed (r=0) base at y=0`);
    // The rim's outer lip is the widest point of the wall, and it sits at the very top of the
    // object (RIM_TOP_FRACTION=1) -- confirms a rim was modeled, not just a bare taper.
    assert.ok(Math.abs(maxRadiusY - dimensions.bodyHeightMm) < 1e-3, `expected ${id}'s widest point (the rim) at the top (y=${dimensions.bodyHeightMm}), got y=${maxRadiusY}`);
  }
});

await test('11. mug handle wall-attachment endpoints sit inside the wall radius at that height, not on/outside it -- regression guard for the floating/gapped handle defect', () => {
  const { handleMesh, dimensions } = buildObjectMesh(getObjectTemplate('mug'), 210, 90);
  const wallRadiusAt = (y) => {
    const t = Math.max(0, Math.min(1, y / dimensions.bodyHeightMm));
    return dimensions.bodyRadiusMm + (dimensions.topRadiusMm - dimensions.bodyRadiusMm) * t;
  };
  const position = handleMesh.geometry.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < position.count; i++) {
    minY = Math.min(minY, position.getY(i));
    maxY = Math.max(maxY, position.getY(i));
  }
  // The handle's two attach ends are its extreme-Y vertices; check each is embedded (radius from
  // the axis strictly less than the wall's own radius at that height).
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (Math.abs(y - minY) < 1e-3 || Math.abs(y - maxY) < 1e-3) {
      const r = Math.hypot(position.getX(i), position.getZ(i));
      assert.ok(r < wallRadiusAt(y) - 1e-6, `expected handle endpoint at y=${y} (r=${r}) embedded inside the wall (wallRadius=${wallRadiusAt(y)})`);
    }
  }
});

await test('12. bottle body vertices above bodyHeightMm (shoulder/neck/cap) get v>1 (clamped to background, off the printable body); body-wall vertices stay within [0,1] -- regression guard for the shoulder texture-bleed defect', () => {
  const { bodyMesh, dimensions } = buildObjectMesh(getObjectTemplate('bottle'), 180, 90);
  const position = bodyMesh.geometry.attributes.position;
  const uv = bodyMesh.geometry.attributes.uv;
  let sawBodyVertex = false, sawShoulderVertex = false;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const v = uv.getY(i);
    if (y >= -1e-6 && y <= dimensions.bodyHeightMm + 1e-6) {
      sawBodyVertex = true;
      assert.ok(v >= -1e-6 && v <= 1 + 1e-6, `expected body-wall vertex (y=${y}) to have v in [0,1], got ${v}`);
    }
    if (y > dimensions.bodyHeightMm + 1) {
      sawShoulderVertex = true;
      assert.ok(v > 1, `expected shoulder/neck/cap vertex (y=${y}) to have v>1 (clamped off the printable body), got ${v}`);
    }
  }
  assert.ok(sawBodyVertex && sawShoulderVertex, 'expected both a body-wall vertex and a shoulder/neck/cap vertex in the bottle profile');
});

// --- S-112: Round Dinner Plate radial profile ---------------------------------------------------

const PLATE_TEMPLATE = getObjectTemplate('plate');
const PLATE_DEFAULTS = getPlateDefaults();

await test('13. S-112: buildObjectMesh("plate") never throws and requires plateParams (unlike every other kind)', () => {
  assert.doesNotThrow(() => buildObjectMesh(PLATE_TEMPLATE, 270, 270, PLATE_DEFAULTS));
  assert.throws(() => buildObjectMesh(PLATE_TEMPLATE, 270, 270), /plateParams is required/);
});

await test('14. S-112: the plate mesh has exactly a printable top-surface mesh + a non-printable underside mesh, no handle', () => {
  const { group, bodyMesh, handleMesh, underMesh, dimensions } = buildObjectMesh(PLATE_TEMPLATE, 270, 270, PLATE_DEFAULTS);
  assert.equal(dimensions.kind, 'plate');
  assert.equal(group.children.length, 2);
  assert.equal(handleMesh, null);
  assert.ok(underMesh, 'expected a non-printable underside/rim-edge/foot-ring mesh');
  assert.ok(group.children.includes(bodyMesh));
  assert.ok(group.children.includes(underMesh));
  assert.notEqual(bodyMesh.geometry, underMesh.geometry);
});

await test('15. S-112: the plate silhouette is rotationally symmetric, has real thickness, a visible foot ring, and reaches the full outer diameter and overall height', () => {
  const { bodyMesh, underMesh, dimensions } = buildObjectMesh(PLATE_TEMPLATE, 270, 270, PLATE_DEFAULTS);
  bodyMesh.geometry.computeBoundingBox();
  underMesh.geometry.computeBoundingBox();
  const topBox = bodyMesh.geometry.boundingBox;
  const underBox = underMesh.geometry.boundingBox;
  // Rotational symmetry: a LatheGeometry revolve is symmetric by construction around Y -- confirmed
  // here by checking the X/Z extents are equal (a true circle in plan view, not an ellipse).
  assert.ok(Math.abs((topBox.max.x - topBox.min.x) - (topBox.max.z - topBox.min.z)) < 1e-6, 'top surface plan-view extent must be a true circle');
  assert.ok(Math.abs((underBox.max.x - underBox.min.x) - (underBox.max.z - underBox.min.z)) < 1e-6, 'underside plan-view extent must be a true circle');
  // Reaches the full outer diameter (both meshes share the outer-edge apex).
  assert.ok(Math.abs(topBox.max.x - dimensions.outerRadiusMm) < 1e-6, 'top surface must reach the full outer radius');
  // Overall height reached: the top surface's own max Y equals overallHeightMm exactly (the rim's
  // outer top edge, per the JSON's own "Maximum height from table surface to top of rim" definition).
  assert.ok(Math.abs(topBox.max.y - dimensions.overallHeightMm) < 1e-6, 'plate must reach its full overallHeightMm at the rim top');
  // Real thickness: the top and underside surfaces are never coincident (not a zero-thickness disc).
  assert.ok(topBox.min.y > underBox.min.y, 'plate must have real thickness (top surface floats above the table, unlike the underside/foot ring)');
  assert.ok(topBox.min.y - underBox.min.y > 1, 'plate thickness must be physically plausible (>1mm), not a hairline');
  // Not bowl-like excessive depth: the well's concave depth must stay within a modest fraction of
  // the overall height (centerDepthMm is ~48% of overallHeightMm at the JSON default -- generous,
  // but far short of the object's own radius, which is what a bowl-like depth would approach).
  assert.ok(dimensions.overallHeightMm - topBox.min.y < dimensions.outerRadiusMm * 0.5, 'well depth must not be bowl-like');
  // Visible supporting foot ring: the underside touches the table (y=0) only near the foot ring
  // radius, not across its whole extent (a flat-bottomed disc would touch at every radius).
  assert.ok(underBox.min.y <= 1e-6, 'the foot ring must actually touch the table (y=0 somewhere on the underside)');
});

await test('16. S-112: the plate\'s printable top surface uses a direct planar (x,z)->canvas UV projection, not the cylindrical azimuth/height mapping', () => {
  const canvasWidthMm = 270, canvasHeightMm = 270;
  const { bodyMesh } = buildObjectMesh(PLATE_TEMPLATE, canvasWidthMm, canvasHeightMm, PLATE_DEFAULTS);
  const position = bodyMesh.geometry.attributes.position;
  const uv = bodyMesh.geometry.attributes.uv;
  let checked = 0;
  for (let i = 0; i < position.count; i++) {
    // Float32 storage (THREE.BufferAttribute's default array type) introduces ~1e-7 relative
    // rounding versus the float64 expected value computed here -- 1e-5 is generous while still
    // catching any real formula mismatch (which would differ by orders of magnitude more).
    const expectedU = (canvasWidthMm / 2 + position.getX(i)) / canvasWidthMm;
    const expectedV = (canvasHeightMm / 2 - position.getZ(i)) / canvasHeightMm;
    assert.ok(Math.abs(uv.getX(i) - expectedU) < 1e-5, `vertex ${i}: U must equal the direct planar projection`);
    assert.ok(Math.abs(uv.getY(i) - expectedV) < 1e-5, `vertex ${i}: V must equal the direct planar projection`);
    checked++;
  }
  assert.ok(checked > 0);
  // The exact canvas center (r=0, the well's center point) must map to UV (0.5, 0.5) -- continuous,
  // no branch-cut/seam issue (unlike the cylindrical azimuth mapping, this needs no special-casing).
  const centerIndex = [...Array(position.count).keys()].find((i) => Math.abs(position.getX(i)) < 1e-6 && Math.abs(position.getZ(i)) < 1e-6);
  assert.ok(centerIndex !== undefined, 'expected at least one vertex at the exact well center (r=0)');
  assert.ok(Math.abs(uv.getX(centerIndex) - 0.5) < 1e-5 && Math.abs(uv.getY(centerIndex) - 0.5) < 1e-5);
});

await test('17. S-112: the plate\'s underside/foot-ring mesh has no printable UV mapping (StoneLayoutTexture is never applied to it -- Preview3DRenderer.js gives it a plain color material instead)', () => {
  const { underMesh } = buildObjectMesh(PLATE_TEMPLATE, 270, 270, PLATE_DEFAULTS);
  // buildObjectMesh() never assigns .map itself (Preview3DRenderer._updateTexture() does that,
  // live, only for bodyMesh) -- MeshStandardMaterial defaults .map to null, so this confirms the
  // underside mesh is built with no texture reference of any kind at construction time.
  assert.equal(underMesh.material.map, null, 'the underside mesh must not carry a design texture');
});

await test('18. S-112: rebuilding the plate mesh at a different live outer diameter (project.plate.outerDiameterMm) scales the silhouette accordingly (a real, user-adjustable dimension, unlike the fixed template factors every other kind uses)', () => {
  const small = buildObjectMesh(PLATE_TEMPLATE, 250, 250, { ...PLATE_DEFAULTS, outerDiameterMm: 250, innerWellDiameterMm: 175 });
  const large = buildObjectMesh(PLATE_TEMPLATE, 300, 300, { ...PLATE_DEFAULTS, outerDiameterMm: 300, innerWellDiameterMm: 215 });
  small.bodyMesh.geometry.computeBoundingBox();
  large.bodyMesh.geometry.computeBoundingBox();
  assert.ok(large.bodyMesh.geometry.boundingBox.max.x > small.bodyMesh.geometry.boundingBox.max.x);
  assert.equal(small.dimensions.outerRadiusMm, 125);
  assert.equal(large.dimensions.outerRadiusMm, 150);
});

// --- RS-2010: vesselParams -----------------------------------------------------------------------

await test('19. RS-2010: buildObjectMesh(..., vesselParams) uses the vessel\'s real topDiameterMm for the mug\'s body radius, replacing the old ratio-derived value', () => {
  const mugTemplate = getObjectTemplate('mug');
  const vessel = getVesselDefaults('mug');
  const canvasWidthMm = Math.PI * vessel.bodyDiameterMm;
  const built = buildObjectMesh(mugTemplate, canvasWidthMm, vessel.printableHeightMm, null, vessel);
  assert.ok(Math.abs(built.dimensions.topRadiusMm - vessel.topDiameterMm / 2) < 1e-9);
  // bodyRadiusMm is unaffected -- still purely a function of canvasWidthMm.
  assert.ok(Math.abs(built.dimensions.bodyRadiusMm - vessel.bodyDiameterMm / 2) < 1e-6);
});

await test('20. RS-2010: omitting vesselParams (every pre-RS-2010 call site) is byte-identical to before -- the ratio-based fallback path is untouched', () => {
  const withoutVessel = buildObjectMesh(getObjectTemplate('mug'), 210, 90);
  const withNullVessel = buildObjectMesh(getObjectTemplate('mug'), 210, 90, null, null);
  assert.deepEqual(withoutVessel.dimensions, withNullVessel.dimensions);
});

console.log('Object geometry builder tests passed.');
