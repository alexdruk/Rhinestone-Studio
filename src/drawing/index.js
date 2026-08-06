// RS-3010: barrel for src/drawing/** -- app.js must only import permanent modules through a
// src/*/index.js barrel, per tools/test-architecture-module-boundaries.mjs. Mirrors every other
// permanent module's barrel shape (src/monogram/index.js, src/history/index.js, ...).
export { createDrawingTool } from './DrawingCanvasTool.js';
export { DRAWING_ZOOM_MIN, DRAWING_ZOOM_MAX } from './DrawingBoard.js';
