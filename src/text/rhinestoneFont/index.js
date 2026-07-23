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

import * as rsBlockPrototypeSS10 from './families/rsBlockPrototypeSS10.js';
import * as rsBlock from './families/rsBlock.js';
import { createRhinestoneFontRegistry } from './RhinestoneFontRegistry.js';

/**
 * The registry every real (non-test) caller should use. TXT-101B: registers the full-coverage
 * production family (RS Block, families/rsBlock.js) alongside the diagnostic-only RS Block
 * Prototype (SS10) it grew out of. Neither is registered in assets/fonts/manifest.json, so neither
 * appears in the normal font picker/Browse Fonts panel yet -- both are reachable only via direct
 * code access (see tools/generate-rs-block-qa-sheets.mjs), pending manual visual approval of the
 * completed alphabet.
 *
 * A future family is added by creating a new families/*.js module in the same shape (descriptor +
 * getGlyphStoneMap + renderOptions, optionally getKerningAdjustmentMm) and adding it to this one
 * array; nothing else in this list needs to change.
 */
export function createDefaultRhinestoneFontRegistry() {
  return createRhinestoneFontRegistry([rsBlockPrototypeSS10, rsBlock]);
}
