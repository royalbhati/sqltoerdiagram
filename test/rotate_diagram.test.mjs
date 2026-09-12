import test from 'node:test';
import assert from 'node:assert';
import { EXAMPLE_SQL } from '../src/examples.js';
import { parseSchema } from '../src/parse.js';
import { arrangeGroupsCompact } from '../src/group-layout-compact.js';
import { organizeLinesShortestPath, spCountOverlap } from '../src/line-organizer.js';
import { rotateDiagram, orientDiagram, resetOrientation } from '../src/rotate-diagram.js';
import { getTableAnchor, buildOrthogonalPoints, segmentIntersectsBox } from '../src/routing.js';
import { toDBMLLayout } from '../src/formats/serialize.js';

function mockDiagram(model, annotations) {
  return {
    model, annotations, manualLinks: [], hidden: new Set(),
    edgeAnchors: new Map(), edgeWaypoints: new Map(), edgeRoutings: new Map(),
    diagramLevel: 'physical', orientation: 'LR', snapshots: 0,
    markDirty() {}, onLayoutChange() {},
    onHistorySnapshot() { this.snapshots++; }, getSnapshot() { return {}; },
    setAnnotations(a) { this.annotations = a; },
  };
}

// The shipped example schema with the two groups from the user's screenshots.
function exampleDiagram() {
  return mockDiagram(parseSchema(EXAMPLE_SQL, 'auto'), [
    { id: 'aaa', type: 'group', text: 'aaa', color: 'blue', tables: ['order_items', 'orders'], x: 0, y: 0, w: 1, h: 1 },
    { id: 'bbb', type: 'group', text: 'bbb', color: 'amber', tables: ['products', 'addresses', 'reviews', 'users'], x: 0, y: 0, w: 1, h: 1 },
  ]);
}

// Four domains with plenty of cross-domain traffic: dense enough to break lines.
const DOMAINS = {
  auth: ['usuario', 'rol', 'permiso', 'rol_permiso', 'sesion'],
  catalog: ['producto', 'categoria', 'marca', 'inventario'],
  sales: ['pedido', 'pedido_item', 'pago', 'factura'],
  logistics: ['envio', 'transportista', 'ruta', 'almacen'],
};
const RELS = [
  ['rol_permiso', 'rol'], ['rol_permiso', 'permiso'], ['usuario', 'rol'], ['sesion', 'usuario'],
  ['producto', 'categoria'], ['producto', 'marca'], ['inventario', 'producto'], ['inventario', 'almacen'],
  ['pedido', 'usuario'], ['pedido_item', 'pedido'], ['pedido_item', 'producto'],
  ['pago', 'pedido'], ['factura', 'pedido'], ['factura', 'usuario'],
  ['envio', 'pedido'], ['envio', 'transportista'], ['envio', 'ruta'], ['ruta', 'almacen'],
  ['almacen', 'usuario'], ['transportista', 'usuario'], ['pago', 'usuario'], ['categoria', 'usuario'],
];

function denseDiagram() {
  const tables = Object.values(DOMAINS).flat().map((n, i) => ({
    key: n, name: n, x: 60 + (i % 5) * 240, y: 60 + Math.floor(i / 5) * 220,
    columns: [{ name: 'id', type: 'bigint' }, { name: 'nombre', type: 'varchar(100)' }, { name: 'ref_id', type: 'bigint' }],
  }));
  const relations = RELS.map(([f, t]) => ({ fromTable: f, toTable: t, fromCols: ['ref_id'], toCols: ['id'] }));
  const annotations = Object.entries(DOMAINS).map(([name, names]) => ({
    id: 'g_' + name, type: 'group', text: name, color: 'blue', tables: names, x: 0, y: 0, w: 100, h: 100,
  }));
  return mockDiagram({ tables, relations }, annotations);
}

