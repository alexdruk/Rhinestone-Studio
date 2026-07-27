/**
 * Deterministic, bounded visual variation for the crystal-shine rendering treatment (PREVIEW-001).
 *
 * Pure and DOM-free: every value is derived only from a stone's own stable fields (xMm, yMm,
 * sizeMm, color, layerId, index) via a plain string hash + seeded PRNG -- never Math.random() or
 * wall-clock time -- so the same StoneLayout always renders identically after reload, and two
 * stones at different positions/sizes get independent (but reproducible) variation.
 *
 * This module never reads or writes a Stone/StoneLayout beyond the fields listed above: it has no
 * knowledge of rendering, canvas, or Three.js, and produces plain numbers/booleans only. Consumed
 * by src/renderer/CrystalStoneRenderer.js (2D canvas) and src/preview3d/StoneLayoutTexture.js (3D
 * texture) so both previews derive the same per-stone look from the same seed.
 */

// FNV-1a: a small, fast, well-distributed non-cryptographic string hash -- deterministic across
// runs/platforms (unlike Object/Map iteration order or Math.random), which is the only property
// this needs.
function fnv1aHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: a tiny seeded PRNG. Deterministic for a given 32-bit seed, which is all this needs
// -- not used anywhere security-sensitive.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stable per-stone seed. Rounding xMm/yMm/sizeMm to 4 decimal places keeps the seed immune to
 * float noise from repeated generation while remaining precise enough that any two stones a
 * production layout would treat as visually distinct also get independent seeds.
 *
 * @param {{xMm:number,yMm:number,sizeMm:number,color?:string,layerId?:string,index?:number|null}} stone
 * @returns {number} unsigned 32-bit integer
 */
export function crystalSeedForStone(stone) {
  const key = [
    stone.xMm.toFixed(4),
    stone.yMm.toFixed(4),
    stone.sizeMm.toFixed(4),
    stone.color || '',
    stone.layerId || '',
    stone.index ?? ''
  ].join('|');
  return fnv1aHash(key);
}

// ~1 in 8 stones is sparkle-eligible -- restrained per PREVIEW-001 ("not every stone"). Left
// unchanged by PREVIEW-001A (already within the 10-12.5% band that milestone asked to preserve).
const SPARKLE_ELIGIBILITY = 0.125;

// PREVIEW-001A: sparkle-eligible stones get one of several deterministic glint shapes instead of
// always the same cross -- see CrystalStoneRenderer.js's drawSparkle() for what each index draws
// (0 small cross, 1 diagonal, 2 tiny point glint, 3 brighter highlight with no star shape).
export const SPARKLE_VARIANT_COUNT = 4;

/**
 * Derives bounded, deterministic visual-only parameters for one stone. Never mutates `stone`.
 *
 * @param {{xMm:number,yMm:number,sizeMm:number,color?:string,layerId?:string,index?:number|null}} stone
 * @returns {{
 *   seed:number,
 *   facetAngleDeg:number,        // [0,180) -- facet/highlight rotation
 *   highlightIntensity:number,   // [0.7,1.0] -- primary specular strength
 *   secondaryAngleDeg:number,    // [0,360) -- secondary reflection placement
 *   secondaryIntensity:number,   // [0.25,0.55] -- secondary reflection strength
 *   shadowStrength:number,       // [0.3,0.55] -- cast-shadow/rim darkening strength
 *   brightness:number,           // [0.92,1.08] -- subtle body brightness multiplier
 *   sparkle:boolean,              // deterministic sparkle eligibility (~12.5% of stones)
 *   sparkleVariant:number         // [0,SPARKLE_VARIANT_COUNT) -- which glint shape, when sparkle is true
 * }}
 */
export function getCrystalAppearance(stone) {
  const seed = crystalSeedForStone(stone);
  const rand = mulberry32(seed);

  return {
    seed,
    facetAngleDeg: rand() * 180,
    highlightIntensity: 0.7 + rand() * 0.3,
    secondaryAngleDeg: rand() * 360,
    secondaryIntensity: 0.25 + rand() * 0.3,
    shadowStrength: 0.3 + rand() * 0.25,
    brightness: 0.92 + rand() * 0.16,
    sparkle: rand() < SPARKLE_ELIGIBILITY,
    sparkleVariant: Math.floor(rand() * SPARKLE_VARIANT_COUNT)
  };
}
