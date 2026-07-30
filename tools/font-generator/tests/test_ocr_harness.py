#!/usr/bin/env python3
"""
FONT-GEN-001 focused test -- OCR harness correctness (normalization + scoring), independent of any
generated font. Renders known-clean text with a standard system font so this test validates the
*harness*, not readability of the Sacramento variants (that's pipeline.py/analyze.py's job).
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.ocr_eval import evaluate, normalize, levenshtein_ops

SYSTEM_FONT = "/System/Library/Fonts/Helvetica.ttc"


def render_clean_text(text, size=80):
    img = Image.new("L", (max(200, len(text) * size), int(size * 1.8)), 255)
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(SYSTEM_FONT, size)
    draw.text((20, size // 4), text, font=font, fill=0)
    return img


def main():
    assert normalize("  Bride Squad!  ") == "bride squad"
    assert normalize("Class of 2027.") == "class of 2027"
    print("PASS: normalize() strips punctuation/case/whitespace correctly")

    distance, ops = levenshtein_ops("ashley", "ashiey")
    assert distance == 1
    assert any(op[0] == "substitute" and op[1] == "l" and op[2] == "i" for op in ops)
    print("PASS: levenshtein_ops() correctly classifies a substitution")

    for phrase in ["Ashley", "Happy Birthday", "Class of 2027"]:
        img = render_clean_text(phrase)
        result = evaluate(phrase, img)
        assert result["charAccuracy"] >= 0.9, f"OCR harness sanity check failed for clean text {phrase!r}: {result}"
        print(f"PASS: OCR harness reads clean '{phrase}' at charAccuracy={result['charAccuracy']}")

    print("PASS: OCR harness sanity checks")


if __name__ == "__main__":
    main()
