// Async auto-layout. The dagre pass takes ~2s on a 300-table schema, so it runs
// in a Web Worker; dagre itself also stays out of the main bundle. If workers
// are unavailable (or the worker fails) we fall back to the same code on the
// main thread, loaded on demand.

let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();   // id -> { resolve, reject }

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./layout-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.positions);
    };
    worker.onerror = () => {
      // script failed to load / crashed: fail everything in flight, stop using it
      workerBroken = true;
      worker = null;
      for (const p of pending.values()) p.reject(new Error('layout worker failed'));
      pending.clear();
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

// start the worker early so the first layout doesn't pay for its boot
export function warmLayout() { getWorker(); }

function plain(model, hidden) {
  return {
    tables: model.tables.map(t => ({ key: t.key, w: t.w, h: t.h })),
    relations: model.relations.map(r => ({ fromTable: r.fromTable, toTable: r.toTable })),
    hidden: hidden ? [...hidden] : [],
  };
}

async function onMainThread(data, opts) {
  const { layoutSized } = await import('./layout-core.js');
  const model = { tables: data.tables, relations: data.relations };
  layoutSized(model, opts, new Set(data.hidden));
  const positions = {};
  for (const t of data.tables) positions[t.key] = { x: t.x, y: t.y };
  return positions;
}

// Resolves to { [tableKey]: {x, y} } (NaN for tables that weren't laid out).
// Tables must already be measured (w/h) — Diagram.setModel does that.
export function computeLayout(model, opts, hidden) {
  const data = plain(model, hidden);
  const w = getWorker();
  if (!w) return onMainThread(data, opts);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, ...data, opts: { dir: opts.dir, spacing: opts.spacing } });
  }).catch(() => onMainThread(data, opts));
}
