/**
 * Repo-root path resolution shared by the FONT-CERT-001 certification tool.
 *
 * Kept tiny and dependency-free so every other module in this tool (and its
 * tests) can resolve paths the same way tools/test-opentype-provider.mjs
 * already does, without each re-deriving import.meta.url math.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function repoPath(...segments) {
  return path.join(REPO_ROOT, ...segments);
}
