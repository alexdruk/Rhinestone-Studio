"""
FONT-GEN-001 -- rasterizes already-computed StoneLayout stone centers into PNG images.

Per CLAUDE.md, geometry/stones are never generated here -- every stone position consumed by this
module already came from the real GeometryEngine/StoneLayout pipeline (measure.mjs ->
productionAnalysis.mjs's analyzeOne). This module is a visualization consumer only, exactly like
src/renderer's 2D Canvas renderer or tools/font-certification's specimenPages.mjs (which does the
same thing as inline SVG) -- it just targets PNG instead, per this milestone's "no SVG output"
restriction.

Two renders per case, for two different audiences:
  - render_review_png(): individual gold-on-dark stone circles, matching the existing rhinestone
    specimen look (specimenPages.mjs) -- for human visual review.
  - render_ocr_image(): black stones on white, supersampled then Gaussian-blurred and downsampled
    so adjacent stones' anti-aliased halos merge into continuous strokes. This mirrors how a human
    perceives a real rhinestone applique from normal viewing distance (the eye integrates
    discrete points into continuous letterforms) -- without this step, OCR (trained on continuous
    glyph strokes) sees only isolated dots and cannot recognize any text at all, regardless of the
    underlying layout's actual readability. Documented explicitly in the FONT-GEN-001 report.
"""
from PIL import Image, ImageDraw, ImageFilter

SUPERSAMPLE = 4
MAX_FINAL_WIDTH_PX = 6000  # tesseract/leptonica has an internal ~32k px ceiling, and review images
# this wide are unusable in a browser anyway; long corpus items (e.g. the full 26-letter alphabet
# as one line) can legitimately span meters at large committed heights, so px_per_mm is scaled down
# for these instead of ever hitting that ceiling or producing an unviewable image.


def _bounds(stones, pad_mm):
    xs = [s["xMm"] for s in stones]
    ys = [s["yMm"] for s in stones]
    return (min(xs) - pad_mm, min(ys) - pad_mm, max(xs) + pad_mm, max(ys) + pad_mm)


def render_review_png(stones, out_path, px_per_mm=10, min_stone_px=6):
    if not stones:
        Image.new("RGB", (200, 80), (15, 23, 32)).save(out_path)
        return
    pad_mm = max(s["sizeMm"] for s in stones)
    minx, miny, maxx, maxy = _bounds(stones, pad_mm)
    width_mm = maxx - minx
    if width_mm * px_per_mm > MAX_FINAL_WIDTH_PX:
        px_per_mm = MAX_FINAL_WIDTH_PX / width_mm
    w = max(1, int((maxx - minx) * px_per_mm))
    h = max(1, int((maxy - miny) * px_per_mm))
    img = Image.new("RGB", (w, h), (15, 23, 32))
    draw = ImageDraw.Draw(img)
    for s in stones:
        cx = (s["xMm"] - minx) * px_per_mm
        # StoneLayout's yMm is already Y-down (opentype.js's getPath() negates font-space Y
        # internally for direct canvas rendering, and GeometryEngine/CanvasRenderer2D.js's own
        # renderStoneLayout() maps yPx = oy + stone.yMm * s with no flip at all -- see
        # docs/specifications' FONT-GEN orientation-bug investigation). No flip here either.
        cy = (s["yMm"] - miny) * px_per_mm
        r = max(min_stone_px / 2, (s["sizeMm"] / 2) * px_per_mm)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(243, 189, 50), outline=(92, 66, 0))
    img.save(out_path)


def render_ocr_image(stones, px_per_mm=16, blur_mm=None):
    """Returns a PIL Image (grayscale) ready for pytesseract -- not saved to disk by default."""
    if not stones:
        return Image.new("L", (200, 80), 255)
    pad_mm = max(s["sizeMm"] for s in stones) * 2
    minx, miny, maxx, maxy = _bounds(stones, pad_mm)
    width_mm = maxx - minx
    if width_mm * px_per_mm > MAX_FINAL_WIDTH_PX:
        px_per_mm = MAX_FINAL_WIDTH_PX / width_mm
    scale = px_per_mm * SUPERSAMPLE
    w = max(1, int((maxx - minx) * scale))
    h = max(1, int((maxy - miny) * scale))
    img = Image.new("L", (w, h), 255)
    draw = ImageDraw.Draw(img)
    for s in stones:
        cx = (s["xMm"] - minx) * scale
        # See render_review_png()'s comment -- yMm is already Y-down, no flip needed.
        cy = (s["yMm"] - miny) * scale
        r = (s["sizeMm"] / 2) * scale
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=0)

    if blur_mm is None:
        blur_mm = stones[0]["sizeMm"] * 0.55  # merges adjacent stones without erasing letterforms
    blur_px = blur_mm * scale
    img = img.filter(ImageFilter.GaussianBlur(radius=blur_px))
    img = img.point(lambda p: 0 if p < 200 else 255)  # re-binarize after blur for clean OCR input
    img = img.resize((max(1, w // SUPERSAMPLE), max(1, h // SUPERSAMPLE)), Image.LANCZOS)
    # Pad with white margin -- tesseract performs poorly on text touching the image edge.
    margin = 24
    padded = Image.new("L", (img.width + margin * 2, img.height + margin * 2), 255)
    padded.paste(img, (margin, margin))
    return padded
