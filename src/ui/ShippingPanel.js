/**
 * ARC-001 (App.js Consolidation, Phase 1) — Shipping & Handling panel moved out of app.js verbatim.
 * shippingInfo is session-local UI state (never part of `project`, never undo/redo-tracked, never
 * exported) mirrored to/from the Shipping Lightbox's form fields. Zero knowledge of
 * Project/Layer/StoneLayout. app.js is the only caller: it calls wireShippingApply() once at
 * startup and syncShippingFieldsFromState() from the Shipping Lightbox's onOpen callback.
 */
import { el } from './DomUtils.js';

export const shippingInfo = { packageType: 'box', lengthMm: '', widthMm: '', heightMm: '', weightG: '', notes: '', fragile: false };

export function syncShippingFieldsFromState() {
  el('shipPackageType').value = shippingInfo.packageType; el('shipLengthMm').value = shippingInfo.lengthMm;
  el('shipWidthMm').value = shippingInfo.widthMm; el('shipHeightMm').value = shippingInfo.heightMm;
  el('shipWeightG').value = shippingInfo.weightG; el('shipNotes').value = shippingInfo.notes; el('shipFragile').checked = shippingInfo.fragile;
}

export function wireShippingApply() {
  el('shipApply').onclick = () => {
    shippingInfo.packageType = el('shipPackageType').value; shippingInfo.lengthMm = el('shipLengthMm').value;
    shippingInfo.widthMm = el('shipWidthMm').value; shippingInfo.heightMm = el('shipHeightMm').value;
    shippingInfo.weightG = el('shipWeightG').value; shippingInfo.notes = el('shipNotes').value; shippingInfo.fragile = el('shipFragile').checked;
    el('status').textContent = 'Shipping & Handling notes updated (this session only).';
  };
}
