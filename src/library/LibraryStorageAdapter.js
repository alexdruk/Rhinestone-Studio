/**
 * LibraryStorageAdapter — RS-1015.
 *
 * Storage adapters are the only place `src/library/**` touches a browser global (`localStorage`);
 * `DesignLibrary.js` itself never calls `localStorage` directly, so it stays testable under plain
 * Node -- exactly like every other permanent module's "pure logic, browser-global only at the
 * edge" shape (e.g. `src/history/HistoryManager.js`'s DOM-free design). Every test in this
 * repository's Node-run `npm test` suite uses `createMemoryStorageAdapter()`; only the live browser
 * app wires `createLocalStorageAdapter()`.
 */

/**
 * An in-memory adapter with the same `{load, save}` shape as the real one. Default for
 * `DesignLibrary` and the only adapter Node tests use.
 * @returns {{load: () => Array<object>, save: (items: Array<object>) => void}}
 */
export function createMemoryStorageAdapter() {
  let items = [];
  return {
    load() {
      return items.map((item) => JSON.parse(JSON.stringify(item)));
    },
    save(nextItems) {
      items = nextItems.map((item) => JSON.parse(JSON.stringify(item)));
    }
  };
}

/**
 * A `localStorage`-backed adapter (this codebase's first `localStorage` consumer). Stores the
 * entire item list as one JSON array under `storageKey`, matching the existing "one plain
 * `JSON.stringify()` blob" style `#exportProject` already uses for Project JSON. A malformed or
 * missing value degrades to an empty library rather than throwing, so a corrupted entry never
 * blocks the app from starting.
 * @param {string} storageKey
 * @param {Storage} [storage] Defaults to the global `localStorage` when available.
 * @returns {{load: () => Array<object>, save: (items: Array<object>) => void}}
 */
export function createLocalStorageAdapter(storageKey, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) {
    throw new Error('createLocalStorageAdapter: localStorage is not available in this environment.');
  }
  return {
    load() {
      const raw = storage.getItem(storageKey);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    save(items) {
      storage.setItem(storageKey, JSON.stringify(items));
    }
  };
}
