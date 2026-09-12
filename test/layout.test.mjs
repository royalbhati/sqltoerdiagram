import test from 'node:test';
import assert from 'node:assert';
import { dagreLayout, forceLayout, radialLayout, removeOverlaps } from '../src/layout.js';
import { segmentIntersectsBox, routeAroundObstacles, buildOrthogonalPoints } from '../src/routing.js';
import { clusterTablesLocalAI, reorderWithLocalAI, reorderWithExistingGroups } from '../src/ai-layout.js';

function createMockModel() {
  return {
    tables: [
      { key: 'users', name: 'users', columns: [{ name: 'id' }, { name: 'email' }] },
      { key: 'profiles', name: 'profiles', columns: [{ name: 'id' }, { name: 'user_id' }] },
      { key: 'tokens', name: 'auth_tokens', columns: [{ name: 'id' }, { name: 'user_id' }] },
      { key: 'orders', name: 'orders', columns: [{ name: 'id' }, { name: 'user_id' }] },
      { key: 'order_items', name: 'order_items', columns: [{ name: 'id' }, { name: 'order_id' }, { name: 'product_id' }] },
      { key: 'products', name: 'products', columns: [{ name: 'id' }, { name: 'title' }] },
    ],
    relations: [
      { fromTable: 'profiles', toTable: 'users', fromCols: ['user_id'], toCols: ['id'] },
      { fromTable: 'tokens', toTable: 'users', fromCols: ['user_id'], toCols: ['id'] },
      { fromTable: 'orders', toTable: 'users', fromCols: ['user_id'], toCols: ['id'] },
      { fromTable: 'order_items', toTable: 'orders', fromCols: ['order_id'], toCols: ['id'] },
      { fromTable: 'order_items', toTable: 'products', fromCols: ['product_id'], toCols: ['id'] },
    ],
    groups: [],
  };
}

test('Hierarchical (Dagre) layout positions all tables without NaN', () => {
  const model = createMockModel();
  dagreLayout(model, { dir: 'LR', spacing: 'comfortable' });

  for (const t of model.tables) {
    assert.ok(Number.isFinite(t.x), `table ${t.key} x is finite`);
    assert.ok(Number.isFinite(t.y), `table ${t.key} y is finite`);
    assert.ok(t.w > 0, `table ${t.key} width > 0`);
    assert.ok(t.h > 0, `table ${t.key} height > 0`);
  }
});

test('Physics (Force-Directed) layout positions all tables without overlap', () => {
  const model = createMockModel();
  forceLayout(model, { spacing: 'comfortable' });

  for (const t of model.tables) {
    assert.ok(Number.isFinite(t.x), `table ${t.key} x is finite`);
    assert.ok(Number.isFinite(t.y), `table ${t.key} y is finite`);
  }

  // Verify no overlap
  const ts = model.tables;
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const a = ts[i], b = ts[j];
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(overlapX < 0 || overlapY < 0, `tables ${a.key} and ${b.key} should not overlap`);
    }
  }
});

test('Radial Hub & Satellites layout places central hub table and satellites', () => {
  const model = createMockModel();
  radialLayout(model, { spacing: 'comfortable' });

  for (const t of model.tables) {
    assert.ok(Number.isFinite(t.x), `table ${t.key} x is finite`);
    assert.ok(Number.isFinite(t.y), `table ${t.key} y is finite`);
  }

  // users table has degree 3 (highest hub), should be placed inside the central region
  const users = model.tables.find(t => t.key === 'users');
  assert.ok(users, 'users table exists');
});

test('Obstacle avoidance routing detours around obstacle tables', () => {
  // Obstacle table in the middle
  const obstacle = { x: 300, y: 100, w: 200, h: 150 };

  // Direct horizontal path from (100, 160) to (700, 160) cuts right through obstacle (y=100..250)
  const p1 = { x: 100, y: 160, nx: 1, ny: 0 };
  const p2 = { x: 700, y: 160, nx: -1, ny: 0 };

  const directHit = segmentIntersectsBox(p1, p2, obstacle, 10);
  assert.strictEqual(directHit.hit, true, 'Direct segment cuts through obstacle');

  // Rerouted path
  const pts = [p1, { x: 400, y: 160 }, p2];
  const routed = routeAroundObstacles(pts, [obstacle], 12);

  assert.ok(routed.length > 2, 'Detour points were generated');

  // Verify none of the routed segments intersect the obstacle box
  for (let i = 0; i < routed.length - 1; i++) {
    const hit = segmentIntersectsBox(routed[i], routed[i + 1], obstacle, 4);
    assert.strictEqual(hit.hit, false, `Segment ${i} should not cut through obstacle`);
  }
});

test('Local AI semantic layout clusters tables into business domains', () => {
  const model = createMockModel();
  const clusters = clusterTablesLocalAI(model);

  assert.ok(clusters.length >= 1, 'Generates at least 1 domain cluster');
  const allClusteredTables = clusters.flatMap(c => c.tables);
  assert.strictEqual(allClusteredTables.length, model.tables.length, 'All tables included in clusters');

  const res = reorderWithLocalAI(model, { createGroups: true, lineStyle: 'ortho-rounded' });
  assert.ok(res.annotations.length > 0, 'Generated group annotations for domains');
  assert.strictEqual(res.lineStyle, 'ortho-rounded');
});

