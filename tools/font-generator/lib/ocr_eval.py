"""
FONT-GEN-001 -- OCR-based readability scoring.

Wraps pytesseract (the system `tesseract` binary) with: text normalization, character/word
accuracy via a Levenshtein alignment (also used to classify substituted/omitted/inserted
characters), and confidence extraction from tesseract's own per-word data.
"""
import re
import string
import pytesseract
from pytesseract import Output

TESS_CONFIG = "--psm 7"  # single text line -- matches this tool's one-line-per-case renders


def normalize(text):
    """Case-fold, strip punctuation, collapse whitespace -- 'where appropriate' per the brief:
    punctuation is stripped because rhinestone layouts carry no punctuation-weight cues, but
    spaces between words are preserved (collapsed to one) since word boundaries are meaningful."""
    text = text.lower()
    text = text.translate(str.maketrans(string.punctuation, " " * len(string.punctuation)))
    text = re.sub(r"\s+", " ", text).strip()
    return text


def levenshtein_ops(expected, actual):
    """
    Standard DP edit-distance with backtrace, returns (distance, ops) where ops is a list of
    ('match'|'substitute'|'omit'|'insert', expected_char_or_None, actual_char_or_None).
    'omit' = a character in `expected` missing from `actual` (production dropped it).
    'insert' = a character in `actual` not present in `expected` (OCR/production added noise).
    """
    n, m = len(expected), len(actual)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if expected[i - 1] == actual[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)

    ops = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and expected[i - 1] == actual[j - 1] and dp[i][j] == dp[i - 1][j - 1]:
            ops.append(("match", expected[i - 1], actual[j - 1]))
            i, j = i - 1, j - 1
        elif i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
            ops.append(("substitute", expected[i - 1], actual[j - 1]))
            i, j = i - 1, j - 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            ops.append(("omit", expected[i - 1], None))
            i -= 1
        else:
            ops.append(("insert", None, actual[j - 1]))
            j -= 1
    ops.reverse()
    return dp[n][m], ops


def run_ocr(image):
    raw_text = pytesseract.image_to_string(image, config=TESS_CONFIG).strip()
    try:
        data = pytesseract.image_to_data(image, config=TESS_CONFIG, output_type=Output.DICT)
        confidences = [float(c) for c in data.get("conf", []) if c not in ("-1", -1)]
        confidence = sum(confidences) / len(confidences) if confidences else None
    except Exception:
        confidence = None
    return raw_text, confidence


def evaluate(expected_text, image):
    raw_text, confidence = run_ocr(image)
    expected_norm = normalize(expected_text)
    actual_norm = normalize(raw_text)

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
        "expectedText": expected_text,
        "rawOcrText": raw_text,
        "expectedNormalized": expected_norm,
        "actualNormalized": actual_norm,
        "exactMatch": expected_norm == actual_norm,
        "charAccuracy": round(char_accuracy, 4),
        "wordAccuracy": round(word_accuracy, 4),
        "confidence": round(confidence, 1) if confidence is not None else None,
        "substitutedChars": substituted,
        "omittedChars": omitted,
        "insertedChars": inserted,
        "editDistance": distance
    }
