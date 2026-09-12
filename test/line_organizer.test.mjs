import test from 'node:test';
import assert from 'node:assert';
import {
  getDiagramEdges,
  getObstacles,
  organizeLinesAStar,
  organizeLinesElkPorts,
  organizeLinesShortestPath,
  spCountCrossings,
  spCountOverlap,
  resetLines,
} from '../src/line-organizer.js';
import { segmentIntersectsBox, getTableAnchor, buildOrthogonalPoints } from '../src/routing.js';

function createMockDiagram() {
  const tRol = { key: 'rol', name: 'rol', x: 50, y: 150, w: 160, h: 140, columns: [{ name: 'id' }, { name: 'nombre' }] };
  const tPermiso = { key: 'permiso', name: 'permiso', x: 260, y: 150, w: 160, h: 140, columns: [{ name: 'id' }, { name: 'nombre' }] };
  const tRolPermiso = { key: 'rol_permiso', name: 'rol_permiso', x: 470, y: 150, w: 160, h: 140, columns: [{ name: 'id' }, { name: 'rol_id' }, { name: 'permiso_id' }] };

  const relations = [
    // rol.id -> rol_permiso.rol_id (traverses across permiso)
    { fromTable: 'rol', toTable: 'rol_permiso', fromCols: ['id'], toCols: ['rol_id'] },
    // permiso.id -> rol_permiso.permiso_id (direct neighbors)
    { fromTable: 'permiso', toTable: 'rol_permiso', fromCols: ['id'], toCols: ['permiso_id'] },
  ];

  const diagram = {
    model: {
      tables: [tRol, tPermiso, tRolPermiso],
      relations,
    },
    manualLinks: [],
    hidden: new Set(),
    edgeAnchors: new Map(),
    edgeWaypoints: new Map(),
    historySnapshots: [],
    markDirty() { this.dirty = true; },
    onLayoutChange() { this.layoutChanged = true; },
    onHistorySnapshot(s) { this.historySnapshots.push(s); },
    getSnapshot() {
      return {
        edgeAnchors: new Map(this.edgeAnchors),
        edgeWaypoints: new Map(this.edgeWaypoints),
      };
    },
    diagramLevel: 'physical',
  };

  return { diagram, tRol, tPermiso, tRolPermiso };
}

test('getDiagramEdges and getObstacles extract edges and exclude end tables', () => {
  const { diagram } = createMockDiagram();
  const edges = getDiagramEdges(diagram);
  assert.strictEqual(edges.length, 2);

  const edgeRol = edges.find(e => e.fk === 'rol');
  assert.ok(edgeRol, 'Found rol relation');
  assert.strictEqual(edgeRol.tk, 'rol_permiso');

  const obstacles = getObstacles(diagram, 'rol', 'rol_permiso');
  assert.strictEqual(obstacles.length, 1);
  assert.strictEqual(obstacles[0].key, 'permiso', 'permiso is correctly identified as obstacle');
});

test('organizeLinesAStar finds collision-free orthogonal path on grid', () => {
  const { diagram, tPermiso } = createMockDiagram();
  const edgeKey = 'rol.id->rol_permiso.rol_id';

  const count = organizeLinesAStar(diagram);
  assert.strictEqual(count, 1, 'Rerouted blocked edge using A*');

  assert.ok(diagram.edgeWaypoints.has(edgeKey));
  const waypoints = diagram.edgeWaypoints.get(edgeKey);
  assert.ok(waypoints.length > 0, 'A* generated waypoints');

  const p1 = getTableAnchor(diagram.model.tables[0], 'id', diagram.model.tables[2], null, 0, diagram.diagramLevel);
  const p2 = getTableAnchor(diagram.model.tables[2], 'rol_id', diagram.model.tables[0], null, 0, diagram.diagramLevel);
  const fullPath = [p1, ...waypoints, p2];

  for (let i = 0; i < fullPath.length - 1; i++) {
    const hit = segmentIntersectsBox(fullPath[i], fullPath[i + 1], tPermiso, 4).hit;
    assert.strictEqual(hit, false, `A* Segment ${i} must not intersect permiso`);
  }
});

