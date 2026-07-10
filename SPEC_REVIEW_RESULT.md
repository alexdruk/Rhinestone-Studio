# Specification Review Result

## Specification

RS-0003.5B2 — Browser Dependency Loading
(`docs/specifications/RS-0003.5B2-BrowserDependencyLoading.md`)

## Review Round

3

## Reviewer

Claude

## Status

CHANGES REQUESTED

---

## Summary

Round 2's finding (the browser ESM build of `opentype.js` has no default export, so `import opentype from 'opentype.js'` cannot resolve against it as-is) was correctly diagnosed in this revision — "Required Implementation" item 1 now names the exact problem and Allowed Files now permits a minimal import-form change in `src/text/OpenTypeProvider.js`.

However, the fix this revision actually specifies — change `OpenTypeProvider.js` to a namespace import (`import * as opentype from 'opentype.js'`) — breaks the other runtime this same import statement must serve. This was verified directly and is a blocking correctness problem, not a style preference.

---

## Required Changes

### 1. "Required Implementation" item 1, sub-item 2 / "Allowed Files" — the mandated `OpenTypeProvider.js` import change breaks Node, not just the browser

`OpenTypeProvider.js` is loaded by two different resolvers today, and this task cannot change that:

- **Node** (`npm test`) resolves the bare specifier `opentype.js` via the package's `package.json` `"main"` field — `dist/opentype.js`, a UMD/CJS bundle.
- **Browser** (once this task adds an import map) resolves the same bare specifier to the package's `"module"` field — `dist/opentype.mjs`, a real ES module.

These two files have incompatible export shapes, verified directly:

```
$ node --input-type=module -e "import opentype from 'opentype.js'; console.log(typeof opentype.parse)"
function          # current default import: works today under Node

$ node --input-type=module -e "import * as opentype from 'opentype.js'; console.log(typeof opentype.parse, typeof opentype.default)"
undefined object  # namespace import under Node: .parse is gone, only .default (whole CJS exports) survives cjs-module-lexer's static analysis

$ node --input-type=module -e "import opentype from './node_modules/opentype.js/dist/opentype.mjs'; ..."
SyntaxError: does not provide an export named 'default'   # round-2 finding: default import fails against the real ESM build
```

So: the **default** import (current code) works under Node but fails under the browser's real ESM build (round 2's finding, correctly identified this round). The **namespace** import (this round's mandated fix) works under the browser's real ESM build, but breaks under Node — `opentype.parse` becomes `undefined`, since Node's CJS interop only exposes the UMD bundle's exports as `.default`, not as statically-analyzed named properties.

There is no single import statement in `OpenTypeProvider.js` that is correct against both resolvers simultaneously, because the two resolvers are being pointed at two structurally different files. Applying this round's mandated namespace-import change would satisfy the browser probe while silently breaking `npm run tools/test-opentype-provider.mjs` (confirmed: that suite currently passes 8/8 against the default import) — directly violating "No functional behavior of `OpenTypeProvider` may change," "while preserving existing runtime behavior," and "Existing tests continue to pass" (Required Automated Tests #20), all in the same document that mandates the change.

**Recommended correction:** revert "Required Implementation" item 1 to *not* touch `OpenTypeProvider.js` at all, and solve the mismatch entirely on the browser-mapping side, which the spec already anticipated as option 3 in "Dependency Strategy" ("a narrowly scoped browser adapter module... if the installed package cannot be loaded directly through the import map" — this is exactly that case). Concretely: add a small adapter module confined to `src/browser/**` that imports the real `opentype.js` ESM build by relative path and re-exports its named `parse` binding as a default export (e.g. `export { parse as default } from '<relative path to node_modules/opentype.js/dist/opentype.mjs>';`), and point the import map's `opentype.js` key at that adapter instead of at the package file directly. Then:

- Node's resolution of `OpenTypeProvider.js`'s existing unmodified default import is completely untouched (import maps are an HTML/browser mechanism; Node's ESM loader has no knowledge of them), so `npm test` keeps passing exactly as today.
- The browser's import map resolves `opentype.js` → the adapter → a genuine default export with `.parse`, matching what `OpenTypeProvider.js`'s existing, unmodified code already expects.

This keeps `src/text/**` fully out of scope again (reverting the new conditional allowance added this round), stays inside files already unconditionally allowed (`src/browser/**`), and requires zero behavior change to the permanent module — a stronger fit for "Import-only browser compatibility must be preferred over changing permanent module behavior," which this document already states as a principle but then contradicts with the mandated `OpenTypeProvider.js` edit.

If there is a reason the adapter approach was rejected in favor of editing `OpenTypeProvider.js` directly, please state it — otherwise this should revert to the adapter-only approach.

---

## Non-Blocking Recommendations

1. Minor typo: Allowed Files — "only for the minimal ES-module import compatibility change described **i** this specification" → "in this specification." Harmless, but worth a pass since this line is being cited as scope authority.
2. If the adapter approach (recommendation above) is adopted, Required Automated Tests item 21 ("OpenTypeProvider imports the browser ES-module build using the browser-compatible import form required by opentype.js") should be reworded — it currently presumes `OpenTypeProvider.js` itself changes its import form, which would no longer be true.

---

## Consistency Check

`docs/ARCHITECTURE.md`, `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`: no violations found beyond the item above. The rest of this revision (explicit `FontManager` naming, instantiation rules, MIME-type verification, forbidden-file list) remains internally consistent and matches actual repository state.

---

## Final Decision

CHANGES REQUESTED. Item 1 is a factual/correctness problem in the mandated fix, not a scope or architecture disagreement — resolving it (most likely by reverting to an adapter-only strategy) should make this specification implementation-ready.
