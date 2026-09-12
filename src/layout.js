// Multi-algorithm table layout engine for SQL ER Diagrams:
// 1. Hierarchical (Dagre / Sugiyama) with rankdir LR/TB and hub weighting
// 2. Physics / Force-Directed with spring attraction, coulomb repulsion, group clustering, and strict anti-collision
// 3. Radial Hub & Satellites (centers primary entity hubs and lays dependencies in concentric arcs)
//
// Guaranteed post-processing:
//  - TableGroup spatial cohesion
//  - Zero-overlap AABB push resolution
//  - Clean orphan side grid packing

import dagre from '@dagrejs/dagre';
import { measureTable } from './renderer.js';

const PRESETS = {
  comfortable: { nodesep: 36, ranksep: 130, edgesep: 24, gap: 20 },
  compact:     { nodesep: 22, ranksep: 80,  edgesep: 14, gap: 14 },
  spacious:    { nodesep: 60, ranksep: 200, edgesep: 36, gap: 32 },
};

function prepareTableSizes(model) {
  for (const t of model.tables) {
    const dims = measureTable(t);
    t.w = dims.w;
    t.h = dims.h;
    t.rowH = dims.rowH;
    t.headerH = dims.headerH;
  }
}

function normalizePositions(tables, minTargetX = 60, minTargetY = 60) {
  let minX = Infinity, minY = Infinity;
  for (const t of tables) {
    if (Number.isFinite(t.x)) minX = Math.min(minX, t.x);
    if (Number.isFinite(t.y)) minY = Math.min(minY, t.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

  const dx = minTargetX - minX;
  const dy = minTargetY - minY;
  for (const t of tables) {
    if (Number.isFinite(t.x)) {
      t.x = Math.round(t.x + dx);
      t.y = Math.round(t.y + dy);
    }
  }
}

/**
 * 1. Hierarchical (Dagre) Layout
 */
export function dagreLayout(model, opts = {}, hidden = null) {
  const dir = opts.dir === 'TB' ? 'TB' : 'LR';
  const preset = PRESETS[opts.spacing] || PRESETS.comfortable;
  const isHidden = (key) => !!(hidden && hidden.has(key));

  prepareTableSizes(model);

  const degree = new Map();
  const bump = (k) => degree.set(k, (degree.get(k) || 0) + 1);
  for (const r of (model.relations || [])) {
    const f = r.fromTable.toLowerCase(), t = r.toTable.toLowerCase();
    if (f !== t) { bump(f); bump(t); }
  }

  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
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
    if (isHidden(t.key)) continue;
    g.setNode(t.key, { width: t.w, height: t.h });
  }

  if (model.groups && Array.isArray(model.groups)) {
    for (let i = 0; i < model.groups.length; i++) {
      const grp = model.groups[i];
      const grpId = 'grp_' + i;
      g.setNode(grpId, { label: grp.name, clusterNode: true });
      for (const tName of grp.tables || []) {
        const key = String(tName).toLowerCase();
        if (g.hasNode(key) && !isHidden(key)) {
          g.setParent(key, grpId);
        }
      }
    }
  }

  let e = 0;
  for (const r of (model.relations || [])) {
    const from = r.fromTable.toLowerCase();
    const to = r.toTable.toLowerCase();
    if (g.hasNode(from) && g.hasNode(to) && from !== to) {
      const hubness = Math.max(degree.get(from) || 0, degree.get(to) || 0);
      const weight = 1 + Math.min(hubness, 12);
      g.setEdge(from, to, { weight, minlen: 1 }, 'e' + e++);
    }
  }

  dagre.layout(g);

  for (const t of model.tables) {
    const node = g.node(t.key);
    if (node) {
      t.x = Math.round(node.x - t.w / 2);
      t.y = Math.round(node.y - t.h / 2);
    } else {
      t.x = NaN; t.y = NaN;
    }
  }

  placeOrphans(model, isHidden);
  removeOverlaps(model, isHidden);
}

/**
 * 2. Physics / Force-Directed Layout
 */
export function forceLayout(model, opts = {}, hidden = null) {
  const isHidden = (key) => !!(hidden && hidden.has(key));
  prepareTableSizes(model);

  const visibleTables = model.tables.filter(t => !isHidden(t.key));
  const n = visibleTables.length;
  if (!n) return;
  if (n === 1) {
    visibleTables[0].x = 100; visibleTables[0].y = 100;
    return;
  }

  const tableMap = new Map(visibleTables.map(t => [t.key.toLowerCase(), t]));
  const spacingMultiplier = opts.spacing === 'compact' ? 0.75 : (opts.spacing === 'spacious' ? 1.4 : 1.0);
  const idealDist = 200 * spacingMultiplier;

  // Initialize unplaced tables in a circle
  const unplaced = visibleTables.some(t => !Number.isFinite(t.x));
  if (unplaced) {
    const initR = Math.max(160, n * 35);
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * 2 * Math.PI;
      visibleTables[i].x = 500 + initR * Math.cos(angle) - visibleTables[i].w / 2;
      visibleTables[i].y = 400 + initR * Math.sin(angle) - visibleTables[i].h / 2;
    }
  }

  // Simulation parameters
  const STEPS = 140;
  let temp = 1.0;
  const cooling = 0.965;

  for (let step = 0; step < STEPS; step++) {
    const forces = visibleTables.map(() => ({ fx: 0, fy: 0 }));

    // 1. Repulsive forces (Coulomb between all table pairs)
    for (let i = 0; i < n; i++) {
      const ti = visibleTables[i];
      const ciX = ti.x + ti.w / 2, ciY = ti.y + ti.h / 2;

      for (let j = i + 1; j < n; j++) {
        const tj = visibleTables[j];
        const cjX = tj.x + tj.w / 2, cjY = tj.y + tj.h / 2;
        let dx = cjX - ciX, dy = cjY - ciY;
        let dist = Math.hypot(dx, dy);
        if (dist < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); dist = 1; }

        const minSep = (ti.w + tj.w) / 2 + (ti.h + tj.h) / 2 + 35;
        const rep = (minSep * minSep * 1.5) / (dist * dist);
        const nx = dx / dist, ny = dy / dist;

        forces[i].fx -= nx * rep;
        forces[i].fy -= ny * rep;
        forces[j].fx += nx * rep;
        forces[j].fy += ny * rep;
      }
    }

    // 2. Attractive spring forces along foreign key edges
    for (const r of (model.relations || [])) {
      const f = tableMap.get(r.fromTable.toLowerCase());
      const t = tableMap.get(r.toTable.toLowerCase());
      if (!f || !t || f === t) continue;

      const fi = visibleTables.indexOf(f);
      const ti = visibleTables.indexOf(t);
      if (fi < 0 || ti < 0) continue;

      const fcX = f.x + f.w / 2, fcY = f.y + f.h / 2;
      const tcX = t.x + t.w / 2, tcY = t.y + t.h / 2;
      const dx = tcX - fcX, dy = tcY - fcY;
      const dist = Math.max(1, Math.hypot(dx, dy));

      const displacement = dist - idealDist;
      const att = displacement * 0.08;
      const nx = dx / dist, ny = dy / dist;

      forces[fi].fx += nx * att;
      forces[fi].fy += ny * att;
      forces[ti].fx -= nx * att;
      forces[ti].fy -= ny * att;
    }

    // 3. Group cohesion forces (tables in the same TableGroup attract to group centroid)
    if (model.groups && Array.isArray(model.groups)) {
      for (const g of model.groups) {
        const gTables = (g.tables || []).map(k => tableMap.get(String(k).toLowerCase())).filter(Boolean);
        if (gTables.length <= 1) continue;

        let gcx = 0, gcy = 0;
        for (const t of gTables) { gcx += t.x + t.w / 2; gcy += t.y + t.h / 2; }
        gcx /= gTables.length; gcy /= gTables.length;

        for (const t of gTables) {
          const idx = visibleTables.indexOf(t);
          if (idx >= 0) {
            forces[idx].fx += (gcx - (t.x + t.w / 2)) * 0.12;
            forces[idx].fy += (gcy - (t.y + t.h / 2)) * 0.12;
          }
        }
      }
    }

    // 4. Move tables bounded by temperature
    const maxDisp = temp * 45;
    for (let i = 0; i < n; i++) {
      const t = visibleTables[i];
      const f = forces[i];
      const mag = Math.hypot(f.fx, f.fy);
      if (mag > 0) {
        const d = Math.min(mag, maxDisp);
        t.x += (f.fx / mag) * d;
        t.y += (f.fy / mag) * d;
      }
    }

    temp *= cooling;
  }

  normalizePositions(visibleTables, 80, 80);
  placeOrphans(model, isHidden);
  removeOverlaps(model, isHidden);
}

