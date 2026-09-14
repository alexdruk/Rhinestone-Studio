#!/usr/bin/env node
/**
 * READ-003 step 1 -- derives a dimensionless `stemWidthRatio` for every enabled OpenType production
 * font. This is the first milestone of the layered readability program: Layer 1 is the set of
 * geometric-impossibility checks that need no recognition model, and "a font's stroke is narrower
 * than one stone" is the clearest such case.
 *
 * ## Why this exists
 *
 * When a font's dominant stroke is narrower than one stone diameter the stone physically overhangs
 * the stroke on both sides, and no sampling algorithm can render that legibly -- it is a geometric
 * fact, not a quality judgement. `stemWidthRatio = stemWidthMm / referenceHeightMm` lets app.js
 * compute the stroke width at the layer's current height with an O(1) multiply
 * (`font.stemWidthRatio * layer.height`) and compare it to the stone diameter, with no runtime
 * geometry.
 *
 * ## Method (mirrors tools/measure-font-height-ratios.mjs's structure -- exported measure function
 *    + guarded CLI entrypoint so tests can import it without side effects)
 *
 * For each font, at a single reference height:
 *   1. `GeometryEngine.resolveTextPolygons()` -- the REAL production font path
 *      (FontManager -> OpenTypeProvider -> VectorPath -> flattened polygons), the same outline every
 *      Boolean Operation / Auto-Fit measurement in this codebase already trusts -- is called once
 *      per glyph in `PRODUCTION_REVIEW_GLYPHS` (A-Za-z0-9, 62 glyphs). A per-glyph call (rather than
 *      one call on a whole word) keeps inter-glyph advance gaps from ever being mistaken for a
 *      stroke, and stops the statistic being biased by whichever letters a sample word happens to
 *      contain.
 *   2. The glyph interior is sampled on a fixed grid. A scanline pass pairs edge crossings even-odd
 *      -- the identical fill rule `StoneSampler.isPointInsidePolygons()` applies point-by-point
 *      (counters/holes correctly excluded), just amortised across each row -- and a per-font
 *      spot-check confirms the two agree (they do for every bundled face).
 *   3. For each interior point, the distance to the nearest polygon edge is found; twice that
 *      distance is the local stroke width there. A point mid-stem sits stroke/2 from each side, so
 *      2*d recovers the stroke; a point in a bowl or at a stem junction sits further from any edge
 *      and yields a larger local width.
 *   4. All local widths for the font (pooled across all 62 glyphs) are reduced to one number by a
 *      percentile -- see the percentile discussion below.
 *
 * ## Which percentile, and why p75
 *
 * The local-width distribution has a long thin tail at BOTH ends:
 *   - low tail: serif tips, stroke terminals, the wedge where two strokes meet -- real ink, but not
 *     what the eye uses to read the letter. The **median is dragged down** by these on seriffed and
 *     script faces.
 *   - high tail: bowl walls seen broadside, diagonal-stroke crossings (x, X), stem junctions (B, R,
 *     g). The **maximum lands in these** and measures the fattest blob in the letter, not its stem.
 *
 * p75 is the "dominant stem the eye reads": above the terminal/join noise, below the bowl/junction
 * blobs. It is the percentile the original READ-003 investigation used and it reproduces the three
 * validation anchors (see the write-up printed by `--report`, and tools/test-read-003-stem-width.mjs):
 *
 *   | case                     | stem width | stone | ratio (stem/stone) | ranks |
 *   |--------------------------|-----------|-------|--------------------|-------|
 *   | Cinzel @ 56mm, SS16      | 2.12mm    | 4.0mm | 0.53  (unreadable) | thinnest |
 *   | Caveat @ 55mm, SS16      | 2.50mm    | 4.0mm | 0.63  (unreadable) | middle |
 *   | Anton  @ 36.52mm, SS6    | 4.37mm    | 2.0mm | 2.19  (confirmed good) | thickest |
 *
 * p50 and p90 are also reported (they rank the three anchors correctly too, but p50 under-reads the
 * absolute widths on script faces and p90 over-reads them on any face with a prominent bowl).
 *
 * ## Reference-height independence
 *
 * `stemWidthRatio` is dimensionless: every vertex `resolveTextPolygons()` returns scales linearly
 * with `heightMm` (one `unitsToMm` scalar, exactly as in measure-font-height-ratios.mjs), so both
 * `stemWidthMm` and `referenceHeightMm` scale together and the ratio is invariant. This is verified
 * empirically -- `measureFontStemWidthRatios()` is run at two reference heights and the ratios are
 * asserted equal to 3 decimal places (see tools/test-read-003-stem-width.mjs test 3), not merely
 * assumed from the code looking linear.
 *
 * ## Scope
 *
 * Every `enabled`, effectively-`providerId:'opentype'` font in assets/fonts/manifest.json -- all 29.
 * Deliberately WIDER than TXT-104's 4 `rhinestoneValidated` fonts: FONT-LIB-002 opened the picker to
 * the whole library, so the whole library needs this check. Excluded, by design:
 *   - `providerId:'rhinestone'` (RS Block / RS Modern) -- authored stone centres, no vector outline;
 *     `resolveTextPolygons()` throws for them (asserted in the test). `stemWidthRatio` must not be
 *     written for them, exactly like `capHeightRatio`.
 *   - the disabled `roboto-mono-regular` stub (a 14-byte non-font).
 *
 * ## Runtime
 *
 * Interior grid sampling over 62 glyphs x 29 fonts is not fast, but this is an offline tool. A full
 * `--write` run is ~1-2 min on the reference machine; `--report` (also measures + prints percentiles)
 * is the same. If a future change pushes it materially past that, say so rather than shipping a tool
 * nobody will re-run.
 *
 * ## Usage
 *   node tools/measure-font-stem-width.mjs            print measured ratios as a table, exit 0.
 *                                                     Does not touch manifest.json.
 *   node tools/measure-font-stem-width.mjs --report   also print the full p50/p75/p90 write-up and
 *                                                     the three validation anchors.
 *   node tools/measure-font-stem-width.mjs --write     update assets/fonts/manifest.json in place
 *                                                     with the measured stemWidthRatio (4 dp) for
 *                                                     each in-scope font. Touches no other field.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { isPointInsidePolygons } from '../src/geometry/StoneSampler.js';
import { PRODUCTION_REVIEW_GLYPHS } from './font-certification/lib/requiredCharacters.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(repoRoot, 'assets/fonts/manifest.json');

// One reference height for the offline measurement. Any positive value gives the same ratio (the
// tool proves this); 100mm keeps the flattened-polygon vertex density and the grid arithmetic in a
// comfortable numeric range.
export const REFERENCE_HEIGHT_MM = 100;

// Grid pitch for interior sampling, as a fraction of the reference height. ~0.35mm at 100mm gives
// >=5 samples across even the thinnest anchor stem (Cinzel, ~2.1mm), which is enough for a stable
// p75; finer than this only slows the tool without moving the ratios.
const GRID_STEP_FRACTION = 0.0035;

// The percentile of the pooled local-width distribution taken as the font's representative stem
// width. See the module doc for why p75.
export const STEM_WIDTH_PERCENTILE = 0.75;

async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * In-scope: enabled AND resolves through the OpenType provider. FontManager already defaults a
 * record with no explicit providerId to 'opentype', so this is every enabled font except RS Block /
 * RS Modern (providerId:'rhinestone') and the disabled roboto-mono stub.
 */
