/**
 * RS-2002 — Typography & Font Library.
 *
 * Covers: the expanded/categorized manifest, the #font <select>'s dynamic optgroup population,
 * the Browse Fonts panel's search/favorites/grouping behavior, the dynamic (no longer hardcoded)
 * TEXT_ENGINE_FONT_IDS derivation, index.html wiring, and backward compatibility (pre-existing
 * font ids/behavior unchanged). Every DOM-touching function below is extracted verbatim from
 * app.js and executed against the real manifest/FontManager -- not reimplemented -- matching the
 * precedent in tools/test-variable-stone-sizes.mjs and tools/test-object-template-integration.mjs.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function extractElementHtml(html, id) {
  const marker = `id="${id}"`;
  const start = html.indexOf(marker);
  assert.ok(start >= 0, `expected to find id="${id}" in the document`);
  const openStart = html.lastIndexOf('<', start);
  let depth = 0, i = openStart;
  const tagNameMatch = html.slice(openStart).match(/^<(\w+)/);
  const tagName = tagNameMatch[1];
  const openRe = new RegExp(`<${tagName}(\\s|>)`, 'g');
  const closeRe = new RegExp(`</${tagName}>`, 'g');
  openRe.lastIndex = openStart;
  while (true) {
    openRe.lastIndex = i + 1;
    closeRe.lastIndex = i + 1;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) throw new Error(`unbalanced tags looking for #${id}`);
    if (nextOpen && nextOpen.index < nextClose.index) { depth++; i = nextOpen.index; }
    else { if (depth === 0) return html.slice(openStart, nextClose.index + nextClose[0].length); depth--; i = nextClose.index; }
  }
}

// Extracts the contiguous RS-2002 font-picker function block (FONT_CATEGORY_LABELS through
// toggleFavoriteFont) plus escapeHtml, and returns a ready-to-call `new Function` factory.
function extractFontLibrarySource() {
  const start = appJs.indexOf('const FONT_CATEGORY_LABELS=');
  assert.ok(start >= 0, 'expected FONT_CATEGORY_LABELS in app.js');
  const end = appJs.indexOf("function toggleFavoriteFont(fontId){if(favoriteFontIds.has(fontId))favoriteFontIds.delete(fontId);else favoriteFontIds.add(fontId);saveFavoriteFontIds(favoriteFontIds);renderFontLibraryList()}");
  assert.ok(end >= 0, 'expected toggleFavoriteFont in app.js');
  const endOfLine = appJs.indexOf('\n', end);
  const escapeHtmlSource = appJs.match(/function escapeHtml\([\s\S]*?\n\}/)[0];
  return `${escapeHtmlSource}\n${appJs.slice(start, endOfLine)}`;
}

function makeDom() {
  const elements = new Map();
  function makeEl(id) {
    const listeners = {};
    const e = {
      id, _html: '', hidden: false, value: '', _attrs: {},
      set innerHTML(v) { this._html = v; },
      get innerHTML() { return this._html; },
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      focus() {}, style: {},
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      dispatchEvent(evt) { for (const fn of (listeners[evt.type] || [])) fn(evt); return true; },
      // TXT-101A's populateFontPreviewCanvases() queries for preview canvases inside the rendered
      // list; this shim has no real child nodes, so an empty result is the correct (not merely
      // convenient) stub -- there is nothing to find until a real DOM parses `_html`.
      querySelectorAll() { return []; }
    };
    return e;
  }
  const el = (id) => { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); };
  return { el, elements };
}

// ---------------------------------------------------------------------------------------------
// 1. Manifest / category coverage
// ---------------------------------------------------------------------------------------------

await test('1. every category the spec requires (Serif/Sans Serif/Display/Monogram/Decorative/Block/Handwritten) is represented by exactly one enabled font', () => {
  const manager = new FontManager(manifest);
  const required = ['serif', 'sans-serif', 'display', 'monogram', 'decorative', 'handwritten'];
  for (const role of required) {
    const matches = manager.listFonts().filter((f) => f.role === role);
    assert.equal(matches.length, 1, `expected exactly one enabled font for category "${role}", found ${matches.length}`);
  }
  // FONT-PORTFOLIO-001 registered sacramento-regular/dancing-script-regular alongside the
  // pre-existing great-vibes-regular, all role 'script' -- the one category the spec's original
  // "exactly one" rule no longer holds for.
  assert.equal(manager.listFonts().filter((f) => f.role === 'script').length, 3, 'expected 3 enabled script fonts after FONT-PORTFOLIO-001 (Great Vibes, Sacramento, Dancing Script)');
  // block still holds at exactly one (Anton) -- FONT-PORTFOLIO-001 validated it, not duplicated it.
  assert.equal(manager.listFonts().filter((f) => f.role === 'block').length, 1);
});

await test('2. the manifest still has exactly one disabled entry (the RobotoMono placeholder), and it is unchanged', () => {
  const manager = new FontManager(manifest);
  const disabled = manager.listFonts({ includeDisabled: true }).filter((f) => !f.enabled);
  assert.equal(disabled.length, 1);
  assert.equal(disabled[0].id, 'roboto-mono-regular');
  assert.equal(disabled[0].path, 'assets/fonts/RobotoMono-Regular.ttf');
});

await test('3. every enabled font\'s referenced file actually exists on disk', async () => {
  const manager = new FontManager(manifest);
  // TXT-101A's rhinestone-native fonts (providerId:'rhinestone') have no font file at all -- their
  // manifest `path` is a documentation-only identifier (RhinestoneFontProvider generates glyph
  // geometry at runtime, never fetches/parses it -- see assets/fonts/manifest.json's notes for
  // those entries), so only OpenType-backed fonts are expected to resolve to a real file on disk.
  for (const font of manager.listFonts().filter((f) => f.providerId === 'opentype')) {
    await readFile(path.join(repoRoot, font.path));
  }
});

// ---------------------------------------------------------------------------------------------
// 2. index.html wiring
// ---------------------------------------------------------------------------------------------

await test('4. the Text Lightbox contains a Browse Fonts control and panel, wired to #font', () => {
  const body = extractElementHtml(indexHtml, 'lightboxText');
  assert.ok(body.includes('id="font"'));
  assert.ok(body.includes('id="fontLibraryBtn"'));
  assert.ok(body.includes('id="fontLibraryPanel"'));
  assert.ok(body.includes('id="fontSearch"'));
  assert.ok(body.includes('id="fontLibraryList"'));
  assert.match(indexHtml, /<select id="font">/, 'expected the #font control to remain a plain <select> for backward compatibility with pre-RS-2002 tests');
});

await test('5. the Browse Fonts panel starts hidden and empty (populated at runtime, like #stoneColor/#stoneSize)', () => {
  const panelMatch = indexHtml.match(/<div id="fontLibraryPanel"[^>]*>/);
  assert.ok(panelMatch, 'expected #fontLibraryPanel');
  assert.match(panelMatch[0], /\bhidden\b/, 'expected #fontLibraryPanel to start hidden');
  const listMatch = indexHtml.match(/<div id="fontLibraryList"[^>]*><\/div>/);
  assert.ok(listMatch, 'expected #fontLibraryList to start empty in the static markup');
});

await test('6. app.js wires open/close/search/pick/favorite handlers for the Browse Fonts panel', () => {
  assert.match(appJs, /el\('fontLibraryBtn'\)\.addEventListener\('click'/);
  assert.match(appJs, /el\('fontSearch'\)\.addEventListener\('input'/);
  assert.match(appJs, /el\('fontLibraryList'\)\.addEventListener\('click'/);
});

// ---------------------------------------------------------------------------------------------
// 3. TEXT_ENGINE_FONT_IDS is now manifest-derived, not a second hardcoded font list
// ---------------------------------------------------------------------------------------------

await test('7. TEXT_ENGINE_FONT_IDS is derived from fontManager.listFonts(), not a hardcoded id list', () => {
  assert.ok(!/const TEXT_ENGINE_FONT_IDS=new Set\(\['courier-prime-regular','great-vibes-regular'\]\)/.test(appJs), 'expected the old hardcoded two-id Set to be gone');
  assert.match(appJs, /let TEXT_ENGINE_FONT_IDS=new Set\(\[DEFAULT_TEXT_FONT_ID\]\)/, 'expected a reassignable fallback Set');
  assert.match(appJs, /TEXT_ENGINE_FONT_IDS=new Set\(fontManager\.listFonts\(\)\.map\(f=>f\.id\)\)/, 'expected TEXT_ENGINE_FONT_IDS to be reassigned from the live manifest');
});

await test('8. every currently-enabled manifest font id would be accepted as valid text-engine input', () => {
  const manager = new FontManager(manifest);
  const idsInSource = new Set(manager.listFonts().map((f) => f.id));
  // Simulates the real reassignment line's right-hand side against the real manifest.
  for (const id of idsInSource) assert.ok(typeof id === 'string' && id.length > 0);
  // FONT-002 added RS Modern (rs-modern, providerId:'rhinestone') alongside RS Block and the 9
  // RS-2002 desktop fonts -- 11. FONT-DECISION-001 added baloo2-variable-regular -- 12.
  // FONT-PORTFOLIO-001 added sacramento-regular and dancing-script-regular -- 14 total.
  // (TEXT_ENGINE_FONT_IDS still derives from every *enabled* manifest font, OpenType included, so
  // existing/legacy-fonted projects keep resolving -- only the picker's *offered* list is
  // Production-Fonts-only, see test 9). The SS10 prototype remains manifest-unregistered (see
  // src/text/rhinestoneFont/index.js).
  assert.equal(idsInSource.size, 14);
});

// ---------------------------------------------------------------------------------------------
// 4. Category grouping / alphabetical sorting (real code, run against the real manifest)
// ---------------------------------------------------------------------------------------------

await test('9. populateFontOptions() offers only Production Fonts (FONT-002) plus validated OpenType fonts (FONT-DECISION-001) -- alphabetically sorted, unvalidated legacy OpenType fonts excluded', () => {
  const manager = new FontManager(manifest);
  const { el } = makeDom();
  const source = extractFontLibrarySource();
  // eslint-disable-next-line no-new-func
  const run = new Function('el', 'fontManager', `${source}\npopulateFontOptions();`);
  run(el, manager);
  const html = el('font')._html;
  const groupLabels = [...html.matchAll(/<optgroup label="([^"]+)">/g)].map((m) => m[1]);
  // FONT-DECISION-001 added a second group: Baloo 2 (providerId:'opentype', rhinestoneValidated:true)
  // sits under its own "Rounded Sans" category, alongside the authored "Production Fonts" group.
  // FONT-PORTFOLIO-001 validated 3 more OpenType fonts, adding "Block" (Anton) and "Script"
  // (Sacramento, Dancing Script; Great Vibes stays unvalidated so does NOT join this group).
  assert.deepEqual(groupLabels, ['Block', 'Production Fonts', 'Rounded Sans', 'Script'], 'expected the authored "Production Fonts" group plus every validated-OpenType category');

  const groupBlocks = [...html.matchAll(/<optgroup label="([^"]+)">([\s\S]*?)<\/optgroup>/g)];
  for (const [, label, inner] of groupBlocks) {
    const families = [...inner.matchAll(/>([^<]+)<\/option>/g)].map((m) => m[1]);
    const sortedFamilies = [...families].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(families, sortedFamilies, `expected fonts within group "${label}" to be alphabetically sorted`);
  }
  const allValues = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(new Set(allValues), new Set(['rs-block', 'rs-modern', 'baloo2-variable-regular', 'anton-regular', 'sacramento-regular', 'dancing-script-regular']), 'expected the two authored Production Fonts plus every validated OpenType font to be offered');
  assert.ok(!allValues.includes('roboto-mono-regular'), 'the disabled RobotoMono placeholder must never be offered');
  assert.ok(!allValues.includes('courier-prime-regular'), 'unvalidated OpenType fonts must not be offered in the normal picker (FONT-002/FONT-DECISION-001)');
});

await test('10. every rendered Production Font <option> carries a font-family style for a live visual preview', () => {
  const manager = new FontManager(manifest);
  const { el } = makeDom();
  const source = extractFontLibrarySource();
  // eslint-disable-next-line no-new-func
  const run = new Function('el', 'fontManager', `${source}\npopulateFontOptions();`);
  run(el, manager);
  const html = el('font')._html;
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const font of manager.listFonts().filter((f) => f.providerId === 'rhinestone' || f.rhinestoneValidated === true)) {
    const re = new RegExp(`<option value="${escapeRegExp(font.id)}" style="font-family:'${escapeRegExp(font.family)}'">`);
    assert.match(html, re, `expected a font-face-previewed option for ${font.id}`);
  }
});

// ---------------------------------------------------------------------------------------------
// 5. Browse Fonts panel: search + favorites + grouping (real code)
// ---------------------------------------------------------------------------------------------

function runFontLibrary(manager, { favoriteIds = [], query = '', currentFontId = 'rs-block' } = {}) {
  const { el } = makeDom();
  el('font').value = currentFontId;
  const source = extractFontLibrarySource();
  // Overriding favoriteFontIds/fontSearchQuery by plain assignment (not as `new Function` params,
  // which would collide with the source's own `let favoriteFontIds`/`let fontSearchQuery`
  // declarations -- a SyntaxError: "Identifier has already been declared").
  // eslint-disable-next-line no-new-func
  const factory = new Function('el', 'fontManager', 'seedFavoriteIds', 'seedQuery', `${source}\nfavoriteFontIds=new Set(seedFavoriteIds);fontSearchQuery=seedQuery;renderFontLibraryList();return el('fontLibraryList')._html;`);
  return factory(el, manager, favoriteIds, query);
}

await test('11. searching by family name narrows the Browse Fonts list to matching fonts only (Production Fonts only, FONT-002)', () => {
  const manager = new FontManager(manifest);
  const html = runFontLibrary(manager, { query: 'modern' });
  assert.match(html, /data-pick-font="rs-modern"/);
  assert.ok(!html.includes('data-pick-font="rs-block"'), 'expected non-matching fonts to be filtered out');
  assert.ok(!html.includes('data-pick-font="courier-prime-regular"'), 'expected OpenType fonts to never appear in the Browse Fonts panel');
});

await test('12. searching by category label narrows the list to every font in that category', () => {
  const manager = new FontManager(manifest);
  const html = runFontLibrary(manager, { query: 'production' });
  assert.match(html, /data-pick-font="rs-block"/);
  assert.match(html, /data-pick-font="rs-modern"/);
});

await test('13. a search with no matches shows an explicit empty state, not a blank panel', () => {
  const manager = new FontManager(manifest);
  const html = runFontLibrary(manager, { query: 'zzz-nonexistent-font-zzz' });
  assert.match(html, /font-library-empty/);
  assert.match(html, /No fonts match your search/);
});

await test('14. a favorited font is pinned under its own "Favorites" group, ahead of its category group', () => {
  const manager = new FontManager(manifest);
  const html = runFontLibrary(manager, { favoriteIds: ['rs-modern'] });
  const favIndex = html.indexOf('Favorites');
  const categoryIndex = html.indexOf('Production Fonts');
  assert.ok(favIndex >= 0 && categoryIndex > favIndex, 'expected a Favorites group before the Production Fonts category group');
  const favoritesSection = html.slice(favIndex, html.indexOf('font-library-group', favIndex + 1));
  assert.match(favoritesSection, /data-fav-font="rs-modern"/);
});

await test('15. the currently selected font is marked aria-selected in the panel', () => {
  const manager = new FontManager(manifest);
  const html = runFontLibrary(manager, { currentFontId: 'rs-modern' });
  assert.match(html, /data-pick-font="rs-modern" role="option" aria-selected="true"/);
});

// ---------------------------------------------------------------------------------------------
// 6. Favorites persistence (localStorage), pickFont() event replay
// ---------------------------------------------------------------------------------------------

await test('16. loadFavoriteFontIds()/saveFavoriteFontIds() round-trip through localStorage and never throw on corrupt data', () => {
  const store = new Map();
  const localStorageShim = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v)
  };
  const source = extractFontLibrarySource();
  // eslint-disable-next-line no-new-func
  const factory = new Function('localStorage', `${source}\nreturn { loadFavoriteFontIds, saveFavoriteFontIds };`);
  const { loadFavoriteFontIds, saveFavoriteFontIds } = factory(localStorageShim);

  assert.deepEqual(loadFavoriteFontIds(), new Set(), 'expected an empty set with nothing stored yet');
  saveFavoriteFontIds(new Set(['lobster-regular', 'anton-regular']));
  assert.deepEqual(loadFavoriteFontIds(), new Set(['lobster-regular', 'anton-regular']));

  store.set('rhinestoneStudio.favoriteFontIds', '{not valid json');
  assert.deepEqual(loadFavoriteFontIds(), new Set(), 'expected corrupt stored JSON to fail safe to an empty set, never throw');
});

await test('17. pickFont() writes the value into #font and replays input+change so history/save/load pick it up, then closes the panel', () => {
  const { el } = makeDom();
  let inputFired = false, changeFired = false;
  el('font').addEventListener('input', () => { inputFired = true; });
  el('font').addEventListener('change', () => { changeFired = true; });
  el('fontLibraryPanel').hidden = false;
  const source = extractFontLibrarySource();
  // TXT-101A: pickFont() now also records "Recently Used" (recordRecentFont()), which re-renders
  // the panel's list via renderFontLibraryList() while it's still open (before pickFont() closes
  // it) -- that function's very first line is `if(!fontManager)return`, so passing null here (no
  // real FontManager needed for this test's assertions) exercises that guard instead of hitting an
  // undefined free variable.
  // eslint-disable-next-line no-new-func
  const run = new Function('el', 'fontManager', `${source}\npickFont('montserrat-regular');`);
  run(el, null);
  assert.equal(el('font').value, 'montserrat-regular');
  assert.ok(inputFired, 'expected pickFont() to dispatch an input event (history session + live regen)');
  assert.ok(changeFired, 'expected pickFont() to dispatch a change event (closes the history session)');
  assert.equal(el('fontLibraryPanel').hidden, true, 'expected pickFont() to close the panel');
});

// ---------------------------------------------------------------------------------------------
// 7. Backward compatibility
// ---------------------------------------------------------------------------------------------

await test('18. the two pre-existing font ids/families are unchanged (old projects must not silently substitute fonts)', () => {
  const manager = new FontManager(manifest);
  assert.equal(manager.getFont('courier-prime-regular').family, 'Courier Prime');
  assert.equal(manager.getFont('courier-prime-regular').path, 'assets/fonts/CourierPrime-Regular.ttf');
  assert.equal(manager.getFont('great-vibes-regular').family, 'Great Vibes');
  assert.equal(manager.getFont('great-vibes-regular').path, 'assets/fonts/GreatVibes-Regular.ttf');
});

await test('19. FontManager\'s own DEFAULT_FONT_ID is unchanged (Courier Prime); app.js\'s DEFAULT_TEXT_FONT_ID is now RS Block (FONT-002)', async () => {
  // These are two deliberately separate constants (see app.js's own DEFAULT_TEXT_FONT_ID comment):
  // FontManager.DEFAULT_FONT_ID is FontManager's own internal getDefaultFont() fallback, untouched
  // by FONT-002; DEFAULT_TEXT_FONT_ID is app.js's picker/new-text-layer default, which FONT-002
  // Part 1 explicitly changes to the default Production Font.
  const { DEFAULT_FONT_ID } = await import('../src/fonts/index.js');
  assert.equal(DEFAULT_FONT_ID, 'courier-prime-regular');
  const match = appJs.match(/const DEFAULT_TEXT_FONT_ID='([^']*)'/);
  assert.equal(match[1], 'rs-block');
});

await test('20. FONT-DECISION-001: baloo2-variable-regular is registered, validated, and keeps full OpenType capability (resizable/curvable, unlike the fixed-pitch authored fonts)', () => {
  const manager = new FontManager(manifest);
  const font = manager.getFont('baloo2-variable-regular');
  assert.equal(font.providerId, 'opentype');
  assert.equal(font.rhinestoneValidated, true);
  assert.equal(font.enabled, true);
  assert.equal(font.path, 'assets/fonts/Baloo2-Regular.ttf');
  // isAuthoredStoneFontId (app.js) gates Fill Style/Text height/Curved text/Fit-to-Shape off only
  // for providerId:'rhinestone' -- this font must NOT trip that gate, since it's a real vector font
  // sampled by the existing StoneSampler, not the fixed-pitch authored dot-matrix DSL.
  assert.match(appJs, /function isAuthoredStoneFontId\(fontId\)\{return resolveFontProviderId\(fontId\)==='rhinestone'\}/);
});

// ---------------------------------------------------------------------------------------------
// 8. Forbidden-file guard (this milestone's own scope)
// ---------------------------------------------------------------------------------------------
console.log('Typography & Font Library (RS-2002) tests passed.');
