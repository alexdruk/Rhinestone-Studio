import { createMemoryStorageAdapter } from './AutosaveStorageAdapter.js';

/**
 * AutosaveManager — RC-005.
 *
 * The one, pure implementation of "what a crash-recovery autosave record looks like and when it's
 * still usable" -- storage-adapter injected, mirroring `src/history/HistoryManager.js`'s and
 * `src/library/DesignLibrary.js`'s existing "pure logic, no DOM, no timers" shape. It knows nothing
 * about `project.layers`/`Layer`/`StoneLayout`/the DOM/`setTimeout` -- it only ever sees whatever
 * plain, JSON-serializable `{project, selectedLayerId}` its caller passes to `save()`. Scheduling
 * *when* to call `save()` (debouncing rapid edits, hooking undo/redo, etc.) is app.js's job, exactly
 * like app.js alone decides when to call `HistoryManager#commit()`.
 *
 * Per docs/architecture/architecture.md ("Project files store intent"), this only ever persists
 * `project`/`selectedLayerId` -- never the generated `StoneLayout` -- so a recovered project is
 * always regenerated fresh, the same as any other project load.
 *
 * A record is wrapped with a schema version and a timestamp so `load()` can reject anything it
 * didn't write itself (a different schema) or anything too old to be a plausible crash-recovery
 * candidate (`maxAgeMs`, default 24h -- this is crash recovery, not backup/version history) without
 * ever throwing. Either case -- and a corrupt/missing stored value -- degrades to `null`, mirroring
 * `LibraryStorageAdapter`'s "a corrupted entry never blocks the app from starting" convention, and
 * clears the stale/corrupt record as a side effect (the "cleanup of stale recovery data"
 * requirement -- no separate background sweep is needed since every boot already calls `load()`
 * once).
 */

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export class AutosaveManager {
  constructor({ storageAdapter = createMemoryStorageAdapter(), maxAgeMs = DEFAULT_MAX_AGE_MS, now = () => Date.now() } = {}) {
    this.storageAdapter = storageAdapter;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
  }

  /**
   * Persists one recovery record, overwriting whatever was there before -- there is only ever one
   * autosave slot (crash recovery, not version history).
   * @param {{project: object, selectedLayerId?: string|null}} snapshot
   */
  save({ project, selectedLayerId = null }) {
    this.storageAdapter.save({
      schemaVersion: SCHEMA_VERSION,
      savedAt: this.now(),
      project: JSON.parse(JSON.stringify(project)),
      selectedLayerId
    });
  }

  /**
   * @returns {{project: object, selectedLayerId: string|null, savedAt: number}|null} `null` when
   * there is nothing usable to recover (missing, corrupt, wrong schema version, or older than
   * `maxAgeMs`). Clears the stored record whenever it returns `null` for a record that did exist.
   */
  load() {
    let record;
    try {
      record = this.storageAdapter.load();
    } catch {
      return null;
    }
    if (!record || typeof record !== 'object') return null;
    const isWellFormed = record.schemaVersion === SCHEMA_VERSION
      && record.project && typeof record.project === 'object' && !Array.isArray(record.project)
      && typeof record.savedAt === 'number' && Number.isFinite(record.savedAt);
    if (!isWellFormed) {
      this.clear();
      return null;
    }
    if (this.now() - record.savedAt > this.maxAgeMs) {
      this.clear();
      return null;
    }
    return { project: record.project, selectedLayerId: record.selectedLayerId ?? null, savedAt: record.savedAt };
  }

  /** Removes the stored recovery record, if any. Safe to call when there is nothing stored. */
  clear() {
    this.storageAdapter.clear();
  }
}
