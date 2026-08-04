/**
 * Real interactive Three.js 3D preview (RS-1006).
 *
 * Consumes only a StoneLayout plus plain display options (cupColor, wrap, objectTemplate,
 * canvasWidthMm/canvasHeightMm) -- the same "renderer never computes geometry" contract
 * src/renderer/CupRenderer.js already follows. It never generates a StoneLayout, never reads a
 * Project/Layer, and never invents a stone position.
 *
 * Three.js and OrbitControls are dynamic-imported inside init(), so nothing here is fetched/parsed
 * until a 3D preview is actually mounted (see src/preview3d/index.js, the only module app.js
 * statically imports). This file itself has no Node unit test -- WebGLRenderer needs a real
 * browser canvas/GL context -- and is verified by browser/manual testing instead (see the
 * specification's Browser/Manual Verification checklist).
 */
// RS-2013 step 4: azimuthRadForCanvasXMm()/getCrystalAppearance()/getCrystalColor() are all pure,
// DOM/Three.js-free modules (no `import` of their own -- confirmed before adding these as static
// imports), so pulling them in here does not defeat this file's "nothing three.js-related loads
// until a 3D preview actually mounts" contract (see the module header above). wallRadiusAt() is
// NOT imported this way -- it lives in ObjectGeometryBuilder.js, which does import 'three', so it
// is captured from init()'s existing dynamic import instead (this._wallRadiusAt).
import { azimuthRadForCanvasXMm } from './ObjectDimensions.js';
import { getCrystalAppearance } from '../renderer/CrystalAppearance.js';
import { getCrystalColor } from '../renderer/CrystalColors.js';

const DEFAULT_ZOOM = 1;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const DEFAULT_POLAR_RAD = 1.3; // ~74.5 degrees from +Y (~15.5 degrees above the horizon) -- shows the object mostly from the side, not looking down into its open top
// S-112: a plate has no "open top" to avoid looking into -- its printable face IS the top, so the
// default framing was originally much closer to top-down than every revolved-vessel kind's
// DEFAULT_POLAR_RAD.
// S-112A: that original 0.68 rad (~51 degrees of elevation) read as near-top-down, which undersold
// the object as a real dinner plate: the sloped rim read almost flat, and the foot ring never showed
// at all -- the foot ring's outer wall sits well inside the rim's outer edge (165mm vs 270mm) and low
// against the table, so any above-the-rim-plane camera has the rim's own overhang occlude it, no
// matter how steep. Verified empirically (real-browser screenshots swept across the whole polar
// range): the foot ring only becomes visible once the camera nears the rim's own underside slope --
// i.e. an eye-level-ish elevation, not a top-down one. Landed on ~13 degrees of elevation (close to
// the revolved-vessel default above), the shallowest angle at which the foot ring and the sloped
// rim/outer lip read clearly at the front edge without rotating, while the top surface (Center
// Well/Rim Band/Full Top Surface design) still fills most of the frame. Geometry itself is untouched
// -- only the camera moved.
const PLATE_DEFAULT_POLAR_RAD = 1.35; // ~77 degrees from +Y (~13 degrees of elevation above horizon)
const MIN_POLAR_RAD = 0.05;
const MAX_POLAR_RAD = Math.PI - 0.05;
// RC-011-FIX: _updateInstancedStones()'s plate branch (see its own comment below) places every
// plate stone with a hardcoded normal.set(0, 1, 0) -- correct as long as the camera stays above
// the horizon, but once OrbitControls' polar angle crosses Math.PI/2 the camera is looking at the
// stones' undersides with no per-instance orientation correction, so they read as mirrored. A
// plate has no legitimate "view from underneath" (the underside isn't a design surface -- it's
// the foot ring resting on a table), so the chosen fix constrains the camera itself rather than
// adding a new per-frame camera-relative re-orientation path (which the vessel branch doesn't
// have either, and isn't justified for a plate-only bug): cap maxPolarAngle just above the
// horizon. Same 0.05 rad margin convention as MIN_POLAR_RAD/MAX_POLAR_RAD above. Only applied for
// dimensions.kind === 'plate' (see _rebuildMesh()) -- every revolved-vessel kind keeps today's
// MIN_POLAR_RAD/MAX_POLAR_RAD range unchanged, since PLATE_DEFAULT_POLAR_RAD (1.35 rad) is well
// within this cap and every other kind's stones are unaffected by this defect.
const PLATE_MAX_POLAR_RAD = Math.PI / 2 - 0.05;
const FRAME_MARGIN = 1.25; // breathing room around the object when framing the "home" camera position

