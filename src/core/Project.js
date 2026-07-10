import { createLayer } from './Layer.js';

const CURRENT_PROJECT_VERSION = 1;
const SUPPORTED_UNITS = new Set(['mm']);

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

export class Project {
  constructor(input = {}) {
    assertObject(input, 'Project input');

    const units = input.units ?? 'mm';
    if (!SUPPORTED_UNITS.has(units)) {
      throw new Error(`Unsupported project units: ${units}. Rhinestone Studio currently stores projects in millimeters.`);
    }

    this.version = Number(input.version ?? CURRENT_PROJECT_VERSION);
    this.product = String(input.product ?? 'mug');
    this.units = units;
    this.canvas = normalizeCanvas(input.canvas);
    this.layers = [];

    const inputLayers = Array.isArray(input.layers) ? input.layers : [];
    inputLayers.forEach((layer) => this.addLayer(layer));
  }

  addLayer(layerInput) {
    const layer = createLayer(layerInput);
    if (this.layers.some((existing) => existing.id === layer.id)) {
      throw new Error(`Layer id already exists: ${layer.id}`);
    }
    this.layers.push(layer);
    return layer;
  }

  removeLayer(layerId) {
    const index = this.layers.findIndex((layer) => layer.id === layerId);
    if (index === -1) return null;
    const [removed] = this.layers.splice(index, 1);
    return removed;
  }

  getLayer(layerId) {
    return this.layers.find((layer) => layer.id === layerId) ?? null;
  }

  updateLayer(layerId, patch = {}) {
    assertObject(patch, 'Layer patch');
    const layer = this.getLayer(layerId);
    if (!layer) throw new Error(`Layer not found: ${layerId}`);

    if (patch.name !== undefined) layer.name = String(patch.name);
    if (patch.visible !== undefined) layer.visible = Boolean(patch.visible);
    if (patch.locked !== undefined) layer.locked = Boolean(patch.locked);
    if (patch.xMm !== undefined) layer.xMm = Number(patch.xMm);
    if (patch.yMm !== undefined) layer.yMm = Number(patch.yMm);
    if (patch.rotationDeg !== undefined) layer.rotationDeg = Number(patch.rotationDeg);
    if (patch.params !== undefined) layer.updateParams(patch.params);

    return layer;
  }

  duplicateLayer(layerId) {
    const layer = this.getLayer(layerId);
    if (!layer) throw new Error(`Layer not found: ${layerId}`);
    const duplicate = layer.clone();
    this.layers.push(duplicate);
    return duplicate;
  }

  moveLayer(layerId, newIndex) {
    const oldIndex = this.layers.findIndex((layer) => layer.id === layerId);
    if (oldIndex === -1) throw new Error(`Layer not found: ${layerId}`);

    const clampedIndex = Math.max(0, Math.min(Number(newIndex), this.layers.length - 1));
    const [layer] = this.layers.splice(oldIndex, 1);
    this.layers.splice(clampedIndex, 0, layer);
    return layer;
  }

  get visibleLayers() {
    return this.layers.filter((layer) => layer.visible);
  }

  validate() {
    const errors = [];

    if (this.units !== 'mm') errors.push('Project units must be mm.');
    if (!Number.isFinite(this.canvas.width) || this.canvas.width <= 0) errors.push('Canvas width must be positive.');
    if (!Number.isFinite(this.canvas.height) || this.canvas.height <= 0) errors.push('Canvas height must be positive.');

    const ids = new Set();
    for (const layer of this.layers) {
      if (ids.has(layer.id)) errors.push(`Duplicate layer id: ${layer.id}`);
      ids.add(layer.id);
      if (!layer.type) errors.push(`Layer ${layer.id} has no type.`);
    }

    return {
      ok: errors.length === 0,
      errors
    };
  }

  toJSON() {
    return {
      version: this.version,
      product: this.product,
      units: this.units,
      canvas: { ...this.canvas },
      layers: this.layers.map((layer) => layer.toJSON())
    };
  }

  toJSONString(space = 2) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  static fromJSON(json) {
    return new Project(json);
  }

  static fromJSONString(jsonString) {
    return new Project(JSON.parse(jsonString));
  }
}

function normalizeCanvas(canvas = {}) {
  const width = Number(canvas.width ?? 210);
  const height = Number(canvas.height ?? 90);
  return { width, height };
}

export { CURRENT_PROJECT_VERSION };
