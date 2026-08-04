/**
 * Affine transform math for SVG import.
 *
 * A matrix is a plain object { a, b, c, d, e, f } representing:
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 * (the same convention as SVG's own `matrix(a,b,c,d,e,f)` transform function).
 *
 * No DOM/Canvas dependency — pure numeric math, so it runs identically under
 * plain Node (tests) and the browser.
 */

export const IDENTITY_MATRIX = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * Compose two matrices so that applying the result to a point is equivalent to
 * applying `inner` first, then `outer`: apply(compose(outer,inner), p) === apply(outer, apply(inner, p)).
 * Used both to fold a `transform="..."` function list (left-to-right token order composes with the
 * later token as `inner`) and to combine a parent group's matrix (`outer`) with a child's own
 * transform (`inner`).
 *
 * @param {{a:number,b:number,c:number,d:number,e:number,f:number}} outer
 * @param {{a:number,b:number,c:number,d:number,e:number,f:number}} inner
 * @returns {{a:number,b:number,c:number,d:number,e:number,f:number}}
 */
export function composeMatrix(outer, inner) {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f
  };
}

/**
 * @param {{a:number,b:number,c:number,d:number,e:number,f:number}} m
 * @param {number} x
 * @param {number} y
 * @returns {{x:number,y:number}}
 */
export function applyMatrix(m, x, y) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function translateMatrix(tx, ty) {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty || 0 };
}

function scaleMatrix(sx, sy) {
  return { a: sx, b: 0, c: 0, d: sy === undefined ? sx : sy, e: 0, f: 0 };
}

function rotateMatrix(deg, cx = 0, cy = 0) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotation = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  if (!cx && !cy) return rotation;
  return composeMatrix(composeMatrix(translateMatrix(cx, cy), rotation), translateMatrix(-cx, -cy));
}

function skewXMatrix(deg) {
  return { a: 1, b: 0, c: Math.tan((deg * Math.PI) / 180), d: 1, e: 0, f: 0 };
}

function skewYMatrix(deg) {
  return { a: 1, b: Math.tan((deg * Math.PI) / 180), c: 0, d: 1, e: 0, f: 0 };
}

/**
 * Parse an SVG `transform` attribute value into a single composed matrix. Unknown/unsupported
 * function names are ignored (treated as identity) rather than throwing, since a transform list is
 * presentation detail on top of otherwise-usable geometry.
 *
 * @param {string|null|undefined} value
 * @returns {{a:number,b:number,c:number,d:number,e:number,f:number}}
 */
export function parseTransformList(value) {
  if (!value || typeof value !== 'string') return IDENTITY_MATRIX;

  let result = IDENTITY_MATRIX;
  const functionPattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match;

  while ((match = functionPattern.exec(value))) {
    const name = match[1];
    const args = match[2]
      .split(/[\s,]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .map(Number);

    let token;
    switch (name) {
      case 'translate':
        token = translateMatrix(args[0] || 0, args[1] || 0);
        break;
      case 'scale':
        token = scaleMatrix(args[0] === undefined ? 1 : args[0], args[1]);
        break;
      case 'rotate':
        token = rotateMatrix(args[0] || 0, args[1] || 0, args[2] || 0);
        break;
      case 'skewX':
        token = skewXMatrix(args[0] || 0);
        break;
      case 'skewY':
        token = skewYMatrix(args[0] || 0);
        break;
      case 'matrix':
        if (args.length === 6 && args.every((n) => Number.isFinite(n))) {
          token = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
        }
        break;
      default:
        break;
    }

    if (token) result = composeMatrix(result, token);
  }

  return result;
}
