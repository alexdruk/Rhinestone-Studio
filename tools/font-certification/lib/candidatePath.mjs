/**
 * Derives the version-specific output folder from a candidate TTF path, for FONT-CERT-001A/001B.
 *
 * A candidate path is expected to follow the repo's own fonts/candidates/<Family>/ttf/<Version>/
 * convention (see fonts/candidates/Elegant-Cursive/ttf/v001/, .../v002/). Per FONT-CERT-001B, the
 * output folder lives beside the candidate itself -- fonts/candidates/<Family>/certification/<Version>/
 * -- a sibling of that family's ttf/ folder, never under the repo's gitignored tmp/. This keeps
 * certification results retained (committable, reviewable in a PR) instead of being disposable
 * build output, while still requiring no hardcoded family/version and never reusing a previous run's
 * folder for a different candidate.
 */
import path from 'node:path';

/**
 * @param {string} candidateRelativePath e.g. "fonts/candidates/Elegant-Cursive/ttf/v002/Elegant-Cursive.ttf"
 * @returns {string} e.g. "fonts/candidates/Elegant-Cursive/certification/v002"
 */
export function deriveOutputRelativePath(candidateRelativePath) {
  if (typeof candidateRelativePath !== 'string' || candidateRelativePath.trim().length === 0) {
    throw new TypeError('deriveOutputRelativePath requires a non-empty candidate path string.');
  }

  const segments = candidateRelativePath.split(/[\\/]+/).filter(Boolean);
  const candidatesIndex = segments.indexOf('candidates');
  // "ttf" must be exactly the segment right after the family name (candidates/<Family>/ttf/...) --
  // not just present anywhere later in the path -- so a stray "ttf" elsewhere can't be mistaken for
  // the version-folder marker.
  const familyIndex = candidatesIndex + 1;
  const ttfIndex = familyIndex + 1;
  const versionIndex = ttfIndex + 1;
  const structureMatches = candidatesIndex !== -1 && segments[ttfIndex] === 'ttf' && segments.length > versionIndex;

  if (!structureMatches) {
    throw new Error(
      `deriveOutputRelativePath: candidate path "${candidateRelativePath}" does not match the expected ` +
      `"fonts/candidates/<Family>/ttf/<Version>/<file>.ttf" structure -- cannot derive a family/version output folder.`
    );
  }

  const family = segments[familyIndex];
  const version = segments[versionIndex];
  return path.posix.join('fonts', 'candidates', family, 'certification', version);
}
