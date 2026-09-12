// "Optimized grid" (menu name; was "1 Columna o 1 Fila") — group layout,
// snapshot of commit c00d210.
//
// Takes Spacing from the Arrange menu (added later). Direction is applied
// afterwards by turning the finished layout (rotate-diagram.js). A diagram with
// no groups is laid out as one invisible group (added later); only then are just
// the 3 best-seeded grid shapes searched and the settle passes skipped. The
// crossing count also gained a bounding-box pre-check, which changes speed only:
// positions verified identical, with and without groups. Otherwise
// FROZEN. One of four independent group-layout algorithms the user keeps side by
// side to pick from. Do not refactor it towards the others and do not port fixes
// into it: it is kept precisely because it lays a diagram out differently, and
// changing it would lose the alternative. Shared-looking helpers below are
// intentional copies.
//
// How it works: no dagre at all. Each group's tables and then the groups
// themselves are packed into a grid, enumerating candidate (cols x rows) shapes
// and improving each with pairwise swaps scored by a cheap geometric estimate.
//
// Character: strongly favours a single-file arrangement, so the canvas comes out
// as a tall narrow column (measured 2309x8172, 3.54:1) — pick it when you want
// the groups stacked in reading order rather than spread over a wide board.
//
// Measured on a 35-table / 8-group / 59-relation schema:
//   59 crossings | 82644px of line | longest line 6282px | 73 vertices
//   canvas 2309x8172 (3.54:1) | 13.2% of the canvas is table | 186ms

import { measureTable } from './renderer.js';

const GL_CROSS_COST = 200;   // estimated px charged per crossing between two connections
const GL_BEND_COST = 40;     // ... per bend, i.e. per connection whose boxes share no axis
const GL_CELL_GAP = 56;      // space between tables inside a group
const GL_PAD_X = 32;         // group box padding
const GL_PAD_TOP = 56;       // ... leaving room for the group label
const GL_PAD_BOTTOM = 28;
const GL_GUTTER = 190;       // channel left between group boxes for cross-group lines
const GL_LOOSE_GAP = 72;     // space between a loose table and the group it hangs off
const GL_SWAP_ROUNDS = 6;    // local-search sweeps per group / per group placement
const GL_MAX_SHAPES = 12;    // candidate grid shapes evaluated per layout problem
const GL_SETTLE_ITERS = 4;   // inner-layout / group-placement alternations before giving up
const GL_POLISH_ROUNDS = 6;  // whole-canvas swap sweeps once the hierarchy is seeded
const GL_IMPLICIT_SHAPES = 3; // grid shapes searched when the whole diagram is one invisible group

/** Do the two boxes share any vertical or horizontal overlap? */
function sharesAxis(a, b) {
  const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return xOverlap > 8 || yOverlap > 8;
}

function centreOf(b) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Which side of the line p->q the point r falls on: -1, 0 or 1. */
function orient(p, q, r) {
  return Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
}

/** Do two centre-to-centre segments properly cross? */
function segmentsCross(a1, a2, b1, b2) {
  // `orient` lives outside so no closure is built per call: this runs millions
  // of times when the whole diagram is scored as one group.
  const d1 = orient(a1, a2, b1), d2 = orient(a1, a2, b2);
  const d3 = orient(b1, b2, a1), d4 = orient(b1, b2, a2);
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

/**
 * Cheap quality estimate of a set of placed boxes and the links between them.
 * `links` are { a, b, w } over indices into `boxes`; `anchors` are fixed points
 * a box is pulled towards (an external partner already placed elsewhere).
 */
function estimateCost(boxes, links, anchors = []) {
  let cost = 0;
  const segs = [];

  for (const l of links) {
    const A = boxes[l.a], B = boxes[l.b];
    if (!A || !B) continue;
    const ca = centreOf(A), cb = centreOf(B);
    cost += (Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y)) * l.w;
    if (!sharesAxis(A, B)) cost += GL_BEND_COST * l.w;
    segs.push([ca, cb]);
  }

  for (const an of anchors) {
    const B = boxes[an.box];
    if (!B) continue;
    const c = centreOf(B);
    cost += (Math.abs(c.x - an.x) + Math.abs(c.y - an.y)) * an.w;
    segs.push([c, { x: an.x, y: an.y }]);
  }

  // Segments whose bounding boxes are apart cannot cross, so they skip the exact
  // test: the same count, far fewer tests. With no groups the whole diagram is
  // scored at once, and testing every pair made 60 tables take 19 s.
  const bb = segs.map(([p, q]) => [Math.min(p.x, q.x), Math.max(p.x, q.x), Math.min(p.y, q.y), Math.max(p.y, q.y)]);
  for (let i = 0; i < segs.length; i++) {
    const a = bb[i];
    for (let j = i + 1; j < segs.length; j++) {
      const b = bb[j];
      if (a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]) continue;
      if (segmentsCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) cost += GL_CROSS_COST;
    }
  }
  return cost;
}