test('optimizeDomainGridPositions places connected domains in adjacent slots', async () => {
  const { optimizeDomainGridPositions } = await import('../src/ai-layout.js');
  const domains = [
    { name: 'Auth', tables: ['users'] },
    { name: 'Orders', tables: ['orders', 'order_items'] },
    { name: 'Analytics', tables: ['logs'] },
    { name: 'Billing', tables: ['invoices'] },
  ];
  // 5 relations between Auth and Orders
  const relations = [
    { fromTable: 'orders', toTable: 'users' },
    { fromTable: 'orders', toTable: 'users' },
    { fromTable: 'orders', toTable: 'users' },
    { fromTable: 'orders', toTable: 'users' },
    { fromTable: 'orders', toTable: 'users' },
  ];

  const slots = optimizeDomainGridPositions(domains, relations, 2);
  assert.strictEqual(slots.length, 4);

  const authSlot = slots[0];
  const ordersSlot = slots[1];
  const dist = Math.abs(authSlot.col - ordersSlot.col) + Math.abs(authSlot.row - ordersSlot.row);
  assert.strictEqual(dist, 1, 'Auth and Orders must be directly adjacent (distance = 1)');
});

test('getTableAnchor separates parallel connections with laneOffset', async () => {
  const { getTableAnchor } = await import('../src/routing.js');
  const table = { x: 100, y: 100, w: 200, h: 200 };
  const target = { x: 500, y: 150 };

  const a1 = getTableAnchor(table, null, target, null, -12);
  const a2 = getTableAnchor(table, null, target, null, 12);

  assert.notStrictEqual(a1.y, a2.y, 'Anchors with different lane offsets must have different coordinates');
  assert.strictEqual(a2.y - a1.y, 24, 'Distance between anchors matches laneOffset difference');
});

test('computeGroupBounds auto-fits bounding box to encompass member tables with standard padding', async () => {
  const { computeGroupBounds } = await import('../src/annotations.js');
  const group = {
    id: 'g1',
    type: 'group',
    text: 'Accounts',
    tables: ['users', 'profiles']
  };
  const tables = [
    { key: 'users', x: 100, y: 150, w: 200, h: 100 },
    { key: 'profiles', x: 350, y: 200, w: 180, h: 120 },
    { key: 'other', x: 800, y: 800, w: 200, h: 100 }
  ];

  // minX = 100, maxX = 350 + 180 = 530 -> w = (530 - 100) + 28*2 = 430 + 56 = 486
  // minY = 150, maxY = 200 + 120 = 320 -> h = (320 - 150) + 38 + 24 = 170 + 62 = 232
  // x = 100 - 28 = 72, y = 150 - 38 = 112
  const bounds = computeGroupBounds(group, tables);
  assert.strictEqual(bounds.x, 72);
  assert.strictEqual(bounds.y, 112);
  assert.strictEqual(bounds.w, 486);
  assert.strictEqual(bounds.h, 232);

  // Moving users to (50, 80) updates bounds accordingly
  tables[0].x = 50;
  tables[0].y = 80;
  const updatedBounds = computeGroupBounds(group, tables);
  assert.strictEqual(updatedBounds.x, 50 - 28);
  assert.strictEqual(updatedBounds.y, 80 - 38);
});

test('reorderWithExistingGroups arranges tables according to user existing groups', () => {
  const model = createMockModel();
  const annotations = [
    {
      id: 'g_auth',
      type: 'group',
      text: 'Auth & Users',
      color: 'blue',
      tables: ['users', 'profiles', 'tokens']
    },
    {
      id: 'g_orders',
      type: 'group',
      text: 'Orders & Catalog',
      color: 'emerald',
      tables: ['orders', 'order_items', 'products']
    }
  ];

  const result = reorderWithExistingGroups(model, annotations, { createGroups: true });
  assert.ok(result.domains.length >= 2, 'Has at least 2 domains');
  assert.ok(result.annotations.length >= 2, 'Generated group annotations for domains');

  // Verify all tables have valid finite positions
  for (const t of model.tables) {
    assert.ok(Number.isFinite(t.x), `table ${t.key} x is finite`);
    assert.ok(Number.isFinite(t.y), `table ${t.key} y is finite`);
  }

  // Preserved original IDs if provided
  const groupIds = result.annotations.map(a => a.id);
  assert.ok(groupIds.includes('g_auth'), 'Preserved g_auth ID');
  assert.ok(groupIds.includes('g_orders'), 'Preserved g_orders ID');
});

test('buildOrthogonalPoints applies laneOffset to transit corridor so parallel routes do not overlap', () => {
  const p1 = { x: 100, y: 100, nx: 1, ny: 0 };
  const p2 = { x: 500, y: 300, nx: -1, ny: 0 };

  const routeA = buildOrthogonalPoints(p1, p2, [], [], -12);
  const routeB = buildOrthogonalPoints(p1, p2, [], [], 12);

  // Both are 4-point S-bends: p1 -> (midX, p1.y) -> (midX, p2.y) -> p2
  assert.strictEqual(routeA.length, 4);
  assert.strictEqual(routeB.length, 4);

  const midXA = routeA[1].x;
  const midXB = routeB[1].x;

  assert.strictEqual(midXB - midXA, 24, 'Parallel corridors are separated by laneOffset difference');
});



