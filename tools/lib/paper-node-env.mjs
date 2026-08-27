// Minimal Node-only shim so Paper.js's own optional jsdom auto-detection
// (node_modules/paper/dist/node/self.js) can give paper.project.importSVG() a real
// DOMParser/document. Must be awaited before 'paper' -- or anything that imports 'paper',
// e.g. src/drawing/DrawingBoard.js -- is itself imported, since paper.js reads the global
// `self` synchronously at module-evaluation time (ESM static imports would hoist ahead of
// this setup, so callers must use dynamic import() for both).
//
// Deliberately builds `self` without a `.window` property. Paper.js only picks its
// canvas-backed View (which needs a real 2D context, i.e. the native `canvas` npm package)
// when `window` is truthy; otherwise it uses its own headless View, which is all pure
// geometry/import work needs. Modern jsdom's `window.window` is spec-non-configurable, so
// paper's own `delete self.window` fallback (written against older jsdom) silently no-ops,
// leaving `window` truthy and crashing when jsdom's bare HTMLCanvasElement.getContext('2d')
// returns null (jsdom only implements 2D contexts when the native `canvas` package is also
// installed). Never setting `self.window` at all avoids that path entirely.
import { JSDOM } from 'jsdom';

let paperPromise = null;

export function loadPaperForNode() {
  if (!paperPromise) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const jsdomWindow = dom.window;
    globalThis.self = {
      document: jsdomWindow.document,
      DOMParser: jsdomWindow.DOMParser,
      XMLSerializer: jsdomWindow.XMLSerializer,
      navigator: { userAgent: `Node.js (${process.platform}; U; rv:${process.version})` }
    };
    paperPromise = import('paper').then((mod) => mod.default || mod);
  }
  return paperPromise;
}
