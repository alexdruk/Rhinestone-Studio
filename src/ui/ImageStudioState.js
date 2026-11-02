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

// IMG-026 (build P): an Image -> Strass layer's look. `redrawMode` is 'colour' (the default) or 'bw';
// for Black & white, `redrawBwStyle` is 'bold' (the default) or 'shaded'. A layer without them (every
// layer made before build P) is Colour. Changing them changes the prompt, so it needs a new redraw.
export const REDRAW_MODES = Object.freeze(['colour', 'bw']);
export const REDRAW_BW_STYLES = Object.freeze(['bold', 'shaded']);

/**
 * @param {object|null} layer
 * @returns {{mode:('colour'|'bw'), bwStyle:('bold'|'shaded')}} the layer's look; anything unknown is the default
 */
export function redrawLookOf(layer) {
  const mode = layer && layer.redrawMode === 'bw' ? 'bw' : 'colour';
  const bwStyle = layer && layer.redrawBwStyle === 'shaded' ? 'shaded' : 'bold';
  return { mode, bwStyle };
}

/** The redraw style (server/redraw/prompt.mjs) a look asks for: 'stones' for Colour, else its style. */
export function redrawStyleForLook({ mode, bwStyle }) {
  return mode === 'bw' ? (bwStyle === 'shaded' ? 'shaded' : 'bold') : 'stones';
}

/** The layer fields that store a look: Black & white keeps its style, Colour has none. */
export function redrawLookFields({ mode, bwStyle }) {
  return mode === 'bw' ? { redrawMode: 'bw', redrawBwStyle: bwStyle === 'shaded' ? 'shaded' : 'bold' } : { redrawMode: 'colour' };
}

// True when the layer's stone redraw was made in another look than the one it now asks for. A flat
// redraw (dormant since IMG-026 D3) has no look.
function lookChanged(layer) {
  const r = layer && layer.redraw;
  if (!r || typeof r !== 'object' || r.style === 'flat') return false;
  return redrawStyleForLook(redrawLookOf(layer)) !== (typeof r.style === 'string' ? r.style : 'stones');
}

/**
 * @param {object|null} layer the selected image layer, or null
 * @param {{available?:boolean, runningLayerId?:(string|null), failed?:boolean}} options
 *   `runningLayerId` is the layer id of the running redraw (null when none); `failed` is true when
 *   this layer's last run in this session failed, was declined, was cancelled or fell back to the
 *   old method.
 * @returns {{legacy:boolean, aiColours:boolean, aiStats:boolean, redrawButton:(string|null), useOriginal:boolean, look:boolean, lookChanged:boolean, views:{mask:boolean, colours:boolean, ai:boolean}}}
 *   IMG-026 (build P): `look` shows the Colour / Black & white choice (whenever a redraw provider is
 *   available, so it can be set before an upload); `lookChanged` is true when the layer's redraw was
 *   made in another look, and then an ai-layout layer offers "Redraw with AI".
 */
export function imageStudioState(layer, { available = false, runningLayerId = null, failed = false } = {}) {
  const hasLayer = Boolean(layer);
  const isAiLayout = hasLayer && layer.fillMode === 'ai-layout';
  const running = runningLayerId !== null && runningLayerId !== undefined;
  const changed = hasLayer && lookChanged(layer);
  let redrawButton = null;
  if (hasLayer && available && !running) {
    if (isAiLayout) {
      const coverage = layer.aiLayout && layer.aiLayout.report ? layer.aiLayout.report.coverage : undefined;
      redrawButton = changed ? REDRAW_WITH_AI : typeof coverage === 'number' && coverage < LOW_COVERAGE ? TRY_AGAIN : null;
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
    look: Boolean(available),
    lookChanged: changed,
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
