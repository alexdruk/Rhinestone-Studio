import { createLibraryItem, touchLibraryItem, cloneLibraryItem } from './LibraryItem.js';
import { createMemoryStorageAdapter } from './LibraryStorageAdapter.js';

/**
 * DesignLibrary — RS-1015.
 *
 * The one, pure implementation of "what the library holds and how it's organized" -- storage-
 * adapter injected, mirroring `src/history/HistoryManager.js`'s existing "pure logic, no DOM"
 * shape. Consumed only through `src/library/index.js`. Never touches `Project`/`Layer`/
 * `StoneLayout`/`GeometryEngine`; item payloads are opaque JSON as far as this class is concerned.
 */
export class DesignLibrary {
  constructor({ storageAdapter = createMemoryStorageAdapter() } = {}) {
    this.storageAdapter = storageAdapter;
    this.items = this.storageAdapter.load().map((raw) => createLibraryItem(raw));
  }

  _persist() {
    this.storageAdapter.save(this.items);
  }

  /** @returns {Array<object>} A shallow copy of every stored item. */
  list() {
    return [...this.items];
  }

  /** @returns {object|null} */
  get(id) {
    return this.items.find((item) => item.id === id) ?? null;
  }

  /**
   * Validates and stores a new item (see `createLibraryItem()`), persists, and returns it.
   * @param {object} itemInput
   * @returns {object}
   */
  add(itemInput) {
    const item = createLibraryItem(itemInput);
    this.items.push(item);
    this._persist();
    return item;
  }

  /** @returns {object} the renamed item. */
  rename(id, name) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`DesignLibrary: item not found: ${id}`);
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new TypeError('DesignLibrary.rename: name must be a non-empty string.');
    }
    const updated = touchLibraryItem(this.items[index], { name });
    this.items[index] = updated;
    this._persist();
    return updated;
  }

  /** @returns {object} the updated item. */
  setCategory(id, category) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`DesignLibrary: item not found: ${id}`);
    const updated = touchLibraryItem(this.items[index], { category });
    this.items[index] = updated;
    this._persist();
    return updated;
  }

  /** @returns {object} the newly created duplicate. */
  duplicate(id) {
    const source = this.get(id);
    if (!source) throw new Error(`DesignLibrary: item not found: ${id}`);
    const copy = cloneLibraryItem(source, { name: `${source.name} Copy` });
    this.items.push(copy);
    this._persist();
    return copy;
  }

  /** @returns {boolean} whether an item was found and removed. */
  remove(id) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return false;
    this.items.splice(index, 1);
    this._persist();
    return true;
  }

  /**
   * Case-insensitive substring search over item names. An empty/whitespace query returns every
   * item, matching the common "empty search box shows everything" convention.
   * @param {string} query
   * @returns {Array<object>}
   */
  search(query) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return this.list();
    return this.items.filter((item) => item.name.toLowerCase().includes(q));
  }

  /**
   * @param {Array<object>} items
   * @param {string} category `'All'` (or falsy) returns `items` unchanged.
   * @returns {Array<object>}
   */
  filterByCategory(items, category) {
    if (!category || category === 'All') return [...items];
    return items.filter((item) => item.category === category);
  }

  /** @returns {Array<string>} the distinct categories currently present, alphabetically sorted. */
  categories() {
    return [...new Set(this.items.map((item) => item.category))].sort((a, b) => a.localeCompare(b));
  }

  /**
   * @param {Array<object>} items
   * @param {'asc'|'desc'} [direction]
   * @returns {Array<object>} a new array, alphabetically sorted by name (case-insensitive).
   */
  sortByName(items, direction = 'asc') {
    const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return direction === 'desc' ? sorted.reverse() : sorted;
  }
}
