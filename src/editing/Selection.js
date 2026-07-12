/**
 * Selection — RS-1009.
 *
 * The one, pure implementation of "how a multi-selection changes." `app.js` holds the actual
 * `Set<string>` state (`selectedLayerIds`) and is the only caller of these three functions —
 * every entry point that changes selection (canvas click, layers-list click, the layer dropdown,
 * new/duplicate/delete/import) goes through them, so there is exactly one selection model, not a
 * second one layered on top of `selectedLayerId`. Never mutates its input.
 */

/** @returns {Set<string>} A new selection containing only `id`. */
export function selectOnly(id) {
  return new Set([id]);
}

/** @returns {Set<string>} A new selection with `id` added if absent, removed if present. */
export function toggleSelection(selectedIds, id) {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** @returns {Set<string>} An empty selection. */
export function clearSelection() {
  return new Set();
}

/**
 * RS-1010: the one place a multi-id selection is ever constructed directly (Alt/Option-drag
 * duplicate needs to select every newly created copy at once, which selectOnly/toggleSelection
 * can't express) -- still routes through this module, preserving "no second selection model."
 * @returns {Set<string>} A new selection containing exactly the given ids.
 */
export function selectMany(ids) {
  return new Set(ids);
}