test('resetLines restores direct lines and clears waypoints and custom anchors', () => {
  const { diagram } = createMockDiagram();
  const edgeKey = 'rol.id->rol_permiso.rol_id';

  // Dirty that one edge by hand: resetLines only has to undo what is stored.
  diagram.edgeAnchors.set(edgeKey, { fromAnchor: { side: 'top', offset: 0.5 }, toAnchor: { side: 'bottom', offset: 0.5 } });
  diagram.edgeWaypoints.set(edgeKey, [{ x: 120, y: 90 }]);
  assert.ok(diagram.edgeAnchors.has(edgeKey));
  assert.ok(diagram.edgeWaypoints.has(edgeKey));

  const resetCount = resetLines(diagram);
  assert.strictEqual(resetCount, 1);
  assert.strictEqual(diagram.edgeAnchors.has(edgeKey), false);
  assert.strictEqual(diagram.edgeWaypoints.has(edgeKey), false);
});

test('organizeLinesElkPorts sorts ports monotonically preventing border crossings', () => {
  // Table "hub" connects to 3 targets at different heights on the right
  const tHub = { key: 'hub', name: 'hub', x: 100, y: 300, w: 160, h: 200, columns: [{ name: 'id' }] };
  const tTop = { key: 't_top', name: 't_top', x: 500, y: 100, w: 160, h: 100, columns: [{ name: 'id' }, { name: 'hub_id' }] };
  const tMid = { key: 't_mid', name: 't_mid', x: 500, y: 350, w: 160, h: 100, columns: [{ name: 'id' }, { name: 'hub_id' }] };
  const tBot = { key: 't_bot', name: 't_bot', x: 500, y: 700, w: 160, h: 100, columns: [{ name: 'id' }, { name: 'hub_id' }] };

  const relations = [
    // Deliberately inserted in reverse order: bot, mid, top
    { fromTable: 't_bot', toTable: 'hub', fromCols: ['hub_id'], toCols: ['id'] },
    { fromTable: 't_mid', toTable: 'hub', fromCols: ['hub_id'], toCols: ['id'] },
    { fromTable: 't_top', toTable: 'hub', fromCols: ['hub_id'], toCols: ['id'] },
  ];

  const diagram = {
    model: { tables: [tHub, tTop, tMid, tBot], relations },
    manualLinks: [],
    hidden: new Set(),
    edgeAnchors: new Map(),
    edgeWaypoints: new Map(),
    markDirty() {},
    onLayoutChange() {},
    diagramLevel: 'physical',
  };

  const count = organizeLinesElkPorts(diagram);
  assert.strictEqual(count, 3);

  // Check the toAnchors at "hub" on the right side:
  const aTop = diagram.edgeAnchors.get('t_top.hub_id->hub.id').toAnchor;
  const aMid = diagram.edgeAnchors.get('t_mid.hub_id->hub.id').toAnchor;
  const aBot = diagram.edgeAnchors.get('t_bot.hub_id->hub.id').toAnchor;

  assert.strictEqual(aTop.side, 'right');
  assert.strictEqual(aMid.side, 'right');
  assert.strictEqual(aBot.side, 'right');

  // Because t_top (y=100) < t_mid (y=350) < t_bot (y=700),
  // their offsets on the right face of hub must be strictly ascending (no line crossing!)
  assert.ok(aTop.offset < aMid.offset, `aTop (${aTop.offset}) must be less than aMid (${aMid.offset})`);
  assert.ok(aMid.offset < aBot.offset, `aMid (${aMid.offset}) must be less than aBot (${aBot.offset})`);
});

test('organizeLinesElkPorts routes blocked lines via channel avoiding intermediate tables', () => {
  const { diagram, tPermiso } = createMockDiagram();
  const edgeKey = 'rol.id->rol_permiso.rol_id';

  const count = organizeLinesElkPorts(diagram);
  assert.strictEqual(count, 2, 'Organized both lines');

  assert.ok(diagram.edgeAnchors.has(edgeKey));
  assert.ok(diagram.edgeWaypoints.has(edgeKey));

  const anchors = diagram.edgeAnchors.get(edgeKey);
  assert.strictEqual(anchors.fromAnchor.side, 'top');
  assert.strictEqual(anchors.toAnchor.side, 'top');

  const waypoints = diagram.edgeWaypoints.get(edgeKey);
  const p1 = getTableAnchor(diagram.model.tables[0], 'id', null, anchors.fromAnchor, 0, diagram.diagramLevel);
  const p2 = getTableAnchor(diagram.model.tables[2], 'rol_id', null, anchors.toAnchor, 0, diagram.diagramLevel);
  const fullPath = [p1, ...waypoints, p2];

  for (let i = 0; i < fullPath.length - 1; i++) {
    const hit = segmentIntersectsBox(fullPath[i], fullPath[i + 1], tPermiso, 4).hit;
    assert.strictEqual(hit, false, `ELK channel segment ${i} must not intersect permiso`);
  }
});

