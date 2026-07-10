/**
 * RS-0003.5B2 — proves the permanent text/geometry dependency graph resolves
 * in the browser, without using any of it live. Importing `OpenTypeProvider`
 * here is what forces its `opentype.js` bare import to resolve through the
 * browser import map; nothing in this file instantiates, renders, or
 * mutates anything.
 */
import { OpenTypeProvider } from '../text/index.js';
import { FontManager } from '../fonts/index.js';
import * as permanentTextModule from '../text/index.js';
import * as permanentGeometryModule from '../geometry/index.js';

export function getBrowserDependencyProbeStatus() {
  return Object.freeze({
    openTypeProviderImported: typeof OpenTypeProvider === 'function',
    fontManagerImported: typeof FontManager === 'function',
    textModuleImported: Object.keys(permanentTextModule).length > 0,
    geometryModuleImported: Object.keys(permanentGeometryModule).length > 0
  });
}
