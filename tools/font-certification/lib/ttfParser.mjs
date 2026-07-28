/**
 * Loads and parses a candidate font file for FONT-CERT-001.
 *
 * Reuses opentype.js the same way src/text/OpenTypeProvider.js does (that
 * module is documented as "the only module in the codebase allowed to know
 * about the OpenType font format" for production code -- this certification
 * tool is deliberately outside that boundary, the same way tools/test-*.mjs
 * font tests already parse fonts directly for inspection, not production
 * geometry generation).
 */
import { readFile } from 'node:fs/promises';
import opentype from 'opentype.js';
import { readSfntTableDirectory } from './sfntTables.mjs';

/**
 * @param {string} absolutePath
 * @returns {Promise<{ buffer: Buffer, font: import('opentype.js').Font|null, sfnt: object, parseError: Error|null }>}
 */
export async function loadCandidateFont(absolutePath) {
  const buffer = await readFile(absolutePath);
  const sfnt = readSfntTableDirectory(buffer);

  let font = null;
  let parseError = null;
  try {
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    font = opentype.parse(arrayBuffer);
  } catch (error) {
    parseError = error;
  }

  return { buffer, font, sfnt, parseError };
}
