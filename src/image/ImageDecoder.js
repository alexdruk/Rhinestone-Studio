/**
 * The one DOM-dependent file in src/image/** (RS-1008).
 *
 * Decoding PNG/JPEG/WebP bytes into pixel data is not hand-rolled the way src/svg/** hand-rolled
 * an XML/path parser — the browser's own createImageBitmap()/<canvas> already do this natively for
 * all three required formats with zero new dependency, and AI_ENGINEER.md disallows adding one
 * without material need. This isolates that one unavoidable browser-only step, matching
 * src/browser/OpenTypeBrowserAdapter.js's existing "isolate the DOM-only glue" precedent — every
 * pixel-processing/sampling function downstream (Grayscale.js through ImageTracePipeline.js) stays
 * DOM-free and Node-testable.
 *
 * isSupportedImageFile() is deliberately pure (no DOM) so its MIME/extension logic has a real
 * Node unit test; only decodeImageFileToBuffer()/readFileAsDataUrl() require a browser.
 */

import { createImageBuffer } from './ImageBuffer.js';

export const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

// Generous headroom above the documented 2000x2000px target working size (Performance section of
// docs/specifications/RS-1008-ImageTrace.md) -- a bound on decode/memory cost, not on the useful
// working resolution (Maximum width/height already caps that further downstream).
export const MAX_SOURCE_DIMENSION_PX = 4000;

/**
 * Pure MIME/extension check — no DOM. Checks `type` first; a file with an empty/incorrect MIME
 * type (some OS/browser combinations do not populate `File.type` reliably) falls back to a
 * filename-extension check.
 *
 * @param {{name?: string, type?: string}} file
 * @returns {boolean}
 */
export function isSupportedImageFile(file) {
  if (!file) return false;
  if (typeof file.type === 'string' && SUPPORTED_IMAGE_MIME_TYPES.has(file.type)) {
    return true;
  }
  if (typeof file.name === 'string') {
    const dot = file.name.lastIndexOf('.');
    if (dot >= 0) {
      const ext = file.name.slice(dot).toLowerCase();
      return SUPPORTED_EXTENSIONS.has(ext);
    }
  }
  return false;
}

/**
 * Decode a File/Blob into an ImageBuffer (RGBA pixel data). Browser-only.
 *
 * @param {File|Blob} file
 * @returns {Promise<{widthPx: number, heightPx: number, data: Uint8ClampedArray}>}
 */
export async function decodeImageFileToBuffer(file) {
  if (!isSupportedImageFile(file)) {
    throw new Error(`Unsupported image type: ${file?.type || file?.name || 'unknown'}. Supported formats: PNG, JPG/JPEG, WebP.`);
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    throw new Error(`Failed to decode image file: ${error.message}`);
  }

  if (bitmap.width > MAX_SOURCE_DIMENSION_PX || bitmap.height > MAX_SOURCE_DIMENSION_PX) {
    bitmap.close?.();
    throw new Error(`Image is too large (${bitmap.width}x${bitmap.height}px); maximum supported source dimension is ${MAX_SOURCE_DIMENSION_PX}px.`);
  }

  // Captured before bitmap.close(): per spec, closing an ImageBitmap zeroes its width/height
  // getters, so they must not be read again after the close() call below.
  const widthPx = bitmap.width;
  const heightPx = bitmap.height;

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, widthPx, heightPx);
  bitmap.close?.();

  return createImageBuffer({ widthPx, heightPx, data: imageData.data });
}

/**
 * Read a File/Blob as a base64 data: URL, for project-persisted storage (`layer.imageSrc`).
 * Browser-only.
 *
 * @param {File|Blob} file
 * @returns {Promise<string>}
 */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Decode an already-persisted `data:` URL (layer.imageSrc) back into an ImageBuffer. Browser-only.
 * Used to regenerate stones for a committed image layer (undo/redo, duplicate, threshold/blur
 * edits) without re-prompting the user for the original file.
 *
 * @param {string} dataUrl
 * @returns {Promise<{widthPx: number, heightPx: number, data: Uint8ClampedArray}>}
 */
export async function decodeDataUrlToBuffer(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return decodeImageFileToBuffer(blob);
}
