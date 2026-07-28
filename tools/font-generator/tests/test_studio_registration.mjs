#!/usr/bin/env node
/**
 * FONT-GEN-001 focused test -- Studio registration + representative rendering smoke test.
 *
 * Exercises the exact same path app.js uses at startup (FontManager.fromUrl -> FontProviderRegistry
 * with OpenTypeProvider -> GeometryEngine.generateTextLayout()) against the real, on-disk
 * assets/fonts/manifest.json, for every accepted Sacramento Rhinestone entry. This is the closest
 * available proxy for "loads in Rhinestone Studio" / "successful production-layout generation" in
 * an environment with no browser-automation tool -- see the FONT-GEN-001 completion report's
 * Browser Verification section for what this does and does not cover (data-layer only, not actual
 * canvas/DOM rendering).
 *
 * Usage: node tools/font-generator/tests/test_studio_registration.mjs
 */
import { readFile } from 'node:fs/promises';
import { repoPath } from '../../font-certification/lib/repoPaths.mjs';
import { FontManager } from '../../../src/fonts/index.js';
import { FontProviderRegistry, OpenTypeProvider } from '../../../src/text/index.js';
import { GeometryEngine } from '../../../src/geometry/GeometryEngine.js';

const REPRESENTATIVE_TEXT_BY_ROLE = { 'rhinestone-experimental': 'Ashley' };

async function main() {
  const manifestPath = repoPath('assets/fonts/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const experimentalFonts = manifest.fonts.filter((f) => f.role === 'rhinestone-experimental');

  if (experimentalFonts.length === 0) {
    console.log('No rhinestone-experimental fonts registered -- nothing to verify (expected if the report recommended REJECT).');
    return;
  }

  const fontManager = new FontManager(manifest);
  const registry = new FontProviderRegistry();
  registry.register(new OpenTypeProvider({ fontManager }));
  const engine = new GeometryEngine({ fontProviderRegistry: registry });

  for (const font of experimentalFonts) {
    const text = REPRESENTATIVE_TEXT_BY_ROLE[font.role] ?? 'Ashley';
    const layout = await engine.generateTextLayout({
      text,
      fontId: font.id,
      layerId: 'font-gen-001-smoke-test',
      heightMm: 45,
      stoneSizeMm: 4,
      gapMm: 0.3,
      mode: 'outline',
      color: 'gold'
    });
    if (!layout.stones || layout.stones.length === 0) {
      throw new Error(`${font.id}: generateTextLayout produced zero stones for "${text}"`);
    }
    console.log(`PASS: ${font.id} (${font.family}) -- "${text}" -> ${layout.stones.length} stones`);
  }

  console.log(`PASS: Studio registration smoke test (${experimentalFonts.length} fonts loaded + rendered via the real pipeline)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