export function isInScope(font) {
  return font.enabled === true && font.providerId === 'opentype';
}

export function roundRatio(n) {
  return Math.round(n * 10000) / 10000;
}

/** Linear-interpolated percentile of an unsorted numeric array (fraction in [0,1]). */
export function percentile(values, fraction) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = fraction * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function distancePointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Flatten every contour into a flat array of edge segments [ax,ay,bx,by]. */
function segmentsFromPolygons(polygons) {
  const segments = [];
  for (const contour of polygons) {
    const n = contour.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % n];
      segments.push([a.xMm, a.yMm, b.xMm, b.yMm]);
    }
  }
  return segments;
}

/**
 * Uniform grid (flat array, integer-indexed off the glyph bounding box -- no Map, no string keys)
 * bucketing the edge segments, so a nearest-edge query only tests segments in the candidate's
 * neighbourhood. `cellMm` is a couple of mm: a short flattened segment lands in one or two cells,
 * and a stem-interior query resolves in the first ring or two.
 */
function buildSegmentGrid(segments, boundingBox, cellMm) {
  const originX = boundingBox.minXmm;
  const originY = boundingBox.minYmm;
  const cols = Math.max(1, Math.ceil(boundingBox.widthMm / cellMm) + 1);
  const rows = Math.max(1, Math.ceil(boundingBox.heightMm / cellMm) + 1);
  const buckets = new Array(cols * rows);
  const col = (x) => { const c = Math.floor((x - originX) / cellMm); return c < 0 ? 0 : c >= cols ? cols - 1 : c; };
  const row = (y) => { const r = Math.floor((y - originY) / cellMm); return r < 0 ? 0 : r >= rows ? rows - 1 : r; };
  for (const seg of segments) {
    const minCx = col(Math.min(seg[0], seg[2]));
    const maxCx = col(Math.max(seg[0], seg[2]));
    const minCy = row(Math.min(seg[1], seg[3]));
    const maxCy = row(Math.max(seg[1], seg[3]));
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const idx = cy * cols + cx;
        (buckets[idx] || (buckets[idx] = [])).push(seg);
      }
    }
  }
  return { buckets, cols, rows, originX, originY, cellMm };
}

