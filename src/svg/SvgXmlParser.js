/**
 * Minimal, dependency-free XML tokenizer sufficient for the SVG element/attribute subset this
 * importer supports. Not a general-purpose XML parser (no DTD/entity-definition processing, no
 * namespace resolution beyond keeping prefixed names as-is) — deliberately small so it runs
 * identically under plain Node (tests) and the browser with no DOMParser dependency.
 *
 * Units are otherwise irrelevant here: this module only builds a plain element tree
 * { name, attrs, children }; SVG-specific interpretation happens in SvgDocumentParser.js.
 */

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text) {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const codePoint = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

function parseAttrs(attrText) {
  const attrs = {};
  const pattern = /([^\s=/"'<>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(attrText))) {
    const name = match[1];
    const value = match[3] !== undefined ? match[3] : match[4];
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/**
 * Parse an XML/SVG source string into a root element tree.
 *
 * @param {string} source
 * @returns {{name:string, attrs:Object<string,string>, children:Array}}
 */
export function parseXml(source) {
  if (typeof source !== 'string') {
    throw new TypeError('parseXml requires a string.');
  }

  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const n = text.length;
  let i = 0;

  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];

  function currentParent() {
    return stack[stack.length - 1];
  }

  while (i < n) {
    const ltIndex = text.indexOf('<', i);
    if (ltIndex === -1) break;
    i = ltIndex;

    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i);
      if (end === -1) throw new Error('Malformed SVG: unterminated processing instruction.');
      i = end + 2;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i);
      if (end === -1) throw new Error('Malformed SVG: unterminated comment.');
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i);
      if (end === -1) throw new Error('Malformed SVG: unterminated CDATA section.');
      i = end + 3;
      continue;
    }
    if (text.startsWith('<!', i)) {
      // DOCTYPE or other markup declaration; skip to its closing '>' (does not handle nested
      // internal subsets with '[...]', which real-world SVG files never use).
      const end = text.indexOf('>', i);
      if (end === -1) throw new Error('Malformed SVG: unterminated declaration.');
      i = end + 1;
      continue;
    }
    if (text.startsWith('</', i)) {
      const end = text.indexOf('>', i);
      if (end === -1) throw new Error('Malformed SVG: unterminated closing tag.');
      const closeName = text.slice(i + 2, end).trim();
      if (stack.length <= 1) {
        throw new Error(`Malformed SVG: unexpected closing tag </${closeName}> with no open element.`);
      }
      const open = stack[stack.length - 1];
      if (open.name !== closeName) {
        throw new Error(`Malformed SVG: mismatched closing tag, expected </${open.name}> but found </${closeName}>.`);
      }
      stack.pop();
      i = end + 1;
      continue;
    }

    // Opening or self-closing tag.
    const end = findTagEnd(text, i);
    if (end === -1) throw new Error('Malformed SVG: unterminated tag.');
    const selfClosing = text[end - 1] === '/';
    const inner = text.slice(i + 1, selfClosing ? end - 1 : end);
    const nameMatch = /^[^\s/]+/.exec(inner);
    if (!nameMatch) throw new Error('Malformed SVG: tag with no element name.');
    const name = nameMatch[0];
    const attrs = parseAttrs(inner.slice(name.length));

    const element = { name, attrs, children: [] };
    currentParent().children.push(element);
    if (!selfClosing) stack.push(element);
    i = end + 1;
  }

  if (stack.length !== 1) {
    throw new Error(`Malformed SVG: unclosed element </${stack[stack.length - 1].name}> missing.`);
  }

  return root;
}

/**
 * Find the index of the '>' that ends a tag starting at `openIndex` ('<'), respecting quoted
 * attribute values so a '>' inside an attribute string does not end the tag early.
 */
function findTagEnd(text, openIndex) {
  let i = openIndex + 1;
  let quote = null;
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
    i++;
  }
  return -1;
}
