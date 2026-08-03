#!/usr/bin/env node
/**
 * TXT-104 step 1 -- derives capHeightRatio/xHeightRatio for the shipped OpenType production font
 * portfolio (Baloo 2, Anton, Sacramento, Dancing Script -- the providerId:'opentype',
 * rhinestoneValidated:true fonts app.js's productionFonts() actually offers), per
 * docs/specifications/TXT-104-TextHeightAccuracyDesign.md section 3.2/step 1.
 *
 * Measures the real, unmodified production font-loading path -- FontManager -> OpenTypeProvider
 * (src/fonts/index.js / src/text/index.js, the same barrel imports app.js uses), not a re-derived
 * glyph-parsing shortcut: renders one reference glyph per metric ('H' for cap height, 'x' for
 * x-height) via OpenTypeProvider.getTextPath() and reads its real GlyphMetrics.boundingBox -- the
 * exact bounding box Auto Fit/Fit-to-Shape/every other measurement in this codebase already trusts,
 * not a hand-rolled recomputation of glyph geometry.
 *
 * The reference heightMm passed to getTextPath() is each font's own unitsPerEm, read directly via
 * one small opentype.js metadata call (not a second measurement path -- just the one public field
 * getTextPath() itself already divides by internally, see OpenTypeProvider.js:183's
 * `unitsToMm = heightMm / font.unitsPerEm`). Per the design doc's own dimensionless-ratio argument,
 * capHeightRatio = boundingBox.heightMm / heightMm is reference-size-independent (unitsToMm is one
 * linear scalar) -- unitsPerEm is simply a convenient, deterministic reference choice, not a
 * correctness requirement.
 *
 * Fonts excluded from scope, deliberately:
 *   - the 8 legacy desktop OpenType fonts (courier-prime-regular, great-vibes-regular, etc.) --
 *     never rhinestoneValidated, hidden from the picker, not part of "the shipped portfolio" this
 *     milestone is about.
 *   - roboto-mono-regular -- a 14-byte non-font stub (see manifest.json's own note); would throw.
 *   - rs-block / rs-modern (providerId:'rhinestone') -- authored stone-center fonts with no
 *     OpenType em-box at all; heightMm is already a confirmed no-op for them (design doc section 1
 *     row 4/row 5) and must not receive these fields.
 *
 * Usage:
 *   node tools/measure-font-height-ratios.mjs           print measured ratios as a table, exit 0.
 *                                                        Does not touch manifest.json.
 *   node tools/measure-font-height-ratios.mjs --write    also update assets/fonts/manifest.json in
 *                                                        place with the measured
 *                                                        capHeightRatio/xHeightRatio (4 decimal
 *                                                        places) for each in-scope font.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import opentype from 'opentype.js';
import { FontManager } from '../src/fonts/index.js';
import { OpenTypeProvider } from '../src/text/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(repoRoot, 'assets/fonts/manifest.json');

async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/** Reads only the unitsPerEm metadata field directly -- not a second glyph-measurement path. */
async function readUnitsPerEm(relativePath) {
  const buffer = await loadFontBufferFromRepoRoot(relativePath);
  return opentype.parse(buffer).unitsPerEm;
}

/**
 * In-scope fonts: providerId:'opentype' AND rhinestoneValidated:true -- see module doc for why
 * this is exactly Baloo 2/Anton/Sacramento/Dancing Script and nothing else.
 */
function isInScope(font) {
  return font.providerId === 'opentype' && font.rhinestoneValidated === true;
}

export function roundRatio(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * @returns {Promise<Array<{id:string, family:string, unitsPerEm:number, capHeightRatio:number, xHeightRatio:number}>>}
 */
export async function measureFontHeightRatios() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const fontManager = new FontManager(manifest);
  const provider = new OpenTypeProvider({ fontManager, loadFontBuffer: loadFontBufferFromRepoRoot });

  const results = [];
  for (const font of fontManager.listFonts({ includeDisabled: true })) {
    if (!isInScope(font)) continue;

    const unitsPerEm = await readUnitsPerEm(font.path);
    const hResult = await provider.getTextPath({ fontId: font.id, text: 'H', heightMm: unitsPerEm });
    const xResult = await provider.getTextPath({ fontId: font.id, text: 'x', heightMm: unitsPerEm });

    results.push({
      id: font.id,
      family: font.family,
      unitsPerEm,
      capHeightRatio: hResult.metrics.boundingBox.heightMm / unitsPerEm,
      xHeightRatio: xResult.metrics.boundingBox.heightMm / unitsPerEm
    });
  }
  return results;
}

async function main() {
  const shouldWrite = process.argv.includes('--write');
  const results = await measureFontHeightRatios();

  console.log('id'.padEnd(28), 'family'.padEnd(18), 'capHeightRatio', 'xHeightRatio');
  for (const r of results) {
    console.log(
      r.id.padEnd(28),
      r.family.padEnd(18),
      roundRatio(r.capHeightRatio).toFixed(4).padEnd(14),
      roundRatio(r.xHeightRatio).toFixed(4)
    );
  }

  if (!shouldWrite) {
    console.log('\n(dry run -- pass --write to update assets/fonts/manifest.json)');
    return;
  }

  await writeRatiosInPlace(results);
  console.log(`\n[measure-font-height-ratios] wrote capHeightRatio/xHeightRatio for ${results.length} font(s) -> ${manifestPath}`);
}

/**
 * Inserts/updates capHeightRatio/xHeightRatio as two new lines directly after each font's existing
 * "notes" line, by text-splicing rather than JSON.stringify()-ing the whole manifest -- a full
 * re-serialize would reformat every other entry's own formatting choices (e.g. collapsing
 * `"unsupportedStoneSizes": ["ss30"]` onto multiple lines), producing unrelated diff noise. Every
 * font entry in this manifest already lists "notes" as its last field before the closing brace, so
 * this is a stable anchor. Idempotent: re-running with the same measurements is a no-op diff.
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

    // Drop any capHeightRatio/xHeightRatio line from a previous run so this stays idempotent
    // rather than duplicating fields on re-run.
    if (/^\s*"(capHeightRatio|xHeightRatio)":/.test(line)) continue;

    output.push(line);

    const measured = currentFontId ? byId.get(currentFontId) : null;
    const notesMatch = measured ? line.match(/^(\s*)"notes":\s*".*"\s*,?\s*$/) : null;
    if (notesMatch) {
      const [, indent] = notesMatch;
      // notes is always followed by at least capHeightRatio now, so it always needs a trailing
      // comma, regardless of whether it had one before (bare last-field vs. already-patched).
      // capHeightRatio is always followed by xHeightRatio (comma); xHeightRatio is always the
      // object's last field before the closing brace (no comma).
      output[output.length - 1] = line.replace(/,?\s*$/, ',');
      output.push(`${indent}"capHeightRatio": ${roundRatio(measured.capHeightRatio)},`);
      output.push(`${indent}"xHeightRatio": ${roundRatio(measured.xHeightRatio)}`);
      currentFontId = null; // each font's notes line appears exactly once
    }
  }

  await writeFile(manifestPath, output.join('\n'));
}

// Guards the CLI entrypoint so tests can `import` measureFontHeightRatios()/roundRatio() (see
// tools/test-font-height-ratios.mjs) without triggering main()'s console output or --write logic
// as an import side effect.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
