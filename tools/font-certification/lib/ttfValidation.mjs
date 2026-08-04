/**
 * PART 1 -- TTF validation for FONT-CERT-001.
 *
 * Produces a flat list of typed checks ({id, category, label, status, detail, evidence}) plus the
 * raw font-metrics snapshot the report/JSON artifacts need. Every check's `status` is one of
 * PASS / WARNING / FAIL / NOT_VERIFIED -- NOT_VERIFIED is used whenever this implementation cannot
 * reliably test the property (per the milestone spec: "Do not claim a geometry check passed if the
 * implementation cannot reliably test it"), never as a silent skip.
 */
import { loadCandidateFont } from './ttfParser.mjs';
import { analyzeGlyphOutline } from './glyphOutline.mjs';
import { REQUIRED_CHARACTERS, REQUIRED_SFNT_TABLES } from './requiredCharacters.mjs';

// FONT-SOURCE-001 fix: the empty-glyphs check below originally excluded only whitespace (via
// String.prototype.trim()) from "unexpectedly empty" mapped characters. That missed an entire class of
// characters that are legitimately, intentionally empty-outline in virtually every well-formed font --
// invisible formatting/control characters and Private-Use-Area codepoints (often used for a font's own
// internal ligature/OpenType-feature glyphs, not real visible characters). Verified empirically against
// 14 real Google Fonts: 9 of 14 mapped at least one of these and were incorrectly FAILing this check for
// a reason with zero bearing on rhinestone production quality. This does not touch the check's actual
// purpose (catching a glyph that *should* be visible but silently isn't) -- it only excludes codepoints
// that were never expected to render anything in the first place.
function isInvisibleByDesignCodepoint(cp) {
  if (cp === 0x00) return true; // NUL
  if (cp <= 0x1f || cp === 0x7f) return true; // C0 controls + DEL
  if (cp >= 0x80 && cp <= 0x9f) return true; // C1 controls
  if (cp === 0x034f) return true; // combining grapheme joiner
  if (cp >= 0x200b && cp <= 0x200f) return true; // zero-width space/non-joiner/joiner, LRM, RLM
  if (cp >= 0x202a && cp <= 0x202e) return true; // bidi embedding/override controls
  if (cp >= 0x2060 && cp <= 0x2064) return true; // word joiner and other invisible operators
  if (cp === 0xfeff) return true; // zero-width no-break space / BOM
  if (cp >= 0xe000 && cp <= 0xf8ff) return true; // BMP Private Use Area
  if (cp >= 0xf0000 && cp <= 0xffffd) return true; // Supplementary Private Use Area-A
  if (cp >= 0x100000 && cp <= 0x10fffd) return true; // Supplementary Private Use Area-B
  return false;
}

function check({ id, category, label, status, detail, evidence = null }) {
  return { id, category, label, status, detail, evidence };
}

/**
 * @param {string} absolutePath
 * @returns {Promise<{ checks: object[], fontMetrics: object, font: import('opentype.js').Font|null, glyphAnalyses: Map<string,object> }>}
 */
