/**
 * LibraryTransform — RS-1015.
 *
 * Pure functions over the live app's plain-object project/layer JSON (the same ad hoc shape
 * `#exportProject`/`validateProject()`/`duplicateLayer()` already use -- never `src/core/Project`/
 * `Layer`, which remain unused by the live app). Consumed only by `app.js`; no DOM, no
 * `GeometryEngine`/`StoneLayout` dependency, and no reinterpretation of any layer field -- geometry,
 * fill style, stone size, color, transforms, SVG source, Image Trace buffer, and boolean/path
 * contours all pass through unchanged.
 */

const INSERT_OFFSET_MM = 8;

function makeLayerId(type) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${type || 'layer'}${Date.now().toString(36)}${random}`;
}

function offsetLayerPosition(layer) {
  const copy = { ...layer };
  if (copy.type === 'circle') {
    copy.cx = (copy.cx ?? 0) + INSERT_OFFSET_MM;
    copy.cy = (copy.cy ?? 0) + INSERT_OFFSET_MM;
  } else {
    copy.x = (copy.x ?? 0) + INSERT_OFFSET_MM;
    copy.y = (copy.y ?? 0) + INSERT_OFFSET_MM;
  }
  return copy;
}

/**
 * Deep-clones layers with fresh ids and a small positional offset, so inserting a library item
 * into the current project never collides with an existing layer id or lands perfectly stacked on
 * top of one -- the same "clone, re-id, nudge" shape `app.js`'s `duplicateLayer()` already applies
 * to a single layer, generalized to a whole array. Layer ordering is preserved (array order).
 * @param {Array<object>} layers
 * @returns {Array<object>}
 */
export function prepareLayersForInsert(layers) {
  if (!Array.isArray(layers)) throw new TypeError('prepareLayersForInsert: layers must be an array.');
  return layers.map((layer) => offsetLayerPosition({
    ...JSON.parse(JSON.stringify(layer)),
    id: makeLayerId(layer.type)
  }));
}

/**
 * Resolves the raw (not yet re-id'd) layer array an item would insert -- 'project' items insert
 * their stored project's whole layer stack, 'selection' items insert their stored layers.
 * @param {object} item
 * @returns {Array<object>}
 */
export function getInsertableLayers(item) {
  if (!item || typeof item !== 'object') throw new TypeError('getInsertableLayers: item must be an object.');
  if (item.kind === 'project') return item.data.project.layers;
  if (item.kind === 'selection') return item.data.layers;
  throw new TypeError(`getInsertableLayers: unsupported item kind: ${item.kind}`);
}

/**
 * Builds a 'selection' library item's `data` payload from the currently-selected layers.
 * @param {Array<object>} layers
 * @param {{width:number,height:number}} canvas
 * @returns {{canvas:{width:number,height:number}, layers:Array<object>}}
 */
export function buildSelectionItemData(layers, canvas) {
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new TypeError('buildSelectionItemData: layers must be a non-empty array.');
  }
  if (!canvas || typeof canvas.width !== 'number' || typeof canvas.height !== 'number') {
    throw new TypeError('buildSelectionItemData: canvas must have numeric width/height.');
  }
  return {
    canvas: { width: canvas.width, height: canvas.height },
    layers: JSON.parse(JSON.stringify(layers))
  };
}

/**
 * Builds a 'project' library item's `data` payload from the whole live project object.
 * @param {object} project
 * @returns {{project:object}}
 */
export function buildProjectItemData(project) {
  if (!project || typeof project !== 'object') {
    throw new TypeError('buildProjectItemData: project must be an object.');
  }
  return { project: JSON.parse(JSON.stringify(project)) };
}

/**
 * Builds a full plain project object from a library item, for "New Project From This". For a
 * 'project' item this is an exact deep clone of the stored project -- geometry, transforms, canvas
 * size, product/cupColor/wrap, and layer order are reproduced identically, never offset or re-id'd,
 * since there is nothing in a brand-new project for it to collide with. For a 'selection' item, the
 * stored layers are wrapped in a fresh, default-shaped project sized to the item's own canvas.
 * Mirrors the exact project shape `defaultProject()`/`#importProjectFile` already produce -- never
 * a new schema.
 * @param {object} item
 * @param {{defaultProduct:string, defaultCupColor:string, defaultWrap:string, projectVersion:number}} defaults
 * @returns {object}
 */
export function buildProjectFromItem(item, defaults) {
  if (!item || typeof item !== 'object') throw new TypeError('buildProjectFromItem: item must be an object.');

  if (item.kind === 'project') {
    return JSON.parse(JSON.stringify(item.data.project));
  }

  if (item.kind === 'selection') {
    return {
      version: defaults.projectVersion,
      units: 'mm',
      name: item.name,
      product: defaults.defaultProduct,
      canvas: { ...item.data.canvas },
      cupColor: defaults.defaultCupColor,
      wrap: defaults.defaultWrap,
      layers: JSON.parse(JSON.stringify(item.data.layers))
    };
  }

  throw new TypeError(`buildProjectFromItem: unsupported item kind: ${item.kind}`);
}
