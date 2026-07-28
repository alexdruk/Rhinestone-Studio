#!/usr/bin/env python3
"""FONT-GEN-001 focused test -- structural validity of every generated font (validate_font.py)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_font import validate, ALL_SIZES


def main():
    failures = []
    for size_id in ALL_SIZES:
        result = validate(size_id)
        if not result["passed"]:
            failures.append((size_id, result["findings"]))
        print(f"{'PASS' if result['passed'] else 'FAIL'}: {size_id} structural validation")

    assert not failures, f"Structural validation failed: {failures}"
    print("PASS: all 5 generated fonts pass structural validation")


if __name__ == "__main__":
    main()