function nearestEdgeDistance(px, py, grid) {
  const { buckets, cols, rows, originX, originY, cellMm } = grid;
  const baseCx = Math.floor((px - originX) / cellMm);
  const baseCy = Math.floor((py - originY) / cellMm);
  let best = Infinity;
  const maxRing = cols + rows;
  for (let ring = 0; ring <= maxRing; ring++) {
    // Every segment in a cell whose nearest point is >= (ring-1)*cellMm away has already been
    // beaten; once the closed rings guarantee that, stop.
    if (best !== Infinity && (ring - 1) * cellMm > best) break;
    const loY = baseCy - ring, hiY = baseCy + ring;
    const loX = baseCx - ring, hiX = baseCx + ring;
    for (let cy = loY; cy <= hiY; cy++) {
      if (cy < 0 || cy >= rows) continue;
      const yEdge = cy === loY || cy === hiY;
      for (let cx = loX; cx <= hiX; cx++) {
        if (cx < 0 || cx >= cols) continue;
        if (!yEdge && cx !== loX && cx !== hiX) continue; // ring shell only
        const bucket = buckets[cy * cols + cx];
        if (!bucket) continue;
        for (let s = 0; s < bucket.length; s++) {
          const seg = bucket[s];
          const d = distancePointToSegment(px, py, seg[0], seg[1], seg[2], seg[3]);
          if (d < best) best = d;
        }
      }
    }
  }
  return best;
}

/**
 * Row-by-row (scanline) enumeration of the grid points that fall inside `polygons`.
 *
 * Per row, every non-horizontal edge crossing the scanline is collected, sorted by x, and paired
 * even-odd -- the identical fill rule StoneSampler.isPointInsidePolygons() applies point-by-point,
 * just amortised across the row so the O(vertex) test is not re-run for every cell of the bounding
 * box. `assertScanlineMatchesEvenOdd()` below spot-checks that this really does agree with the
 * codebase primitive on every font (it does: all 29 bundled OpenType faces have properly nested,
 * non-self-overlapping contours, so even-odd and non-zero winding coincide).
 */
