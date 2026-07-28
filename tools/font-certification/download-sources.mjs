#!/usr/bin/env node
/**
 * FONT-SOURCE-001 -- downloads the latest official version of each catalog font from Google Fonts'
 * own source repo (github.com/google/fonts, which mirrors fonts.google.com) into
 * fonts/sources/<FontName>/<FontName>.ttf. Never modifies the downloaded bytes.
 *
 * Usage: node tools/font-certification/download-sources.mjs [FontName ...]
 * With no arguments, downloads every font in the catalog.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoPath } from './lib/repoPaths.mjs';
import { FONT_SOURCE_CATALOG, GOOGLE_FONTS_OFL_BASE_URL, sourceTtfRelativePath } from './font-source-catalog.mjs';

async function downloadOne(entry) {
  const url = `${GOOGLE_FONTS_OFL_BASE_URL}/${entry.oflPath}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed for ${entry.displayName}: HTTP ${response.status} from ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const destRelative = sourceTtfRelativePath(entry.name);
  const destAbsolute = repoPath(destRelative);
  await mkdir(path.dirname(destAbsolute), { recursive: true });
  await writeFile(destAbsolute, buffer);
  return { entry, destRelative, bytes: buffer.length };
}

export async function downloadSources(names) {
  const entries = names && names.length > 0
    ? FONT_SOURCE_CATALOG.filter((e) => names.includes(e.name))
    : FONT_SOURCE_CATALOG;

  if (names && names.length > 0) {
    const missing = names.filter((n) => !FONT_SOURCE_CATALOG.some((e) => e.name === n));
    if (missing.length > 0) {
      throw new Error(`Unknown font name(s) in catalog: ${missing.join(', ')}`);
    }
  }

  const results = [];
  for (const entry of entries) {
    const result = await downloadOne(entry);
    results.push(result);
  }
  return results;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const names = process.argv.slice(2);
  downloadSources(names)
    .then((results) => {
      for (const { entry, destRelative, bytes } of results) {
        console.log(`✓ ${entry.displayName} -> ${destRelative} (${bytes} bytes)`);
      }
      console.log(`\nDownloaded ${results.length} font(s).`);
    })
    .catch((error) => {
      console.error('download-sources failed:', error.message);
      process.exitCode = 1;
    });
}
