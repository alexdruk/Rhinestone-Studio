/**
 * Raw sfnt table-directory reader.
 *
 * opentype.js exposes a `font.tables` object, but it only contains tables
 * opentype.js has a dedicated parser for, and it does not surface `hmtx` as
 * a distinct entry even when the table is physically present in the file
 * (it folds hmtx straight into each Glyph's advanceWidth instead). Reading
 * the sfnt table directory ourselves -- 12-byte header + 16-byte records,
 * per the OpenType spec -- gives an authoritative, format-agnostic answer to
 * "which tables does this file actually contain", independent of what any
 * particular parsing library chooses to expose.
 *
 * This module does no glyph/outline interpretation -- it only reads the
 * table directory, so it works identically for TrueType (`glyf`) and
 * CFF-flavored (`CFF `) OpenType files.
 */

const SFNT_VERSION_TRUETYPE = 0x00010000;
const SFNT_VERSION_TRUETYPE_TRUE_TAG = 0x74727565; // 'true', legacy Mac TrueType
const SFNT_VERSION_OTTO = 0x4f54544f; // 'OTTO', CFF-flavored OpenType
const SFNT_VERSION_TTC = 0x74746366; // 'ttcf', TrueType Collection

/**
 * @param {Buffer} buffer Raw font file bytes.
 * @returns {{ sfntVersionTag: string, isTrueTypeOutlines: boolean, isCffOutlines: boolean, isCollection: boolean, tableTags: string[] }}
 */
export function readSfntTableDirectory(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw new Error('readSfntTableDirectory requires a Buffer of at least 12 bytes.');
  }

  const sfntVersion = buffer.readUInt32BE(0);
  const isCollection = sfntVersion === SFNT_VERSION_TTC;

  if (isCollection) {
    // A .ttf/.otf candidate should never be a collection container; report it
    // as such rather than misreading collection-header bytes as a table directory.
    return {
      sfntVersionTag: 'ttcf',
      isTrueTypeOutlines: false,
      isCffOutlines: false,
      isCollection: true,
      tableTags: []
    };
  }

  const isTrueTypeOutlines = sfntVersion === SFNT_VERSION_TRUETYPE || sfntVersion === SFNT_VERSION_TRUETYPE_TRUE_TAG;
  const isCffOutlines = sfntVersion === SFNT_VERSION_OTTO;

  const numTables = buffer.readUInt16BE(4);
  const tableTags = [];
  for (let i = 0; i < numTables; i++) {
    const recordOffset = 12 + i * 16;
    if (recordOffset + 4 > buffer.length) break;
    tableTags.push(buffer.toString('ascii', recordOffset, recordOffset + 4).trim());
  }

  return {
    sfntVersionTag: sfntVersionToTag(sfntVersion),
    isTrueTypeOutlines,
    isCffOutlines,
    isCollection: false,
    tableTags
  };
}

function sfntVersionToTag(sfntVersion) {
  if (sfntVersion === SFNT_VERSION_TRUETYPE) return '0x00010000';
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(sfntVersion, 0);
  return bytes.toString('ascii');
}
