// Auto-layout entry point: measures every table from its content, then hands
// the sized model to the dagre-based core (layout-core.js). The browser app
// runs the core in a Web Worker instead (see layout-client.js) so a large
// schema never blocks the page; the CLI and the worker fallback use this.
import { measureTable } from './renderer.js';
import { layoutSized, removeOverlaps } from './layout-core.js';

export function layout(model, opts = {}, hidden = null) {
  for (const t of model.tables) {
    const dims = measureTable(t);
    t.w = dims.w;
    t.h = dims.h;
    t.rowH = dims.rowH;
    t.headerH = dims.headerH;
  }
  layoutSized(model, opts, hidden);
}

export { removeOverlaps };
