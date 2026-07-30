"""
FONT-GEN-001 -- systematic glyph-category rules.

Per the milestone brief: "Systematic glyph-category rules are acceptable when required" as an
alternative to manually editing individual glyph control points. These sets classify every
Sacramento glyph so glyph_transform.py can apply different procedural thresholds per category
instead of one blanket transform for all 375 glyphs -- e.g. a looped lowercase "o" needs counter-
enlargement headroom a narrow vertical "l" does not.

Categories are keyed by Unicode character (ASCII range only -- the corpus and required phrases
never need anything outside it). A glyph may belong to more than one category (e.g. "b" is both
ascender and looped-lowercase).
"""

LOOPED_LOWERCASE = set("abdegopq")
NARROW_VERTICAL = set("ijltIJLT1")
ASCENDERS = set("bdfhklt")
DESCENDERS = set("gjpqy")
CAPITALS = set(chr(c) for c in range(ord("A"), ord("Z") + 1))
NUMERALS = set("0123456789")
COUNTER_BEARING = set("abdegopqABDOPQR0468")  # mirrors font-certification's readabilityMetrics.mjs set


def categories_for_char(ch: str) -> set:
    cats = set()
    if ch in LOOPED_LOWERCASE:
        cats.add("looped-lowercase")
    if ch in NARROW_VERTICAL:
        cats.add("narrow-vertical")
    if ch in ASCENDERS:
        cats.add("ascender")
    if ch in DESCENDERS:
        cats.add("descender")
    if ch in CAPITALS:
        cats.add("capital")
    if ch in NUMERALS:
        cats.add("numeral")
    if ch in COUNTER_BEARING:
        cats.add("counter-bearing")
    if not cats:
        cats.add("plain-lowercase")
    return cats