function interiorGridPoints(polygons, boundingBox, stepMm) {
  const edges = [];
  for (const contour of polygons) {
    const n = contour.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % n];
      if (a.yMm === b.yMm) continue; // horizontal edge contributes no scanline crossing
      edges.push([a.xMm, a.yMm, b.xMm, b.yMm]);
    }
  }
  const points = [];
  const x0 = boundingBox.minXmm + stepMm / 2;
  for (let y = boundingBox.minYmm + stepMm / 2; y < boundingBox.maxYmm; y += stepMm) {
    const crossings = [];
    for (const e of edges) {
      const [ax, ay, bx, by] = e;
      const yMin = ay < by ? ay : by;
      const yMax = ay < by ? by : ay;
      if (y < yMin || y >= yMax) continue; // half-open: no double count at shared vertices
      const t = (y - ay) / (by - ay);
      crossings.push(ax + t * (bx - ax));
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const spanStart = crossings[k];
      const spanEnd = crossings[k + 1];
      let x = x0 + Math.ceil((spanStart - x0) / stepMm) * stepMm;
      for (; x < spanEnd; x += stepMm) points.push({ xMm: x, yMm: y });
    }
  }
  return points;
}

/**
 * Cross-check a sample of the scanline interior points against StoneSampler.isPointInsidePolygons()
 * -- the sampler's own even-odd predicate -- and throw if they disagree on more than `tolerance` of
 * the sample. Guards against a font whose contours would need a different fill rule (none of the 29
 * bundled faces do), so the tool fails loudly rather than silently measuring the wrong ink set.
 */
function assertScanlineMatchesEvenOdd(fontId, glyph, polygons, points, { sampleSize = 400, tolerance = 0.01 } = {}) {
  if (points.length === 0) return;
  const stride = Math.max(1, Math.floor(points.length / sampleSize));
  let checked = 0;
  let mismatches = 0;
  for (let i = 0; i < points.length; i += stride) {
    checked += 1;
    if (!isPointInsidePolygons(points[i], polygons)) mismatches += 1;
  }
  if (mismatches / checked > tolerance) {
    throw new Error(
      `measure-font-stem-width: scanline interior set for "${fontId}" glyph "${glyph}" disagrees with ` +
      `isPointInsidePolygons() on ${mismatches}/${checked} sampled points -- this font needs a different fill rule.`
    );
  }
}

/**
 * Local stroke widths (mm) sampled across every glyph in PRODUCTION_REVIEW_GLYPHS for one font, at
 * `referenceHeightMm`. Pooled -- one flat array for the whole font.
 */
export async function measureLocalStrokeWidths(engine, font, referenceHeightMm) {
  const stepMm = referenceHeightMm * GRID_STEP_FRACTION;
  const widths = [];
  for (const glyph of PRODUCTION_REVIEW_GLYPHS) {
    let result;
    try {
      result = await engine.resolveTextPolygons({
        text: glyph,
        fontId: font.id,
        providerId: font.providerId,
        layerId: 'read-003-stem-measure',
        heightMm: referenceHeightMm
      });
    } catch {
      continue; // a glyph the font genuinely cannot render -- skip, don't abort the font
    }
    const { polygons, boundingBox } = result;
    if (!boundingBox || polygons.length === 0) continue;

    const segments = segmentsFromPolygons(polygons);
    if (segments.length === 0) continue;
    const grid = buildSegmentGrid(segments, boundingBox, Math.max(referenceHeightMm * 0.02, 1));

    const interior = interiorGridPoints(polygons, boundingBox, stepMm);
    assertScanlineMatchesEvenOdd(font.id, glyph, polygons, interior);
    for (const point of interior) {
      const d = nearestEdgeDistance(point.xMm, point.yMm, grid);
      if (Number.isFinite(d)) widths.push(2 * d);
    }
  }
  return widths;
}

