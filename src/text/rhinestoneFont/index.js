export {
  RhinestoneFontProvider,
  createRhinestoneFontProvider
} from './RhinestoneFontProvider.js';

export {
  RhinestoneFontRegistry,
  createRhinestoneFontRegistry
} from './RhinestoneFontRegistry.js';

export {
  descriptor as rsBlockPrototypeSS10Descriptor,
  getGlyphStoneMap as rsBlockPrototypeSS10GetGlyphStoneMap,
  PITCH_MM as RS_BLOCK_PROTOTYPE_SS10_PITCH_MM
} from './families/rsBlockPrototypeSS10.js';

export {
  descriptor as rsBlockDescriptor,
  getGlyphStoneMap as rsBlockGetGlyphStoneMap,
  getKerningAdjustmentMm as rsBlockGetKerningAdjustmentMm,
  PITCH_MM as RS_BLOCK_PITCH_MM
} from './families/rsBlock.js';

export {
  descriptor as rsModernDescriptor,
  getGlyphStoneMap as rsModernGetGlyphStoneMap,
  getKerningAdjustmentMm as rsModernGetKerningAdjustmentMm,
  PITCH_MM as RS_MODERN_PITCH_MM
} from './families/rsModern.js';

import * as rsBlockPrototypeSS10 from './families/rsBlockPrototypeSS10.js';
import * as rsBlock from './families/rsBlock.js';
import * as rsModern from './families/rsModern.js';
import { createRhinestoneFontRegistry } from './RhinestoneFontRegistry.js';

/**
 * The registry every real (non-test) caller should use. Registers both production Production Fonts
 * (RS Block, families/rsBlock.js; RS Modern, families/rsModern.js, added in FONT-002) alongside the
 * diagnostic-only RS Block Prototype (SS10) RS Block grew out of. The prototype is not registered in
 * assets/fonts/manifest.json, so it never appears in the normal font picker/Browse Fonts panel --
 * reachable only via direct code access (see tools/generate-rs-block-qa-sheets.mjs).
 *
 * A future family is added by creating a new families/*.js module in the same shape (descriptor +
 * getGlyphStoneMap + renderOptions, optionally getKerningAdjustmentMm) and adding it to this one
 * array; nothing else in this list needs to change.
 */
export function createDefaultRhinestoneFontRegistry() {
  return createRhinestoneFontRegistry([rsBlockPrototypeSS10, rsBlock, rsModern]);
}
