// Preloaded via `node --import` for every tools/test-*.mjs run (see tools/run-tests.mjs).
//
// Paper.js's own optional Node/jsdom auto-detection (node_modules/paper/dist/node/self.js) only
// runs when the global `self` is still falsy at the moment 'paper' is first imported. jsdom is now
// a project devDependency (RS-3011 Step 8, so tools/lib/paper-node-env.mjs can give
// paper.project.importSVG() a real DOMParser) -- which means paper's own self-detection can find
// it too, for ANY test that transitively imports 'paper' (currently: src/drawing/DrawingBoard.js,
// reachable from app.js's own module graph). That auto-detection is broken against modern jsdom:
// it tries to signal "no window" via `delete self.window`, but jsdom's `window.window` is a
// spec-mandated non-configurable accessor, so the delete silently no-ops, `window` stays truthy,
// and Paper.js crashes trying to get a 2D canvas context jsdom can't provide without the separate
// native `canvas` package (which this project intentionally does not add).
//
// Setting a plain, DOM-less `self` here -- before any test file's own code runs -- makes paper.js
// skip its own internal detection entirely, for every test EXCEPT the ones that explicitly opt in
// to a real DOM via tools/lib/paper-node-env.mjs (which overwrites `globalThis.self` with a richer
// shim before dynamically importing 'paper', taking precedence over this default). This keeps every
// other test's behavior identical to what it was before jsdom became a project dependency at all.
if (typeof globalThis.self === 'undefined') {
  globalThis.self = {
    navigator: { userAgent: `Node.js (${process.platform}; U; rv:${process.version})` }
  };
}