/**
 * @param {object} [options]
 * @param {number} [options.referenceHeightMm] override the reference height (used by the
 *   reference-height-independence test).
 * @returns {Promise<Array<{id:string, family:string, style:string, sampleCount:number,
 *   p50:number, p75:number, p90:number, stemWidthMm:number, stemWidthRatio:number}>>}
 */
export async function measureFontStemWidthRatios({ referenceHeightMm = REFERENCE_HEIGHT_MM } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const fontManager = new FontManager(manifest);
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: loadFontBufferFromRepoRoot
  });
  const engine = new GeometryEngine({ fontProviderRegistry });

  const results = [];
  for (const font of fontManager.listFonts({ includeDisabled: true })) {
    if (!isInScope(font)) continue;

    const widths = await measureLocalStrokeWidths(engine, font, referenceHeightMm);
    const p75 = percentile(widths, STEM_WIDTH_PERCENTILE);
    results.push({
      id: font.id,
      family: font.family,
      style: font.style,
      sampleCount: widths.length,
      p50: percentile(widths, 0.5),
      p75,
      p90: percentile(widths, 0.9),
      stemWidthMm: p75,
      stemWidthRatio: p75 / referenceHeightMm
    });
  }
  return results;
}

// --- validation anchors from the READ-003 investigation ---
const ANCHORS = [
  { id: 'cinzel-regular', heightMm: 56, stoneMm: 4.0, reportedStemMm: 2.12 },
  { id: 'caveat-regular', heightMm: 55, stoneMm: 4.0, reportedStemMm: 2.50 },
  { id: 'anton-regular', heightMm: 36.52, stoneMm: 2.0, reportedStemMm: 4.37 }
];

function printReport(results) {
  const byId = new Map(results.map((r) => [r.id, r]));
  console.log('\n=== READ-003 stem-width percentile write-up ===\n');
  console.log('Reference height for measurement:', REFERENCE_HEIGHT_MM, 'mm');
  console.log('Glyph set: PRODUCTION_REVIEW_GLYPHS (' + PRODUCTION_REVIEW_GLYPHS.length + ' glyphs)\n');
  console.log(
    'id'.padEnd(26),
    'p50/refH'.padEnd(10),
    'p75/refH'.padEnd(10),
    'p90/refH'.padEnd(10),
    'samples'
  );
  for (const r of results) {
    console.log(
      r.id.padEnd(26),
      roundRatio(r.p50 / REFERENCE_HEIGHT_MM).toFixed(4).padEnd(10),
      roundRatio(r.p75 / REFERENCE_HEIGHT_MM).toFixed(4).padEnd(10),
      roundRatio(r.p90 / REFERENCE_HEIGHT_MM).toFixed(4).padEnd(10),
      r.sampleCount
    );
  }

  console.log('\n--- Validation anchors (chosen statistic: p75) ---\n');
  console.log(
    'case'.padEnd(22),
    'reported'.padEnd(10),
    'p50'.padEnd(9),
    'p75'.padEnd(9),
    'p90'.padEnd(9),
    'p75 err'.padEnd(9),
    'stem/stone (p75)'
  );
  const p75Ratios = [];
  for (const anchor of ANCHORS) {
    const r = byId.get(anchor.id);
    if (!r) { console.log(anchor.id, 'NOT IN SCOPE'); continue; }
    const p50mm = (r.p50 / REFERENCE_HEIGHT_MM) * anchor.heightMm;
    const p75mm = (r.p75 / REFERENCE_HEIGHT_MM) * anchor.heightMm;
    const p90mm = (r.p90 / REFERENCE_HEIGHT_MM) * anchor.heightMm;
    const err = (p75mm - anchor.reportedStemMm) / anchor.reportedStemMm;
    p75Ratios.push({ id: anchor.id, stemOverStone: p75mm / anchor.stoneMm });
    console.log(
      `${anchor.id} @ ${anchor.heightMm}mm`.padEnd(22),
      `${anchor.reportedStemMm.toFixed(2)}mm`.padEnd(10),
      `${p50mm.toFixed(2)}mm`.padEnd(9),
      `${p75mm.toFixed(2)}mm`.padEnd(9),
      `${p90mm.toFixed(2)}mm`.padEnd(9),
      `${(err * 100).toFixed(1)}%`.padEnd(9),
      (p75mm / anchor.stoneMm).toFixed(2)
    );
  }
  const ranked = p75Ratios.every((r, i) => i === 0 || p75Ratios[i - 1].stemOverStone < r.stemOverStone);
  console.log('\nAnchors rank Cinzel < Caveat < Anton by stem/stone (p75):', ranked ? 'YES' : 'NO');
}