// RS-2013 §4 step 4/7: the "extended" 4-light rig tools/rs2013-instanced-stone-harness.html
// validated behind its own `?lighting=extended` param (step 3) -- ambient lowered so the extra
// directional coverage below doesn't flatten per-facet contrast, plus two more directional lights
// from angles the original PREVIEW-001 pair doesn't cover. Now the only rig (step 7 removed the
// old texture path's original 2-light + 0.75-ambient rig once the instanced path became the sole
// renderer).
const AMBIENT_INTENSITY = 0.4;
const EXTRA_LIGHTS = [
  { intensity: 1.1, position: [-108, 51, 91] },
  { intensity: 0.7, position: [25, -39, 142] }
];

// RS-2013 §4 step 5b: rate-limits how often _updateInstancedStones()'s expensive per-stone loop
// actually runs during a rapid burst of same-stone-count update() calls (a continuous drag fires
// update() on every pointermove, unthrottled -- app.js:1927/1930, cited in the design doc's §3.2).
// Mirrors the *spirit* of app.js's own AUTOSAVE_DEBOUNCE_MS precedent (app.js:872) -- coalescing a
// high-frequency edit signal before doing expensive work -- but not its trailing-only shape: a pure
// debounce would freeze the stone layer for the *entire* drag and only snap into place once the
// pointer stops for the full window, which is fine for a background localStorage write nobody
// watches happen but not for a live visual preview the operator is actively looking at. See
// _updateInstancedStonesThrottled() below and TASK_RESULT.md for the full reasoning and measured
// numbers. 100ms comfortably exceeds the worst single-rebuild cost step 5 measured at the
// ~15,000-stone ceiling (~34-38ms max) -- so a burst of calls faster than that always coalesces to
// at most ~10 rebuilds/sec, not zero throttling effect -- while still keeping the stone layer
// visibly moving during a drag (not frozen the way AUTOSAVE_DEBOUNCE_MS's 1200ms would read).
const INSTANCED_STONES_REBUILD_THROTTLE_MS = 100;

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// RS-2013 §4 step 4: ported from tools/rs2013-instanced-stone-harness.html's findRimPlaneY() --
// the plate's real printable top surface has genuine vertical relief (a concave well + sloped
// rim; only its UV mapping is a flat orthographic projection, not the geometry itself), so a
// stone's world Y at the well/rim transition is read directly off the already-built mesh rather
// than duplicating ObjectGeometryBuilder.js's private profile constants a second time.
function findPlateRimPlaneY(topGeometry, dimensions) {
  const position = topGeometry.attributes.position;
  let bestIndex = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < position.count; i++) {
    const r = Math.hypot(position.getX(i), position.getZ(i));
    const diff = Math.abs(r - dimensions.innerWellRadiusMm);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }
  return position.getY(bestIndex);
}

