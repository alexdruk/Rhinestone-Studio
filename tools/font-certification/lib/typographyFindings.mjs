/**
 * PART 2 -- Typography review findings for FONT-CERT-001.
 *
 * Every finding here is grounded in a measurement taken from the parsed font (advance widths,
 * bounding boxes, declared x-height/cap-height, outline-shape similarity) rather than a subjective
 * call -- per the milestone spec's "Do not assign subjective scores without explaining the
 * evidence." Final legibility judgment still belongs to the rendered typography-specimen.png
 * (browser-verified separately); this module supplies the numbers that inform it.
 */
import { analyzeGlyphOutline, normalizedOutlinePoints } from './glyphOutline.mjs';
import { chamferDistance } from './shapeSimilarity.mjs';
import { TYPOGRAPHY_AMBIGUITY_GROUPS, TYPOGRAPHY_WORDS, STRESS_STRINGS } from './requiredCharacters.mjs';

const AMBIGUITY_CHAMFER_THRESHOLD = 0.09; // same normalized-unit threshold as productionAnalysis.mjs

function fillRatio(analysis) {
  const box = analysis.boundingBoxUnits;
  if (!box) return null;
  const area = (box.maxX - box.minX) * (box.maxY - box.minY);
  if (area <= 0) return null;
  return analysis.filledAreaUnits / area;
}

/**
 * @param {import('opentype.js').Font} font
 * @param {Map<string,object>} glyphAnalyses Required-character analyses, from ttfValidation.validateTtf().
 * @returns {object}
 */