function drawnLines(d) {
  const by = new Map(d.model.tables.map(t => [t.key.toLowerCase(), t]));
  const out = [];
  for (const r of d.model.relations) {
    const key = `${r.fromTable}.${r.fromCols[0] || ''}->${r.toTable}.${r.toCols[0] || ''}`.toLowerCase();
    const a = d.edgeAnchors.get(key);
    if (!a?.fromAnchor || !a?.toAnchor) continue;
    const from = by.get(r.fromTable.toLowerCase()), to = by.get(r.toTable.toLowerCase());
    const p1 = getTableAnchor(from, r.fromCols[0], null, a.fromAnchor, 0, 'physical');
    const p2 = getTableAnchor(to, r.toCols[0], null, a.toAnchor, 0, 'physical');
    out.push({ from, to, pts: buildOrthogonalPoints(p1, p2, (d.edgeWaypoints.get(key) || []).map(p => ({ ...p })), [], 0) });
  }
  return out;
}

const centre = (d, key) => {
  const t = d.model.tables.find(x => x.key === key);
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 };
};

function side(d, a, b) {
  const A = centre(d, a), B = centre(d, b);
  return Math.abs(A.x - B.x) > Math.abs(A.y - B.y) ? (A.x < B.x ? 'left' : 'right') : (A.y < B.y ? 'above' : 'below');
}

function assertNoTableOverlap(tables) {
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const a = tables[i], b = tables[j];
      const clash = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0
                 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0;
      assert.ok(!clash, `${a.key} and ${b.key} overlap`);
    }
  }
}

const state = (d) => JSON.stringify([
  d.model.tables.map(t => [t.key, t.x, t.y]),
  [...d.edgeAnchors.entries()],
  [...d.edgeWaypoints.entries()],
]);

test('turning to Vertical reproduces the diagram the user turned by hand', () => {
  // The user's own target: the horizontal layout turned a quarter clockwise,
  // with every table turned back upright and the groups re-fitted.
  const d = exampleDiagram();
  arrangeGroupsCompact(d, { spacing: 'comfortable' });
  rotateDiagram(d, true);

  assert.strictEqual(side(d, 'orders', 'order_items'), 'left');
  assert.strictEqual(side(d, 'users', 'addresses'), 'left');
  assert.strictEqual(side(d, 'addresses', 'reviews'), 'above');
  assert.strictEqual(side(d, 'reviews', 'products'), 'left');
  assert.strictEqual(side(d, 'order_items', 'addresses'), 'above', 'group aaa sits above group bbb');
  assert.strictEqual(d.orientation, 'TB');
});

test('a turn keeps every table upright and never lets two tables overlap', () => {
  const d = exampleDiagram();
  arrangeGroupsCompact(d, { spacing: 'comfortable' });
  const sizes = new Map(d.model.tables.map(t => [t.key, [t.w, t.h]]));
  rotateDiagram(d, true);
  for (const t of d.model.tables) {
    assert.deepStrictEqual([t.w, t.h], sizes.get(t.key), `${t.key} keeps its own width and height`);
  }
  assertNoTableOverlap(d.model.tables);
});

test('wide tables stacked tightly are spaced out, not overlapped, when turned', () => {
  // Stacked 40px apart: turned, their centres would sit ~180px apart side by
  // side, far less than their 300px width. A pure rotation would pile them up.
  const tables = ['a', 'b', 'c'].map((k, i) => ({
    key: k, name: k, x: 100, y: 100 + i * 180, w: 300, h: 140,
    columns: [{ name: 'id', type: 'bigint' }],
  }));
  const d = mockDiagram({ tables, relations: [] }, [
    { id: 'g', type: 'group', text: 'g', color: 'blue', tables: ['a', 'b', 'c'], x: 0, y: 0, w: 1, h: 1 },
  ]);
  const res = rotateDiagram(d, true);
  assert.ok(res.nudged > 0, 'the turn had to space something out');
  assertNoTableOverlap(d.model.tables);
  assert.strictEqual(side(d, 'a', 'b'), 'right', 'the stack became a row, in the turned order');
  assert.strictEqual(side(d, 'b', 'c'), 'right');
});

