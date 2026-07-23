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

import * as rsBlockPrototypeSS10 from './families/rsBlockPrototypeSS10.js';
import { createRhinestoneFontRegistry } from './RhinestoneFontRegistry.js';

/**
 * The registry every real (non-test) caller should use. TXT-101A restart: only the diagnostic-only
 * RS Block Prototype (SS10) family is registered here -- both prior full-coverage attempts (a shared
 * centerline skeleton; a from-scratch vector-outline rebuild) failed manual readability QA and were
 * removed; see families/rsBlockPrototypeSS10.js's module doc and this restart's final report. This
 * prototype is deliberately NOT registered in assets/fonts/manifest.json, so it never appears in the
 * normal font picker/Browse Fonts panel -- it is reachable only via direct code access (see
 * tools/generate-rs-block-prototype-qa-sheet.mjs), pending visual approval.
 *
 * A future family (including a fully-designed production RS Block once this prototype's approach is
 * approved) is added by creating a new families/*.js module in the same shape (descriptor +
 * getGlyphStoneMap + renderOptions) and adding it to this one array; nothing else in this list needs
 * to change.
 */
export function createDefaultRhinestoneFontRegistry() {
  return createRhinestoneFontRegistry([rsBlockPrototypeSS10]);
}
