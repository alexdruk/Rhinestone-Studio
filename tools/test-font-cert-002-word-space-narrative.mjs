import assert from 'node:assert/strict';
import { wordSpaceNarrative } from './font-certification/lib/reportHtml.mjs';
import { classifyCertification } from './font-certification/lib/classification.mjs';

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function findings(overrides) {
  return {
    wordSpaceFindings: [{ word: 'Happy Birthday', leftChar: 'y', rightChar: 'B', gapUnits: 271.8, medianIntraWordGapUnits: 89, adequate: true }],
    inadequateWordSpaces: [],
    ...overrides
  };
}

// --- FONT-CERT-002 requirement: "a PASS word-space result cannot produce warning narrative" --------

await test('wordSpaceNarrative(): an all-adequate (PASS) result never mentions running together / a flagged word', () => {
  const text = wordSpaceNarrative(findings());
  assert.ok(!/running together|reads as running|visually confirming/i.test(text), `PASS narrative must not contain warning language, got: "${text}"`);
  assert.ok(!/\d+ of \d+ tested word-space boundar\w+ measure below/i.test(text), `PASS narrative must not use the "X of Y below threshold" phrasing reserved for warnings, got: "${text}"`);
  assert.ok(text.includes('Happy Birthday'), 'a PASS narrative should still name the tightest case as evidence');
  assert.ok(text.includes((271.8 / 89).toFixed(2)), 'the actual measured ratio must appear as evidence');
});

await test('wordSpaceNarrative(): this is the exact v003 regression -- a 3.05x PASS ratio must never produce "runs together" text', () => {
  // This is the literal bug FONT-CERT-002 was filed for: a candidate whose "Happy Birthday" gap
  // measured 3.05x the median (comfortably PASS) still had the report state it "visually runs
  // together" because that sentence was a hardcoded string, not derived from wordSpaceFindings.
  const v003Like = findings({
    wordSpaceFindings: [
      { word: 'Bride Squad', leftChar: 'e', rightChar: 'S', gapUnits: 501, medianIntraWordGapUnits: 89, adequate: true },
      { word: 'Happy Birthday', leftChar: 'y', rightChar: 'B', gapUnits: 271.8359375, medianIntraWordGapUnits: 89, adequate: true },
      { word: 'Dance Team', leftChar: 'e', rightChar: 'T', gapUnits: 665, medianIntraWordGapUnits: 89, adequate: true }
    ],
    inadequateWordSpaces: []
  });
  const text = wordSpaceNarrative(v003Like);
  assert.ok(!/runs together|running together/i.test(text), `expected no "runs together" language for an all-PASS result, got: "${text}"`);
});

// --- FONT-CERT-002 requirement: "a WARNING result does produce the warning narrative" ----------------

await test('wordSpaceNarrative(): an inadequate (WARNING) word-space is explicitly named with its measured ratio', () => {
  const inadequateFinding = { word: 'Happy Birthday', leftChar: 'y', rightChar: 'B', gapUnits: 111, medianIntraWordGapUnits: 89, adequate: false };
  const text = wordSpaceNarrative(findings({
    wordSpaceFindings: [inadequateFinding],
    inadequateWordSpaces: [inadequateFinding]
  }));
  assert.ok(text.includes('Happy Birthday'), 'expected the specific flagged word to be named');
  assert.ok(text.includes('"y"') && text.includes('"B"'), 'expected the specific flagged boundary characters to be named');
  assert.ok(text.includes((111 / 89).toFixed(2)), 'expected the actual measured ratio to appear as evidence');
  assert.ok(/visually confirming|verify/i.test(text), 'expected the narrative to recommend visual confirmation for a flagged case');
});

await test('wordSpaceNarrative(): with no multi-word phrases tested, the narrative says so rather than asserting a result', () => {
  const text = wordSpaceNarrative(findings({ wordSpaceFindings: [], inadequateWordSpaces: [] }));
  assert.ok(/no multi-word phrases were available/i.test(text));
});

// --- classification.mjs: refinementNotes only fires for genuinely inadequate word-spaces ------------

await test('classifyCertification() refinementNotes contains no word-space warning when inadequateWordSpaces is empty', () => {
  const result = classifyCertification({
    ttfChecks: [{ id: 'ttf-parse', category: 'parsing', label: 'x', status: 'PASS', detail: 'ok' }],
    productionAnalysis: { glyphResults: new Map(), wordResults: new Map(), similarityFindings: [], similarityThreshold: 0.09, heightMm: 25, gapMm: 0.3 },
    typographyFindings: { weightOutliers: [], baselineAnomalies: [], inadequateWordSpaces: [] }
  });
  assert.ok(!result.refinementNotes.some((n) => n.includes('Word-space')), 'no word-space refinement note should exist when nothing was flagged inadequate');
});

await test('classifyCertification() refinementNotes contains the word-space warning when inadequateWordSpaces is non-empty', () => {
  const result = classifyCertification({
    ttfChecks: [{ id: 'ttf-parse', category: 'parsing', label: 'x', status: 'PASS', detail: 'ok' }],
    productionAnalysis: { glyphResults: new Map(), wordResults: new Map(), similarityFindings: [], similarityThreshold: 0.09, heightMm: 25, gapMm: 0.3 },
    typographyFindings: {
      weightOutliers: [],
      baselineAnomalies: [],
      inadequateWordSpaces: [{ word: 'Happy Birthday', leftChar: 'y', rightChar: 'B', gapUnits: 111, medianIntraWordGapUnits: 89 }]
    }
  });
  assert.ok(result.refinementNotes.some((n) => n.includes('Word-space too narrow') && n.includes('Happy Birthday')));
});

console.log('FONT-CERT-002 word-space narrative regression tests passed.');