/** Candidate (cols, rows) grids for n items, widest choice first, capped. */
function candidateShapes(n) {
  if (n <= 1) return [{ cols: 1, rows: 1 }];
  const all = [];
  for (let cols = 1; cols <= n; cols++) all.push({ cols, rows: Math.ceil(n / cols) });
  if (all.length <= GL_MAX_SHAPES) return all;
  // Keep the squarish middle plus the two extremes: those are the useful ones.
  const mid = Math.round(Math.sqrt(n));
  all.sort((a, b) => Math.abs(a.cols - mid) - Math.abs(b.cols - mid));
  const keep = all.slice(0, GL_MAX_SHAPES - 2);
  keep.push({ cols: 1, rows: n }, { cols: n, rows: 1 });
  return keep;
}

/**
 * Position `items` (each with w/h) into the cells of a grid, given an ordering.
 * Column widths and row heights follow the actual items landing in them, so a
 * wide table never leaves a hole beside a narrow one.
 */
function placeInGrid(items, order, cols, gap, originX = 0, originY = 0) {
  const rows = Math.ceil(order.length / cols);
  const colW = new Array(cols).fill(0);
  const rowH = new Array(rows).fill(0);

  order.forEach((itemIdx, slot) => {
    const it = items[itemIdx];
    if (!it) return;
    const c = slot % cols, r = (slot / cols) | 0;
    colW[c] = Math.max(colW[c], it.w);
    rowH[r] = Math.max(rowH[r], it.h);
  });

  const colX = [originX];
  for (let c = 1; c < cols; c++) colX[c] = colX[c - 1] + colW[c - 1] + gap;
  const rowY = [originY];
  for (let r = 1; r < rows; r++) rowY[r] = rowY[r - 1] + rowH[r - 1] + gap;

  const boxes = new Array(items.length).fill(null);
  order.forEach((itemIdx, slot) => {
    const it = items[itemIdx];
    if (!it) return;
    const c = slot % cols, r = (slot / cols) | 0;
    // Centre each item in its cell so rows of mixed heights still read straight.
    boxes[itemIdx] = {
      x: colX[c] + (colW[c] - it.w) / 2,
      y: rowY[r] + (rowH[r] - it.h) / 2,
      w: it.w, h: it.h,
    };
  });

  const totalW = cols ? colX[cols - 1] + colW[cols - 1] - originX : 0;
  const totalH = rows ? rowY[rows - 1] + rowH[rows - 1] - originY : 0;
  return { boxes, w: totalW, h: totalH };
}

/**
 * Choose the grid shape and the ordering that route best, by trying every
 * sensible shape and improving each with pairwise swaps.
 */
