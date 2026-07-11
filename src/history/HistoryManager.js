/**
 * HistoryManager — a generic, dependency-free undo/redo stack.
 *
 * It knows nothing about Project, Layer, StoneLayout, or the DOM. It stores
 * only whatever plain, JSON-serializable state its caller passes in, as a
 * serialized string (not a live object graph) so history entries cannot be
 * mutated after the fact and cost little memory per entry.
 *
 * Two ways to add a step:
 *  - commit(state): one discrete action (add/delete/duplicate/etc.) is
 *    exactly one undo step.
 *  - beginSession(state) / endSession(): coalesces many rapid calls (one per
 *    keystroke or slider-drag tick) into a single undo step. beginSession()
 *    is a no-op while a session is already open; endSession() closes it so
 *    the next beginSession() starts a new step.
 */

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

export class HistoryManager {
  constructor({ maxSize = 100 } = {}) {
    assertPositiveInteger(maxSize, 'maxSize');
    this.maxSize = maxSize;
    this._past = [];
    this._future = [];
    this._sessionOpen = false;
  }

  get canUndo() {
    return this._past.length > 0;
  }

  get canRedo() {
    return this._future.length > 0;
  }

  get sessionOpen() {
    return this._sessionOpen;
  }

  get pastSize() {
    return this._past.length;
  }

  get futureSize() {
    return this._future.length;
  }

  commit(state) {
    this._sessionOpen = false;
    this._pushBounded(this._past, state);
    this._future.length = 0;
  }

  beginSession(state) {
    if (this._sessionOpen) return false;
    this._sessionOpen = true;
    this._pushBounded(this._past, state);
    this._future.length = 0;
    return true;
  }

  endSession() {
    this._sessionOpen = false;
  }

  undo(currentState) {
    this._sessionOpen = false;
    if (this._past.length === 0) return null;
    const restored = this._past.pop();
    this._pushBounded(this._future, currentState);
    return JSON.parse(restored);
  }

  redo(currentState) {
    this._sessionOpen = false;
    if (this._future.length === 0) return null;
    const restored = this._future.pop();
    this._pushBounded(this._past, currentState);
    return JSON.parse(restored);
  }

  clear() {
    this._sessionOpen = false;
    this._past.length = 0;
    this._future.length = 0;
  }

  _pushBounded(stack, state) {
    stack.push(JSON.stringify(state));
    if (stack.length > this.maxSize) stack.shift();
  }
}
