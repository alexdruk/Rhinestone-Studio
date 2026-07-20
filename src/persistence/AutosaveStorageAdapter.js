/**
 * AutosaveStorageAdapter — RC-005.
 *
 * Storage adapters are the only place `src/persistence/**` touches a browser global
 * (`localStorage`); `AutosaveManager.js` itself never calls `localStorage` directly, mirroring
 * `src/library/LibraryStorageAdapter.js`'s existing "pure logic, browser global only at the edge"
 * shape. Every test in this repository's Node-run `npm test` suite uses
 * `createMemoryStorageAdapter()`; only the live browser app wires `createLocalStorageAdapter()`.
 *
 * Unlike `LibraryStorageAdapter` (a list of items), autosave holds exactly one recovery record, so
 * the adapter shape is `{load, save, clear}` over a single JSON-serializable value rather than an
 * array.
 */

/**
 * An in-memory adapter with the same `{load, save, clear}` shape as the real one. Default for
 * `AutosaveManager` and the only adapter Node tests use.
 * @returns {{load: () => object|null, save: (value: object) => void, clear: () => void}}
 */
export function createMemoryStorageAdapter() {
  let value = null;
  return {
    load() {
      return value === null ? null : JSON.parse(JSON.stringify(value));
    },
    save(nextValue) {
      value = JSON.parse(JSON.stringify(nextValue));
    },
    clear() {
      value = null;
    }
  };
}

/**
 * A `localStorage`-backed adapter. Stores the one recovery record as a JSON blob under
 * `storageKey`, matching the existing "one plain `JSON.stringify()` blob" style `#exportProject`/
 * `LibraryStorageAdapter` already use. A malformed or missing value degrades to `null` rather than
 * throwing, so a corrupted entry never blocks the app from starting.
 * @param {string} storageKey
 * @param {Storage} [storage] Defaults to the global `localStorage` when available.
 * @returns {{load: () => object|null, save: (value: object) => void, clear: () => void}}
 */
export function createLocalStorageAdapter(storageKey, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) {
    throw new Error('createLocalStorageAdapter: localStorage is not available in this environment.');
  }
  return {
    load() {
      const raw = storage.getItem(storageKey);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    save(value) {
      storage.setItem(storageKey, JSON.stringify(value));
    },
    clear() {
      storage.removeItem(storageKey);
    }
  };
}
