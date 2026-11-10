// Undo / redo stack of whole-diagram snapshots (SQL text + positions +
// annotations + hidden tables + manual links). Snapshots are small and
// immutable, so "restore" is just "load this state" — no inverse operations
// to get wrong. Pure: no DOM, the caller supplies state and a comparison key.

export function createHistory({ limit = 100, mergeMs = 1000 } = {}) {
  let stack = [];   // [{ state, key, kind, t }]
  let idx = -1;     // index of the current state

  return {
    // Record the current state. Returns true if a new step was stored.
    //   key   a string that is equal iff two states are equal (dedupes no-ops
    //         such as pan/zoom, which don't change anything undoable)
    //   kind  'type' steps made in quick succession merge into one, so a burst
    //         of typing is undone together rather than keystroke by keystroke
    commit(state, key, kind = 'edit', now = Date.now()) {
      const top = stack[idx];
      if (top && top.key === key) return false;
      const atTip = idx === stack.length - 1;
      if (kind === 'type' && top && top.kind === 'type' && atTip && idx > 0 && now - top.t < mergeMs) {
        if (stack[idx - 1].key === key) { stack.pop(); idx--; return true; }   // typed back to the previous step
        stack[idx] = { state, key, kind, t: now };
        return true;
      }
      stack.length = idx + 1;               // a new step discards the redo tail
      stack.push({ state, key, kind, t: now });
      if (stack.length > limit) stack.splice(0, stack.length - limit);
      idx = stack.length - 1;
      return true;
    },
    undo() { return idx > 0 ? stack[--idx].state : null; },
    redo() { return idx < stack.length - 1 ? stack[++idx].state : null; },
    get canUndo() { return idx > 0; },
    get canRedo() { return idx < stack.length - 1; },
    get size() { return stack.length; },
    clear() { stack = []; idx = -1; },
  };
}
