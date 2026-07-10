/**
 * OpenType-backed font provider for Rhinestone Studio.
 *
 * This is the only module in the codebase allowed to know about the OpenType
 * font format. It resolves font records through the Font Manager, parses the
 * font file with opentype.js, and returns neutral VectorPath / GlyphMetrics
 * data in millimeters. The Geometry Engine and renderers never see OpenType
 * types, units, or APIs.
 */

import opentype from 'opentype.js';
import { IFontProvider } from './IFontProvider.js';
import { Contour, VectorPath, GlyphMetrics, FontProviderResult } from './VectorPath.js';

/**
 * Load a font file's raw bytes given its manifest-relative path.
 *
 * Uses `fetch` in browser-like environments and falls back to the Node
 * filesystem otherwise, so the same provider works in the app and in tests.
 *
 * @param {string} path
 * @returns {Promise<ArrayBuffer>}
 */
async function defaultLoadFontBuffer(path) {
  if (typeof fetch === 'function' && typeof window !== 'undefined') {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Unable to load font file "${path}": ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  const { readFile } = await import('node:fs/promises');
  const buffer = await readFile(path);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * Convert a flat list of opentype.js glyph path commands (already scaled to
 * millimeters by the caller) into the neutral VectorPath contour format.
 *
 * TrueType-flavored glyphs close a contour implicitly (the last point
 * connects back to the matching moveTo) without emitting a 'Z' command,
 * while CFF-flavored glyphs emit one explicitly. Both are normalized here
 * so every contour in the output is closed, which manufacturing-quality
 * outline/fill sampling depends on.
 *
 * @param {Array<object>} commands
 * @param {string|null} id
 * @returns {VectorPath}
 */
function convertGlyphCommandsToVectorPath(commands, id) {
  const path = new VectorPath({ id, source: 'font:opentype' });
  let contour = null;

  const closeCurrentContourIfOpen = () => {
    if (contour && !contour.isClosed) {
      contour.closePath();
    }
  };

  for (const command of commands) {
    switch (command.type) {
      case 'M':
        closeCurrentContourIfOpen();
        contour = new Contour();
        path.addContour(contour);
        contour.moveTo(command.x, command.y);
        break;
      case 'L':
        if (!contour) throw new Error('Malformed glyph path: lineTo before moveTo.');
        contour.lineTo(command.x, command.y);
        break;
      case 'Q':
        if (!contour) throw new Error('Malformed glyph path: quadraticTo before moveTo.');
        contour.quadraticTo(command.x1, command.y1, command.x, command.y);
        break;
      case 'C':
        if (!contour) throw new Error('Malformed glyph path: cubicTo before moveTo.');
        contour.cubicTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y);
        break;
      case 'Z':
        if (!contour) throw new Error('Malformed glyph path: closePath before moveTo.');
        contour.closePath();
        break;
      default:
        throw new Error(`Unsupported OpenType path command: ${command.type}`);
    }
  }

  closeCurrentContourIfOpen();

  return path;
}

export class OpenTypeProvider extends IFontProvider {
  /**
   * @param {object} options
   * @param {import('../fonts/FontManager.js').FontManager} options.fontManager
   * @param {(path: string) => Promise<ArrayBuffer>} [options.loadFontBuffer]
   * @param {string} [options.id]
   * @param {string} [options.displayName]
   */
  constructor({ fontManager, loadFontBuffer = defaultLoadFontBuffer, id = 'opentype', displayName = 'OpenType' } = {}) {
    super();

    if (!fontManager || typeof fontManager.getFont !== 'function') {
      throw new TypeError('OpenTypeProvider requires a fontManager with getFont().');
    }
    if (typeof loadFontBuffer !== 'function') {
      throw new TypeError('OpenTypeProvider requires loadFontBuffer to be a function.');
    }

    this._fontManager = fontManager;
    this._loadFontBuffer = loadFontBuffer;
    this._id = id;
    this._displayName = displayName;
    this._parsedFontsById = new Map();
  }

  get id() {
    return this._id;
  }

  get displayName() {
    return this._displayName;
  }

  async isAvailable() {
    return true;
  }

  /**
   * Providers are loaded lazily per font id inside getTextPath, since the
   * registry's load() call happens before a fontId is known. This method
   * exists to satisfy the IFontProvider contract.
   */
  async load() {}

  async _loadParsedFont(fontId) {
    const cached = this._parsedFontsById.get(fontId);
    if (cached) return cached;

    const record = this._fontManager.getFont(fontId);

    let buffer;
    try {
      buffer = await this._loadFontBuffer(record.path);
    } catch (error) {
      throw new Error(`OpenTypeProvider could not load font file for "${fontId}" (${record.path}): ${error.message}`);
    }

    let parsedFont;
    try {
      parsedFont = opentype.parse(buffer);
    } catch (error) {
      throw new Error(`OpenTypeProvider could not parse font file for "${fontId}" (${record.path}): ${error.message}`);
    }

    this._parsedFontsById.set(fontId, parsedFont);
    return parsedFont;
  }

  /**
   * @param {object} options
   * @param {string} options.fontId
   * @param {string} options.text
   * @param {number} options.heightMm
   * @returns {Promise<FontProviderResult>}
   */
  async getTextPath({ fontId, text, heightMm } = {}) {
    if (typeof fontId !== 'string' || fontId.length === 0) {
      throw new TypeError('OpenTypeProvider.getTextPath requires a non-empty fontId.');
    }
    if (typeof text !== 'string' || text.length === 0) {
      throw new TypeError('OpenTypeProvider.getTextPath requires non-empty text.');
    }
    if (typeof heightMm !== 'number' || !Number.isFinite(heightMm) || heightMm <= 0) {
      throw new TypeError('OpenTypeProvider.getTextPath requires a positive heightMm.');
    }

    const font = await this._loadParsedFont(fontId);
    const unitsToMm = heightMm / font.unitsPerEm;

    // Glyphs are walked one Unicode code point at a time via charToGlyph
    // instead of font.getPath()/stringToGlyphs(), which bypasses GSUB
    // substitution (ligatures, contextual forms). Some script fonts ship
    // GSUB lookup formats opentype.js cannot parse and would otherwise throw.
    // Per-character glyphs are also what deterministic, letter-by-letter
    // stone placement needs.
    const commands = [];
    let advanceWidthMm = 0;
    let previousGlyph = null;

    for (const character of Array.from(text)) {
      const glyph = font.charToGlyph(character);

      if (previousGlyph) {
        advanceWidthMm += font.getKerningValue(previousGlyph, glyph) * unitsToMm;
      }

      const glyphPath = glyph.getPath(advanceWidthMm, 0, heightMm);
      commands.push(...glyphPath.commands);

      advanceWidthMm += (glyph.advanceWidth || 0) * unitsToMm;
      previousGlyph = glyph;
    }

    const path = convertGlyphCommandsToVectorPath(commands, `${fontId}:${text}`);

    const metrics = new GlyphMetrics({
      advanceWidthMm,
      boundingBox: path.getBoundingBox(),
      ascenderMm: font.ascender * unitsToMm,
      descenderMm: font.descender * unitsToMm
    });

    return new FontProviderResult({ path, metrics, fontId, text, heightMm });
  }
}

export function createOpenTypeProvider(options) {
  return new OpenTypeProvider(options);
}