test('turned lines stay orthogonal, clear of other tables and never on top of each other', () => {
  const d = denseDiagram();
  arrangeGroupsCompact(d, { spacing: 'comfortable' });
  organizeLinesShortestPath(d);
  const res = rotateDiagram(d, true);

  const lines = drawnLines(d);
  assert.strictEqual(lines.length, d.model.relations.length, 'every line survives the turn');
  for (const { from, to, pts } of lines) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      assert.ok(Math.abs(a.x - b.x) < 0.6 || Math.abs(a.y - b.y) < 0.6, 'every segment is axis-aligned');
      for (const t of d.model.tables) {
        if (t === from || t === to) continue;
        assert.ok(!segmentIntersectsBox(a, b, t, 15.5).hit, `a line keeps 16px clear of ${t.key}`);
      }
    }
  }
  assert.strictEqual(Math.round(spCountOverlap(lines.map(l => l.pts))), 0, 'no line is drawn on top of another');
  assert.ok(res.repaired < res.lines, 'most lines turn as they are; only the broken ones are re-traced');
});

test('turning back with nothing touched restores the diagram exactly, lines included', () => {
  const d = exampleDiagram();
  arrangeGroupsCompact(d, { spacing: 'comfortable' });
  organizeLinesShortestPath(d);
  const before = state(d);

  rotateDiagram(d, true);
  const res = rotateDiagram(d, false);

  assert.ok(res.restored, 'the way back is the remembered state, not an approximation');
  assert.strictEqual(state(d), before);
  assert.strictEqual(d.orientation, 'LR');
});

test('turning back after an edit turns the edited diagram instead of discarding the edit', () => {
  const d = exampleDiagram();
  arrangeGroupsCompact(d, { spacing: 'comfortable' });
  const dx0 = centre(d, 'users').x - centre(d, 'orders').x;
  const dy0 = centre(d, 'users').y - centre(d, 'orders').y;

  rotateDiagram(d, true);
  d.model.tables.find(t => t.key === 'users').x -= 200;   // dragged while vertical
  const res = rotateDiagram(d, false);

  assert.ok(!res.restored, 'an edited diagram is turned, not reset');
  // Counter-clockwise, "200px further left" becomes "200px further down".
  const dx1 = centre(d, 'users').x - centre(d, 'orders').x;
  const dy1 = centre(d, 'users').y - centre(d, 'orders').y;
  assert.ok(Math.abs(dx1 - dx0) < 2, `users keeps its horizontal place (moved ${dx1 - dx0}px)`);
  assert.ok(Math.abs(dy1 - dy0 - 200) < 2, `the drag comes back as 200px downwards (got ${dy1 - dy0}px)`);
});

test('a turn is one undoable step, and a turn inside another action records none', () => {
  const d = exampleDiagram();
  arrangeGroupsCompact(d, { spacing: 'comfortable' });
  const start = d.snapshots;
  rotateDiagram(d, true);
  assert.strictEqual(d.snapshots, start + 1);
  rotateDiagram(d, false, { recordHistory: false });
  assert.strictEqual(d.snapshots, start + 1);
});

test('re-routing some lines with keepOthers never moves or rides on the rest', () => {
  const d = denseDiagram();
  arrangeGroupsCompact(d, { spacing: 'comfortable' });
  organizeLinesShortestPath(d);

  const keys = [...d.edgeAnchors.keys()];
  const targets = keys.slice(0, 6);
  const others = keys.slice(6);
  const frozen = JSON.stringify(others.map(k => [k, d.edgeAnchors.get(k), d.edgeWaypoints.get(k) || []]));

  const before = d.snapshots;
  organizeLinesShortestPath(d, targets, { keepOthers: true, recordHistory: false, forceStyle: false, quick: true });

  assert.strictEqual(JSON.stringify(others.map(k => [k, d.edgeAnchors.get(k), d.edgeWaypoints.get(k) || []])), frozen,
    'the lines not being re-routed keep their exact shape');
  assert.strictEqual(d.snapshots, before, 'recordHistory: false records nothing');
  assert.strictEqual(Math.round(spCountOverlap(drawnLines(d).map(l => l.pts))), 0, 'the new routes never ride on a fixed line');
});