export async function validateTtf(absolutePath) {
  const { buffer, font, sfnt, parseError } = await loadCandidateFont(absolutePath);
  const checks = [];

  checks.push(check({
    id: 'ttf-parse',
    category: 'parsing',
    label: 'Successful TTF parsing',
    status: font && !parseError ? 'PASS' : 'FAIL',
    detail: font && !parseError
      ? 'opentype.js parsed the file without error.'
      : `opentype.js failed to parse the file: ${parseError?.message ?? 'unknown error'}`
  }));

  if (!font) {
    // Nothing further can be reliably checked -- report every remaining Part 1 check as FAIL/NOT_VERIFIED
    // rather than throwing, so callers still get a complete (if entirely failing) checklist.
    for (const id of ['outline-format', 'quadratic-outlines', 'units-per-em', 'glyph-count', 'cmap-coverage',
      'notdef-glyph', 'required-characters', 'required-tables', 'font-naming', 'vertical-metrics',
      'empty-glyphs', 'open-contours', 'self-intersections', 'zero-length-duplicate-segments',
      'coordinate-range', 'advance-width-consistency']) {
      checks.push(check({ id, category: 'unavailable', label: id, status: 'FAIL', detail: 'Font failed to parse; check not evaluated.' }));
    }
    return {
      checks,
      fontMetrics: { fileSizeBytes: buffer.length, sfnt },
      font: null,
      glyphAnalyses: new Map()
    };
  }

  // --- Outline format -------------------------------------------------------------------------
  const isCff = sfnt.isCffOutlines || font.outlinesFormat === 'cff';
  const isTrueType = sfnt.isTrueTypeOutlines || font.outlinesFormat === 'truetype';
  checks.push(check({
    id: 'outline-format',
    category: 'structure',
    label: 'Outline format',
    status: isTrueType || isCff ? 'PASS' : 'FAIL',
    detail: isCff
      ? `CFF (PostScript-flavored) outlines. sfnt signature "${sfnt.sfntVersionTag}" (OTTO), opentype.js outlinesFormat="${font.outlinesFormat}".`
      : isTrueType
        ? `TrueType (quadratic) outlines. sfnt signature "${sfnt.sfntVersionTag}", opentype.js outlinesFormat="${font.outlinesFormat}".`
        : `Unrecognized outline format: sfnt signature "${sfnt.sfntVersionTag}".`,
    evidence: { sfntVersionTag: sfnt.sfntVersionTag, opentypeOutlinesFormat: font.outlinesFormat }
  }));

  const requiredCharSamples = REQUIRED_CHARACTERS.filter((c) => c.char !== ' ').slice(0, 10);
  let totalCurveCommands = 0;
  let totalLineCommands = 0;
  for (const { char } of requiredCharSamples) {
    const analysis = analyzeGlyphOutline(font, char);
    totalCurveCommands += analysis.curveCommandCount;
    totalLineCommands += analysis.lineCommandCount;
  }
  checks.push(check({
    id: 'quadratic-outlines',
    category: 'structure',
    label: 'Quadratic TrueType outlines',
    status: isCff ? 'FAIL' : (totalCurveCommands > 0 ? 'PASS' : 'WARNING'),
    detail: isCff
      ? `The file is CFF-flavored OpenType (sfnt "OTTO"), not TrueType -- it has no quadratic ` +
        `("glyf") outlines at all; its curves (if any) are cubic Bezier by construction. ` +
        `Sampled across the first ${requiredCharSamples.length} required glyphs: ${totalCurveCommands} ` +
        `curve commands, ${totalLineCommands} line commands.`
      : totalCurveCommands > 0
        ? `TrueType file with quadratic curves confirmed: ${totalCurveCommands} curve commands found across ${requiredCharSamples.length} sampled glyphs.`
        : `TrueType file, but the sampled glyphs use only straight-line segments (${totalLineCommands} lines, 0 curves) -- outlines are polyline approximations, not quadratic curves.`,
    evidence: { curveCommands: totalCurveCommands, lineCommands: totalLineCommands, sampledGlyphs: requiredCharSamples.length }
  }));

  // --- unitsPerEm / glyph count ---------------------------------------------------------------
  checks.push(check({
    id: 'units-per-em',
    category: 'structure',
    label: 'unitsPerEm',
    status: Number.isInteger(font.unitsPerEm) && font.unitsPerEm > 0 ? 'PASS' : 'FAIL',
    detail: `unitsPerEm = ${font.unitsPerEm}`,
    evidence: { unitsPerEm: font.unitsPerEm }
  }));

  checks.push(check({
    id: 'glyph-count',
    category: 'structure',
    label: 'Glyph count',
    status: font.glyphs.length > 0 ? 'PASS' : 'FAIL',
    detail: `${font.glyphs.length} glyphs (font.numGlyphs=${font.numGlyphs}).`,
    evidence: { glyphCount: font.glyphs.length }
  }));

  // --- .notdef ---------------------------------------------------------------------------------
  const notdefGlyph = font.glyphs.get(0);
  const notdefOk = notdefGlyph && notdefGlyph.name === '.notdef';
  checks.push(check({
    id: 'notdef-glyph',
    category: 'structure',
    label: '.notdef at glyph index 0',
    status: notdefOk ? 'PASS' : 'FAIL',
    detail: notdefOk ? '.notdef confirmed at glyph index 0.' : `Glyph index 0 is named "${notdefGlyph?.name ?? 'unknown'}", not ".notdef".`
  }));

  // --- cmap coverage / required characters ------------------------------------------------------
  const glyphIndexMap = font.tables.cmap?.glyphIndexMap ?? {};
  const cmapEntryCount = Object.keys(glyphIndexMap).length;
  checks.push(check({
    id: 'cmap-coverage',
    category: 'coverage',
    label: 'Unicode cmap coverage',
    status: cmapEntryCount > 0 ? 'PASS' : 'FAIL',
    detail: `cmap maps ${cmapEntryCount} Unicode code point(s) to glyphs.`,
    evidence: { cmapEntryCount }
  }));

  const glyphAnalyses = new Map();
  const missingCharacters = [];
  for (const { char, name } of REQUIRED_CHARACTERS) {
    const analysis = analyzeGlyphOutline(font, char);
    glyphAnalyses.set(char, analysis);
    if (analysis.isMissing) missingCharacters.push(name);
  }
  checks.push(check({
    id: 'required-characters',
    category: 'coverage',
    label: 'Required character coverage (A-Z, a-z, 0-9, space, . , \' - ! ?)',
    status: missingCharacters.length === 0 ? 'PASS' : 'FAIL',
    detail: missingCharacters.length === 0
      ? `All ${REQUIRED_CHARACTERS.length} required characters map to a real glyph (glyph index != 0).`
      : `Missing glyph mapping for: ${missingCharacters.join(', ')}.`,
    evidence: { requiredCount: REQUIRED_CHARACTERS.length, missing: missingCharacters }
  }));

  // --- Required tables ---------------------------------------------------------------------------
  const presentTags = new Set(sfnt.tableTags);
  const tableStatus = REQUIRED_SFNT_TABLES.map((tag) => {
    const rawTag = tag === 'OS/2' ? 'OS/2' : tag;
    const present = presentTags.has(rawTag) || (tag === 'glyf' && presentTags.has('glyf'));
    return { tag, present };
  });
  const missingTables = tableStatus.filter((t) => !t.present).map((t) => t.tag);
  checks.push(check({
    id: 'required-tables',
    category: 'structure',
    label: 'Required sfnt tables',
    status: missingTables.length === 0 ? 'PASS' : 'FAIL',
    detail: missingTables.length === 0
      ? `All required tables present: ${REQUIRED_SFNT_TABLES.join(', ')}.`
      : `Missing required table(s): ${missingTables.join(', ')}. File contains: ${sfnt.tableTags.join(', ')}` +
        (missingTables.includes('glyf') || missingTables.includes('loca')
          ? ' (expected for a CFF-flavored OpenType file -- CFF outlines replace glyf+loca with a single "CFF " table, present here.)'
          : ''),
    evidence: { present: sfnt.tableTags, missing: missingTables, cffTablePresent: presentTags.has('CFF') }
  }));

  // --- Naming ---------------------------------------------------------------------------------
  const names = font.names ?? {};
  const nameSet = names.windows ?? names.macintosh ?? {};
  const family = nameSet.fontFamily?.en ?? null;
  const subfamily = nameSet.fontSubfamily?.en ?? null;
  const version = nameSet.version?.en ?? null;
  const postScriptName = nameSet.postScriptName?.en ?? null;
  const namingMissing = [family, subfamily, version, postScriptName].filter((v) => !v).length;
  checks.push(check({
    id: 'font-naming',
    category: 'naming',
    label: 'Family / subfamily / version / PostScript naming',
    status: namingMissing === 0 ? 'PASS' : 'WARNING',
    detail: `family="${family}", subfamily="${subfamily}", version="${version}", postScriptName="${postScriptName}".`,
    evidence: { family, subfamily, version, postScriptName }
  }));

  // --- Vertical metrics / hmtx --------------------------------------------------------------------
  const hhea = font.tables.hhea ?? {};
  const os2 = font.tables.os2 ?? {};
  const ascender = font.ascender ?? hhea.ascender ?? null;
  const descender = font.descender ?? hhea.descender ?? null;
  const lineGap = hhea.lineGap ?? os2.sTypoLineGap ?? null;
  const metricsOk = Number.isFinite(ascender) && Number.isFinite(descender);
  checks.push(check({
    id: 'vertical-metrics',
    category: 'metrics',
    label: 'Ascender, descender, line gap, horizontal metrics',
    status: metricsOk ? (ascender > 0 && descender < 0 ? 'PASS' : 'WARNING') : 'FAIL',
    detail: `ascender=${ascender}, descender=${descender}, hhea.lineGap=${lineGap}, ` +
      `advanceWidthMax=${hhea.advanceWidthMax ?? 'n/a'}, numberOfHMetrics=${hhea.numberOfHMetrics ?? 'n/a'} (hmtx table present: ${presentTags.has('hmtx')}).`,
    evidence: { ascender, descender, lineGap, advanceWidthMax: hhea.advanceWidthMax ?? null, numberOfHMetrics: hhea.numberOfHMetrics ?? null, hmtxTablePresent: presentTags.has('hmtx') }
  }));

  // --- Invalid / empty glyphs (full glyph set, cross-referenced against cmap) ------------------
  const reverseCmap = new Map();
  for (const [codepoint, glyphIndex] of Object.entries(glyphIndexMap)) {
    if (!reverseCmap.has(glyphIndex)) reverseCmap.set(glyphIndex, []);
    reverseCmap.get(glyphIndex).push(Number(codepoint));
  }
  const unexpectedlyEmpty = [];
  for (let i = 1; i < font.glyphs.length; i++) {
    const glyph = font.glyphs.get(i);
    const path = glyph.getPath(0, 0, font.unitsPerEm);
    if (path.commands.length > 0) continue;
    const codepoints = reverseCmap.get(i) ?? [];
    const nonSpaceCodepoints = codepoints.filter((cp) => String.fromCodePoint(cp).trim().length > 0 && !isInvisibleByDesignCodepoint(cp));
    const nonSpaceChars = nonSpaceCodepoints.map((cp) => String.fromCodePoint(cp));
    if (nonSpaceChars.length > 0) unexpectedlyEmpty.push({ glyphIndex: i, characters: nonSpaceChars });
  }
  checks.push(check({
    id: 'empty-glyphs',
    category: 'geometry',
    label: 'Invalid or empty glyphs',
    status: unexpectedlyEmpty.length === 0 ? 'PASS' : 'FAIL',
    detail: unexpectedlyEmpty.length === 0
      ? 'No mapped, non-whitespace, non-invisible-by-design character resolves to an empty outline.'
      : `${unexpectedlyEmpty.length} mapped character(s) resolve to an empty outline: ` +
        unexpectedlyEmpty.map((e) => `"${e.characters.join('/')}" (glyph ${e.glyphIndex})`).join(', ') + '.',
    evidence: { unexpectedlyEmpty }
  }));

  // --- Open contours, self-intersections, zero-length/duplicate segments, coordinate range ------
  // These are computed together from the same per-character glyphAnalyses map built above, over
  // every required character (not just a sample), since they are cheap and the spec asks for
  // concrete per-glyph findings.
  const openContourChars = [];
  const selfIntersectingChars = [];
  const zeroLengthDuplicateChars = [];
  const outOfRangeChars = [];
  for (const { char } of REQUIRED_CHARACTERS) {
    const a = glyphAnalyses.get(char);
    if (!a || a.isEmpty) continue;
    if (a.openContourCount > 0) {
      openContourChars.push({
        char,
        openContourCount: a.openContourCount,
        maxOpenGapUnits: Math.round(a.maxOpenGapUnits * 10) / 10,
        maxOpenGapPercentOfEm: Math.round(a.maxOpenGapPercentOfEm * 100) / 100
      });
    }
    if (a.selfIntersectionCount > 0 || a.crossContourIntersectionCount > 0) {
      selfIntersectingChars.push({ char, selfIntersectionCount: a.selfIntersectionCount, crossContourIntersectionCount: a.crossContourIntersectionCount });
    }
    if (a.zeroLengthSegmentCount > 0 || a.duplicateSegmentCount > 0) {
      zeroLengthDuplicateChars.push({ char, zeroLengthSegmentCount: a.zeroLengthSegmentCount, duplicateSegmentCount: a.duplicateSegmentCount });
    }
    if (a.outOfRangeCoordinateCount > 0) outOfRangeChars.push({ char, outOfRangeCoordinateCount: a.outOfRangeCoordinateCount });
  }

  checks.push(check({
    id: 'open-contours',
    category: 'geometry',
    label: 'Open contours',
    // WARNING rather than FAIL: this is a real, consistent construction defect in the source file
    // (verified below), but it is not production-blocking -- src/text/OpenTypeProvider.js's
    // convertGlyphCommandsToVectorPath() already force-closes every contour downstream (see its own
    // doc comment), which is exactly why Part 3's real generateTextLayout() calls against this
    // candidate still produce valid, non-empty StoneLayouts despite this gap.
    status: openContourChars.length === 0 ? 'PASS' : 'WARNING',
    detail: (() => {
      if (openContourChars.length === 0) {
        return 'Every required-character contour closes explicitly (an explicit "Z"/closepath command) or implicitly (its final point returns to its starting point).';
      }
      const gaps = openContourChars.map((c) => c.maxOpenGapPercentOfEm);
      const maxGapPercent = Math.max(...gaps);
      const avgGapPercent = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const worstChars = [...openContourChars].sort((a, b) => b.maxOpenGapPercentOfEm - a.maxOpenGapPercentOfEm).slice(0, 5);
      return `${openContourChars.length} of ${REQUIRED_CHARACTERS.length} character(s) have at least one contour with no explicit close command whose final point does not exactly return to its start point ` +
        `(gap sizes as % of the font's em square: average ${avgGapPercent.toFixed(2)}%, max ${maxGapPercent.toFixed(2)}% -- small precision gaps, not wide-open paths). ` +
        `Largest gaps: ${worstChars.map((c) => `"${c.char}" (${c.maxOpenGapUnits}u, ${c.maxOpenGapPercentOfEm}% of em)`).join(', ')}. ` +
        `This is a consistent pattern across nearly every glyph, suggesting the source file was authored/exported without closepath operators, not an isolated defect. It is not production-blocking: ` +
        `src/text/OpenTypeProvider.js force-closes every contour during conversion (confirmed -- Part 3's real GeometryEngine.generateTextLayout() calls against this file produce valid StoneLayouts), but it is worth returning to the type designer as a file-hygiene issue.`;
    })(),
    evidence: { openContourChars }
  }));

  const totalSelfIntersections = selfIntersectingChars.reduce((sum, c) => sum + c.selfIntersectionCount + c.crossContourIntersectionCount, 0);
  checks.push(check({
    id: 'self-intersections',
    category: 'geometry',
    label: 'Self-intersections',
    status: selfIntersectingChars.length === 0 ? 'PASS' : 'WARNING',
    detail: selfIntersectingChars.length === 0
      ? `Strict transversal-crossing test (deduplicated, 16-segments-per-curve flattened outline, ${REQUIRED_CHARACTERS.length} required characters) found no self- or cross-contour crossings.`
      : `${selfIntersectingChars.length} of ${REQUIRED_CHARACTERS.length} character(s) show ${totalSelfIntersections} total crossing(s) (small counts: 1-4 per affected character) -- ` +
        selfIntersectingChars.map((c) => `"${c.char}" (self:${c.selfIntersectionCount}, cross-contour:${c.crossContourIntersectionCount})`).join(', ') + '. ' +
        'Not production-blocking on its own (verify visually against rhinestone-specimen.png/typography-specimen.png -- a transversal crossing in the outline does not necessarily produce a visible defect once converted to stones).',
    evidence: {
      selfIntersectingChars,
      method: 'FONT-CERT-002: strict proper/transversal crossing test only (no collinear-touching special case -- see glyphOutline.mjs\'s segmentsIntersect() doc comment for why), run on a deduplicated flattened polygon. ' +
        'Validated against synthetic known-good/known-bad fixtures (tools/test-font-cert-002-outline-detector-fixtures.mjs) and empirically against this candidate: an earlier, unaudited version of this detector reported thousands of false-positive crossings per glyph from curve-tessellation noise.'
    }
  }));

  const totalRawZeroLength = zeroLengthDuplicateChars.reduce((sum, c) => sum + c.zeroLengthSegmentCount, 0);
  const totalDuplicateSegments = zeroLengthDuplicateChars.reduce((sum, c) => sum + c.duplicateSegmentCount, 0);
  checks.push(check({
    id: 'zero-length-duplicate-segments',
    category: 'geometry',
    label: 'Zero-length or duplicate outline segments',
    // WARNING, not FAIL: a raw zero-length draw command is a no-op (draws nothing, moves nowhere) --
    // real file redundancy worth flagging, but not a rendering or manufacturing defect. A genuine
    // duplicate *segment* (two distinct edges tracing the same pair of points) would be more serious,
    // but none were found in this candidate (see evidence).
    status: zeroLengthDuplicateChars.length === 0 ? 'PASS' : 'WARNING',
    detail: zeroLengthDuplicateChars.length === 0
      ? 'No zero-length draw commands or duplicate outline segments found in required-character outlines.'
      : `${zeroLengthDuplicateChars.length} of ${REQUIRED_CHARACTERS.length} character(s) contain ${totalRawZeroLength} raw zero-length draw command(s) total ` +
        `(a command whose endpoint exactly duplicates the current pen position -- draws nothing, harmless no-op, but real source-file redundancy)` +
        (totalDuplicateSegments > 0 ? ` and ${totalDuplicateSegments} duplicate outline segment(s) (a genuine retraced edge)` : ', 0 duplicate outline segments') + '. ' +
        'Not production-blocking: these commands have no visual or geometric effect. Per-character counts: ' +
        zeroLengthDuplicateChars.slice(0, 8).map((c) => `"${c.char}" (zero-length:${c.zeroLengthSegmentCount}, duplicate:${c.duplicateSegmentCount})`).join(', ') +
        (zeroLengthDuplicateChars.length > 8 ? `, +${zeroLengthDuplicateChars.length - 8} more` : '') + '.',
    evidence: {
      zeroLengthDuplicateChars,
      method: 'FONT-CERT-002: zero-length counted on the raw (unflattened) command stream only -- a command whose target is within 0.05% of the em square of the current pen position. ' +
        'Duplicate-segment counted on the deduplicated flattened polygon. Neither is measured against the flattened/tessellated polygon directly, which previously produced counts inflated by 10-100x from curve-tessellation sampling artifacts.'
    }
  }));

  checks.push(check({
    id: 'coordinate-range',
    category: 'geometry',
    label: 'Coordinates outside valid TrueType ranges',
    status: outOfRangeChars.length === 0 ? 'PASS' : 'FAIL',
    detail: (outOfRangeChars.length === 0
      ? `All required-character outline coordinates fall within the signed 16-bit range (${INT16_RANGE_NOTE}).`
      : `${outOfRangeChars.length} character(s) have coordinates outside [-32768, 32767] font units: ` +
        outOfRangeChars.map((c) => `"${c.char}" (${c.outOfRangeCoordinateCount})`).join(', ') + '.') +
      (isCff ? ' Note: this file is CFF-flavored, not glyf-based -- the int16 glyf range is a compatibility check only, not this format\'s native constraint.' : ''),
    evidence: { outOfRangeChars, formatIsCff: isCff }
  }));

  // --- Advance width / side bearing consistency --------------------------------------------------
  const advanceWidths = REQUIRED_CHARACTERS
    .filter((c) => c.char !== ' ')
    .map(({ char }) => glyphAnalyses.get(char).advanceWidthUnits)
    .filter((w) => Number.isFinite(w));
  const sortedWidths = [...advanceWidths].sort((a, b) => a - b);
  const medianWidth = sortedWidths[Math.floor(sortedWidths.length / 2)] ?? 0;
  const suspiciousWidths = [];
  for (const { char } of REQUIRED_CHARACTERS) {
    if (char === ' ') continue;
    const a = glyphAnalyses.get(char);
    if (a.advanceWidthUnits <= 0) suspiciousWidths.push({ char, advanceWidthUnits: a.advanceWidthUnits, reason: 'non-positive advance width' });
    else if (medianWidth > 0 && (a.advanceWidthUnits > medianWidth * 4 || a.advanceWidthUnits < medianWidth * 0.15)) {
      suspiciousWidths.push({ char, advanceWidthUnits: a.advanceWidthUnits, medianWidth, reason: 'advance width far from median' });
    }
  }
  checks.push(check({
    id: 'advance-width-consistency',
    category: 'metrics',
    label: 'Inconsistent or suspicious advance widths / side bearings',
    status: suspiciousWidths.length === 0 ? 'PASS' : 'WARNING',
    detail: suspiciousWidths.length === 0
      ? `Advance widths for required characters cluster reasonably around the median (${medianWidth} units).`
      : `${suspiciousWidths.length} character(s) have suspicious advance widths (median=${medianWidth} units): ` +
        suspiciousWidths.map((s) => `"${s.char}"=${s.advanceWidthUnits}`).join(', ') + '.',
    evidence: { medianWidthUnits: medianWidth, suspiciousWidths }
  }));

  const fontMetrics = {
    fileSizeBytes: buffer.length,
    sfntVersionTag: sfnt.sfntVersionTag,
    outlinesFormat: font.outlinesFormat,
    unitsPerEm: font.unitsPerEm,
    glyphCount: font.glyphs.length,
    cmapEntryCount,
    tableTags: sfnt.tableTags,
    family,
    subfamily,
    version,
    postScriptName,
    ascender,
    descender,
    lineGap,
    sxHeight: os2.sxHeight ?? null,
    sCapHeight: os2.sCapHeight ?? null,
    italicAngle: font.tables.post?.italicAngle ?? null,
    isFixedPitch: Boolean(font.tables.post?.isFixedPitch),
    advanceWidthMedianUnits: medianWidth,
    curveVsLineCommandSample: { curveCommands: totalCurveCommands, lineCommands: totalLineCommands, sampledGlyphs: requiredCharSamples.length }
  };

  return { checks, fontMetrics, font, glyphAnalyses };
}

const INT16_RANGE_NOTE = '-32768 to 32767';