function solvePlacement(items, links, anchors, gap, wantWide = true, maxShapes = Infinity) {
  const n = items.length;
  if (!n) return { boxes: [], w: 0, h: 0, order: [], cols: 1 };
  if (n === 1) {
    const p = placeInGrid(items, [0], 1, gap);
    return { ...p, order: [0], cols: 1 };
  }

  // Seed the ordering by connection weight, so hubs start near the middle.
  const degree = new Array(n).fill(0);
  for (const l of links) { degree[l.a] += l.w; degree[l.b] += l.w; }
  const seed = Array.from({ length: n }, (_, i) => i).sort((a, b) => degree[b] - degree[a]);

  // Every shape costs a full swap search, which takes seconds once one group
  // holds the whole diagram. When capped, search only the shapes the seed order
  // already scores best in: on the 60- and 100-table test diagrams without
  // groups, the winner was among the three best seeds.
  let shapes = candidateShapes(n);
  if (shapes.length > maxShapes) {
    const seedScore = (shape) => {
      const p = placeInGrid(items, seed, shape.cols, gap);
      const bulk = Math.max(p.w, p.h) / Math.max(1, Math.min(p.w, p.h));
      const facesRight = wantWide ? p.w >= p.h : p.h >= p.w;
      return (estimateCost(p.boxes, links, anchors) + bulk * 12) * (facesRight ? 1 : 3);
    };
    const keep = new Set(shapes
      .map(s => [s, seedScore(s)])
      .sort((a, b) => a[1] - b[1])
      .slice(0, maxShapes)
      .map(e => e[0]));
    shapes = shapes.filter(s => keep.has(s));  // original order, so ties resolve as before
  }

  let best = null;
  for (const shape of shapes) {
    const order = seed.slice();
    let placed = placeInGrid(items, order, shape.cols, gap);
    let cost = estimateCost(placed.boxes, links, anchors);

    for (let round = 0; round < GL_SWAP_ROUNDS; round++) {
      let improved = false;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const trial = order.slice();
          [trial[i], trial[j]] = [trial[j], trial[i]];
          const tp = placeInGrid(items, trial, shape.cols, gap);
          const tc = estimateCost(tp.boxes, links, anchors);
          if (tc < cost - 0.5) {
            order[i] = trial[i]; order[j] = trial[j];
            placed = tp; cost = tc; improved = true;
          }
        }
      }
      if (!improved) break;
    }

    // Prefer the cheaper route; lean towards a horizontal arrangement at both
    // levels. "Vertical" is this result turned afterwards (rotate-diagram.js).
    const bulk = Math.max(placed.w, placed.h) / Math.max(1, Math.min(placed.w, placed.h));
    // Multiplicative, not additive: this algorithm's costs run into tens of
    // thousands of px, so a flat penalty would never outweigh them. It is a
    // preference, not a guarantee — at compact spacing this variant packs each
    // group into a tall column, and no arrangement of boxes 3400px tall can be
    // made wider than tall, so "Horizontal" is simply unreachable there.
    const facesRight = wantWide ? placed.w >= placed.h : placed.h >= placed.w;
    const score = (cost + bulk * 12) * (facesRight ? 1 : 3);
    if (!best || score < best.score) {
      best = { boxes: placed.boxes, w: placed.w, h: placed.h, order, cols: shape.cols, cost, score };
    }
  }
  return best;
}

// --- Direction and Spacing, driven by the Arrange menu ---------------------
// Copied into each group-layout algorithm on purpose: the three are deliberately
// independent, so these helpers are duplicated rather than shared.

// "comfortable" is exactly the values this algorithm was tuned and measured
// with, so the setting the user already likes never moves. Gutters between group
// boxes are damped to half the factor: widening them costs far more routing
// quality than widening the gaps between tables (measured on the compact
// variant, gutter 90 -> 220 took total line length from 9833px to 12319px).
const GL_SPACING = { compact: 0.75, comfortable: 1, spacious: 1.45 };

function spacingScale(spacing) {
  const f = GL_SPACING[spacing] ?? 1;
  return { gap: f, pad: f, gutter: 1 + (f - 1) * 0.5 };
}

/** Groups defined on the canvas, with their member tables resolved. */
export function collectGroupsSingleAxis(model, annotations = []) {
  const tables = model?.tables || [];
  const byKey = new Map(tables.map(t => [t.key.toLowerCase(), t]));
  const groupAnnos = (annotations || []).filter(a => a.type === 'group');
  const raw = [];

  if (groupAnnos.length) {
    for (const a of groupAnnos) {
      let keys = Array.isArray(a.tables)
        ? a.tables.map(k => String(k).toLowerCase()).filter(k => byKey.has(k))
        : [];
      // A box drawn around tables without listing them still counts.
      if (!keys.length && Number.isFinite(a.x) && Number.isFinite(a.w)) {
        for (const t of tables) {
          if (!Number.isFinite(t.x)) continue;
          if (t.x >= a.x - 20 && t.x + (t.w || 100) <= a.x + a.w + 20 &&
              t.y >= a.y - 20 && t.y + (t.h || 50) <= a.y + a.h + 20) {
            keys.push(t.key.toLowerCase());
          }
        }
      }
      if (keys.length) raw.push({ id: a.id, name: a.text || 'Group', color: a.color || 'blue', keys });
    }
  } else if (Array.isArray(model?.groups) && model.groups.length) {
    for (const g of model.groups) {
      const keys = (g.tables || []).map(k => String(k).toLowerCase()).filter(k => byKey.has(k));
      if (keys.length) raw.push({ name: g.name || 'Group', color: g.color || 'blue', keys });
    }
  }

  // A table belongs to one group only: the first that claims it.
  const claimed = new Set();
  const groups = [];
  for (const g of raw) {
    const keys = g.keys.filter(k => !claimed.has(k));
    for (const k of keys) claimed.add(k);
    if (keys.length) groups.push({ ...g, keys, tables: keys.map(k => byKey.get(k)) });
  }
  const loose = tables.filter(t => !claimed.has(t.key.toLowerCase()));
  return { groups, loose, byKey };
}

