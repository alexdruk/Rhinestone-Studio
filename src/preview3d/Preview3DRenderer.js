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
import { drawStoneLayoutTexture, textureSizeForMm } from './StoneLayoutTexture.js';

const DEFAULT_ZOOM = 1;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const DEFAULT_POLAR_RAD = 1.3; // ~74.5 degrees from +Y (~15.5 degrees above the horizon) -- shows the object mostly from the side, not looking down into its open top
const MIN_POLAR_RAD = 0.05;
const MAX_POLAR_RAD = Math.PI - 0.05;
const FRAME_MARGIN = 1.25; // breathing room around the object when framing the "home" camera position

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
    this._textureCanvas = null;
    this._textureCtx = null;
    this._texture = null;
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

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe9eef5);

    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const directional = new THREE.DirectionalLight(0xffffff, 1.6);
    directional.position.set(60, 120, 90);
    this.scene.add(directional);

    this.controls = new orbitModule.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 5000;
    this.controls.minPolarAngle = MIN_POLAR_RAD;
    this.controls.maxPolarAngle = MAX_POLAR_RAD;
    this.controls.addEventListener('change', () => this._onControlsChange());

    this._resizeObserver = new ResizeObserver(() => this._handleResize());
    this._resizeObserver.observe(this.canvas.parentElement || this.canvas);

    this._mounted = true;
    this._handleResize();
    this._animate();
  }

  _animate() {
    if (!this._mounted) return;
    requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  _handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
   * @param {{cupColor:string, objectTemplate:object, canvasWidthMm:number, canvasHeightMm:number}} options
   *   S-109: no `wrap` option -- the object mesh's texture UV is wrap-mode independent (built once
   *   inside ObjectGeometryBuilder.js's buildObjectMesh(), at the object's true circumference
   *   scale), so this method no longer needs to react to wrap-mode changes at all. The Front View
   *   Frame (app.js) still visualizes the selected wrap mode's width on the 2D canvas, using
   *   ObjectDimensions.js's frontViewFrameWidthMm(), unchanged.
   */
  update(stoneLayout, { cupColor, objectTemplate, canvasWidthMm, canvasHeightMm }) {
    if (!this._mounted) return;

    const geometryKey = `${objectTemplate.id}:${canvasWidthMm}:${canvasHeightMm}`;
    const geometryChanged = geometryKey !== this._geometryKey;
    if (geometryChanged) {
      this._rebuildMesh(objectTemplate, canvasWidthMm, canvasHeightMm);
      this._geometryKey = geometryKey;
    }

    this._updateTexture(stoneLayout, canvasWidthMm, canvasHeightMm, cupColor);

    if (geometryChanged) this._frameCamera();
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
    if (this._mounted) this.controls.reset();
  }

  dispose() {
    this._mounted = false;
    this._resizeObserver?.disconnect();
    this.controls?.dispose();
    this._disposeGroup();
    this._texture?.dispose();
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

  _rebuildMesh(objectTemplate, canvasWidthMm, canvasHeightMm) {
    this._disposeGroup();
    const { group, bodyMesh, handleMesh, dimensions } = this._buildObjectMesh(objectTemplate, canvasWidthMm, canvasHeightMm);
    this._group = group;
    this._bodyMesh = bodyMesh;
    this._handleMesh = handleMesh;
    this._dimensions = dimensions;
    this.scene.add(group);
  }

  _updateTexture(stoneLayout, canvasWidthMm, canvasHeightMm, cupColor) {
    const THREE = this._THREE;
    if (!this._textureCanvas) {
      this._textureCanvas = document.createElement('canvas');
      this._textureCtx = this._textureCanvas.getContext('2d');
      this._texture = new THREE.CanvasTexture(this._textureCanvas);
      this._texture.wrapS = THREE.ClampToEdgeWrapping;
      this._texture.wrapT = THREE.ClampToEdgeWrapping;
      this._texture.generateMipmaps = false;
      this._texture.minFilter = THREE.LinearFilter;
      this._texture.colorSpace = THREE.SRGBColorSpace;
    }

    const { widthPx, heightPx } = textureSizeForMm(canvasWidthMm, canvasHeightMm);
    if (this._textureCanvas.width !== widthPx || this._textureCanvas.height !== heightPx) {
      this._textureCanvas.width = widthPx;
      this._textureCanvas.height = heightPx;
    }
    drawStoneLayoutTexture(this._textureCtx, stoneLayout, { widthMm: canvasWidthMm, heightMm: canvasHeightMm, backgroundColor: cupColor });
    this._texture.needsUpdate = true;

    if (this._bodyMesh.material.map !== this._texture) {
      this._bodyMesh.material.map = this._texture;
      this._bodyMesh.material.color.set(0xffffff);
      this._bodyMesh.material.needsUpdate = true;
    }
    if (this._handleMesh) {
      this._handleMesh.material.color.set(cupColor);
    }
  }

  // Fits both the object's height and its full diameter inside the current viewport, accounting
  // for the panel's actual aspect ratio (the Object Preview panel is often portrait, not square --
  // framing on height alone left wide/short objects like the bottle's shoulder clipped left/right).
  _frameCamera() {
    const THREE = this._THREE;
    const { bodyRadiusMm, topRadiusMm, totalHeightMm } = this._dimensions;
    const maxRadius = Math.max(bodyRadiusMm, topRadiusMm || bodyRadiusMm);

    const verticalFovRad = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect || 1;
    const distanceForHeight = (totalHeightMm / 2) / Math.tan(verticalFovRad / 2);
    const distanceForWidth = maxRadius / (Math.tan(verticalFovRad / 2) * aspect);
    const distance = Math.max(distanceForHeight, distanceForWidth, 40) * FRAME_MARGIN;
    this._objectDistance = distance;

    const target = new THREE.Vector3(0, totalHeightMm / 2, 0);
    this.controls.target.copy(target);

    const spherical = new THREE.Spherical(distance / this._zoom, DEFAULT_POLAR_RAD, (this._azimuthDeg * Math.PI) / 180);
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
