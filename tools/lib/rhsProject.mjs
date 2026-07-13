/**
 * RS-2001: this file's implementation moved to src/gallery/RhsFixtureBridge.js so there is exactly
 * one `.rhs` fixture-schema bridge shared by the Node regression/benchmark suite and the browser
 * Gallery. This is now a thin re-export shim — no behavior change, no duplicate logic. See
 * src/gallery/RhsFixtureBridge.js for the implementation and full rationale.
 */
export * from '../../src/gallery/RhsFixtureBridge.js';
