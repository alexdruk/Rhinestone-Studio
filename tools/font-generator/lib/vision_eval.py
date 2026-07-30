"""
FONT-DECISION-001 -- vision-transcription scoring.

Replaces pytesseract as the primary readability signal (see FONT-EVAL-002: a vision-capable read
of the same rhinestone renders scored 132/140 exact where pytesseract scored 30/140 -- pytesseract
was the confound, not font legibility). There is no automated vision API in this offline pipeline;
"vision-transcription" means a person (or vision-capable model) looks at the rendered image and
transcribes it directly. This module scores a manually-supplied transcription against the expected
text using the exact same normalize()/levenshtein_ops() logic every prior milestone's pytesseract
numbers were scored with, so vision and pytesseract results are apples-to-apples comparable.

pytesseract (lib/ocr_eval.py) is kept unchanged as a secondary, clearly-labeled legacy metric for
continuity with FONT-GEN-001-004's historical numbers -- it is not replaced or removed, only
demoted from the acceptance signal.
"""
from .ocr_eval import normalize, levenshtein_ops


def evaluate(expected_text, transcribed_text):
    """
    Same return shape as ocr_eval.evaluate(), scored from a human/vision transcription instead of
    a pytesseract OCR pass. `transcribed_text` is the exact text a rater read off the rendered
    specimen (not run through any OCR engine).
    """
    expected_norm = normalize(expected_text)
    actual_norm = normalize(transcribed_text)

    distance, ops = levenshtein_ops(expected_norm, actual_norm)
    char_accuracy = 1.0 - (distance / max(len(expected_norm), 1))
    char_accuracy = max(0.0, char_accuracy)

    expected_words = expected_norm.split(" ") if expected_norm else []
    actual_words = actual_norm.split(" ") if actual_norm else []
    matched_words = 0
    remaining = list(actual_words)
    for w in expected_words:
        if w in remaining:
            remaining.remove(w)
            matched_words += 1
    word_accuracy = matched_words / len(expected_words) if expected_words else 1.0

    substituted = [(o[1], o[2]) for o in ops if o[0] == "substitute"]
    omitted = [o[1] for o in ops if o[0] == "omit"]
    inserted = [o[2] for o in ops if o[0] == "insert"]

    return {
        "source": "vision",
        "expectedText": expected_text,
        "transcribedText": transcribed_text,
        "expectedNormalized": expected_norm,
        "actualNormalized": actual_norm,
        "exactMatch": expected_norm == actual_norm,
        "charAccuracy": round(char_accuracy, 4),
        "wordAccuracy": round(word_accuracy, 4),
        "substitutedChars": substituted,
        "omittedChars": omitted,
        "insertedChars": inserted,
        "editDistance": distance
    }
