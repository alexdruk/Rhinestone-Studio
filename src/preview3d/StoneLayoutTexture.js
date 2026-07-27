/**
 * Generates a canvas texture directly from StoneLayout for the 3D preview (RS-1006).
 *
 * Pure Canvas-2D drawing -- no Three.js import, and no canvas element creation of its own (the
 * caller supplies the 2D context, exactly like src/renderer/CanvasRenderer2D.js's drawStone()
 * already does). That is what makes this module unit-testable with the same dependency-free fake
 * CanvasRenderingContext2D convention tools/test-object-preview-renderer.mjs already uses, with no
 * real canvas/DOM/Three.js required.
 *
 * Millimeter scaling: TEXTURE_PX_PER_MM is fixed, so the texel-to-mm ratio never changes with
 * object size -- a 40mm-tall tumbler and a 300mm-wide bottle wrap both get exactly the same
 * texture sharpness, and texture cost stays flat and predictable for any production size.
 */
import { drawCrystalStone } from '../renderer/CrystalStoneRenderer.js';
import { getCrystalAppearance } from '../renderer/CrystalAppearance.js';

export const TEXTURE_PX_PER_MM = 8;

/**
 * @param {number} widthMm
 * @param {number} heightMm
 * @returns {{widthPx:number, heightPx:number}}
 */
export function textureSizeForMm(widthMm, heightMm) {
  return {
    widthPx: Math.max(2, Math.round(widthMm * TEXTURE_PX_PER_MM)),
    heightPx: Math.max(2, Math.round(heightMm * TEXTURE_PX_PER_MM))
  };
}

/**
 * Draws the production-canvas background plus every stone (as a shaded circle at its true mm
 * position) into `ctx`. The caller owns the canvas element/texture object; this function only
 * draws into whatever 2D context it is given, sized via textureSizeForMm().
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {object} options
 * @param {number} options.widthMm
 * @param {number} options.heightMm
 * @param {string} options.backgroundColor Hex color, e.g. '#1f3556' -- the object's base color,
 *   painted into every texel the design does not cover.
 * @returns {{widthPx:number, heightPx:number}}
 */
export function drawStoneLayoutTexture(ctx, stoneLayout, { widthMm, heightMm, backgroundColor }) {
  const { widthPx, heightPx } = textureSizeForMm(widthMm, heightMm);
  const pxPerMm = TEXTURE_PX_PER_MM;

  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, widthPx, heightPx);

  for (const stone of stoneLayout.stones) {
    const x = stone.xMm * pxPerMm;
    const y = stone.yMm * pxPerMm;
    const r = Math.max(0.75, (stone.sizeMm / 2) * pxPerMm);
    // PREVIEW-001: reuses CanvasRenderer2D's faceted-crystal drawing (same appearance seed) so the
    // 3D preview's baked texture and the 2D canvas render the same stone the same way, instead of
    // a second flat-dot implementation drifting from it.
    drawCrystalStone(ctx, x, y, r, stone.color, getCrystalAppearance(stone));
  }

  return { widthPx, heightPx };
}
