import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RC-006 — Version 1.0 Feature Freeze: Design Library.
//
// The freeze mirrors S-103's Gallery freeze exactly (see git history feat(scope): S-103 Product
// Scope Freeze): the #menuLibrary top-menu button gets the native `disabled` attribute plus a
// "Coming Soon" badge, so the browser withholds click/Enter/Space activation and tab focus. No
// Design Library code, data, or storage is touched -- #menuLibrary is the *only* UI entry point
// that opens the Design Library lightbox (there is no keyboard shortcut or secondary trigger), so
// disabling it is sufficient to make the workflow unreachable from the UI.
//
// Covered:
//  1. #menuLibrary is disabled with a visible "Coming Soon" affordance in index.html.
//  2. The Design Library lightbox markup, and its onclick wiring in app.js, are left completely
//     intact -- this is a freeze, not a deletion.
//  3. Gallery's own S-103 freeze (button markup, wiring) is untouched by this change.
//  4. Import's top-menu entry is untouched (still enabled, no freeze markup).
//  5. Existing stored Design Library data survives a load/save round-trip unchanged -- nothing in
//     this freeze deletes or migrates `localStorage['rhinestone-studio:design-library']`.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

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

function extractButton(html, id) {
  const marker = `id="${id}"`;
  const start = html.indexOf(marker);
  assert.ok(start !== -1, `expected to find a button with ${marker} in index.html`);
  const tagStart = html.lastIndexOf('<button', start);
  const tagEnd = html.indexOf('</button>', start) + '</button>'.length;
  return html.slice(tagStart, tagEnd);
}

// ---------- 1. #menuLibrary is disabled with a visible "Coming Soon" affordance ----------

await test('#menuLibrary carries the native disabled attribute and aria-disabled="true"', () => {
  const button = extractButton(indexHtml, 'menuLibrary');
  assert.match(button, /\bdisabled\b/, 'expected the native [disabled] attribute so the button is unreachable by click/Enter/Space/Tab');
  assert.match(button, /aria-disabled="true"/, 'expected aria-disabled="true" for assistive tech');
});

await test('#menuLibrary shows a "Coming Soon" badge and an explanatory title', () => {
  const button = extractButton(indexHtml, 'menuLibrary');
  assert.match(button, /topmenu-badge">Coming Soon</i, 'expected a visible "Coming Soon" badge');
  assert.match(button.toLowerCase(), /title="[^"]*(feature freeze|rc-006|temporarily unavailable)[^"]*"/, 'expected the tooltip to explain the freeze');
});

await test('the .topmenu-btn:disabled CSS rule (already added for S-103) exists so the disabled state is visibly distinct', () => {
  assert.match(indexHtml, /\.topmenu-btn:disabled\s*\{/, 'expected a shared disabled-state style for topmenu buttons');
});

// ---------- 2. Design Library implementation, data, and wiring stay intact ----------

await test('the Design Library lightbox markup (#lightboxLibrary) is still present, unmodified in structure', () => {
  assert.match(indexHtml, /<div class="lightbox-overlay non-modal" id="lightboxLibrary">/, 'expected the Design Library dialog markup to remain');
  assert.match(indexHtml, /id="librarySaveProject"/, 'expected Save Whole Project control to remain');
  assert.match(indexHtml, /id="librarySaveSelection"/, 'expected Save Selection control to remain');
});

await test('app.js still wires #menuLibrary to open the Design Library lightbox (code path stays live, just unreachable via the disabled button)', () => {
  assert.match(appJs, /el\('menuLibrary'\)\.onclick=\(\)=>lightboxes\.library\.open\(\);/, 'expected the existing click handler to remain, exactly as before the freeze');
});

await test('the src/library/** module is untouched by this change (git-tracked source still exports the same API)', async () => {
  const lib = await import('../src/library/index.js');
  for (const name of ['DesignLibrary', 'createLibraryItem', 'createLocalStorageAdapter', 'createMemoryStorageAdapter', 'buildProjectFromItem']) {
    assert.equal(typeof lib[name], 'function', `expected src/library/index.js to still export ${name}`);
  }
});

// ---------- 3. Gallery (S-103) and Import remain unaffected ----------

await test('Gallery\'s own S-103 freeze markup and wiring are unchanged by this commit', () => {
  const button = extractButton(indexHtml, 'menuGallery');
  assert.match(button, /\bdisabled\b/);
  assert.match(button, /topmenu-badge">Coming Soon</i);
  assert.match(button, /S-103/, 'expected the original S-103 tooltip text to be untouched');
  assert.match(appJs, /el\('menuGallery'\)\.onclick=\(\)=>lightboxes\.gallery\.open\(\);/, 'expected Gallery\'s click handler to remain exactly as before');
});

await test('Import\'s top-menu entry is untouched: still enabled, no freeze markup', () => {
  const button = extractButton(indexHtml, 'menuImport');
  assert.doesNotMatch(button, /\bdisabled\b/, 'Import must stay fully usable');
  assert.doesNotMatch(button, /topmenu-badge/, 'Import must not get a "Coming Soon" badge');
});

// ---------- 4. Existing stored Design Library data is preserved, not deleted or migrated ----------

function fakeStorage(initial) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
    _dump: () => Object.fromEntries(store)
  };
}

await test('a pre-existing Design Library localStorage record round-trips unchanged through load()', async () => {
  const { createLocalStorageAdapter, DesignLibrary } = await import('../src/library/index.js');
  const key = 'rhinestone-studio:design-library';
  const preExisting = [
    {
      id: 'item-1',
      kind: 'project',
      name: 'My Saved Design',
      category: 'text',
      createdAt: '2026-01-01T00:00:00.000Z',
      data: { project: { name: 'My Saved Design', canvas: { width: 210, height: 90 }, layers: [] } }
    }
  ];
  const storage = fakeStorage({ [key]: JSON.stringify(preExisting) });
  const adapter = createLocalStorageAdapter(key, storage);

  const library = new DesignLibrary({ storageAdapter: adapter });
  assert.equal(library.items.length, 1);
  assert.equal(library.items[0].id, 'item-1');
  assert.equal(library.items[0].name, 'My Saved Design');

  // Constructing the library only reads; nothing in the freeze re-saves/migrates the record.
  assert.equal(storage.getItem(key), JSON.stringify(preExisting), 'expected the stored record to be byte-for-byte unchanged after load');
});

await test('app.js does not call .clear() or otherwise wipe the Design Library storage key as part of the freeze', () => {
  assert.doesNotMatch(appJs, /designLibrary\s*\.\s*clear\s*\(/, 'the freeze must not clear stored library items');
  assert.doesNotMatch(appJs, /removeItem\(\s*LIBRARY_STORAGE_KEY/, 'the freeze must not remove the library storage key');
});
