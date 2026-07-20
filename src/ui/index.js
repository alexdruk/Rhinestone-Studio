/**
 * Public barrel for src/ui/** — UI-001. app.js imports only from here, matching every other
 * permanent module's "consumed only through its index.js" shape.
 */
export { Lightbox } from './Lightbox.js';
export { el, parseIntOr } from './DomUtils.js';
export { download, exportCanvas } from './DownloadHelpers.js';
export { shippingInfo, syncShippingFieldsFromState, wireShippingApply } from './ShippingPanel.js';
