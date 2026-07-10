/**
 * Browser-only compatibility shim for the `opentype.js` npm package.
 *
 * `src/text/OpenTypeProvider.js` imports `opentype.js` as a default import
 * because Node resolves the bare specifier to the package's CommonJS/UMD
 * `main` build, which exposes its API as a default export. The browser
 * import map instead resolves the same bare specifier to the package's
 * native ES-module `module` build, which only exposes named exports and has
 * no default export. This adapter bridges that gap by importing the real
 * ES-module build directly (by relative path, not by bare specifier) and
 * re-exporting the API shape `OpenTypeProvider` expects as a default export.
 * `OpenTypeProvider.js` itself stays untouched.
 */
import * as opentypeEsm from '../../node_modules/opentype.js/dist/opentype.mjs';

export default {
  parse: opentypeEsm.parse
};