const CLEARANCE = 16;

// Rebuild the full point sequence the renderer will draw for an edge.
function routeOf(diagram, key, from, to, fromCol, toCol) {
  const a = diagram.edgeAnchors.get(key);
  const wps = diagram.edgeWaypoints.get(key) || [];
  const p1 = getTableAnchor(from, fromCol, a ? null : to, a?.fromAnchor, 0, diagram.diagramLevel);
  const p2 = getTableAnchor(to, toCol, a ? null : from, a?.toAnchor, 0, diagram.diagramLevel);
  return [p1, ...wps, p2];
}

function assertOrthogonal(pts, label) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ok = Math.abs(a.x - b.x) < 0.6 || Math.abs(a.y - b.y) < 0.6;
    assert.ok(ok, `${label}: segment ${i} is not axis-aligned (${a.x},${a.y} -> ${b.x},${b.y})`);
  }
}

function assertClears(pts, obstacles, label) {
  for (let i = 0; i < pts.length - 1; i++) {
    for (const o of obstacles) {
      assert.ok(
        !segmentIntersectsBox(pts[i], pts[i + 1], o, CLEARANCE - 0.5).hit,
        `${label}: segment ${i} comes within ${CLEARANCE}px of ${o.key}`
      );
    }
  }
}

function onPerimeter(t, p) {
  const onX = Math.abs(p.x - t.x) < 0.6 || Math.abs(p.x - (t.x + t.w)) < 0.6;
  const onY = Math.abs(p.y - t.y) < 0.6 || Math.abs(p.y - (t.y + t.h)) < 0.6;
  const inX = p.x >= t.x - 0.6 && p.x <= t.x + t.w + 0.6;
  const inY = p.y >= t.y - 0.6 && p.y <= t.y + t.h + 0.6;
  return (onX && inY) || (onY && inX);
}

test('organizeLinesShortestPath routes rol -> rol_permiso around permiso with clearance', () => {
  const { diagram, tRol, tPermiso, tRolPermiso } = createMockDiagram();
  const key = 'rol.id->rol_permiso.rol_id';

  const res = organizeLinesShortestPath(diagram);
  assert.strictEqual(res.routed, 2, 'both relations were re-routed');
  assert.strictEqual(res.overlaps, 0, 'no line is drawn on top of another');

  const pts = routeOf(diagram, key, tRol, tRolPermiso, 'id', 'rol_id');
  assertOrthogonal(pts, 'rol->rol_permiso');
  assertClears(pts, [tPermiso], 'rol->rol_permiso');
  assert.ok(onPerimeter(tRol, pts[0]), 'starts on the rol perimeter');
  assert.ok(onPerimeter(tRolPermiso, pts[pts.length - 1]), 'ends on the rol_permiso perimeter');
});

test('organizeLinesShortestPath wipes previous vertices and anchors first', () => {
  const { diagram } = createMockDiagram();
  const key = 'permiso.id->rol_permiso.permiso_id';

  // Junk left over from a previous organizer run.
  diagram.edgeWaypoints.set(key, [{ x: -900, y: -900 }, { x: -900, y: 900 }]);
  diagram.edgeAnchors.set(key, { fromAnchor: { side: 'top', offset: 0.02 }, toAnchor: { side: 'bottom', offset: 0.98 } });

  organizeLinesShortestPath(diagram);

  const wps = diagram.edgeWaypoints.get(key) || [];
  assert.ok(!wps.some(p => p.x === -900), 'stale vertices are gone');
  const anch = diagram.edgeAnchors.get(key);
  assert.ok(anch && anch.fromAnchor.offset > 0.02, 'stale anchor offset was recomputed');
});

