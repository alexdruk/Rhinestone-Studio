/**
 * ARC-001 (App.js Consolidation, Phase 1) — Shipping & Handling panel moved out of app.js verbatim.
 * shippingInfo is session-local UI state (never part of `project`, never undo/redo-tracked, never
 * exported) mirrored to/from the Shipping Lightbox's form fields. Zero knowledge of
 * Project/Layer/StoneLayout. app.js is the only caller: it calls wireShippingApply() once at
 * startup and syncShippingFieldsFromState() from the Shipping Lightbox's onOpen callback.
 * RS-3018: lengthMm/widthMm/heightMm are stored in mm (storage boundary, per LengthUnits.js) but
 * displayed/accepted in whatever unit the caller passes -- shippingInfo has no project.units of
 * its own, so the caller (app.js) supplies it. '' is preserved verbatim as "not yet entered".
 */
import { el } from './DomUtils.js';
import { displayValueToMm, formatLengthDisplay } from '../units/index.js';

export const shippingInfo = { packageType: 'box', lengthMm: '', widthMm: '', heightMm: '', weightG: '', notes: '', fragile: false };

export function syncShippingFieldsFromState(units) {
  el('shipPackageType').value = shippingInfo.packageType;
  el('shipLengthMm').value = shippingInfo.lengthMm === '' ? '' : formatLengthDisplay(shippingInfo.lengthMm, units);
  el('shipWidthMm').value = shippingInfo.widthMm === '' ? '' : formatLengthDisplay(shippingInfo.widthMm, units);
  el('shipHeightMm').value = shippingInfo.heightMm === '' ? '' : formatLengthDisplay(shippingInfo.heightMm, units);
  el('shipWeightG').value = shippingInfo.weightG; el('shipNotes').value = shippingInfo.notes; el('shipFragile').checked = shippingInfo.fragile;
}

export function wireShippingApply(getUnits) {
  el('shipApply').onclick = () => {
    const units = getUnits();
    shippingInfo.packageType = el('shipPackageType').value;
    shippingInfo.lengthMm = el('shipLengthMm').value === '' ? '' : displayValueToMm(el('shipLengthMm').value, units);
    shippingInfo.widthMm = el('shipWidthMm').value === '' ? '' : displayValueToMm(el('shipWidthMm').value, units);
    shippingInfo.heightMm = el('shipHeightMm').value === '' ? '' : displayValueToMm(el('shipHeightMm').value, units);
    shippingInfo.weightG = el('shipWeightG').value; shippingInfo.notes = el('shipNotes').value; shippingInfo.fragile = el('shipFragile').checked;
    el('status').textContent = 'Shipping & Handling notes updated (this session only).';
  };
}
