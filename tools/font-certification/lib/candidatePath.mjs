/**
 * Derives the version-specific output folder from a candidate TTF path, for FONT-CERT-001A.
 *
 * A candidate path is expected to follow the repo's own fonts/candidates/<Family>/ttf/<Version>/
 * convention (see fonts/candidates/Elegant-Cursive/ttf/v001/, .../v002/). The output folder mirrors
 * that family/version pair under tmp/font-certification/ -- so certify.mjs never has to hardcode a
 * specific family or version, and never silently reuses a previous run's output folder for a
 * different candidate.
 */
import path from 'node:path';

/**
 * @param {string} candidateRelativePath e.g. "fonts/candidates/Elegant-Cursive/ttf/v002/Elegant-Cursive.ttf"
 * @returns {string} e.g. "tmp/font-certification/Elegant-Cursive/v002"
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
  return path.posix.join('tmp', 'font-certification', family, version);
}