test('organizeLinesShortestPath keeps neighbours direct and forces rounded 90 corners', () => {
  const { diagram, tPermiso, tRolPermiso } = createMockDiagram();
  const key = 'permiso.id->rol_permiso.permiso_id';

  organizeLinesShortestPath(diagram);
  assert.strictEqual(diagram.edgeRouting, 'ortho-rounded');

  const pts = routeOf(diagram, key, tPermiso, tRolPermiso, 'id', 'permiso_id');
  assertOrthogonal(pts, 'permiso->rol_permiso');
  // Facing tables with overlapping spans: straight shot, no vertices at all.
  assert.strictEqual((diagram.edgeWaypoints.get(key) || []).length, 0, 'no needless vertices');
  assert.strictEqual(diagram.edgeAnchors.get(key).fromAnchor.side, 'right');
  assert.strictEqual(diagram.edgeAnchors.get(key).toAnchor.side, 'left');
});

test('organizeLinesShortestPath honours a selection and leaves other edges alone', () => {
  const { diagram } = createMockDiagram();
  const target = 'rol.id->rol_permiso.rol_id';
  const other = 'permiso.id->rol_permiso.permiso_id';

  const res = organizeLinesShortestPath(diagram, [target]);
  assert.strictEqual(res.routed, 1);
  assert.ok(diagram.edgeAnchors.has(target), 'selected edge was routed');
  assert.ok(!diagram.edgeAnchors.has(other), 'unselected edge was untouched');
});

test('organizeLinesShortestPath separates lines sharing a corridor into lanes', () => {
  const { diagram } = createMockDiagram();
  // Two relations from the same table to the same target: without lane
  // separation both would dock on the identical perimeter point.
  diagram.model.relations.push({ fromTable: 'rol', toTable: 'permiso', fromCols: ['nombre'], toCols: ['nombre'] });
  diagram.model.tables[0].columns.push({ name: 'otro' });
  diagram.model.relations.push({ fromTable: 'rol', toTable: 'permiso', fromCols: ['otro'], toCols: ['id'] });

  organizeLinesShortestPath(diagram);

  const a = diagram.edgeAnchors.get('rol.nombre->permiso.nombre');
  const b = diagram.edgeAnchors.get('rol.otro->permiso.id');
  assert.ok(a && b, 'both parallel relations were routed');
  const sameSpot = a.fromAnchor.side === b.fromAnchor.side
    && Math.abs(a.fromAnchor.offset - b.fromAnchor.offset) < 1e-6;
  assert.ok(!sameSpot, 'parallel lines do not overlap on the same anchor point');
});

test('organizeLinesShortestPath escapes a table boxed in on three sides', () => {
  const { diagram, tRol, tRolPermiso } = createMockDiagram();
  // Wall off the direct corridor above and below permiso so the only way out
  // is around the outside of the diagram.
  const wallTop = { key: 'wall_top', name: 'wall_top', x: 230, y: -60, w: 220, h: 190, columns: [] };
  const wallBottom = { key: 'wall_bottom', name: 'wall_bottom', x: 230, y: 310, w: 220, h: 190, columns: [] };
  diagram.model.tables.push(wallTop, wallBottom);

  const res = organizeLinesShortestPath(diagram, ['rol.id->rol_permiso.rol_id']);
  assert.strictEqual(res.routed, 1, 'a route was still found');

  const pts = routeOf(diagram, 'rol.id->rol_permiso.rol_id', tRol, tRolPermiso, 'id', 'rol_id');
  assertOrthogonal(pts, 'boxed-in route');
  assertClears(pts, [diagram.model.tables[1], wallTop, wallBottom], 'boxed-in route');
});

// --- Crossing-awareness and the never-overlap guarantee ---

