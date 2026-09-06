/**
 * FONT-PITCH-001 -- the authored Production Fonts (RS Block, RS Modern) place every stone on a fixed
 * 3.1mm grid (rsBlock.js / rsModern.js PITCH_MM). GeometryEngine then stamps each authored stone at
 * the layer's selected stoneSizeMm, so any catalog stone size wider than the grid pitch overlaps its
 * own neighbour -- a physical-spacing limit, not a readability one (docs/BACKLOG.md, the row closed
 * by this milestone).
 *
 * This suite proves the manifest's per-font `unsupportedStoneSizes` list is exactly the set of
 * catalog sizes that would overlap -- DERIVED here from the real authored glyph maps and kerning
 * tables, never hardcoded -- so a future glyph/pitch/kerning edit that changes the safe set fails
 * this test until the manifest is updated to match.
 *
 * It cannot and does not establish visual readability -- that is the QA sheets' job.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import {
  DEFAULT_STONE_SIZE_ID,
  STONE_SIZES,
  getStoneSize
} from '../src/renderer/StoneSizes.js';
import * as rsBlock from '../src/text/rhinestoneFont/families/rsBlock.js';
import * as rsModern from '../src/text/rhinestoneFont/families/rsModern.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

// Slice a function's full source (signature through its balanced closing brace) out of app.js --
// same technique as test-font-portfolio-001-stone-size-gating.mjs.
function sliceBalanced(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" in app.js`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces slicing "${startMarker}"`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// RS Block / RS Modern both document identical coverage: A-Z, a-z, 0-9, space, and . , ! ? ' - &
// (families/rsBlock.js descriptor.notes). getGlyphStoneMap() returns null for anything else.
const COVERED_CHARACTERS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'0123456789',
  ' ', '.', ',', '!', '?', "'", '-', '&'
];

// findOverlappingStonePairs() (src/geometry/StoneLayout.js) is the codebase's single definition of
// "two stones overlap": `distanceMm < (a.sizeMm + b.sizeMm) / 2 - 1e-9`. Exact tangency
// (distance === sum-of-radii) is NOT an overlap, and there is a 1e-9 mm slack. For two equal stones
// of diameter d that reduces to `centreDistance < d - OVERLAP_EPSILON_MM`, so a catalog size d is
// unsafe for an authored font iff `minCentreDistanceMm < d - OVERLAP_EPSILON_MM`.
const OVERLAP_EPSILON_MM = 1e-9;

/**
 * Minimum stone-centre-to-centre distance the family can ever produce, over:
 *   - the intra-glyph case (two stones within one authored glyph), and
 *   - every ordered glyph pair (a, b), with b's stones offset by
 *     a.advanceWidthMm + getKerningAdjustmentMm(a, b) -- exactly how
 *     GeometryEngine._buildLineContours() walks the pen position.
 */
function minCentreDistanceMm(family) {
  const { getGlyphStoneMap, getKerningAdjustmentMm } = family;
  const glyphs = new Map();
  for (const character of COVERED_CHARACTERS) {
    const glyph = getGlyphStoneMap(character);
    assert.ok(glyph, `expected authored glyph coverage for ${JSON.stringify(character)}`);
    if (glyph.stones.length > 0) glyphs.set(character, glyph);
  }

  let min = Infinity;

  // Intra-glyph.
  for (const glyph of glyphs.values()) {
    const { stones } = glyph;
    for (let i = 0; i < stones.length; i++) {
      for (let j = i + 1; j < stones.length; j++) {
        const d = Math.hypot(stones[i].xMm - stones[j].xMm, stones[i].yMm - stones[j].yMm);
        if (d < min) min = d;
      }
    }
  }

  // Every ordered glyph pair.
  for (const [a, glyphA] of glyphs) {
    for (const [b, glyphB] of glyphs) {
      const penBMm = glyphA.advanceWidthMm + getKerningAdjustmentMm(a, b);
      for (const sa of glyphA.stones) {
        for (const sb of glyphB.stones) {
          const d = Math.hypot(sa.xMm - (sb.xMm + penBMm), sa.yMm - sb.yMm);
          if (d < min) min = d;
        }
      }
    }
  }

  return min;
}

const FAMILIES = [
  { fontId: 'rs-block', module: rsBlock },
  { fontId: 'rs-modern', module: rsModern }
];

