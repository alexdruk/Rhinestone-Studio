/**
 * IMG-026 (C2): which Image → Strass lightbox controls show for the selected image layer, and the
 * "Colours used" rows of an ai-layout layer. Pure: renderImageStudio() and
 * syncImageRedrawControls() in app.js apply the result and do not restate these rules. See
 * docs/specifications/IMG-026-StrassLayoutService.md, "Who sees what" and "Colours used (S17)".
 */
import { STONE_COLORS } from '../renderer/CrystalColors.js';

const TRY_AGAIN = 'Try again';
const REDRAW_WITH_AI = 'Redraw with AI';
const LOW_COVERAGE = 0.5;

/**
 * @param {object|null} layer the selected image layer, or null
 * @param {{available?:boolean, runningLayerId?:(string|null), failed?:boolean}} options
 *   `runningLayerId` is the layer id of the running redraw (null when none); `failed` is true when
 *   this layer's last run in this session failed, was declined, was cancelled or fell back to the
 *   old method.
 * @returns {{legacy:boolean, aiColours:boolean, aiStats:boolean, redrawButton:(string|null), useOriginal:boolean, views:{mask:boolean, colours:boolean, ai:boolean}}}
 */
export function imageStudioState(layer, { available = false, runningLayerId = null, failed = false } = {}) {
  const hasLayer = Boolean(layer);
  const isAiLayout = hasLayer && layer.fillMode === 'ai-layout';
  const running = runningLayerId !== null && runningLayerId !== undefined;
  let redrawButton = null;
  if (hasLayer && available && !running) {
    if (isAiLayout) {
      const coverage = layer.aiLayout && layer.aiLayout.report ? layer.aiLayout.report.coverage : undefined;
      redrawButton = typeof coverage === 'number' && coverage < LOW_COVERAGE ? TRY_AGAIN : null;
    } else {
      redrawButton = failed ? TRY_AGAIN : REDRAW_WITH_AI;
    }
  }
  return {
    legacy: hasLayer && !isAiLayout && runningLayerId !== layer.id,
    aiColours: isAiLayout,
    aiStats: isAiLayout,
    redrawButton,
    useOriginal: hasLayer && Boolean(layer.redraw) && !isAiLayout && !running,
    views: { mask: !isAiLayout, colours: !isAiLayout, ai: hasLayer && Boolean(layer.redraw) }
  };
}

/**
 * One row per colour id in `aiLayout.stones`: `count` stones carry that original id, `toId` is its
 * swap target (itself when not swapped). Highest count first; ties follow STONE_COLORS key order.
 * @param {{stones:Array<[number,number,string,string]>}} aiLayout
 * @param {Object<string,string>} [colorSwaps]
 * @returns {Array<{fromId:string, toId:string, count:number}>}
 */
export function aiLayoutColourRows(aiLayout, colorSwaps) {
  const counts = new Map();
  for (const stone of aiLayout.stones) counts.set(stone[3], (counts.get(stone[3]) || 0) + 1);
  const order = Object.keys(STONE_COLORS);
  const rank = (id) => { const i = order.indexOf(id); return i === -1 ? order.length : i; };
  const swaps = colorSwaps && typeof colorSwaps === 'object' ? colorSwaps : {};
  return [...counts].map(([fromId, count]) => ({
    fromId,
    toId: Object.prototype.hasOwnProperty.call(swaps, fromId) ? swaps[fromId] : fromId,
    count
  })).sort((a, b) => b.count - a.count || rank(a.fromId) - rank(b.fromId));
}
