export {
  RhinestoneFontProvider,
  createRhinestoneFontProvider
} from './RhinestoneFontProvider.js';

export {
  RhinestoneFontRegistry,
  createRhinestoneFontRegistry
} from './RhinestoneFontRegistry.js';

export { SKELETON_SUPPORTED_CHARACTERS } from './skeletonGlyphs.js';

export { descriptor as rsBlockDescriptor, getGlyphStrokes as rsBlockGetGlyphStrokes, renderOptions as rsBlockRenderOptions } from './families/rsBlock.js';
export { descriptor as rsModernDescriptor, getGlyphStrokes as rsModernGetGlyphStrokes, renderOptions as rsModernRenderOptions } from './families/rsModern.js';
export { descriptor as rsScriptDescriptor, getGlyphStrokes as rsScriptGetGlyphStrokes, renderOptions as rsScriptRenderOptions } from './families/rsScript.js';

import * as rsBlock from './families/rsBlock.js';
import * as rsModern from './families/rsModern.js';
import * as rsScript from './families/rsScript.js';
import { createRhinestoneFontRegistry } from './RhinestoneFontRegistry.js';

/**
 * The registry every real (non-test) caller should use -- registers all three launch families.
 * A future family is added by creating a new families/*.js module in the same shape and adding it
 * to this one array; nothing else in this list needs to change.
 */
export function createDefaultRhinestoneFontRegistry() {
  return createRhinestoneFontRegistry([rsBlock, rsModern, rsScript]);
}