export function computeTypographyFindings(font, glyphAnalyses) {
  const os2 = font.tables.os2 ?? {};
  const sxHeight = os2.sxHeight ?? null;
  const sCapHeight = os2.sCapHeight ?? null;

  // --- Ambiguity pairs (outline-shape similarity) ------------------------------------------------
  const ambiguityFindings = [];
  for (const group of TYPOGRAPHY_AMBIGUITY_GROUPS) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [charA, charB] = [group[i], group[j]];
        const analysisA = glyphAnalyses.get(charA) ?? analyzeGlyphOutline(font, charA);
        const analysisB = glyphAnalyses.get(charB) ?? analyzeGlyphOutline(font, charB);
        const distance = chamferDistance(normalizedOutlinePoints(analysisA), normalizedOutlinePoints(analysisB));
        ambiguityFindings.push({
          pair: [charA, charB],
          chamferDistance: distance,
          flagged: distance !== null && distance < AMBIGUITY_CHAMFER_THRESHOLD
        });
      }
    }
  }

  // --- Visual weight (fill ratio) consistency across a-z ------------------------------------------
  const lowercase = Array.from('abcdefghijklmnopqrstuvwxyz');
  const fillRatios = lowercase
    .map((char) => ({ char, ratio: fillRatio(glyphAnalyses.get(char) ?? analyzeGlyphOutline(font, char)) }))
    .filter((r) => r.ratio !== null);
  const medianFillRatio = [...fillRatios].map((r) => r.ratio).sort((a, b) => a - b)[Math.floor(fillRatios.length / 2)] ?? 0;
  const weightOutliers = fillRatios.filter((r) => medianFillRatio > 0 && (r.ratio > medianFillRatio * 1.8 || r.ratio < medianFillRatio * 0.35));

  // --- Baseline / vertical alignment ---------------------------------------------------------------
  // opentype.js's Glyph.getPath() (used by analyzeGlyphOutline, mirroring the real production path
  // in src/text/OpenTypeProvider.js) negates Y when converting font units to path coordinates --
  // font space is Y-up, but this is the same Y-down convention Rhinestone Studio's canvas/mm space
  // uses throughout. In that convention: baseline is y=0, a glyph's ascender/x-height top is its
  // most-negative minY, and a descender extends *positively* below the baseline (maxY > 0).
  const DESCENDER_THRESHOLD_UNITS = font.unitsPerEm * 0.08; // 8% of em -- small baseline overshoot (round letters) is normal and should not read as a descender
  const baselineFindings = lowercase.map((char) => {
    const analysis = glyphAnalyses.get(char) ?? analyzeGlyphOutline(font, char);
    const box = analysis.boundingBoxUnits;
    if (!box) return { char, minYUnits: null, maxYUnits: null, hasBelowBaselineExtension: false };
    return {
      char,
      minYUnits: box.minY,
      maxYUnits: box.maxY,
      hasBelowBaselineExtension: box.maxY > DESCENDER_THRESHOLD_UNITS
    };
  });
  // Conventional (non-script) descenders: g, j, p, q, y. This font is a cursive/script family, where
  // a looped descender-like tail on other letters (e.g. "f") can be a legitimate stylistic choice,
  // not a defect -- so below-baseline extension outside that conventional set is reported as an
  // observation for the type designer to confirm intentional, not asserted as a hard error.
  const conventionalDescenderLetters = new Set(['g', 'j', 'p', 'q', 'y']);
  const baselineAnomalies = baselineFindings.filter((f) => f.hasBelowBaselineExtension && !conventionalDescenderLetters.has(f.char) && f.minYUnits !== null);

  // --- x-height / cap-height consistency -----------------------------------------------------------
  // Height above baseline = |minY| (minY is negative in this Y-down convention; see note above).
  const xHeightLetters = ['a', 'c', 'e', 'm', 'n', 'o', 'r', 's', 'u', 'v', 'w', 'x', 'z'];
  const xHeightMeasurements = xHeightLetters.map((char) => {
    const box = (glyphAnalyses.get(char) ?? analyzeGlyphOutline(font, char)).boundingBoxUnits;
    return { char, heightAboveBaselineUnits: box ? -box.minY : null };
  }).filter((m) => m.heightAboveBaselineUnits !== null);
  const xHeightValues = xHeightMeasurements.map((m) => m.heightAboveBaselineUnits);
  const xHeightSpread = xHeightValues.length > 0 ? Math.max(...xHeightValues) - Math.min(...xHeightValues) : 0;

  const uppercase = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const capHeightMeasurements = uppercase.map((char) => {
    const box = (glyphAnalyses.get(char) ?? analyzeGlyphOutline(font, char)).boundingBoxUnits;
    return { char, heightAboveBaselineUnits: box ? -box.minY : null };
  }).filter((m) => m.heightAboveBaselineUnits !== null);
  const capHeightValues = capHeightMeasurements.map((m) => m.heightAboveBaselineUnits);
  const capHeightSpread = capHeightValues.length > 0 ? Math.max(...capHeightValues) - Math.min(...capHeightValues) : 0;

  // --- Repeated-letter / word-rhythm findings (advance-width based) -------------------------------
  function measureWord(text) {
    let totalAdvanceUnits = 0;
    const perCharacterAdvance = [];
    for (const char of Array.from(text)) {
      if (char === ' ') { totalAdvanceUnits += font.charToGlyph(' ').advanceWidth ?? 0; continue; }
      const glyph = font.charToGlyph(char);
      perCharacterAdvance.push({ char, advanceWidthUnits: glyph.advanceWidth ?? 0 });
      totalAdvanceUnits += glyph.advanceWidth ?? 0;
    }
    return { text, totalAdvanceUnits, perCharacterAdvance };
  }

  const wordFindings = TYPOGRAPHY_WORDS.map(measureWord);
  const stressFindings = STRESS_STRINGS.map((text) => {
    const measurement = measureWord(text);
    // Repeated-letter check: for doubled letters (e.g. "mm"), the two per-character advances should
    // be identical (same glyph twice) -- a real discrepancy would indicate the provider/kerning
    // pipeline is treating repeated glyphs inconsistently, not the font file itself.
    const advances = measurement.perCharacterAdvance.map((c) => c.advanceWidthUnits);
    const consistent = advances.every((a) => a === advances[0]);
    return { ...measurement, repeatedGlyphAdvanceConsistent: consistent };
  });

  // --- Word-space adequacy ------------------------------------------------------------------------
  // Measures the actual visual gap (ink edge to ink edge, in font units) at every letter-to-letter
  // boundary and at every inter-word space in TYPOGRAPHY_WORDS, then compares them: a word-space
  // that produces a visual gap no larger than an ordinary intra-word letter gap will read as the
  // two words running together, even though its logical advance width is nonzero.
  function inkGapUnits(leftChar, rightChar, throughSpace) {
    const leftGlyph = font.charToGlyph(leftChar);
    const rightGlyph = font.charToGlyph(rightChar);
    const leftAnalysis = glyphAnalyses.get(leftChar) ?? analyzeGlyphOutline(font, leftChar);
    const rightAnalysis = glyphAnalyses.get(rightChar) ?? analyzeGlyphOutline(font, rightChar);
    if (!leftAnalysis.boundingBoxUnits || !rightAnalysis.boundingBoxUnits) return null;
    let penAdvance = leftGlyph.advanceWidth ?? 0;
    if (throughSpace) {
      const spaceGlyph = font.charToGlyph(' ');
      penAdvance += font.getKerningValue(leftGlyph, spaceGlyph) + (spaceGlyph.advanceWidth ?? 0) + font.getKerningValue(spaceGlyph, rightGlyph);
    } else {
      penAdvance += font.getKerningValue(leftGlyph, rightGlyph);
    }
    return (penAdvance + rightAnalysis.boundingBoxUnits.minX) - leftAnalysis.boundingBoxUnits.maxX;
  }

  const intraWordGaps = [];
  for (const { text } of wordFindings) {
    const chars = Array.from(text);
    for (let i = 0; i < chars.length - 1; i++) {
      if (chars[i] === ' ' || chars[i + 1] === ' ') continue;
      const gap = inkGapUnits(chars[i], chars[i + 1], false);
      if (gap !== null) intraWordGaps.push(gap);
    }
  }
  const sortedIntraWordGaps = [...intraWordGaps].sort((a, b) => a - b);
  const medianIntraWordGapUnits = sortedIntraWordGaps[Math.floor(sortedIntraWordGaps.length / 2)] ?? 0;
  const WORD_SPACE_ADEQUACY_MULTIPLIER = 1.3;

  const wordSpaceFindings = [];
  for (const { text } of wordFindings) {
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] !== ' ' || i === 0 || i === chars.length - 1) continue;
      const leftChar = chars[i - 1];
      const rightChar = chars[i + 1];
      const gap = inkGapUnits(leftChar, rightChar, true);
      if (gap === null) continue;
      wordSpaceFindings.push({
        word: text,
        leftChar,
        rightChar,
        gapUnits: gap,
        medianIntraWordGapUnits,
        adequate: gap >= medianIntraWordGapUnits * WORD_SPACE_ADEQUACY_MULTIPLIER
      });
    }
  }
  const inadequateWordSpaces = wordSpaceFindings.filter((f) => !f.adequate);

  return {
    ambiguityFindings,
    ambiguityThreshold: AMBIGUITY_CHAMFER_THRESHOLD,
    fillRatios,
    medianFillRatio,
    weightOutliers,
    baselineFindings,
    baselineAnomalies,
    xHeight: { declared: sxHeight, measuredSpreadUnits: xHeightSpread, measurements: xHeightMeasurements },
    capHeight: { declared: sCapHeight, measuredSpreadUnits: capHeightSpread, measurements: capHeightMeasurements },
    wordFindings,
    stressFindings,
    medianIntraWordGapUnits,
    wordSpaceFindings,
    inadequateWordSpaces
  };
}
