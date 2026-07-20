/**
 * ARC-001 (App.js Consolidation, Phase 1) — generic browser file-download helpers moved out of
 * app.js verbatim. Pure DOM/Blob/URL helpers only: no Project/Layer/StoneLayout/layer-type
 * knowledge. app.js is the only caller (every export button handler).
 */
import { el } from './DomUtils.js';

export function download(name, mime, data) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 800);
  el('status').textContent = `Downloaded ${name}`;
}

export function exportCanvas(name, canvas) {
  canvas.toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 800);
  }, 'image/png');
}
