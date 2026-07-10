/**
 * Layer model for Rhinestone Studio.
 *
 * A Layer stores editable design intent only. It does not store generated
 * rhinestone positions. Stone positions are derived later by GeometryEngine.
 */

const SUPPORTED_LAYER_TYPES = new Set(['text', 'circle', 'rectangle', 'svg', 'manual']);

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function makeId(prefix = 'layer') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export class Layer {
  constructor(input = {}) {
    assertObject(input, 'Layer input');

    const type = input.type ?? 'text';
    if (!SUPPORTED_LAYER_TYPES.has(type)) {
      throw new Error(`Unsupported layer type: ${type}`);
    }

    this.id = String(input.id ?? makeId(type));
    this.type = type;
    this.name = String(input.name ?? this.defaultNameForType(type));
    this.visible = input.visible ?? true;
    this.locked = input.locked ?? false;

    this.xMm = Number(input.xMm ?? 0);
    this.yMm = Number(input.yMm ?? 0);
    this.rotationDeg = Number(input.rotationDeg ?? 0);

    this.params = structuredCloneSafe(input.params ?? {});
  }

  defaultNameForType(type) {
    switch (type) {
      case 'text': return 'Text';
      case 'circle': return 'Circle';
      case 'rectangle': return 'Rectangle';
      case 'svg': return 'SVG';
      case 'manual': return 'Manual Stones';
      default: return 'Layer';
    }
  }

  clone(overrides = {}) {
    return new Layer({
      ...this.toJSON(),
      id: overrides.id ?? makeId(this.type),
      name: overrides.name ?? `${this.name} Copy`,
      ...overrides,
      params: overrides.params ?? structuredCloneSafe(this.params)
    });
  }

  updateParams(partialParams = {}) {
    assertObject(partialParams, 'partialParams');
    this.params = {
      ...this.params,
      ...structuredCloneSafe(partialParams)
    };
    return this;
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    return this;
  }

  setLocked(locked) {
    this.locked = Boolean(locked);
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      visible: this.visible,
      locked: this.locked,
      xMm: this.xMm,
      yMm: this.yMm,
      rotationDeg: this.rotationDeg,
      params: structuredCloneSafe(this.params)
    };
  }

  static fromJSON(json) {
    return new Layer(json);
  }

  static get supportedTypes() {
    return [...SUPPORTED_LAYER_TYPES];
  }
}

export class TextLayer extends Layer {
  constructor(input = {}) {
    super({
      ...input,
      type: 'text',
      name: input.name ?? input.text ?? 'Text',
      params: {
        text: input.text ?? input.params?.text ?? 'Vitalina',
        font: input.font ?? input.params?.font ?? 'Courier Prime',
        mode: input.mode ?? input.params?.mode ?? 'centerline',
        heightMm: Number(input.heightMm ?? input.params?.heightMm ?? 18),
        stoneSizeMm: Number(input.stoneSizeMm ?? input.params?.stoneSizeMm ?? 2),
        gapMm: Number(input.gapMm ?? input.params?.gapMm ?? 0.3),
        color: input.color ?? input.params?.color ?? 'Crystal AB',
        autoFit: input.autoFit ?? input.params?.autoFit ?? true,
        ...(input.params ?? {})
      }
    });
  }
}

export class CircleLayer extends Layer {
  constructor(input = {}) {
    super({
      ...input,
      type: 'circle',
      name: input.name ?? 'Circle',
      params: {
        cxMm: Number(input.cxMm ?? input.params?.cxMm ?? 105),
        cyMm: Number(input.cyMm ?? input.params?.cyMm ?? 45),
        radiusMm: Number(input.radiusMm ?? input.params?.radiusMm ?? 15),
        mode: input.mode ?? input.params?.mode ?? 'outline',
        stoneSizeMm: Number(input.stoneSizeMm ?? input.params?.stoneSizeMm ?? 2),
        gapMm: Number(input.gapMm ?? input.params?.gapMm ?? 0.3),
        color: input.color ?? input.params?.color ?? 'Crystal AB',
        ...(input.params ?? {})
      }
    });
  }
}

export class RectangleLayer extends Layer {
  constructor(input = {}) {
    super({
      ...input,
      type: 'rectangle',
      name: input.name ?? 'Rectangle',
      params: {
        xMm: Number(input.rectXMm ?? input.params?.xMm ?? 70),
        yMm: Number(input.rectYMm ?? input.params?.yMm ?? 30),
        widthMm: Number(input.widthMm ?? input.params?.widthMm ?? 70),
        heightMm: Number(input.heightMm ?? input.params?.heightMm ?? 25),
        mode: input.mode ?? input.params?.mode ?? 'outline',
        stoneSizeMm: Number(input.stoneSizeMm ?? input.params?.stoneSizeMm ?? 2),
        gapMm: Number(input.gapMm ?? input.params?.gapMm ?? 0.3),
        color: input.color ?? input.params?.color ?? 'Crystal AB',
        ...(input.params ?? {})
      }
    });
  }
}

export function createLayer(input = {}) {
  const type = input.type ?? 'text';
  if (type === 'text') return new TextLayer(input);
  if (type === 'circle') return new CircleLayer(input);
  if (type === 'rectangle') return new RectangleLayer(input);
  return new Layer(input);
}

function structuredCloneSafe(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
