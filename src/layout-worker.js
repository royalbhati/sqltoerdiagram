// Runs the dagre layout off the main thread. Receives pre-measured tables and
// replies with their positions; the page stays interactive meanwhile.
import { layoutSized } from './layout-core.js';

self.onmessage = (e) => {
  const { id, tables, relations, opts, hidden } = e.data;
  try {
    const model = { tables, relations };
    layoutSized(model, opts, new Set(hidden || []));
    const positions = {};
    for (const t of tables) positions[t.key] = { x: t.x, y: t.y };
    self.postMessage({ id, positions });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