for (const { fontId, module } of FAMILIES) {
  await test(`${fontId}: manifest unsupportedStoneSizes is exactly the set of catalog sizes wider than the authored grid`, () => {
    const minDistMm = minCentreDistanceMm(module);
    assert.ok(Number.isFinite(minDistMm) && minDistMm > 0, `${fontId} min centre distance must be a positive finite number`);

    const manifestUnsupported = new Set(fontManager.getFont(fontId).unsupportedStoneSizes);

    const derivedUnsafe = [];
    const derivedSafe = [];
    for (const size of STONE_SIZES) {
      const wouldOverlap = minDistMm < size.diameterMm - OVERLAP_EPSILON_MM;
      if (wouldOverlap) {
        derivedUnsafe.push(size.id);
        assert.ok(
          manifestUnsupported.has(size.id),
          `${size.id} (${size.diameterMm}mm) overlaps the ${minDistMm.toFixed(3)}mm grid but is missing from ${fontId}'s unsupportedStoneSizes`
        );
      } else {
        derivedSafe.push(size.id);
        assert.ok(
          !manifestUnsupported.has(size.id),
          `${size.id} (${size.diameterMm}mm) fits the ${minDistMm.toFixed(3)}mm grid but ${fontId}'s unsupportedStoneSizes excludes it`
        );
      }
    }

    // No stale entries: every id the manifest lists must be a real catalog size this derivation
    // actually classified as unsafe.
    for (const id of manifestUnsupported) {
      assert.ok(
        derivedUnsafe.includes(id),
        `${fontId}'s unsupportedStoneSizes lists ${JSON.stringify(id)}, which the pitch derivation does not classify as overlapping`
      );
    }

    // The surviving safe set must be usable at all: non-empty and including the project default.
    assert.ok(derivedSafe.length > 0, `${fontId} must keep at least one usable stone size`);
    assert.ok(
      derivedSafe.includes(DEFAULT_STONE_SIZE_ID),
      `${fontId} must keep the default stone size ${DEFAULT_STONE_SIZE_ID} (${getStoneSize(DEFAULT_STONE_SIZE_ID).diameterMm}mm)`
    );
  });
}

// app.js can't import PITCH_MM (it must not reach into src/text/rhinestoneFont/families/), so the
// pitch appears as a bare literal in two user-facing strings. This test is the only thing keeping
// those literals honest: if PITCH_MM ever changes, or an editor "rounds" the copy, this fails.
await test('the pitch literal in app.js\'s authored-font messaging equals rsBlock.js / rsModern.js PITCH_MM', () => {
  assert.equal(
    rsBlock.PITCH_MM, rsModern.PITCH_MM,
    `RS Block and RS Modern PITCH_MM disagree (${rsBlock.PITCH_MM} vs ${rsModern.PITCH_MM}) -- this test assumes one shared authored pitch`
  );
  const pitchMm = rsBlock.PITCH_MM;

  // Each entry: the app.js function to slice, and a regex whose one capture group is the pitch
  // literal inside that function's authored-font string (anchored to the literal's own copy, so a
  // stray "3.1mm" in a nearby comment is never what gets matched).
  const literalSites = [
    {
      fn: 'function updateStoneSizePrintableCapabilityUI(){',
      label: 'updateStoneSizePrintableCapabilityUI() font-gate tooltip',
      re: /wider than \$\{font\.family\}'s fixed (\d+(?:\.\d+)?)mm stone grid/
    },
    {
      fn: 'async function updateStoneSizeOverlapCapabilityUI(){',
      label: 'updateStoneSizeOverlapCapabilityUI() authored-font warning',
      re: /places every stone on a fixed (\d+(?:\.\d+)?)mm grid/
    }
  ];

  for (const site of literalSites) {
    const fnSrc = sliceBalanced(appJs, site.fn);
    const match = fnSrc.match(site.re);
    assert.ok(match, `could not find the pitch literal in ${site.label} -- did the wording change?`);
    const literalMm = Number(match[1]);
    assert.equal(
      literalMm, pitchMm,
      `${site.label} says ${literalMm}mm but rsBlock.js / rsModern.js PITCH_MM is ${pitchMm}mm -- update the app.js string to match the authored pitch`
    );
  }
});

console.log('FONT-PITCH-001 authored-stone-size gating tests passed.');
