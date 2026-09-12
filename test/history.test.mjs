import test from 'node:test';
import assert from 'node:assert';
import { HistoryManager } from '../src/history.js';

test('HistoryManager push, undo, redo, and depth limit', () => {
  const h = new HistoryManager(3);
  assert.strictEqual(h.canUndo(), false);
  assert.strictEqual(h.canRedo(), false);

  // Initial state S0
  const s0 = { tables: { users: { x: 10, y: 20 } } };
  const s1 = { tables: { users: { x: 50, y: 60 } } };
  const s2 = { tables: { users: { x: 100, y: 120 } } };
  const s3 = { tables: { users: { x: 150, y: 180 } } };
  const s4 = { tables: { users: { x: 200, y: 240 } } };

  // Push s0 before moving to s1
  h.push(s0);
  assert.strictEqual(h.canUndo(), true);
  assert.strictEqual(h.canRedo(), false);

  // Undo returns s0 and saves s1 into redo stack
  const undoS0 = h.undo(s1);
  assert.deepStrictEqual(undoS0, s0);
  assert.strictEqual(h.canUndo(), false);
  assert.strictEqual(h.canRedo(), true);

  // Redo returns s1 and puts s0 back into undo stack
  const redoS1 = h.redo(s0);
  assert.deepStrictEqual(redoS1, s1);
  assert.strictEqual(h.canUndo(), true);
  assert.strictEqual(h.canRedo(), false);

  // Test depth limit = 3
  h.clear();
  h.push(s0);
  h.push(s1);
  h.push(s2);
  h.push(s3); // s0 shifted out

  assert.strictEqual(h.undoStack.length, 3);
  assert.deepStrictEqual(h.undo(s4), s3);
  assert.deepStrictEqual(h.undo(s3), s2);
  assert.deepStrictEqual(h.undo(s2), s1);
  assert.strictEqual(h.canUndo(), false); // s0 was pruned
});

test('HistoryManager listener notifications', () => {
  const h = new HistoryManager(10);
  let lastStatus = null;
  const unsubscribe = h.onChange((status) => {
    lastStatus = status;
  });

  h.push({ a: 1 });
  assert.deepStrictEqual(lastStatus, { canUndo: true, canRedo: false });

  h.undo({ a: 2 });
  assert.deepStrictEqual(lastStatus, { canUndo: false, canRedo: true });

  h.redo({ a: 1 });
  assert.deepStrictEqual(lastStatus, { canUndo: true, canRedo: false });

  unsubscribe();
  h.clear();
  // after unsubscribe, lastStatus should not have changed to canUndo: false
  assert.deepStrictEqual(lastStatus, { canUndo: true, canRedo: false });
});