export class Preview3DRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this._mounted = false;
    this._geometryKey = null;
    this._azimuthDeg = 0;
    this._zoom = DEFAULT_ZOOM;
    this._sliderAzimuthDeg = 0;
    this._sliderZoom = DEFAULT_ZOOM;
    this._objectDistance = null;
    this._dimensions = null;
    this._group = null;
    this._bodyMesh = null;
    this._handleMesh = null;
    this._underMesh = null; // S-112: the plate's non-printable underside/rim-edge/foot-ring mesh, null for every other kind
    // RS-2013 §4 step 4: instanced-stone mesh. _stoneMesh mirrors _bodyMesh/_handleMesh/_underMesh's
    // own "current mesh for the live group" convention; _plateTopY is computed once per
    // _rebuildMesh() (geometry-key change), not per update() call, since it only depends on the
    // built plate mesh, not the live StoneLayout.
    this._stoneMesh = null;
    this._plateTopY = 0;
    this._wallRadiusAt = null;
    // RS-2013 §4 step 5b: throttle bookkeeping for _updateInstancedStonesThrottled() -- see that
    // method and INSTANCED_STONES_REBUILD_THROTTLE_MS's own comment above for the reasoning.
    this._lastInstancedRebuildAt = -Infinity;
    this._instancedRebuildTimer = null;
    this._pendingInstancedArgs = null;
    this._ambientLight = null;
    this._extraLights = [];
    // RS-2011: invalidation-based rendering replaces the old unconditional per-frame
    // requestAnimationFrame loop -- see _requestRender()/_renderFrame(). _frameScheduled guards
    // against queuing more than one pending frame; _renderCount is verification instrumentation only
    // (a plain counter of actual renderer.render() calls, so idle-vs-active behavior can be confirmed
    // by polling a number in a browser test instead of eyeballing the canvas).
    this._frameScheduled = false;
    this._renderCount = 0;
    // S-107: fires with the live camera azimuth (degrees, same -180..180/front=0 convention as
    // `rotation`) whenever the operator free-orbits the Object Preview with the mouse/touch, so
    // app.js can keep the 2D canvas's Front View Frame in sync -- see _onControlsChange() below for
    // why this never fires for our own slider/frame-drag-driven camera moves (no feedback loop).
    this.onAzimuthChange = null;
  }

  async init() {
    if (this._mounted) return;
    const [THREE, orbitModule, geometryModule] = await Promise.all([
      import('three'),
      import('../../node_modules/three/examples/jsm/controls/OrbitControls.js'),
      import('./ObjectGeometryBuilder.js')
    ]);
    this._THREE = THREE;
    this._buildObjectMesh = geometryModule.buildObjectMesh;
    // RS-2013 §4 step 4: wallRadiusAt() lives in ObjectGeometryBuilder.js (which imports 'three'),
    // so it is captured here from the same dynamic import already used for buildObjectMesh, rather
    // than a fresh static import at this file's top (which would eagerly load three.js -- see the
    // top-of-file import comment).
    this._wallRadiusAt = geometryModule.wallRadiusAt;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe9eef5);

    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);

    // RS-2013 §4 step 4/7: the "extended" rig -- lower ambient than the original 0.75 so the extra
    // directional coverage below doesn't flatten per-facet contrast on the instanced stones, plus
    // two more directional lights from angles the original PREVIEW-001 pair doesn't cover. This was
    // toggled on only while `instancedStones` was true (step 4-6); step 7 made it the only rig once
    // the instanced path became the sole renderer.
    this._ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
    this.scene.add(this._ambientLight);
    const directional = new THREE.DirectionalLight(0xffffff, 1.6);
    directional.position.set(60, 120, 90);
    this.scene.add(directional);
    // PREVIEW-001: a second, dimmer fill light from the opposite side gives the faceted-crystal
    // stones a second angle to catch, instead of relying on one directional light alone.
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-70, 40, -60);
    this.scene.add(fill);
    for (const spec of EXTRA_LIGHTS) {
      const light = new THREE.DirectionalLight(0xffffff, spec.intensity);
      light.position.set(...spec.position);
      this.scene.add(light);
      this._extraLights.push(light);
    }

    this.controls = new orbitModule.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 5000;
    this.controls.minPolarAngle = MIN_POLAR_RAD;
    this.controls.maxPolarAngle = MAX_POLAR_RAD;
    this.controls.addEventListener('change', () => { this._onControlsChange(); this._requestRender(); });
    // RS-2011: 'start'/'end' fire on pointerdown/pointerup (and wheel-dolly start/end) -- 'change'
    // alone is not enough to kick off the very first frame of a drag, since a raw pointermove only
    // accumulates OrbitControls' internal delta, it does not itself call update()/dispatch 'change'.
    // 'start' schedules that first frame; the render loop's own controls.update() call then detects
    // the accumulated delta and dispatches 'change' on every subsequent frame for as long as the
    // operator keeps moving the pointer or damping still has residual velocity, self-terminating once
    // OrbitControls stops reporting a change (see _requestRender()'s own comment).
    this.controls.addEventListener('start', () => this._requestRender());
    this.controls.addEventListener('end', () => this._requestRender());

    this._resizeObserver = new ResizeObserver(() => this._handleResize());
    this._resizeObserver.observe(this.canvas.parentElement || this.canvas);

    this._mounted = true;
    this._handleResize();
    this._requestRender();
  }

  // RS-2011: schedules a single requestAnimationFrame-bound render, deduplicated via
  // _frameScheduled -- calling this any number of times before that frame fires still only renders
  // once. Replaces the old unconditional per-frame _animate() loop: nothing here perpetuates itself
  // except OrbitControls' own damping, which keeps re-invalidating (via the 'change' listener in
  // init()) only while the camera is actually still moving -- see _renderFrame().
  _requestRender() {
    if (!this._mounted || this._frameScheduled) return;
    this._frameScheduled = true;
    requestAnimationFrame(() => this._renderFrame());
  }

  _renderFrame() {
    this._frameScheduled = false;
    if (!this._mounted) return;
    // OrbitControls.update() applies any pending drag/damping delta and (per its own implementation)
    // dispatches 'change' -- which re-invalidates via _requestRender() -- only while the camera is
    // still actually moving past its internal epsilon; once damping settles, update() stops
    // dispatching 'change' and this loop naturally stops scheduling further frames.
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._renderCount++;
  }

  /** RS-2011: verification instrumentation -- the number of actual renderer.render() calls so far. */
  getRenderCount() {
    return this._renderCount;
  }

  _handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this._requestRender();
  }

  /**
   * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
   * @param {{cupColor:string, objectTemplate:object, canvasWidthMm:number, canvasHeightMm:number,
   *   plateParams:object|null, vesselParams:object|null}} options
   *   S-109: no `wrap` option -- the object mesh's texture UV is wrap-mode independent (built once
   *   inside ObjectGeometryBuilder.js's buildObjectMesh(), at the object's true circumference
   *   scale), so this method no longer needs to react to wrap-mode changes at all. The Front View
   *   Frame (app.js) still visualizes the selected wrap mode's width on the 2D canvas, using
   *   ObjectDimensions.js's frontViewFrameWidthMm(), unchanged.
   *   S-112: `plateParams` (project.plate, normalized) is only meaningful when
   *   objectTemplate.preview.kind==='plate' -- omitted/null for every other template, exactly like
   *   `wrap` used to be an option every non-relevant caller could simply not pass.
   *   RS-2010: `vesselParams` (project.vessel, normalized) is only meaningful for mug/tumbler/
   *   bottle -- same "omitted/null when not relevant" style as plateParams above.
   *   RS-2013 §4 step 7: the old texture-baking path and its `instancedStones` gating flag are
   *   gone -- this always builds/updates the instanced-stone mesh (see _updateInstancedStones()).
   */
  update(stoneLayout, { cupColor, objectTemplate, canvasWidthMm, canvasHeightMm, plateParams = null, vesselParams = null }) {
    if (!this._mounted) return;

    const geometryKey = `${objectTemplate.id}:${canvasWidthMm}:${canvasHeightMm}:${plateParams ? JSON.stringify(plateParams) : ''}:${vesselParams ? JSON.stringify(vesselParams) : ''}`;
    const geometryChanged = geometryKey !== this._geometryKey;
    if (geometryChanged) {
      this._rebuildMesh(objectTemplate, canvasWidthMm, canvasHeightMm, plateParams, vesselParams);
      this._geometryKey = geometryKey;
    }

    this._updateInstancedStonesThrottled(stoneLayout, canvasWidthMm, canvasHeightMm, cupColor);

    if (geometryChanged) this._frameCamera();
    this._requestRender();
  }

  /**
   * Repositions the camera to reflect the Rotation/Zoom sliders, but only when they actually
   * changed since the last call -- an unrelated project edit (e.g. typing in the text field) calls
   * this every time via drawCup(), and must never yank the camera out from under a manual
   * orbit/pan the operator is mid-way through with the mouse.
   *
   * @param {number} azimuthDeg
   * @param {number} zoom
   */
  syncView(azimuthDeg, zoom) {
    if (!this._mounted) return;
    if (azimuthDeg !== this._sliderAzimuthDeg) {
      this._sliderAzimuthDeg = azimuthDeg;
      this.setAzimuthDeg(azimuthDeg);
    }
    if (zoom !== this._sliderZoom) {
      this._sliderZoom = zoom;
      this.setZoom(zoom);
    }
  }

  setAzimuthDeg(deg) {
    this._azimuthDeg = deg;
    this._repositionCamera();
  }

  setZoom(zoom) {
    this._zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    this._repositionCamera();
  }

  /** Restores the camera to the last-framed "home" position for the current object. */
  resetView() {
    this._azimuthDeg = 0;
    this._zoom = DEFAULT_ZOOM;
    this._sliderAzimuthDeg = 0;
    this._sliderZoom = DEFAULT_ZOOM;
    if (this._mounted) { this.controls.reset(); this._requestRender(); }
  }

  dispose() {
    this._mounted = false;
    this._clearPendingInstancedRebuild();
    this._resizeObserver?.disconnect();
    this.controls?.dispose();
    this._disposeGroup();
    this.renderer?.dispose();
  }

  _disposeGroup() {
    if (!this._group) return;
    this.scene.remove(this._group);
    this._group.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
  }

  _rebuildMesh(objectTemplate, canvasWidthMm, canvasHeightMm, plateParams, vesselParams) {
    this._disposeGroup();
    const { group, bodyMesh, handleMesh, underMesh, dimensions } = this._buildObjectMesh(objectTemplate, canvasWidthMm, canvasHeightMm, plateParams, vesselParams);
    this._group = group;
    this._bodyMesh = bodyMesh;
    this._handleMesh = handleMesh;
    this._underMesh = underMesh || null;
    this._dimensions = dimensions;
    // RC-011-FIX: re-applied on every geometry rebuild (not just once in init()) so switching
    // between a plate project and a vessel project always gets the right cap -- see
    // PLATE_MAX_POLAR_RAD's own comment above for why plate needs a tighter maxPolarAngle.
    this.controls.maxPolarAngle = dimensions.kind === 'plate' ? PLATE_MAX_POLAR_RAD : MAX_POLAR_RAD;
    // _disposeGroup() above already disposed the old _stoneMesh (it was a child of the old
    // group) -- rebuilt lazily by _updateInstancedStones() on the next update() call.
    this._stoneMesh = null;
    this._plateTopY = dimensions.kind === 'plate' ? findPlateRimPlaneY(bodyMesh.geometry, dimensions) : 0;
    this.scene.add(group);
    this._applyCrystalMaterialResponse();
  }

  // PREVIEW-001: a small specular-response nudge on the design-bearing surface only (the mesh the
  // baked crystal texture is mapped onto) -- ObjectGeometryBuilder.js's own module doc disclaims
  // material decisions ("Geometry only: no material ... decisions are made here"), so this stays
  // here rather than in that file. Deliberately modest (not a jump to full metalness/near-zero
  // roughness) so glazed ceramic/ABS product bodies don't start reading as chrome; the underside,
  // handle, and plate foot ring (non-design surfaces) are left at their original values.
  _applyCrystalMaterialResponse() {
    if (this._bodyMesh) {
      this._bodyMesh.material.roughness = 0.42;
      this._bodyMesh.material.metalness = 0.08;
    }
  }

  // RS-2013 §4 step 5b: gates _updateInstancedStones()'s expensive per-stone loop behind a
  // leading-edge-plus-guaranteed-trailing throttle -- see INSTANCED_STONES_REBUILD_THROTTLE_MS's
  // comment for the reasoning. A stone-COUNT change (add/remove -- a structural edit, not the
  // continuous-drag case this mitigation targets) always rebuilds immediately, never throttled:
  // capacity has to change synchronously so InstancedMesh.count never lags an added/removed stone,
  // and this is not the high-frequency scenario step 5 measured (that was same-count position
  // updates during a drag). Otherwise: the first call after a quiet period (>=THROTTLE_MS since the
  // last real rebuild) fires immediately too, so a single discrete edit or the *first* movement of
  // a drag is never delayed -- only calls arriving faster than that get coalesced, always into
  // exactly one trailing rebuild (the latest args win, any earlier pending call is superseded) once
  // the burst quiets, so the mesh is never left stuck showing a stale position.
  _updateInstancedStonesThrottled(stoneLayout, canvasWidthMm, canvasHeightMm, cupColor) {
    const capacity = Math.max(1, stoneLayout.stones.length);
    const capacityChanged = !this._stoneMesh || this._stoneMesh.userData.capacity !== capacity;
    const elapsed = nowMs() - this._lastInstancedRebuildAt;

    if (capacityChanged || elapsed >= INSTANCED_STONES_REBUILD_THROTTLE_MS) {
      this._clearPendingInstancedRebuild();
      this._lastInstancedRebuildAt = nowMs();
      this._updateInstancedStones(stoneLayout, canvasWidthMm, canvasHeightMm, cupColor);
      return;
    }

    this._pendingInstancedArgs = { stoneLayout, canvasWidthMm, canvasHeightMm, cupColor };
    if (!this._instancedRebuildTimer) {
      this._instancedRebuildTimer = setTimeout(() => {
        this._instancedRebuildTimer = null;
        const args = this._pendingInstancedArgs;
        this._pendingInstancedArgs = null;
        if (!args || !this._mounted) return;
        this._lastInstancedRebuildAt = nowMs();
        this._updateInstancedStones(args.stoneLayout, args.canvasWidthMm, args.canvasHeightMm, args.cupColor);
        this._requestRender();
      }, INSTANCED_STONES_REBUILD_THROTTLE_MS - elapsed);
    }
  }

  _clearPendingInstancedRebuild() {
    if (this._instancedRebuildTimer) {
      clearTimeout(this._instancedRebuildTimer);
      this._instancedRebuildTimer = null;
    }
    this._pendingInstancedArgs = null;
  }

  // RS-2013 §4 step 4: builds/updates the instanced-stone mesh from a real StoneLayout, ported
  // directly from tools/rs2013-instanced-stone-harness.html's runStep2Placement() (the harness's
  // own validated reference implementation for this math -- see that file's extensive comments
  // for the reasoning behind each step, not repeated here). Only the plain octahedron + unmodified
  // diffuse MeshStandardMaterial (roughness=0.42/metalness=0.08) are used -- step 3b evaluated and
  // rejected both a richer 16-triangle geometry and a more specular material preset as the shipped
  // default; see docs/specifications/RS-2013-InstancedFacetedStoneRenderingDesign.md's step-3b
  // TASK_RESULT.md.
  _updateInstancedStones(stoneLayout, canvasWidthMm, canvasHeightMm, cupColor) {
    const THREE = this._THREE;
    const dimensions = this._dimensions;
    const stones = stoneLayout.stones;
    // InstancedMesh's instance count is fixed at construction -- capacity tracks the buffer size
    // actually allocated (never 0, an empty layout still needs a valid, if unused, buffer) so a
    // stone-count change (an edit adding/removing stones, not a geometry-key change) only pays for
    // a full mesh rebuild when capacity itself needs to grow or shrink, not on every update() call.
    const capacity = Math.max(1, stones.length);
    if (!this._stoneMesh || this._stoneMesh.userData.capacity !== capacity) {
      if (this._stoneMesh) {
        this._group.remove(this._stoneMesh);
        this._stoneMesh.geometry.dispose();
        this._stoneMesh.material.dispose();
      }
      const geometry = new THREE.OctahedronGeometry(1, 0);
      const material = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.08 });
      this._stoneMesh = new THREE.InstancedMesh(geometry, material, capacity);
      this._stoneMesh.userData.capacity = capacity;
      this._group.add(this._stoneMesh);
    }
    this._stoneMesh.count = stones.length;

    const zAxis = new THREE.Vector3(0, 0, 1);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const qAlign = new THREE.Quaternion();
    const qSpin = new THREE.Quaternion();
    const scaleV = new THREE.Vector3();
    const normal = new THREE.Vector3();

    for (let i = 0; i < stones.length; i++) {
      const stone = stones[i];

      if (dimensions.kind === 'plate') {
        // §3.3 2a: flat top surface, normal always +Y, no per-stone spin.
        // RC-013: no sign flip on Z -- stone positions carry no texture and are never sampled by
        // THREE.CanvasTexture, so flipY=true (the reason applyPlateTopSurfaceUv() in
        // ObjectGeometryBuilder.js negates this same term) does not apply here. The prior negation
        // was very likely copied from that function and inverted the Y-to-Z mapping, rendering every
        // letter vertically flipped (a "V" as "Λ").
        position.set(stone.xMm - canvasWidthMm / 2, this._plateTopY, (stone.yMm - canvasHeightMm / 2));
        normal.set(0, 1, 0);
        qAlign.setFromUnitVectors(zAxis, normal);
        quaternion.copy(qAlign);
      } else {
        // §3.3 2b/2c: azimuth via the one shared, already-unit-tested function; height clamped to
        // [0, bodyHeightMm] so off-body content never places a stone outside the printable body.
        // stone.yMm is Y-down (production-canvas convention); world Y here is Y-up, so the
        // inversion below is required.
        const azimuth = azimuthRadForCanvasXMm(stone.xMm, canvasWidthMm);
        const clampedYMm = Math.max(0, Math.min(dimensions.bodyHeightMm, stone.yMm));
        const y = dimensions.bodyHeightMm - clampedYMm;
        // 2c (bottle): constant bodyRadiusMm, no interpolation. 2b (mug/tumbler): wallRadiusAt().
        const radius = dimensions.kind === 'bottle' ? dimensions.bodyRadiusMm : this._wallRadiusAt(y, dimensions);
        const sinAz = Math.sin(azimuth);
        const cosAz = Math.cos(azimuth);
        position.set(radius * sinAz, y, radius * cosAz);

        // Pure radial-normal approximation (ignores the small taper-induced tilt) -- §3.3's own
        // recommended cheap-first approximation, unchanged from the harness.
        normal.set(sinAz, 0, cosAz);
        qAlign.setFromUnitVectors(zAxis, normal);
        // Per-instance spin around the outward-normal axis reuses CrystalAppearance.js's own
        // seeded facetAngleDeg, exactly as the harness does.
        const appearance = getCrystalAppearance(stone);
        qSpin.setFromAxisAngle(zAxis, (appearance.facetAngleDeg * Math.PI) / 180);
        quaternion.copy(qAlign).multiply(qSpin);
      }

      const radiusMm = stone.sizeMm / 2;
      scaleV.setScalar(radiusMm);
      matrix.compose(position, quaternion, scaleV);
      this._stoneMesh.setMatrixAt(i, matrix);
      this._stoneMesh.setColorAt(i, new THREE.Color(getCrystalColor(stone.color).fill));
    }
    this._stoneMesh.instanceMatrix.needsUpdate = true;
    if (this._stoneMesh.instanceColor) this._stoneMesh.instanceColor.needsUpdate = true;

    // The body never carries a design texture -- stones live in their own instanced mesh, so the
    // body is simply tinted to the live cupColor.
    if (this._bodyMesh.material.map !== null) {
      this._bodyMesh.material.map = null;
      this._bodyMesh.material.needsUpdate = true;
    }
    this._bodyMesh.material.color.set(cupColor);
    if (this._handleMesh) this._handleMesh.material.color.set(cupColor);
    if (this._underMesh) this._underMesh.material.color.set(cupColor);
  }

  // Fits both the object's height and its full diameter inside the current viewport, accounting
  // for the panel's actual aspect ratio (the Object Preview panel is often portrait, not square --
  // framing on height alone left wide/short objects like the bottle's shoulder clipped left/right).
  _frameCamera() {
    const THREE = this._THREE;
    const { bodyRadiusMm, topRadiusMm, outerRadiusMm, totalHeightMm } = this._dimensions;
    // S-112: the plate's dims use outerRadiusMm (a flat disc has no body/top wall radius) --
    // bodyRadiusMm/topRadiusMm are simply absent from that dimensions object (see
    // ObjectDimensions.js's computeObjectDimensionsMm() plate branch), unlike every revolved-vessel
    // kind. Falling through to outerRadiusMm here keeps this the one shared framing function for
    // every object kind, matching every other kind's existing "framing needs only a radius and a
    // height" contract.
    const maxRadius = Math.max(bodyRadiusMm ?? outerRadiusMm, topRadiusMm || bodyRadiusMm || outerRadiusMm);

    const verticalFovRad = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 1;
    const distanceForHeight = (totalHeightMm / 2) / Math.tan(verticalFovRad / 2);
    const distanceForWidth = maxRadius / (Math.tan(verticalFovRad / 2) * aspect);
    const distance = Math.max(distanceForHeight, distanceForWidth, 40) * FRAME_MARGIN;
    this._objectDistance = distance;

    const target = new THREE.Vector3(0, totalHeightMm / 2, 0);
    this.controls.target.copy(target);

    const polarRad = this._dimensions.kind === 'plate' ? PLATE_DEFAULT_POLAR_RAD : DEFAULT_POLAR_RAD;
    const spherical = new THREE.Spherical(distance / this._zoom, polarRad, (this._azimuthDeg * Math.PI) / 180);
    const offset = new THREE.Vector3().setFromSpherical(spherical);
    this.camera.position.copy(target).add(offset);

    this.camera.near = Math.max(0.1, distance / 100);
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();

    this.controls.update();
    this.controls.saveState();
  }

  _repositionCamera() {
    if (!this._dimensions || !this._objectDistance) return;
    const THREE = this._THREE;
    const target = this.controls.target;
    const offset = new THREE.Vector3().copy(this.camera.position).sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta = (this._azimuthDeg * Math.PI) / 180;
    spherical.radius = this._objectDistance / this._zoom;
    spherical.makeSafe();
    const newOffset = new THREE.Vector3().setFromSpherical(spherical);
    this.camera.position.copy(target).add(newOffset);
    this.controls.update();
    this._requestRender();
  }

  // S-107: reads the camera's *actual* current azimuth back out of its position (the same
  // atan2(x,z)-based spherical convention _repositionCamera()/_frameCamera() write it with), so it
  // reflects reality regardless of whether it got there via setAzimuthDeg() or a manual
  // mouse/touch orbit OrbitControls applied directly to the camera.
  _currentAzimuthDeg() {
    const THREE = this._THREE;
    const offset = new THREE.Vector3().copy(this.camera.position).sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    return (spherical.theta * 180) / Math.PI;
  }

  // S-107: OrbitControls fires 'change' both for a real user drag/touch orbit AND as a side effect
  // of our own setAzimuthDeg()/_repositionCamera() writes (which call controls.update() to commit
  // the new position). Comparing the freshly-read azimuth against this._azimuthDeg -- which
  // setAzimuthDeg() always updates *before* touching the camera -- tells the two apart without any
  // extra flag: our own writes always already match by the time 'change' fires, so onAzimuthChange
  // only ever fires for a genuine, operator-driven orbit. This is what lets app.js keep the 2D
  // canvas's Front View Frame following a free mouse-drag rotation of the Object Preview.
  _onControlsChange() {
    if (!this._mounted || !this._dimensions) return;
    const current = this._currentAzimuthDeg();
    let delta = (current - this._azimuthDeg) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    if (Math.abs(delta) < 0.01) return;
    this._azimuthDeg = current;
    this._sliderAzimuthDeg = current;
    if (this.onAzimuthChange) this.onAzimuthChange(current);
  }
}