function gridDiagram(rows, cols, seed = 12345) {
  const tables = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      tables.push({
        key: `t${i}`, name: `t${i}`, x: 60 + c * 260, y: 60 + r * 230, w: 180, h: 126,
        columns: [{ name: 'id' }, { name: 'a_id' }, { name: 'b_id' }, { name: 'c_id' }],
      });
    }
  }
  const rnd = (() => { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const names = ['a_id', 'b_id', 'c_id'];
  const relations = [];
  for (let i = 0; i < tables.length; i++) {
    for (let k = 0; k < 2; k++) {
      const j = Math.floor(rnd() * tables.length);
      if (j !== i) relations.push({ fromTable: tables[i].key, toTable: tables[j].key, fromCols: ['id'], toCols: [names[k % 3]] });
    }
  }
  return {
    model: { tables, relations }, manualLinks: [], hidden: new Set(),
    edgeAnchors: new Map(), edgeWaypoints: new Map(), edgeRoutings: new Map(),
    diagramLevel: 'physical',
    markDirty() {}, onLayoutChange() {}, onHistorySnapshot() {}, getSnapshot() { return {}; },
  };
}

// Rebuild exactly what the renderer will draw, for every relation.
function drawnRoutes(diagram) {
  const byKey = new Map(diagram.model.tables.map(t => [t.key.toLowerCase(), t]));
  const out = [];
  for (const r of diagram.model.relations) {
    const fk = r.fromTable.toLowerCase(), tk = r.toTable.toLowerCase();
    const key = `${fk}.${(r.fromCols[0] || '').toLowerCase()}->${tk}.${(r.toCols[0] || '').toLowerCase()}`;
    const a = diagram.edgeAnchors.get(key);
    if (!a) continue;
    const from = byKey.get(fk), to = byKey.get(tk);
    const p1 = getTableAnchor(from, r.fromCols[0], null, a.fromAnchor, 0, diagram.diagramLevel);
    const p2 = getTableAnchor(to, r.toCols[0], null, a.toAnchor, 0, diagram.diagramLevel);
    const wps = (diagram.edgeWaypoints.get(key) || []).map(p => ({ ...p }));
    out.push({ from, to, pts: buildOrthogonalPoints(p1, p2, wps, [], 0) });
  }
  return out;
}

test('organizeLinesShortestPath never draws one line on top of another', () => {
  const diagram = gridDiagram(5, 6);
  const res = organizeLinesShortestPath(diagram);
  assert.strictEqual(res.routed, diagram.model.relations.length, 'every relation was routed');

  const routes = drawnRoutes(diagram);
  assert.strictEqual(Math.round(spCountOverlap(routes.map(r => r.pts))), 0,
    'collinear overlap must be zero — lines may cross in an X but never share a corridor');
  assert.strictEqual(res.overlaps, 0, 'the reported summary agrees');
});

test('organizeLinesShortestPath keeps clearance and 90 degree corners under load', () => {
  const diagram = gridDiagram(5, 6);
  organizeLinesShortestPath(diagram);

  for (const r of drawnRoutes(diagram)) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      assert.ok(Math.abs(a.x - b.x) < 0.6 || Math.abs(a.y - b.y) < 0.6, 'every segment is axis-aligned');
      for (const t of diagram.model.tables) {
        if (t === r.from || t === r.to) continue;
        assert.ok(!segmentIntersectsBox(a, b, t, 15.5).hit, `line keeps 16px clear of ${t.key}`);
      }
    }
  }
});

test('organizeLinesShortestPath holds its crossing count on a fixed dense diagram', () => {
  // Regression guard on the seeded 30-table / 58-relation layout. Routing that
  // ignores other lines scores 446 crossings here; crossing-aware routing with
  // SP_CROSS_COST = 150 scores 162, and raising the weight further buys almost
  // nothing. Fail if a change pushes it back towards the blind number.
  const diagram = gridDiagram(5, 6);
  const res = organizeLinesShortestPath(diagram);
  const crossings = spCountCrossings(drawnRoutes(diagram).map(r => r.pts));

  assert.strictEqual(crossings, res.crossings, 'the reported crossing count matches the drawn geometry');
  assert.ok(crossings <= 200, `expected at most 200 crossings, got ${crossings}`);

  // Same input, same output: the search must not drift between runs.
  const again = gridDiagram(5, 6);
  assert.strictEqual(organizeLinesShortestPath(again).crossings, res.crossings, 'routing is deterministic');
});

