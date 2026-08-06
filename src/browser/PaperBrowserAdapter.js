/**
 * Browser-only compatibility shim for the `paper` npm package.
 *
 * Paper.js ships no ES-module build (its `package.json` has no
 * `module`/`exports`/`type` field; `main` is a UMD bundle). `index.html`
 * loads `node_modules/paper/dist/paper-full.js` as a classic, non-module
 * `<script>` tag before this adapter's consumers run, which attaches the
 * API to `window.paper`. This adapter bridges that gap by re-exporting
 * `window.paper` as a default export, the same shape a real ES-module
 * build would expose.
 */
export default window.paper;