async function main() {
  const shouldWrite = process.argv.includes('--write');
  const shouldReport = process.argv.includes('--report');
  const t0 = Date.now();
  const results = await measureFontStemWidthRatios();
  const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('id'.padEnd(26), 'family'.padEnd(18), 'stemWidthRatio');
  for (const r of results) {
    console.log(r.id.padEnd(26), r.family.padEnd(18), roundRatio(r.stemWidthRatio).toFixed(4));
  }
  console.log(`\n[measure-font-stem-width] measured ${results.length} font(s) in ${elapsedS}s`);

  if (shouldReport) printReport(results);

  if (!shouldWrite) {
    console.log('\n(dry run -- pass --write to update assets/fonts/manifest.json)');
    return;
  }

  await writeRatiosInPlace(results);
  console.log(`\n[measure-font-stem-width] wrote stemWidthRatio for ${results.length} font(s) -> ${manifestPath}`);
}

/**
 * Splice `stemWidthRatio` in as one new line after each in-scope font's last existing field, by text
 * editing rather than JSON.stringify()-ing the whole manifest (a full re-serialize would reformat
 * every other entry). Idempotent: an existing stemWidthRatio line is dropped and rewritten.
 *
 * The anchor is the entry's final field before its closing `}` -- for the four TXT-104 fonts that is
 * `xHeightRatio`, for every other in-scope font it is `notes`. Both are matched.
 */
async function writeRatiosInPlace(results) {
  const original = await readFile(manifestPath, 'utf8');
  const lines = original.split('\n');
  const byId = new Map(results.map((r) => [r.id, r]));
  let currentFontId = null;

  const output = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idMatch = line.match(/^\s*"id":\s*"([^"]+)",?\s*$/);
    if (idMatch) currentFontId = idMatch[1];

    // Drop any stemWidthRatio line from a previous run so re-running stays a no-op diff.
    if (/^\s*"stemWidthRatio":/.test(line)) continue;

    const measured = currentFontId ? byId.get(currentFontId) : null;
    // The in-scope entry's last field is xHeightRatio when present, else notes.
    const lastFieldMatch = measured
      ? line.match(/^(\s*)"(xHeightRatio|notes)":\s*.*?\s*,?\s*$/)
      : null;
    // Look past a stemWidthRatio line left by a previous run (already `continue`d above) so re-running
    // still recognises this as the entry's last real field and stays a no-op diff.
    let j = i + 1;
    while (j < lines.length && /^\s*"stemWidthRatio":/.test(lines[j])) j += 1;
    const nextIsClosingBrace = /^\s*\}\s*,?\s*$/.test(lines[j] ?? '');

    output.push(line);

    if (lastFieldMatch && nextIsClosingBrace) {
      const indent = lastFieldMatch[1];
      output[output.length - 1] = line.replace(/,?\s*$/, ',');
      output.push(`${indent}"stemWidthRatio": ${roundRatio(measured.stemWidthRatio)}`);
      currentFontId = null;
    }
  }

  await writeFile(manifestPath, output.join('\n'));
}

// Guards the CLI entrypoint so tools/test-read-003-stem-width.mjs can import the measure functions
// without triggering main()'s output or --write.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