test('going all the way round returns exactly to the start, lines included', () => {
  const d = exampleDiagram();
  arrangeGroupsCompact(d, { spacing: 'comfortable' });
  organizeLinesShortestPath(d);
  const start = state(d);

  for (const dir of ['TB', 'RL', 'BT', 'LR']) orientDiagram(d, dir);

  assert.strictEqual(state(d), start);
  assert.strictEqual(d.orientation, 'LR');
});

test('right to left is left to right turned half-way, so every side swaps', () => {
  const d = exampleDiagram();
  arrangeGroupsCompact(d, { spacing: 'comfortable' });
  organizeLinesShortestPath(d);
  const res = orientDiagram(d, 'RL');

  // As laid out: orders below order_items, aaa left of bbb, reviews below products.
  assert.strictEqual(side(d, 'orders', 'order_items'), 'above');
  assert.strictEqual(side(d, 'order_items', 'addresses'), 'right', 'group aaa is now right of bbb');
  assert.strictEqual(side(d, 'reviews', 'products'), 'above');
  assert.strictEqual(res.nudged, 0, 'a half turn cannot make tables collide');
  assertNoTableOverlap(d.model.tables);

  const lines = drawnLines(d);
  assert.strictEqual(lines.length, d.model.relations.length);
  assert.strictEqual(Math.round(spCountOverlap(lines.map(l => l.pts))), 0);
  for (const { from, to, pts } of lines) {
    for (let i = 0; i < pts.length - 1; i++) {
      for (const t of d.model.tables) {
        if (t === from || t === to) continue;
        assert.ok(!segmentIntersectsBox(pts[i], pts[i + 1], t, 15.5).hit, `a line keeps 16px clear of ${t.key}`);
      }
    }
  }
});

test('bottom to top is top to bottom turned half-way', () => {
  const d = exampleDiagram();
  arrangeGroupsCompact(d, { spacing: 'comfortable' });
  orientDiagram(d, 'TB');
  const tb = new Map(d.model.tables.map(t => [t.key, centre(d, t.key)]));
  orientDiagram(d, 'BT');

  // Every pair keeps its distance and flips its direction.
  for (const a of d.model.tables) {
    for (const b of d.model.tables) {
      if (a === b) continue;
      const before = { x: tb.get(b.key).x - tb.get(a.key).x, y: tb.get(b.key).y - tb.get(a.key).y };
      const after = { x: centre(d, b.key).x - centre(d, a.key).x, y: centre(d, b.key).y - centre(d, a.key).y };
      assert.ok(Math.abs(after.x + before.x) < 1.5 && Math.abs(after.y + before.y) < 1.5,
        `${a.key} -> ${b.key} is mirrored through the centre`);
    }
  }
  assert.strictEqual(d.orientation, 'BT');
});

test('picking the direction the diagram already has changes nothing', () => {
  const d = exampleDiagram();
  arrangeGroupsCompact(d, { spacing: 'comfortable' });
  const before = state(d);
  const snaps = d.snapshots;
  const res = orientDiagram(d, 'LR');
  assert.strictEqual(res.changed, false);
  assert.strictEqual(state(d), before);
  assert.strictEqual(d.snapshots, snaps, 'no undo step for a no-op');
});

test('a fresh arrangement forgets the directions remembered for the old one', () => {
  const d = exampleDiagram();
  arrangeGroupsCompact(d, { spacing: 'comfortable' });
  orientDiagram(d, 'TB');
  arrangeGroupsCompact(d, { spacing: 'comfortable' });   // re-arranged: left to right again
  resetOrientation(d);

  const res = orientDiagram(d, 'TB');
  assert.ok(!res.restored, 'the old vertical layout must not come back over the new arrangement');
  assert.strictEqual(d.orientation, 'TB');
});

test('the Layout panel writes the direction, and left to right when there is none', () => {
  // Pasting the panel's text back must restore which way the diagram flows;
  // without it, the Direction buttons would turn from the wrong starting point.
  const model = parseSchema(EXAMPLE_SQL, 'auto');
  assert.strictEqual(JSON.parse(toDBMLLayout(model, [], null, { orientation: 'BT' })).orientation, 'BT');
  assert.strictEqual(JSON.parse(toDBMLLayout(model, [], null, {})).orientation, 'LR');
});
