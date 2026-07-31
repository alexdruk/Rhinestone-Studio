#!/usr/bin/env node
/**
 * FONT-GEN-001 -- Studio integration: registers accepted Sacramento Rhinestone variants in
 * assets/fonts/manifest.json as experimental, manually-selectable fonts (providerId 'opentype' --
 * real TTF files, loaded through the existing OpenTypeProvider path, same as every bundled desktop
 * font). Purely additive: never removes/disables existing entries (original Sacramento was never
 * registered here to begin with, so nothing to preserve there either), never changes how any other
 * font resolves. Idempotent -- re-running with the same size list updates those entries in place
 * rather than duplicating them.
 *
 * Usage:
 *   node tools/font-generator/register_studio_fonts.mjs SS6 SS10 SS16
 */
import { readFile, writeFile } from 'node:fs/promises';
import { repoPath } from '../font-certification/lib/repoPaths.mjs';

const MANIFEST_PATH = repoPath('assets/fonts/manifest.json');

const CONFIG_BY_SIZE = {
  SS6: { stoneDiameterMm: 2.0, gapMm: 0.3 },
  SS10: { stoneDiameterMm: 2.8, gapMm: 0.3 },
  SS16: { stoneDiameterMm: 4.0, gapMm: 0.3 },
  SS20: { stoneDiameterMm: 4.7, gapMm: 0.3 },
  SS30: { stoneDiameterMm: 6.4, gapMm: 0.3 }
};

function buildEntry(sizeUpper, validatedHeightRangeMm) {
  const sizeLower = sizeUpper.toLowerCase();
  const { stoneDiameterMm, gapMm } = CONFIG_BY_SIZE[sizeUpper];
  const [lo, hi] = validatedHeightRangeMm;
  return {
    id: `sacramento-rhinestone-${sizeLower}`,
    family: `Sacramento Rhinestone ${sizeUpper}`,
    style: 'Regular',
    weight: 400,
    path: `generated-fonts/${sizeUpper}/SacramentoRhinestone_${sizeUpper}.ttf`,
    role: 'rhinestone-experimental',
    enabled: true,
    providerId: 'opentype',
    notes: `FONT-GEN-001: procedurally-transformed Sacramento variant calibrated for ${stoneDiameterMm}mm stones (${gapMm}mm gap), validated readable at ${lo}-${hi}mm letter height. Experimental -- for visual A/B testing only, manual selection required (no automatic font switching on stone-size change). See docs/specifications/FONT-GEN-001-ProceduralSacramentoRhinestoneFamily.md.`
  };
}

async function main() {
  const sizes = process.argv.slice(2);
  if (sizes.length === 0) {
    console.error('Usage: node register_studio_fonts.mjs <SIZE...> e.g. SS6 SS10');
    process.exit(1);
  }

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  for (const sizeUpper of sizes) {
    if (!(sizeUpper in CONFIG_BY_SIZE)) throw new Error(`Unknown size: ${sizeUpper}`);

    const metaPath = repoPath(`generated-fonts/${sizeUpper}/summary.${sizeUpper}.json`);
    const summary = JSON.parse(await readFile(metaPath, 'utf8'));
    const heightRange = summary.heightsMm ? [summary.heightsMm.min, summary.heightsMm.max] : [null, null];

    const entry = buildEntry(sizeUpper, heightRange);
    const existingIndex = manifest.fonts.findIndex((f) => f.id === entry.id);
    if (existingIndex >= 0) {
      manifest.fonts[existingIndex] = entry;
    } else {
      manifest.fonts.push(entry);
    }
    console.log(`Registered ${entry.id} (${entry.family}) -- ${entry.path}`);
  }

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