/** Weighted table-to-table adjacency across relations and manual links. */
function buildLinks(diagram) {
  const weights = new Map();
  const bump = (a, b) => {
    if (!a || !b || a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    weights.set(key, (weights.get(key) || 0) + 1);
  };
  for (const r of (diagram.model?.relations || [])) {
    bump((r.fromTable || '').toLowerCase(), (r.toTable || '').toLowerCase());
  }
  for (const l of (diagram.manualLinks || [])) {
    bump((l.from?.table || '').toLowerCase(), (l.to?.table || '').toLowerCase());
  }
  return [...weights.entries()].map(([k, w]) => {
    const [a, b] = k.split('|');
    return { a, b, w };
  });
}

/**
 * Re-arrange the existing groups and the tables inside them so the connections
 * route as short, straight and untangled as the estimate can tell. Clears every
 * stored waypoint and anchor first, so the lines start from a clean slate.
 * Returns { groups, tables, loose, annotations, cost }.
 */
export function arrangeGroupsSingleAxis(diagram, opts = {}) {
  // Spacing from the Arrange menu, relative to this algorithm's tuned values.
  const S = spacingScale(opts.spacing);
  const PAD_X = Math.round(GL_PAD_X * S.pad);
  const PAD_TOP = Math.round(GL_PAD_TOP * S.pad);
  const PAD_BOTTOM = Math.round(GL_PAD_BOTTOM * S.pad);
  const GUTTER = Math.round(GL_GUTTER * S.gutter);
  const LOOSE_GAP = Math.round(GL_LOOSE_GAP * S.gap);
  const CELL_GAP = Math.round(GL_CELL_GAP * S.gap);
  const GAP = CELL_GAP;

  const model = diagram?.model;
  if (!model?.tables?.length) throw new Error('The diagram has no tables to arrange.');

  const level = diagram.diagramLevel || 'physical';
  for (const t of model.tables) {
    const dims = measureTable(t, level);
    t.w = dims.w; t.h = dims.h; t.rowH = dims.rowH; t.headerH = dims.headerH;
  }

  let { groups, loose, byKey } = collectGroupsSingleAxis(model, diagram.annotations);
  // No groups at all: the whole diagram becomes one invisible group, so the same
  // machinery still lays it out. It never gets a box, and nothing is left loose.
  const implicit = !groups.length;
  if (implicit) {
    groups = [{ keys: model.tables.map(t => t.key.toLowerCase()), tables: model.tables.slice(), implicit }];
    loose = [];
  }

  diagram.onHistorySnapshot?.(diagram.getSnapshot());

  // Wipe every vertex and anchor: the lines must be re-derived from scratch.
  diagram.edgeWaypoints.clear();
  diagram.edgeAnchors.clear();

  const links = buildLinks(diagram);
  const groupOf = new Map();
  groups.forEach((g, i) => g.keys.forEach(k => groupOf.set(k, i)));

  // --- Stage 1 & 3: inner layout, twice, so the second pass can aim tables at
  // the external partners the first pass revealed the position of.
  const layoutInner = (externalCentres) => {
    for (const g of groups) {
      const idxOf = new Map(g.keys.map((k, i) => [k, i]));
      const inner = [];
      const anchors = [];
      for (const l of links) {
        const ia = idxOf.get(l.a), ib = idxOf.get(l.b);
        if (ia !== undefined && ib !== undefined) {
          inner.push({ a: ia, b: ib, w: l.w });
        } else if (externalCentres && (ia !== undefined || ib !== undefined)) {
          // External relations pull with the same weight as internal ones, so a
          // table drifts towards the face of its group that looks at its partner.
          const mine = ia !== undefined ? ia : ib;
          const c = externalCentres.get(ia !== undefined ? l.b : l.a);
          if (c) {
            anchors.push({
              box: mine,
              x: c.x - g.x0 - PAD_X,     // inner layout is relative to the box padding
              y: c.y - g.y0 - PAD_TOP,
              w: l.w,
            });
          }
        }
      }
      const sol = solvePlacement(g.tables, inner, anchors, CELL_GAP, true, g.implicit ? GL_IMPLICIT_SHAPES : Infinity);
      g.inner = sol;
      g.w = sol.w + PAD_X * 2;
      g.h = sol.h + PAD_TOP + PAD_BOTTOM;
    }
  };

  layoutInner(null);

  // --- Stage 2: place the groups themselves, shape chosen freely.
  const placeGroups = () => {
    const items = groups.map(g => ({ w: g.w, h: g.h }));
    const gLinks = new Map();
    for (const l of links) {
      const ga = groupOf.get(l.a), gb = groupOf.get(l.b);
      if (ga === undefined || gb === undefined || ga === gb) continue;
      const key = ga < gb ? `${ga}|${gb}` : `${gb}|${ga}`;
      gLinks.set(key, (gLinks.get(key) || 0) + l.w);
    }
    const arr = [...gLinks.entries()].map(([k, w]) => {
      const [a, b] = k.split('|').map(Number);
      return { a, b, w };
    });
    const sol = solvePlacement(items, arr, [], GUTTER);
    groups.forEach((g, i) => {
      const b = sol.boxes[i];
      g.x0 = 80 + b.x;
      g.y0 = 80 + b.y;
    });
    return sol;
  };

  let placement = placeGroups();

  const applyInner = () => {
    for (const g of groups) {
      g.tables.forEach((t, i) => {
        const b = g.inner.boxes[i];
        if (!b) return;
        t.x = Math.round(g.x0 + PAD_X + b.x);
        t.y = Math.round(g.y0 + PAD_TOP + b.y);
      });
    }
  };
  applyInner();

  const snapshotCentres = () => {
    const m = new Map();
    for (const t of model.tables) if (Number.isFinite(t.x)) m.set(t.key.toLowerCase(), centreOf(t));
    return m;
  };

  // The inner layouts aim at where the neighbouring groups are, and moving the
  // groups changes that — so alternate the two until the group order settles,
  // otherwise every table is pointed at an address the groups have left.
  // A lone invisible group has no neighbours to aim at, so these passes would
  // only recompute the very same inner layout, twice. Skip them.
  if (!implicit) {
    let lastOrder = placement.order.join(',');
    for (let iter = 0; iter < GL_SETTLE_ITERS; iter++) {
      layoutInner(snapshotCentres());
      placement = placeGroups();
      applyInner();
      const order = placement.order.join(',');
      if (order === lastOrder) break;
      lastOrder = order;
    }

    // One last inner pass against the final group positions, which stay put; the
    // boxes are measured from the tables afterwards, so a size change is harmless.
    layoutInner(snapshotCentres());
    applyInner();
  }
  const finalPlacement = placement;

  // --- Global polish -------------------------------------------------------
  // The two stages above each optimise their own level: tables against their
  // group, groups against each other. Neither can see the thing that actually
  // tangles a diagram — a line from one table deep inside a group to another
  // table deep inside a different one. So finish by scoring EVERY relation as
  // one segment across the whole canvas, and keep swapping until nothing helps.
  const tableIdx = new Map(model.tables.map((t, i) => [t.key.toLowerCase(), i]));
  const globalLinks = links
    .map(l => ({ a: tableIdx.get(l.a), b: tableIdx.get(l.b), w: l.w }))
    .filter(l => l.a !== undefined && l.b !== undefined);
  const globalCost = () => estimateCost(model.tables, globalLinks);

  let groupOrder = finalPlacement.order.slice();
  const groupCols = finalPlacement.cols;

  const rebuildGroup = (g) => {
    const p = placeInGrid(g.tables, g.inner.order, g.inner.cols, CELL_GAP);
    g.inner.boxes = p.boxes;
    g.w = p.w + PAD_X * 2;
    g.h = p.h + PAD_TOP + PAD_BOTTOM;
  };
  const rebuildGroupPositions = () => {
    const p = placeInGrid(groups.map(g => ({ w: g.w, h: g.h })), groupOrder, groupCols, GUTTER);
    groups.forEach((g, i) => {
      const b = p.boxes[i];
      g.x0 = 80 + b.x;
      g.y0 = 80 + b.y;
    });
  };

  rebuildGroupPositions();
  applyInner();

  let best = globalCost();
  for (let round = 0; round < GL_POLISH_ROUNDS; round++) {
    let improved = false;

    // Move a table to a different cell of its own group.
    for (const g of groups) {
      const n = g.tables.length;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const saved = g.inner.order.slice();
          [g.inner.order[i], g.inner.order[j]] = [g.inner.order[j], g.inner.order[i]];
          rebuildGroup(g);
          rebuildGroupPositions();
          applyInner();
          const cost = globalCost();
          if (cost < best - 0.5) { best = cost; improved = true; }
          else {
            g.inner.order = saved;
            rebuildGroup(g);
            rebuildGroupPositions();
            applyInner();
          }
        }
      }
    }

    // Swap two whole groups.
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const saved = groupOrder.slice();
        [groupOrder[i], groupOrder[j]] = [groupOrder[j], groupOrder[i]];
        rebuildGroupPositions();
        applyInner();
        const cost = globalCost();
        if (cost < best - 0.5) { best = cost; improved = true; }
        else {
          groupOrder = saved;
          rebuildGroupPositions();
          applyInner();
        }
      }
    }

    if (!improved) break;
  }

  // --- 4. Ungrouped tables hang loose beside their strongest group.
  // A function, not a straight-line block: turning the diagram moves every group
  // box, so the loose tables have to be re-parked afterwards.
  const placeLoose = () => {
    const placed = groups.map(g => ({ x: g.x0, y: g.y0, w: g.w, h: g.h }));
    const looseBoxes = [];
    for (const t of loose) {
      const k = t.key.toLowerCase();
      const pull = new Map();
      for (const l of links) {
        const other = l.a === k ? l.b : (l.b === k ? l.a : null);
        if (!other) continue;
        const gi = groupOf.get(other);
        if (gi !== undefined) pull.set(gi, (pull.get(gi) || 0) + l.w);
      }
      let host = -1, bestW = 0;
      for (const [gi, w] of pull) if (w > bestW) { bestW = w; host = gi; }
      const anchor = host >= 0 ? groups[host] : groups[0];

      const slots = [];
      for (let ring = 0; ring < 8; ring++) {
        const dy = ring * (t.h + LOOSE_GAP);
        const dx = ring * (t.w + LOOSE_GAP);
        slots.push({ x: anchor.x0 + anchor.w + LOOSE_GAP, y: anchor.y0 + dy });
        slots.push({ x: anchor.x0 - t.w - LOOSE_GAP, y: anchor.y0 + dy });
        slots.push({ x: anchor.x0 + dx, y: anchor.y0 + anchor.h + LOOSE_GAP });
        slots.push({ x: anchor.x0 + dx, y: anchor.y0 - t.h - LOOSE_GAP });
      }
      const clashes = (box) => (o) =>
        Math.min(box.x + box.w, o.x + o.w) - Math.max(box.x, o.x) > -LOOSE_GAP / 2 &&
        Math.min(box.y + box.h, o.y + o.h) - Math.max(box.y, o.y) > -LOOSE_GAP / 2;
      const free = slots.find(s => {
        const box = { x: s.x, y: s.y, w: t.w, h: t.h };
        return !placed.some(clashes(box)) && !looseBoxes.some(clashes(box));
      }) || slots[0];

      t.x = Math.round(free.x);
      t.y = Math.round(free.y);
      looseBoxes.push({ x: t.x, y: t.y, w: t.w, h: t.h });
    }
  };
  placeLoose();
  // --- Group boxes, regenerated to wrap what is actually inside them.
  const notes = (diagram.annotations || []).filter(a => a.type !== 'group');
  const boxes = groups.filter(g => !g.implicit).map((g, i) => {
    const xs = g.tables.map(t => t.x), ys = g.tables.map(t => t.y);
    const x1 = Math.max(...g.tables.map(t => t.x + t.w));
    const y1 = Math.max(...g.tables.map(t => t.y + t.h));
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return {
      id: g.id || `group_gl_${i}_${Date.now().toString(36)}`,
      type: 'group',
      text: g.name,
      color: g.color || 'blue',
      tables: g.keys,
      x: Math.round(x0 - PAD_X),
      y: Math.round(y0 - PAD_TOP),
      w: Math.round(x1 - x0 + PAD_X * 2),
      h: Math.round(y1 - y0 + PAD_TOP + PAD_BOTTOM),
    };
  });
  diagram.setAnnotations([...notes, ...boxes]);

  diagram.markDirty();
  diagram.onLayoutChange?.();

  return {
    groups: implicit ? 0 : groups.length,
    implicit,
    tables: model.tables.length,
    loose: loose.length,
    annotations: boxes,
    cost: Math.round(finalPlacement.cost || 0),
  };
}