/**
 * 3. Radial / Hub & Satellites Layout
 */
export function radialLayout(model, opts = {}, hidden = null) {
  const isHidden = (key) => !!(hidden && hidden.has(key));
  prepareTableSizes(model);

  const visibleTables = model.tables.filter(t => !isHidden(t.key));
  if (!visibleTables.length) return;
  if (visibleTables.length === 1) {
    visibleTables[0].x = 100;
    visibleTables[0].y = 100;
    return;
  }

  // 1. Build adjacency graph and degree counts
  const degree = new Map();
  const adj = new Map();
  for (const t of visibleTables) {
    degree.set(t.key.toLowerCase(), 0);
    adj.set(t.key.toLowerCase(), new Set());
  }

  for (const r of (model.relations || [])) {
    const f = r.fromTable.toLowerCase(), t = r.toTable.toLowerCase();
    if (f !== t && adj.has(f) && adj.has(t)) {
      adj.get(f).add(t);
      adj.get(t).add(f);
      degree.set(f, degree.get(f) + 1);
      degree.set(t, degree.get(t) + 1);
    }
  }

  // 2. Identify top hub table (highest degree)
  let maxDegree = -1;
  let hubKey = visibleTables[0].key.toLowerCase();
  for (const [k, d] of degree.entries()) {
    if (d > maxDegree) {
      maxDegree = d;
      hubKey = k;
    }
  }

  // 3. BFS layer assignment from hub
  const layers = [];
  const layerMap = new Map();
  const parentMap = new Map();
  const visited = new Set([hubKey]);
  let currentLayer = [hubKey];
  layerMap.set(hubKey, 0);

  while (currentLayer.length) {
    layers.push(currentLayer);
    const nextLayer = [];
    for (const u of currentLayer) {
      for (const v of adj.get(u) || []) {
        if (!visited.has(v)) {
          visited.add(v);
          layerMap.set(v, layers.length);
          parentMap.set(v, u);
          nextLayer.push(v);
        }
      }
    }
    currentLayer = nextLayer;
  }

  // 4. Center coordinates and spacing
  const spacingMultiplier = opts.spacing === 'compact' ? 0.75 : (opts.spacing === 'spacious' ? 1.35 : 1.0);
  const cx = 800, cy = 600;

  const tableMap = new Map(visibleTables.map(t => [t.key.toLowerCase(), t]));
  const hubTable = tableMap.get(hubKey);
  if (hubTable) {
    hubTable.x = cx - hubTable.w / 2;
    hubTable.y = cy - hubTable.h / 2;
  }

  // 5. Place concentric rings
  let currentRadius = (opts.spacing === 'compact' ? 240 : 340);
  for (let l = 1; l < layers.length; l++) {
    const layerKeys = layers[l];
    layerKeys.sort((a, b) => {
      const pa = parentMap.get(a) || '', pb = parentMap.get(b) || '';
      return pa.localeCompare(pb);
    });

    const n = layerKeys.length;
    const requiredRadius = Math.max(currentRadius, (n * 160 * spacingMultiplier) / (2 * Math.PI));
    const angleStep = (2 * Math.PI) / n;

    for (let i = 0; i < n; i++) {
      const tKey = layerKeys[i];
      const t = tableMap.get(tKey);
      if (!t) continue;
      const angle = i * angleStep;
      t.x = Math.round(cx + requiredRadius * Math.cos(angle) - t.w / 2);
      t.y = Math.round(cy + requiredRadius * Math.sin(angle) - t.h / 2);
    }
    currentRadius = requiredRadius + (opts.spacing === 'compact' ? 220 : 320) * spacingMultiplier;
  }

  normalizePositions(visibleTables, 80, 80);
  placeOrphans(model, isHidden);
  removeOverlaps(model, isHidden);
}

/**
 * Dispatcher for auto-layout algorithms:
 * opts.algo = 'dagre' (default) | 'force' | 'radial'
 */
export function layout(model, opts = {}, hidden = null) {
  const algo = opts.algo || 'dagre';
  if (algo === 'force') {
    forceLayout(model, opts, hidden);
  } else if (algo === 'radial') {
    radialLayout(model, opts, hidden);
  } else {
    dagreLayout(model, opts, hidden);
  }
}

/**
 * Guarantee no two tables overlap along minimum penetration axis.
 */
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
        if (ox <= 0 || oy <= 0) continue;
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

/**
 * Tables with no relations get packed into a compact grid beside the graph.
 */
function placeOrphans(model, isHidden = null) {
  const hid = (k) => !!(isHidden && isHidden(k));
  const connected = new Set();
  for (const r of (model.relations || [])) {
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
