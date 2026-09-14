/**
 * FONT-LIB-006 — Browse Fonts panel: one flat alphabetical list, no category headers.
 *
 * renderFontLibraryList() used to close with one `.font-library-group` header per category
 * (groupFamilyEntriesByCategory()) — 11 headers for 28 family rows inside a 280px scroll viewport,
 * six of them introducing a single font. The panel's own #fontCategoryFilter and the
 * category-label match in its search predicate already slice the list by category, so the headers
 * were a third mechanism for the same job. This milestone drops them for a single flat list sorted
 * by family name under one always-present "All fonts" header (which also terminates the Favorites
 * section); the two structural groups (Recently Used, Favorites) and every row-level behaviour are
 * untouched.
 *
 * Every DOM-touching function below is extracted verbatim from app.js and executed against the
 * real manifest/FontManager — matching tools/test-typography-font-library.mjs's harness (its
 * tests 11–15), which this file reuses.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
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

// Verbatim from test-typography-font-library.mjs.
function extractFontLibrarySource() {
  const start = appJs.indexOf('const FONT_CATEGORY_LABELS=');
  assert.ok(start >= 0, 'expected FONT_CATEGORY_LABELS in app.js');
  const end = appJs.indexOf("function toggleFavoriteFont(fontId){if(favoriteFontIds.has(fontId))favoriteFontIds.delete(fontId);else favoriteFontIds.add(fontId);saveFavoriteFontIds(favoriteFontIds);renderFontLibraryList()}");
  assert.ok(end >= 0, 'expected toggleFavoriteFont in app.js');
  const endOfLine = appJs.indexOf('\n', end);
  const escapeHtmlSource = appJs.match(/function escapeHtml\([\s\S]*?\n\}/)[0];
  return `${escapeHtmlSource}\n${appJs.slice(start, endOfLine)}`;
}

// Verbatim from test-typography-font-library.mjs.
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

// Same shape as test-typography-font-library.mjs's runFontLibrary(), extended with recentIds and
// categoryFilter seeds (both plain `let`s inside the extracted source, set by assignment for the
// same reason favoriteFontIds/fontSearchQuery are — they collide with `new Function` params).
function runPanel(manager, { favoriteIds = [], recentIds = [], query = '', categoryFilter = '', currentFontId = 'rs-block' } = {}) {
  const { el } = makeDom();
  el('font').value = currentFontId;
  const source = extractFontLibrarySource();
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'el', 'fontManager', 'seedFavoriteIds', 'seedRecentIds', 'seedQuery', 'seedCategory',
    `${source}\nfavoriteFontIds=new Set(seedFavoriteIds);recentFontIds=[...seedRecentIds];fontSearchQuery=seedQuery;fontCategoryFilterValue=seedCategory;renderFontLibraryList();return el('fontLibraryList')._html;`
  );
  return factory(el, manager, favoriteIds, recentIds, query, categoryFilter);
}

const groupHeaders = (html) => [...html.matchAll(/<div class="font-library-group">([^<]*)<\/div>/g)].map((m) => m[1]);
const rowFamilies = (html) => [...html.matchAll(/<span class="font-library-item-name">([^<]+)<\/span>/g)].map((m) => m[1]);
const catLabel = (() => {
  const m = appJs.match(/const FONT_CATEGORY_LABELS=\{[^}]*\};/)[0];
  // eslint-disable-next-line no-new-func
  const LABELS = new Function(`${m}return FONT_CATEGORY_LABELS;`)();
  return (role) => LABELS[role] || (role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Other');
})();

// Production fonts / one entry per family, replicated from productionFonts() + fontFamilyEntries().
function familyRoles(manager) {
  const fonts = manager.listFonts().filter((f) => f.providerId === 'rhinestone' || f.enabled === true);
  const byFamily = new Map();
  for (const f of fonts) if (!byFamily.has(f.family)) byFamily.set(f.family, f.role);
  return byFamily;
}

// ---------------------------------------------------------------------------------------------

await test('1. with no search and no category filter, the list carries NO category-label group header, only a single "All fonts" header', () => {
  const manager = new FontManager(manifest);
  const html = runPanel(manager);
  const headers = groupHeaders(html);
  assert.deepEqual(headers, ['All fonts'], 'expected exactly one group header, "All fonts", with no recents/favorites');
  assert.equal(headers.filter((h) => h === 'All fonts').length, 1, 'the "All fonts" header must appear exactly once');
  const allLabels = new Set([...familyRoles(manager).values()].map(catLabel));
  for (const label of allLabels) {
    assert.ok(!html.includes(`<div class="font-library-group">${label}</div>`), `category header "${label}" must not appear`);
  }
});

await test('2. every offered family appears exactly once as a row', () => {
  const manager = new FontManager(manifest);
  const html = runPanel(manager);
  const families = rowFamilies(html);
  const expected = [...familyRoles(manager).keys()];
  assert.equal(families.length, expected.length, 'expected exactly one row per family');
  assert.deepEqual([...families].sort(), [...expected].sort());
  for (const fam of new Set(families)) {
    assert.equal(families.filter((f) => f === fam).length, 1, `family "${fam}" rendered more than once`);
  }
});

await test('3. rows appear in ascending family order by localeCompare', () => {
  const manager = new FontManager(manifest);
  const families = rowFamilies(runPanel(manager));
  const sorted = [...families].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(families, sorted, 'expected the flat list sorted by family localeCompare');
});

await test('4. a recently-used font still renders under "Recently Used" and a favorited one under "Favorites"', () => {
  const manager = new FontManager(manifest);
  const html = runPanel(manager, { recentIds: ['rs-modern'], favoriteIds: ['anton-regular'] });
  const headers = groupHeaders(html);
  assert.ok(headers.includes('Recently Used'), 'expected a "Recently Used" header');
  assert.ok(headers.includes('Favorites'), 'expected a "Favorites" header');
  // The two structural groups plus the always-present "All fonts" header are the ONLY headers —
  // no category label sneaks back in.
  assert.deepEqual([...headers].sort(), ['All fonts', 'Favorites', 'Recently Used']);
  const recentSection = html.slice(html.indexOf('Recently Used'), html.indexOf('Favorites'));
  assert.match(recentSection, /data-pick-font="rs-modern"/);
  // The favorited family is pinned first under the Favorites header — ahead of the alphabetical
  // flat list, which would otherwise open with "Abril Fatface".
  const afterFav = html.slice(html.indexOf('Favorites'));
  assert.equal(rowFamilies(afterFav)[0], 'Anton', 'expected the favorited family pinned first under "Favorites"');
  // The "All fonts" header comes AFTER the "Favorites" header, so the Favorites section has a
  // terminator — the invariant test-typography-font-library.mjs:296 relies on to slice it.
  assert.ok(html.indexOf('>All fonts<') > html.indexOf('>Favorites<'), 'expected the "All fonts" header to terminate the Favorites section');
});

await test('5. setting #fontCategoryFilter to a role still narrows the list to that category', () => {
  const manager = new FontManager(manifest);
  const html = runPanel(manager, { categoryFilter: 'block' });
  const roles = familyRoles(manager);
  const expected = [...roles.entries()].filter(([, role]) => role === 'block').map(([fam]) => fam).sort();
  assert.deepEqual(rowFamilies(html).sort(), expected, 'expected only "block" families');
  assert.ok(!html.includes('data-pick-font="great-vibes-regular"'), 'a non-block font must be filtered out');
});

await test('6. a search matching a category label still narrows the list', () => {
  const manager = new FontManager(manifest);
  const html = runPanel(manager, { query: 'production' });
  assert.match(html, /data-pick-font="rs-block"/);
  assert.match(html, /data-pick-font="rs-modern"/);
  assert.ok(!html.includes('data-pick-font="anton-regular"'), 'a font outside the matched category must not appear');
});

await test('7. the empty state still renders when nothing matches', () => {
  const manager = new FontManager(manifest);
  const html = runPanel(manager, { query: 'zzz-nonexistent-font-zzz' });
  assert.match(html, /font-library-empty/);
  assert.match(html, /No fonts match your search/);
});

console.log('Browse Fonts flat-list (FONT-LIB-006) tests passed.');
