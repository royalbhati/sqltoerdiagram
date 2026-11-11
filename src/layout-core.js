// Auto-layout core via dagre: a layered layout so related tables sit near each
// other. Table sizes are measured by the caller (see layout.js).
//
// "Smart" tuning for ER schemas:
//  - hub tables (high fan-in/out) are detected and their edges weighted so the
//    spoke tables align in the rank next to the hub instead of scattering;
//  - network-simplex ranking + greedy cycle removal handles real-world FK loops;
//  - generous rank/node separation keeps dense hubs from overlapping;
//  - disconnected tables are packed into a tidy grid off to the side instead of
//    one giant column.
import dagre from '@dagrejs/dagre';

const PRESETS = {
  comfortable: { nodesep: 30, ranksep: 84,  edgesep: 20 },
  compact:     { nodesep: 20, ranksep: 56,  edgesep: 12 },
  spacious:    { nodesep: 60, ranksep: 200, edgesep: 36 },
};

// Position tables that already carry w/h. Pure (no DOM, no text metrics) so it
// runs unchanged on the main thread, in a Web Worker and in Node.
export function layoutSized(model, opts = {}, hidden = null) {
  const dir = opts.dir === 'TB' ? 'TB' : 'LR';
  const preset = PRESETS[opts.spacing] || PRESETS.comfortable;
  const isHidden = (key) => !!(hidden && hidden.has(key));

  // degree map (how connected each table is) — drives hub-aware edge weighting
  const degree = new Map();
  const bump = (k) => degree.set(k, (degree.get(k) || 0) + 1);
  for (const r of model.relations) {
    const f = r.fromTable.toLowerCase(), t = r.toTable.toLowerCase();
    if (f !== t) { bump(f); bump(t); }
  }

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: dir,
    nodesep: preset.nodesep,
    ranksep: preset.ranksep,
    edgesep: preset.edgesep,
    ranker: 'network-simplex',
    acyclicer: 'greedy',
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const t of model.tables) {
    if (isHidden(t.key)) continue;             // hidden tables aren't laid out
    g.setNode(t.key, { width: t.w, height: t.h });
  }
  let e = 0;
  for (const r of model.relations) {
    const from = r.fromTable.toLowerCase();
    const to = r.toTable.toLowerCase();
    if (g.hasNode(from) && g.hasNode(to) && from !== to) {
      // edges touching a hub get more weight so spokes stay adjacent & aligned
      const hubness = Math.max(degree.get(from) || 0, degree.get(to) || 0);
      const weight = 1 + Math.min(hubness, 12);
      g.setEdge(from, to, { weight, minlen: 1 }, 'e' + e++);
    }
  }

  dagre.layout(g);

  for (const t of model.tables) {
    const node = g.node(t.key);
    if (node) {
      // dagre returns centre coords -> convert to top-left
      t.x = node.x - t.w / 2;
      t.y = node.y - t.h / 2;
    } else {
      t.x = NaN; t.y = NaN;
    }
  }

  placeOrphans(model, isHidden);
  removeOverlaps(model, isHidden);
}

// Guarantee no two tables overlap. dagre avoids overlaps within a rank, but
// orphan packing or very wide tables can still collide — this nudges any
// overlapping pair apart along the smallest axis until everything is clear.
// O(n²) per pass with a small pass count; fine for hundreds of tables.
const GAP = 18;
export function removeOverlaps(model, isHidden = null) {
  const ts = model.tables.filter(t => Number.isFinite(t.x) && !(isHidden && isHidden(t.key)));
  const n = ts.length;
  if (n < 2) return;
  const MAX_PASSES = 60;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = ts[i], b = ts[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + GAP;
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + GAP;
        if (ox <= 0 || oy <= 0) continue;   // not overlapping (with gap)
        // push apart along the axis of least penetration
        if (ox < oy) {
          const shift = ox / 2;
          if (a.x < b.x) { a.x -= shift; b.x += shift; }
          else { a.x += shift; b.x -= shift; }
        } else {
          const shift = oy / 2;
          if (a.y < b.y) { a.y -= shift; b.y += shift; }
          else { a.y += shift; b.y -= shift; }
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

// Tables with no relations get packed into a compact grid beside the graph,
// rather than a single tall column that wastes space.
function placeOrphans(model, isHidden = null) {
  const hid = (k) => !!(isHidden && isHidden(k));
  const connected = new Set();
  for (const r of model.relations) {
    connected.add(r.fromTable.toLowerCase());
    connected.add(r.toTable.toLowerCase());
  }
  const orphans = model.tables.filter(t => !hid(t.key) && (!connected.has(t.key) || !Number.isFinite(t.x)));
  if (!orphans.length) return;

  const placed = model.tables.filter(t => Number.isFinite(t.x) && connected.has(t.key) && !hid(t.key));
  let maxX = 0, minY = Infinity, maxY = -Infinity;
  for (const t of placed) {
    maxX = Math.max(maxX, t.x + t.w);
    minY = Math.min(minY, t.y);
    maxY = Math.max(maxY, t.y + t.h);
  }
  if (!Number.isFinite(minY)) { minY = 40; maxY = 40; }

  const startX = (placed.length ? maxX + 100 : 40);
  const colW = Math.max(...orphans.map(t => t.w), 160) + 36;
  const availH = Math.max(maxY - minY, 400);
  let x = startX, y = minY, rowMax = 0;
  for (const t of orphans) {
    if (y > minY && y + t.h > minY + availH) { y = minY; x += colW; rowMax = 0; }
    t.x = x;
    t.y = y;
    y += t.h + 36;
    rowMax = Math.max(rowMax, t.w);
  }
}