test('organizeLinesShortestPath fans ten converging lines out without crossings', () => {
  const hub = { key: 'hub', name: 'hub', x: 700, y: 400, w: 200, h: 150, columns: [{ name: 'id' }] };
  const tables = [hub];
  const relations = [];
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2;
    tables.push({
      key: `s${i}`, name: `s${i}`,
      x: Math.round(700 + Math.cos(ang) * 460), y: Math.round(400 + Math.sin(ang) * 330),
      w: 170, h: 126, columns: [{ name: 'id' }, { name: 'hub_id' }],
    });
    relations.push({ fromTable: `s${i}`, toTable: 'hub', fromCols: ['hub_id'], toCols: ['id'] });
  }
  const diagram = {
    model: { tables, relations }, manualLinks: [], hidden: new Set(),
    edgeAnchors: new Map(), edgeWaypoints: new Map(), edgeRoutings: new Map(),
    diagramLevel: 'physical',
    markDirty() {}, onLayoutChange() {}, onHistorySnapshot() {}, getSnapshot() { return {}; },
  };

  const res = organizeLinesShortestPath(diagram);
  assert.strictEqual(res.routed, 10);
  assert.strictEqual(res.crossings, 0, 'a clean hub needs no crossings at all');
  assert.strictEqual(res.overlaps, 0);

  // Every line must dock on its own point of the hub perimeter.
  const seen = new Set();
  for (const r of relations) {
    const a = diagram.edgeAnchors.get(`${r.fromTable}.hub_id->hub.id`);
    const spot = `${a.toAnchor.side}:${a.toAnchor.offset.toFixed(4)}`;
    assert.ok(!seen.has(spot), `hub anchor ${spot} is used only once`);
    seen.add(spot);
  }
});

test('organizeLinesShortestPath keeps parallel lines at least 12px apart', () => {
  // Not overlapping is not the same as being readable: two lines seeded on grid
  // tracks 4px apart used to end up almost touching in a wide-open channel.
  const diagram = gridDiagram(5, 6);
  organizeLinesShortestPath(diagram);

  const segs = [];
  for (const r of drawnRoutes(diagram)) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const horiz = Math.abs(a.y - b.y) < 0.6;
      segs.push({
        r, horiz,
        coord: horiz ? a.y : a.x,
        lo: horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
        hi: horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
      });
    }
  }

  let tightest = Infinity;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.r === b.r || a.horiz !== b.horiz) continue;
      // Only pairs that actually run alongside each other, not corner brushes.
      if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) <= 8) continue;
      tightest = Math.min(tightest, Math.abs(a.coord - b.coord));
    }
  }

  assert.ok(tightest >= 11.5, `closest parallel pair should be >= 12px apart, got ${tightest}`);
});

test('organizeLinesShortestPath unpicks a crossing two lines can simply swap out of', () => {
  // Both lines run from the same table to two targets on the same side. Taking
  // them in the wrong lane order crosses them for nothing; only moving BOTH at
  // once fixes it, which single-line rip-up can never discover.
  const src = { key: 'src', name: 'src', x: 600, y: 60, w: 180, h: 126, columns: [{ name: 'id' }, { name: 'a_id' }, { name: 'b_id' }] };
  const left = { key: 'left', name: 'left', x: 200, y: 420, w: 180, h: 126, columns: [{ name: 'id' }] };
  const right = { key: 'right', name: 'right', x: 1000, y: 420, w: 180, h: 126, columns: [{ name: 'id' }] };
  const diagram = {
    model: {
      tables: [src, left, right],
      relations: [
        { fromTable: 'src', toTable: 'left', fromCols: ['a_id'], toCols: ['id'] },
        { fromTable: 'src', toTable: 'right', fromCols: ['b_id'], toCols: ['id'] },
      ],
    },
    manualLinks: [], hidden: new Set(),
    edgeAnchors: new Map(), edgeWaypoints: new Map(), edgeRoutings: new Map(),
    diagramLevel: 'physical',
    markDirty() {}, onLayoutChange() {}, onHistorySnapshot() {}, getSnapshot() { return {}; },
  };

  const res = organizeLinesShortestPath(diagram);
  assert.strictEqual(res.routed, 2);
  assert.strictEqual(res.crossings, 0, 'the two lines must not cross each other');
  assert.strictEqual(res.overlaps, 0);
});
