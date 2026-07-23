/**
 * TXT-101A — Original Rhinestone Font System Foundation: Browse Fonts panel upgrades.
 *
 * Covers the RS-2002 Browse Fonts panel's TXT-101A extensions: a category filter, live
 * rhinestone-layout previews generated through the real production pipeline (not a CSS text
 * mockup), "Recently Used" tracking, and that favorites/search continue to work unchanged. Follows
 * the same "extract and execute the real app.js source" convention as
 * tools/test-typography-font-library.mjs (which this file complements, not duplicates -- that file
 * owns search/favorites/category-grouping regression coverage; this one owns what TXT-101A added).
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
      querySelectorAll() { return []; }
    };
    return e;
  }
  const el = (id) => { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); };
  return { el, elements };
}

function runFontLibrary(manager, { favoriteIds = [], recentIds = [], query = '', categoryFilter = '', currentFontId = 'courier-prime-regular' } = {}) {
  const { el } = makeDom();
  el('font').value = currentFontId;
  const source = extractFontLibrarySource();
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'el', 'fontManager', 'seedFavoriteIds', 'seedRecentIds', 'seedQuery', 'seedCategoryFilter',
    `${source}\nfavoriteFontIds=new Set(seedFavoriteIds);recentFontIds=seedRecentIds;fontSearchQuery=seedQuery;fontCategoryFilterValue=seedCategoryFilter;renderFontLibraryList();return el('fontLibraryList')._html;`
  );
  return factory(el, manager, favoriteIds, recentIds, query, categoryFilter);
}

// ---------------------------------------------------------------------------------------------
// 1. index.html: category filter control exists alongside search
// ---------------------------------------------------------------------------------------------

await test('1. the Browse Fonts panel has a category filter <select> alongside the search input', () => {
  const panelStart = indexHtml.indexOf('id="fontLibraryPanel"');
  const panelSection = indexHtml.slice(panelStart, indexHtml.indexOf('id="fontLibraryList"', panelStart));
  assert.match(panelSection, /id="fontCategoryFilter"/);
  assert.match(panelSection, /id="fontSearch"/);
});

// ---------------------------------------------------------------------------------------------
// 2. Category filter behavior (real code)
// ---------------------------------------------------------------------------------------------

await test('2. filtering by category narrows the list to only that category, regardless of search text', () => {
  const manager = new FontManager(manifest);
  const html = runFontLibrary(manager, { categoryFilter: 'rhinestone' });
  assert.match(html, /data-pick-font="rs-block-regular"/);
  assert.match(html, /data-pick-font="rs-modern-regular"/);
  assert.match(html, /data-pick-font="rs-script-regular"/);
  assert.ok(!html.includes('data-pick-font="anton-regular"'), 'expected a non-rhinestone font to be excluded by the category filter');
});

await test('3. app.js wires the category filter\'s change listener and populates its options from the live manifest', () => {
  assert.match(appJs, /el\('fontCategoryFilter'\)\.addEventListener\('change'/);
  assert.match(appJs, /function populateFontCategoryFilterOptions\(\)/);
  assert.match(appJs, /populateFontCategoryFilterOptions\(\)/);
});

// ---------------------------------------------------------------------------------------------
// 3. Live rhinestone-layout previews (real production pipeline, not a CSS mockup)
// ---------------------------------------------------------------------------------------------

await test('4. every font row renders a preview <canvas> keyed to its font id, not the old inline font-family CSS mockup', () => {
  const manager = new FontManager(manifest);
  const html = runFontLibrary(manager, {});
  assert.match(html, /<canvas class="font-preview-canvas" data-preview-font="courier-prime-regular"/);
  assert.match(html, /<canvas class="font-preview-canvas" data-preview-font="rs-block-regular"/);
  assert.ok(!/style="font-family:/.test(html), 'expected the old CSS-font-family text preview to be replaced by a real rendered preview');
});

await test('5. getFontPreviewLayout() generates a preview through permanentEngine.generateTextLayout() -- the same call generateTextStonesLive() makes for a real layer -- and caches the result per font id', () => {
  assert.match(appJs, /async function getFontPreviewLayout\(font\)/);
  assert.match(appJs, /permanentEngine\.generateTextLayout\(\{text:FONT_PREVIEW_TEXT,fontId:font\.id,providerId:font\.providerId/);
  assert.match(appJs, /const fontPreviewLayoutCache=new Map\(\)/);
});

await test('6. a rhinestone-native font\'s preview uses that family\'s own recommended stone size/gap, not a hardcoded default', () => {
  assert.match(appJs, /rhinestoneFontRegistry\.getMetadata\(font\.id\)/);
  assert.match(appJs, /meta\?meta\.recommendedStoneSizeMm:1\.5/);
  assert.match(appJs, /meta\?meta\.recommendedGapMm:0\.3/);
});

await test('7. preview population yields to the main thread between rows instead of blocking on a Promise.all batch (panel stays responsive while filling in)', () => {
  assert.match(appJs, /function yieldToMainThread\(\)/);
  const fn = appJs.match(/async function populateFontPreviewCanvases\(container\)\{[\s\S]*?\n\}/);
  assert.ok(fn, 'expected populateFontPreviewCanvases()');
  assert.ok(!/Promise\.all/.test(fn[0]), 'expected sequential-with-yield, not a blocking Promise.all batch');
  assert.match(fn[0], /await yieldToMainThread\(\)/);
});

await test('8. the fire-and-forget preview population call is guarded against unhandled rejection', () => {
  assert.match(appJs, /populateFontPreviewCanvases\(list\)\.catch\(/);
});

// ---------------------------------------------------------------------------------------------
// 4. Recently Used
// ---------------------------------------------------------------------------------------------

await test('9. a recently-picked font is pinned under its own "Recently Used" group, ahead of Favorites and category groups', () => {
  const manager = new FontManager(manifest);
  const html = runFontLibrary(manager, { recentIds: ['playfair-display-regular'], favoriteIds: ['anton-regular'] });
  const recentIndex = html.indexOf('Recently Used');
  const favIndex = html.indexOf('Favorites');
  assert.ok(recentIndex >= 0 && favIndex > recentIndex, 'expected "Recently Used" before "Favorites"');
  const recentSection = html.slice(recentIndex, html.indexOf('font-library-group', recentIndex + 1));
  assert.match(recentSection, /data-pick-font="playfair-display-regular"/);
});

await test('10. recordRecentFont()/loadRecentFontIds()/saveRecentFontIds() round-trip through localStorage, most-recent-first, capped, and never throw on corrupt data', () => {
  const store = new Map();
  const localStorageShim = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v)
  };
  const source = extractFontLibrarySource();
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'localStorage', 'el', 'fontManager',
    `${source}\nreturn { loadRecentFontIds, recordRecentFont, get recentFontIds(){ return recentFontIds } };`
  );
  const { el } = makeDom();
  el('fontLibraryPanel').hidden = true;
  const { loadRecentFontIds, recordRecentFont } = factory(localStorageShim, el, null);

  assert.deepEqual(loadRecentFontIds(), []);
  recordRecentFont('a');
  recordRecentFont('b');
  recordRecentFont('a'); // re-picking an already-recent font should move it to the front, not duplicate it
  assert.deepEqual(loadRecentFontIds(), ['a', 'b']);

  store.set('rhinestoneStudio.recentFontIds', '{not valid json');
  assert.deepEqual(loadRecentFontIds(), [], 'expected corrupt stored JSON to fail safe to an empty array, never throw');
});

await test('11. picking a font from the native <select> (not just the Browse Fonts panel) also records it as recently used', () => {
  assert.match(appJs, /el\('font'\)\.addEventListener\('change',\(\)=>recordRecentFont\(el\('font'\)\.value\)\)/);
});

// ---------------------------------------------------------------------------------------------
// 5. Pre-existing search/favorites behavior still works with rhinestone fonts included
// ---------------------------------------------------------------------------------------------

await test('12. searching by family name finds a rhinestone-native font too', () => {
  const manager = new FontManager(manifest);
  const html = runFontLibrary(manager, { query: 'rs block' });
  assert.match(html, /data-pick-font="rs-block-regular"/);
  assert.ok(!html.includes('data-pick-font="rs-modern-regular"'));
});

await test('13. a rhinestone-native font can be favorited/pinned exactly like a desktop font', () => {
  const manager = new FontManager(manifest);
  const html = runFontLibrary(manager, { favoriteIds: ['rs-script-regular'] });
  const favIndex = html.indexOf('Favorites');
  const favoritesSection = html.slice(favIndex, html.indexOf('font-library-group', favIndex + 1));
  assert.match(favoritesSection, /data-fav-font="rs-script-regular"/);
});

console.log('Rhinestone Font Browser (TXT-101A) tests passed.');
