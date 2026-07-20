// Shared helper for the "this test is registered in the suite" checks in
// tools/test-s107-long-text-readability.mjs, tools/test-s110-design-shapes-consolidation.mjs,
// tools/test-s110a-smart-shape-to-text-creation.mjs, and tools/test-s112a-plate-ux-corrections.mjs.
//
// CI-001 replaced package.json's hand-maintained "&&" chains with tools/run-tests.mjs +
// tools/test-groups.mjs (see docs/specifications/CI-001-RealTestExecution.md); package.json no
// longer enumerates test filenames, so a check that greps its literal text for a filename is
// permanently obsolete, not a regression. The real registration contract now lives in
// tools/test-groups.mjs (which named group a file belongs to, and the default-suite exclusion
// list) and in tools/run-tests.mjs's own selection logic — this helper checks both directly, so a
// genuine regression (a file silently dropped from its group, or from the default/full suite)
// still fails loudly.

import assert from 'node:assert/strict';
import { GROUPS, EXCLUDED_FROM_DEFAULT } from '../test-groups.mjs';
import { resolveSelection, parseArgs } from '../run-tests.mjs';

export function assertTestRegistered({ filename, group, includedInDefault }) {
  assert.ok(
    Object.prototype.hasOwnProperty.call(GROUPS, group),
    `tools/test-groups.mjs has no group named "${group}"`,
  );
  assert.ok(
    GROUPS[group].includes(filename),
    `expected tools/test-groups.mjs GROUPS.${group} to include ${filename}`,
  );

  const isExcludedFromDefault = EXCLUDED_FROM_DEFAULT.includes(filename);
  assert.strictEqual(
    !isExcludedFromDefault,
    includedInDefault,
    includedInDefault
      ? `expected ${filename} not to be in tools/test-groups.mjs's EXCLUDED_FROM_DEFAULT`
      : `expected ${filename} to be in tools/test-groups.mjs's EXCLUDED_FROM_DEFAULT`,
  );

  const defaultSelection = resolveSelection(parseArgs([]));
  assert.strictEqual(
    defaultSelection.includes(filename),
    includedInDefault,
    includedInDefault
      ? `expected the default "node tools/run-tests.mjs" selection (what \`npm test\` runs) to include ${filename}`
      : `expected the default "node tools/run-tests.mjs" selection (what \`npm test\` runs) NOT to include ${filename}`,
  );

  const fullSelection = resolveSelection(parseArgs(['--all']));
  assert.ok(
    fullSelection.includes(filename),
    `expected "node tools/run-tests.mjs --all" (what \`npm run test:full\` runs) to include ${filename}`,
  );
}
