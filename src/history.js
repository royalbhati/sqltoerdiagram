// History manager for Undo / Redo operations.
// Supports arbitrary state snapshots, depth limit, and change listeners.

export class HistoryManager {
  constructor(maxDepth = 50) {
    this.maxDepth = maxDepth;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  /**
   * Clone a snapshot deeply to avoid mutation issues.
   */
  _clone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Map) {
      return new Map(Array.from(obj.entries()).map(([k, v]) => [k, this._clone(v)]));
    }
    if (obj instanceof Set) {
      return new Set(Array.from(obj.values()).map(v => this._clone(v)));
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this._clone(item));
    }
    const copy = {};
    for (const [k, v] of Object.entries(obj)) {
      copy[k] = this._clone(v);
    }
    return copy;
  }

  /**
   * Push a previous state before a change occurred.
   * Clears the redo stack.
   */
  push(snapshot) {
    if (!snapshot) return;
    this.undoStack.push(this._clone(snapshot));
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this._notify();
  }

  /**
   * Undo: passes current state into redoStack and returns the previous state from undoStack.
   */
  undo(currentSnapshot) {
    if (!this.canUndo()) return null;
    const previous = this.undoStack.pop();
    if (currentSnapshot) {
      this.redoStack.push(this._clone(currentSnapshot));
      if (this.redoStack.length > this.maxDepth) {
        this.redoStack.shift();
      }
    }
    this._notify();
    return this._clone(previous);
  }

  /**
   * Redo: passes current state into undoStack and returns the next state from redoStack.
   */
  redo(currentSnapshot) {
    if (!this.canRedo()) return null;
    const next = this.redoStack.pop();
    if (currentSnapshot) {
      this.undoStack.push(this._clone(currentSnapshot));
      if (this.undoStack.length > this.maxDepth) {
        this.undoStack.shift();
      }
    }
    this._notify();
    return this._clone(next);
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this._notify();
  }

  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notify() {
    const status = { canUndo: this.canUndo(), canRedo: this.canRedo() };
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('HistoryManager listener error:', err);
      }
    }
  }
}
