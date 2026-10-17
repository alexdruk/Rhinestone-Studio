// IMG-026K -- the 3D preview's instanced stone is a round flat-back rhinestone: its silhouette
// covers at least 90 % of the stone's round footprint (the old octahedron covered 64 %), its height
// runs from 0 to 1 along local +Z (the outward normal STONE_DEPTH_RATIO flattens), it has no base
// facing the wall, and the instanced mesh uses it with flat shading. See
// docs/specifications/IMG-026-StrassLayoutService.md, "Round stones in the 3D preview (build K)".
import assert from 'node:assert/strict';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

globalThis.requestAnimationFrame = () => 0;
const THREE = await import('three');
const { buildObjectMesh, wallRadiusAt } = await import('../src/preview3d/ObjectGeometryBuilder.js');
const { getObjectTemplate } = await import('../src/products/index.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');
const { Preview3DRenderer, createRhinestoneGeometry, RHINESTONE_FACETS, STONE_DEPTH_RATIO } = await import('../src/preview3d/Preview3DRenderer.js');

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

const geometry = createRhinestoneGeometry(THREE);
const pos = geometry.getAttribute('position');
const vertices = Array.from({ length: pos.count }, (_, i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]);

function silhouetteArea() {
  const pts = vertices.map(([x, y]) => [x, y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of pts.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let a = 0;
  for (let i = 0; i < hull.length; i++) { const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}

await test('1. the silhouette seen along the normal covers at least 90 % of the unit disc (the octahedron covered 2/pi)', () => {
  const ratio = silhouetteArea() / Math.PI;
  assert.ok(ratio >= 0.9, `coverage ${ratio.toFixed(3)}`);
});

await test('2. the stone spans 0 to 1 along local +Z, stays inside the unit radius, and has no base face lying on the wall', () => {
  const zs = vertices.map((v) => v[2]);
  assert.ok(Math.abs(Math.min(...zs)) < 1e-9 && Math.abs(Math.max(...zs) - 1) < 1e-9);
  assert.ok(vertices.every(([x, y]) => Math.hypot(x, y) <= 1 + 1e-9));
  for (let t = 0; t < pos.count; t += 3) {
    assert.ok(!(vertices[t][2] < 1e-9 && vertices[t + 1][2] < 1e-9 && vertices[t + 2][2] < 1e-9), 'no triangle lies flat at z = 0');
  }
  assert.equal(pos.count / 3, RHINESTONE_FACETS * 4 * 2, 'triangles: two per facet for each of the four profile segments (girdle, crown, table ring, table centre)');
});

await test('3. the instanced mesh uses the rhinestone geometry with flat shading, and the depth ratio still flattens the normal axis', () => {
  const instance = new Preview3DRenderer({ getBoundingClientRect: () => ({ width: 400, height: 300 }) });
  instance._mounted = true;
  instance._THREE = THREE;
  instance._buildObjectMesh = buildObjectMesh;
  instance._wallRadiusAt = wallRadiusAt;
  instance.scene = new THREE.Scene();
  instance.camera = new THREE.PerspectiveCamera(35, 4 / 3, 1, 5000);
  instance.controls = { target: new THREE.Vector3(), update() {}, saveState() {} };
  instance.renderer = { capabilities: { getMaxAnisotropy: () => 4 } };
  instance._ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  instance.scene.add(instance._ambientLight);
  const layout = new StoneLayout({ layerId: 'img', stones: [new Stone({ layerId: 'img', index: 0, xMm: 100, yMm: 40, sizeMm: 2, color: 'silk' })] });
  instance.update(layout, { cupColor: '#1f3556', objectTemplate: getObjectTemplate('mug'), canvasWidthMm: 257.6, canvasHeightMm: 85 });
  const mesh = instance._stoneMesh;
  assert.ok(mesh, 'the instanced stone mesh exists');
  assert.equal(mesh.geometry.getAttribute('position').count, pos.count);
  assert.equal(mesh.material.flatShading, true);
  const m = new THREE.Matrix4(); mesh.getMatrixAt(0, m);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s);
  assert.ok(Math.abs(s.x - 1) < 1e-6 && Math.abs(s.z - STONE_DEPTH_RATIO) < 1e-6);
});

await test('4. registration: test-img-026-rhinestone-geometry.mjs is in the renderers group and the default suite', () => {
  assertTestRegistered({ filename: 'test-img-026-rhinestone-geometry.mjs', group: 'renderers', includedInDefault: true });
});
