import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pointDistance,
  pointsOnLine,
  filterRedundantWaypoints,
  projectPointToPerimeter,
  getTableAnchor,
  getOrthogonalSegments,
  moveOrthogonalSegment,
  moveOrthogonalCorner,
  buildOrthogonalPoints,
  dockOrthogonalAnchor
} from '../src/routing.js';
import { Diagram } from '../src/diagram.js';
import { exportSVG } from '../src/svg-export.js';

test('filterRedundantWaypoints eliminates duplicates and collinear points', () => {
  const pts = [
    { x: 100, y: 100 },
    { x: 100, y: 100.5 }, // duplicate within tolerance
    { x: 200, y: 100 },
    { x: 300, y: 100 },   // collinear with (100, 100) and (400, 100)
    { x: 400, y: 100 },
    { x: 400, y: 250 },
    { x: 400, y: 400 },   // collinear
    { x: 500, y: 400 }
  ];
  const cleaned = filterRedundantWaypoints(pts, 3);
  assert.equal(cleaned.length, 4);
  assert.deepEqual(cleaned, [
    { x: 100, y: 100 },
    { x: 400, y: 100 },
    { x: 400, y: 400 },
    { x: 500, y: 400 }
  ]);
});

test('projectPointToPerimeter docks smoothly to nearest edge with valid normal and offset', () => {
  const table = { x: 100, y: 100, w: 200, h: 150 };

  // Cursor on the right
  const pRight = projectPointToPerimeter(table, { x: 350, y: 175 });
  assert.equal(pRight.side, 'right');
  assert.equal(pRight.x, 300);
  assert.equal(pRight.y, 175);
  assert.equal(pRight.nx, 1);
  assert.equal(pRight.ny, 0);

  // Cursor on top
  const pTop = projectPointToPerimeter(table, { x: 200, y: 40 });
  assert.equal(pTop.side, 'top');
  assert.equal(pTop.x, 200);
  assert.equal(pTop.y, 100);
  assert.equal(pTop.nx, 0);
  assert.equal(pTop.ny, -1);

  // Cursor on bottom
  const pBottom = projectPointToPerimeter(table, { x: 200, y: 320 });
  assert.equal(pBottom.side, 'bottom');
  assert.equal(pBottom.x, 200);
  assert.equal(pBottom.y, 250);
  assert.equal(pBottom.nx, 0);
  assert.equal(pBottom.ny, 1);

  // Cursor on left
  const pLeft = projectPointToPerimeter(table, { x: 70, y: 175 });
  assert.equal(pLeft.side, 'left');
  assert.equal(pLeft.x, 100);
  assert.equal(pLeft.y, 175);
  assert.equal(pLeft.nx, -1);
  assert.equal(pLeft.ny, 0);
});

test('moveOrthogonalSegment does NOT multiply vertices across multiple continuous frames', () => {
  const p1 = { x: 100, y: 100, nx: 1, ny: 0 };
  const p2 = { x: 400, y: 300, nx: -1, ny: 0 };
  const { points } = getOrthogonalSegments(p1, p2, []);
  assert.equal(points.length, 4); // [p1, (250, 100), (250, 300), p2]

  // Simulate 50 continuous mousemove frames dragging the middle vertical segment (index 1)
  let lastResult = null;
  for (let step = 1; step <= 50; step++) {
    const dx = step * 2; // moving right
    lastResult = moveOrthogonalSegment(p1, p2, points, 1, dx, 0);
    // Waypoints count must remain exactly 2, never increasing or multiplying!
    assert.equal(lastResult.waypoints.length, 2, `Step ${step} created unexpected waypoints`);
  }
  // At step 50, dx = 100, vertical segment is at X = 250 + 100 = 350
  assert.equal(lastResult.waypoints[0].x, 350);
  assert.equal(lastResult.waypoints[1].x, 350);
});

test('moveOrthogonalSegment slides anchor along table edge when moving first segment', () => {
  const sourceTable = { key: 'users', x: 50, y: 50, w: 100, h: 200 };
  const p1 = { x: 150, y: 100, nx: 1, ny: 0, side: 'right' };
  const p2 = { x: 400, y: 100, nx: -1, ny: 0, side: 'left' };
  const points = [
    { ...p1 },
    { x: 250, y: 100 },
    { x: 250, y: 300 },
    { ...p2, y: 300 }
  ];

  // Drag first segment (horizontal from right side): dy moves along right side
  const res = moveOrthogonalSegment(p1, p2, points, 0, 0, 40, sourceTable, null);
  assert.ok(res.fromAnchor, 'Expected fromAnchor update');
  assert.equal(res.fromAnchor.side, 'right');
  // 100 + 40 = 140, relative to table y=50, offset = (140 - 50) / 200 = 0.45
  assert.equal(res.fromAnchor.offset, 0.45);
});

test('moveOrthogonalCorner moves corner and auto-collapses when collinear', () => {
  const p1 = { x: 100, y: 100, nx: 1, ny: 0 };
  const p2 = { x: 400, y: 300, nx: -1, ny: 0 };
  const points = [
    { x: 100, y: 100 },
    { x: 250, y: 100 },
    { x: 250, y: 300 },
    { x: 400, y: 300 }
  ];

  // Move corner 0 (which is pts[1] = 250, 100) to (300, 150)
  const moved = moveOrthogonalCorner(p1, p2, points, 0, 300, 150);
  assert.equal(moved.length, 2);
  assert.equal(moved[0].x, 300);
  assert.equal(moved[0].y, 150);

  // Now move corner 0 collinear with p1 (Y = 100, X = 100)
  const collapsed = moveOrthogonalCorner(p1, p2, points, 0, 100, 100);
  // Should collapse collinear points
  assert.ok(collapsed.length <= 2);
});

test('reconnectEdge reconnects manual links and model relations cleanly', () => {
  // Create mock diagram instance
  globalThis.window = { devicePixelRatio: 1, addEventListener: () => {} };
  globalThis.requestAnimationFrame = () => {};
  const mockCanvas = {
    getContext: () => ({
      fillText: () => {},
      measureText: () => ({ width: 50 }),
      setTransform: () => {},
      save: () => {},
      restore: () => {},
      clearRect: () => {},
      beginPath: () => {},
      stroke: () => {},
      fill: () => {}
    }),
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    style: {}
  };
  const d = new Diagram(mockCanvas);
  d.model = {
    tables: [
      { key: 'users', name: 'users', x: 0, y: 0, w: 150, h: 100, columns: [{ name: 'id' }] },
      { key: 'orders', name: 'orders', x: 300, y: 0, w: 150, h: 100, columns: [{ name: 'id' }, { name: 'user_id' }] },
      { key: 'customers', name: 'customers', x: 600, y: 0, w: 150, h: 100, columns: [{ name: 'cid' }] },
    ],
    relations: [
      { fromTable: 'orders', fromCols: ['user_id'], toTable: 'users', toCols: ['id'] }
    ]
  };
  d.manualLinks = [
    { from: { table: 'orders', col: 'id' }, to: { table: 'users', col: 'id' } }
  ];

  // Reconnect manual link target to customers.cid
  const manualKey = 'orders.id->users.id';
  const ok1 = d.reconnectEdge(manualKey, false, 'customers', 'cid');
  assert.equal(ok1, true);
  assert.equal(d.manualLinks[0].to.table, 'customers');
  assert.equal(d.manualLinks[0].to.col, 'cid');

  // Reconnect model relation target to customers.cid
  const modelKey = 'orders.user_id->users.id';
  const ok2 = d.reconnectEdge(modelKey, false, 'customers', 'cid');
  assert.equal(ok2, true);
  assert.equal(d.model.relations[0].toTable, 'customers');
  assert.equal(d.model.relations[0].toCols[0], 'cid');
});

test('sequential waypoint insertion preserves segment order (points 1..N)', () => {
  const mockCanvas = {
    getContext: () => ({
      fillText: () => {}, measureText: () => ({ width: 50 }),
      setTransform: () => {}, save: () => {}, restore: () => {},
      clearRect: () => {}, beginPath: () => {}, stroke: () => {}, fill: () => {}
    }),
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    style: {}
  };
  const d = new Diagram(mockCanvas);
  const key = 'orders.user_id->users.id';

  // Initially 0 waypoints (line has 2 points: 1=start, 2=end)
  assert.equal(d.edgeWaypoints.get(key), undefined);

  // 1st double click: insert point A at middle
  d.addWaypoint(key, 250, 150, 0);
  assert.deepEqual(d.edgeWaypoints.get(key), [{ x: 250, y: 150 }]);
  // Line now has 3 points: 1=start, 2=A, 3=end

  // 2nd double click: click between vertex 2 (A) and vertex 3 (end)
  // The insert index for segment 1 (between 2 and 3) must be 1!
  d.addWaypoint(key, 350, 250, 1);
  assert.deepEqual(d.edgeWaypoints.get(key), [
    { x: 250, y: 150 }, // Vertex 2 remains A
    { x: 350, y: 250 }  // Vertex 3 becomes the new point!
  ]);
  // Line now has 4 points: 1=start, 2=A, 3=new, 4=end!

  // 3rd double click: click between vertex 1 (start) and vertex 2 (A)
  // The insert index for segment 0 (between 1 and 2) must be 0!
  d.addWaypoint(key, 150, 120, 0);
  assert.deepEqual(d.edgeWaypoints.get(key), [
    { x: 150, y: 120 }, // Vertex 2 becomes new point!
    { x: 250, y: 150 }, // Vertex 3 was A
    { x: 350, y: 250 }  // Vertex 4 was previous point
  ]);
});

test('moveOrthogonalSegment turns anchor to lateral face cleanly without vertex clustering', () => {
  const fromTable = { key: 'order_items', x: 240, y: 660, w: 300, h: 330 };
  const toTable = { key: 'orders', x: 800, y: 150, w: 200, h: 300 };

  const p1 = { x: 380, y: 660, nx: 0, ny: -1, side: 'top' };
  const corner = { x: 380, y: 220 };
  const p2 = { x: 800, y: 220, nx: -1, ny: 0, side: 'left' };
  const basePoints = [ { ...p1 }, { ...corner }, { ...p2 } ];

  // Drag vertical segment (segIndex 0) within table width (dx = -50)
  const resWithin = moveOrthogonalSegment(p1, p2, basePoints, 0, -50, 0, fromTable, toTable);
  assert.equal(resWithin.waypoints.length, 1, 'Should have exactly 1 corner within table');
  assert.equal(resWithin.fromAnchor.side, 'top');
  assert.equal(resWithin.waypoints[0].x, 330);

  // Drag vertical segment beyond left edge of table (dx = -160, x = 220 < 240)
  const resOutside = moveOrthogonalSegment(p1, p2, basePoints, 0, -160, 0, fromTable, toTable);
  assert.equal(resOutside.fromAnchor.side, 'left', 'Anchor must turn to lateral left face');
  assert.ok(resOutside.waypoints.length <= 2, 'Must have at most 2 corners for clean L/Z step without clustering');
  assert.equal(resOutside.waypoints[resOutside.waypoints.length - 1].y, 220, 'Final corner must align with target horizontally');
});

test('moveOrthogonalSegment on 1-segment line slides both anchors and forms clean L-bend above table', () => {
  const fromTable = { key: 'order_items', x: 240, y: 660, w: 300, h: 330 };
  const toTable = { key: 'orders', x: 800, y: 500, w: 200, h: 300 };

  const p1 = { x: 540, y: 680, nx: 1, ny: 0, side: 'right' };
  const p2 = { x: 800, y: 680, nx: -1, ny: 0, side: 'left' };
  const basePoints = [ { ...p1 }, { ...p2 } ];

  // Drag horizontal segment up by 10px (still within lateral height of both tables)
  const resSlide = moveOrthogonalSegment(p1, p2, basePoints, 0, 0, -10, fromTable, toTable);
  assert.equal(resSlide.waypoints.length, 0, 'Must not create any waypoints when sliding within lateral faces');
  assert.equal(resSlide.fromAnchor.side, 'right');
  assert.equal(resSlide.toAnchor.side, 'left');

  // Drag horizontal segment above order_items (dy = -40, y = 640 < 660)
  const resAbove = moveOrthogonalSegment(p1, p2, basePoints, 0, 0, -40, fromTable, toTable);
  assert.equal(resAbove.fromAnchor.side, 'top', 'fromAnchor must transition to top edge');
  assert.equal(resAbove.toAnchor.side, 'left', 'toAnchor remains on lateral left face of orders');
  assert.equal(resAbove.waypoints.length, 1, 'Must form a clean L-bend with exactly 1 corner');
  assert.equal(resAbove.waypoints[0].y, 640, 'Corner must align with orders left-side entry');
});

test('moveOrthogonalCorner slides connected anchors on tables and keeps clean L-bend (Images 2 & 3)', () => {
  const fromTable = { key: 'order_items', x: 50, y: 300, w: 200, h: 200 };
  const toTable = { key: 'orders', x: 500, y: 50, w: 200, h: 200 };

  const p1 = { x: 130, y: 300, nx: 0, ny: -1, side: 'top' };
  const corner = { x: 130, y: 130 };
  const p2 = { x: 500, y: 130, nx: -1, ny: 0, side: 'left' };
  const basePoints = [ { ...p1 }, { ...corner }, { ...p2 } ];

  // Image 2: Drag corner outwards (103, 99)
  const resOut = moveOrthogonalCorner(p1, p2, basePoints, 0, 103, 99, fromTable, toTable);
  assert.equal(resOut.waypoints.length, 1, 'Must keep exactly 1 corner without loops or boxes');
  assert.equal(resOut.waypoints[0].x, 103);
  assert.equal(resOut.waypoints[0].y, 99);
  assert.equal(resOut.fromAnchor.side, 'top', 'fromAnchor slides along top face');
  assert.equal(resOut.toAnchor.side, 'left', 'toAnchor slides along left face');

  // Image 3: Drag corner inwards (176, 154)
  const resIn = moveOrthogonalCorner(p1, p2, basePoints, 0, 176, 154, fromTable, toTable);
  assert.equal(resIn.waypoints.length, 1, 'Must keep exactly 1 corner without staircase or Z-step');
  assert.equal(resIn.waypoints[0].x, 176);
  assert.equal(resIn.waypoints[0].y, 154);
  assert.equal(resIn.fromAnchor.side, 'top');
  assert.equal(resIn.toAnchor.side, 'left');
});

test('moveOrthogonalCorner down-right creates 2 corners, tracks activeCornerIndex, and collapses cleanly upward (User Images 1, 2, 3)', () => {
  const fromTable = { key: 'order_items', x: 100, y: 300, w: 200, h: 200 };
  const toTable = { key: 'orders', x: 500, y: 100, w: 200, h: 300 };

  // Image 1: 1 corner in L
  const p1 = { x: 200, y: 300, nx: 0, ny: -1, side: 'top' };
  const corner = { x: 200, y: 150 };
  const p2 = { x: 500, y: 150, nx: -1, ny: 0, side: 'left' };
  const basePoints = [ { ...p1 }, { ...corner }, { ...p2 } ];

  // Drag down-right into space between tables (targetX: 380, targetY: 250)
  // Anchor moves to lateral right face of order_items (x=300)
  const resSplit = moveOrthogonalCorner(p1, p2, basePoints, 0, 380, 250, fromTable, toTable);
  assert.equal(resSplit.fromAnchor.side, 'right', 'Anchor transitions to right face');
  assert.equal(resSplit.waypoints.length, 2, 'Must create exactly 2 corners (Z/S shape)');
  assert.equal(resSplit.activeCornerIndex, 1, 'activeCornerIndex must point to the corner being dragged (vertex 2)');
  assert.equal(resSplit.waypoints[1].x, 380);
  assert.equal(resSplit.waypoints[1].y, 250);

  // Image 3 Fix: From Image 2 state (2 corners), drag vertex 2 (cornerIndex = 1) upward in space (targetX: 380, targetY: 150)
  // It must maintain the clean 2 corners on the right lateral face of order_items without corrupting into a staircase
  const pts2 = [
    { x: 300, y: 250, nx: 1, ny: 0, side: 'right' },
    resSplit.waypoints[0],
    resSplit.waypoints[1],
    { x: 500, y: 250, nx: -1, ny: 0, side: 'left' }
  ];
  const resUp = moveOrthogonalCorner(pts2[0], pts2[3], pts2, 1, 380, 150, fromTable, toTable);
  assert.equal(resUp.fromAnchor.side, 'right', 'Anchor stays on right lateral face when dragged in space to the right of table');
  assert.equal(resUp.toAnchor.side, 'left', 'toAnchor must stay on lateral face of orders');
  assert.equal(resUp.waypoints.length, 2, 'Must maintain exactly 2 corners, NEVER a staircase or zig-zag');
  assert.equal(resUp.activeCornerIndex, 1, 'activeCornerIndex stays on the dragged corner');
  assert.equal(resUp.waypoints[1].y, 150);

  // When dragged leftward above order_items (targetX: 200, within x: 100..300, targetY: 150 < 300)
  // It must collapse smoothly to top face with exactly 1 corner (an L-route)
  const resCollapse = moveOrthogonalCorner(pts2[0], pts2[3], pts2, 1, 200, 150, fromTable, toTable);
  assert.equal(resCollapse.fromAnchor.side, 'top', 'When dragged leftward above table, anchor must collapse to top face');
  assert.equal(resCollapse.toAnchor.side, 'left', 'toAnchor must stay on lateral face of orders');
  assert.equal(resCollapse.waypoints.length, 1, 'Must collapse back to 1 corner in L');
  assert.equal(resCollapse.activeCornerIndex, 0, 'activeCornerIndex becomes 0 on collapsed single corner');
  assert.equal(resCollapse.waypoints[0].y, 150);
});

test('vertexAt returns accurate 0-based indexes matching getOrthogonalSegments points', () => {
  const mockCanvas = {
    getContext: () => ({
      measureText: (txt) => ({ width: (txt || '').length * 7 }),
      setLineDash: () => {},
      beginPath: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      rect: () => {},
      roundRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {}
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {}
  };
  const d = new Diagram(mockCanvas);
  d.model = {
    tables: [
      { key: 'order_items', x: 100, y: 300, w: 200, h: 200, columns: [{ name: 'id' }] },
      { key: 'orders', x: 500, y: 100, w: 200, h: 200, columns: [{ name: 'id' }] }
    ],
    relations: [{ fromTable: 'order_items', fromCols: ['id'], toTable: 'orders', toCols: ['id'] }]
  };
  const key = 'order_items.id->orders.id';
  d.routingStyle = 'ortho-sharp';
  // Store 2 waypoints
  d.edgeWaypoints.set(key, [{ x: 380, y: 300 }, { x: 380, y: 150 }]);
  d.selectedEdgeKey = key;

  // Hover near Corner 0 (380, 300)
  const hit0 = d.vertexAt(380, 300);
  assert.ok(hit0, 'Should detect Corner 0');
  assert.equal(hit0.index, 0, 'Corner 0 must have index 0');

  // Hover near Corner 1 (380, 150)
  const hit1 = d.vertexAt(380, 150);
  assert.ok(hit1, 'Should detect Corner 1');
  assert.equal(hit1.index, 1, 'Corner 1 must have index 1');
});

test('moveOrthogonalCorner never drops to 0 waypoints or freezes when corners are 2px apart (logs.txt line 187)', () => {
  const fromTable = { key: 'order_items', x: 50, y: 175, w: 130, h: 200 };
  const toTable = { key: 'orders', x: 350, y: 50, w: 150, h: 250 };
  const p1 = { x: 180, y: 186, nx: 1, ny: 0, side: 'right' };
  const p2 = { x: 350, y: 184, nx: -1, ny: 0, side: 'left' };
  const basePoints = [
    { ...p1 },
    { x: 195, y: 186 },
    { x: 195, y: 183 },
    { ...p2 }
  ];

  // Drag corner 1 from (195, 183) to (195, 184), making vertical gap between corners only 2px
  const res = moveOrthogonalCorner(p1, p2, basePoints, 1, 195, 184, fromTable, toTable);
  assert.ok(res.waypoints.length > 0, 'Waypoints must NEVER drop to 0 while dragging a corner');
  assert.ok(res.activeCornerIndex >= 0, 'activeCornerIndex must be valid non-negative index');
  assert.ok(res.points.length >= 3, 'Full points must contain at least 3 points (p1, corner, p2)');
});

test('moveOrthogonalSegment updates fromAnchor when dragging segment 1 down beside table (user segment drag)', () => {
  const fromTable = { key: 'order_items', x: 0, y: 179, w: 180, h: 200 };
  const toTable = { key: 'orders', x: 350, y: 50, w: 200, h: 250 };
  const p1 = { x: 127, y: 179, nx: 0, ny: -1, side: 'top' };
  const corner = { x: 127, y: 108 };
  const p2 = { x: 350, y: 108, nx: -1, ny: 0, side: 'left' };
  const basePoints = [ { ...p1 }, { ...corner }, { ...p2 } ];

  // Drag horizontal segment (segIndex 1) down by 128px (from y=108 to y=236)
  const res = moveOrthogonalSegment(p1, p2, basePoints, 1, 0, 128, fromTable, toTable);
  assert.ok(res.fromAnchor, 'fromAnchor must NOT be null');
  assert.equal(res.fromAnchor.side, 'right', 'fromAnchor must transition to right lateral face');
  assert.ok(res.toAnchor, 'toAnchor must NOT be null');
  assert.equal(res.toAnchor.side, 'left', 'toAnchor must stay on left face of orders');
  assert.equal(res.waypoints.length, 0, 'Waypoints must collapse to 0 for a straight horizontal line');
});

test('dockOrthogonalAnchor strictly respects orthogonal approach rules', () => {
  const table = { x: 350, y: 50, w: 180, h: 190 };

  // Horizontal approach strictly above table (py = -14 < 50) -> must dock to top
  const dockAbove = dockOrthogonalAnchor(table, { x: 110, y: -14 }, true, false);
  assert.equal(dockAbove.side, 'top');
  assert.equal(dockAbove.ny, -1);
  assert.equal(dockAbove.y, 50);

  // Horizontal approach strictly below table (py = 300 > 240) -> must dock to bottom
  const dockBelow = dockOrthogonalAnchor(table, { x: 110, y: 300 }, true, false);
  assert.equal(dockBelow.side, 'bottom');
  assert.equal(dockBelow.ny, 1);
  assert.equal(dockBelow.y, 240);

  // Horizontal approach within table vertical span (py = 100) -> docks to left
  const dockWithin = dockOrthogonalAnchor(table, { x: 110, y: 100 }, true, false);
  assert.equal(dockWithin.side, 'left');
  assert.equal(dockWithin.nx, -1);
  assert.equal(dockWithin.x, 350);

  // Vertical approach strictly to the left of table (px = 200 < 350) -> docks to left
  const dockLeft = dockOrthogonalAnchor(table, { x: 200, y: 100 }, false, false);
  assert.equal(dockLeft.side, 'left');
  assert.equal(dockLeft.nx, -1);

  // Vertical approach within horizontal span (px = 400) -> docks to top or bottom
  const dockVertTop = dockOrthogonalAnchor(table, { x: 400, y: 20 }, false, false);
  assert.equal(dockVertTop.side, 'top');
  assert.equal(dockVertTop.ny, -1);
});

test('moveOrthogonalCorner dragging upward above orders transitions to top edge without freezing at y=72 (logs.txt bug)', () => {
  const fromTable = { key: 'order_items', x: 0, y: 179, w: 180, h: 200 };
  const toTable = { key: 'orders', x: 350, y: 50, w: 180, h: 190 };
  const p1 = { x: 152, y: 179, nx: 0, ny: -1, side: 'top' };
  const corner = { x: 152, y: 106 };
  const p2 = { x: 350, y: 106, nx: -1, ny: 0, side: 'left' };
  const basePoints = [ { ...p1 }, { ...corner }, { ...p2 } ];

  // 1. Drag corner upward above orders (targetX: 110, targetY: -14)
  // In logs.txt, this froze at y=72 because orders anchor was clamped to left face at offset 0.04
  const resUp = moveOrthogonalCorner(p1, p2, basePoints, 0, 110, -14, fromTable, toTable);
  assert.ok(resUp.toAnchor, 'toAnchor must be present');
  assert.equal(resUp.toAnchor.side, 'top', 'toAnchor must transition to top edge of orders');
  assert.equal(resUp.waypoints.length, 2, 'Must create 2 corners (corner 0 at mouse, corner 1 entering roof of orders)');
  assert.equal(resUp.waypoints[0].x, 110);
  assert.equal(resUp.waypoints[0].y, -14, 'Corner 0 must NOT freeze at 72; it must follow mouse to -14');
  assert.equal(resUp.activeCornerIndex, 0, 'activeCornerIndex must remain 0 on the dragged corner');

  // 2. Drag further up to targetY: -50 using current points
  const resUpFurther = moveOrthogonalCorner(resUp.points[0], resUp.points[resUp.points.length - 1], resUp.points, 0, 110, -50, fromTable, toTable);
  assert.equal(resUpFurther.waypoints[0].y, -50, 'Corner 0 must move freely upward to -50');
  assert.equal(resUpFurther.waypoints.length, 2);
  assert.equal(resUpFurther.toAnchor.side, 'top');

  // 3. Drag back down level with orders left edge (targetY: 70 >= 50)
  const resDown = moveOrthogonalCorner(resUpFurther.points[0], resUpFurther.points[resUpFurther.points.length - 1], resUpFurther.points, 0, 110, 70, fromTable, toTable);
  assert.equal(resDown.toAnchor.side, 'left', 'toAnchor must transition back to left edge of orders');
  assert.equal(resDown.waypoints.length, 1, 'Must collapse back to 1 corner (clean L-route)');
  assert.equal(resDown.waypoints[0].x, 110);
  assert.equal(resDown.waypoints[0].y, 70);
  assert.equal(resDown.activeCornerIndex, 0);
});

test('cardinality markers orient correctly in direction of line on top and bottom faces', () => {
  const model = {
    tables: [
      { name: 'order_items', key: 'order_items', x: 100, y: 300, w: 200, h: 200, columns: [{ name: 'id', pk: true }, { name: 'order_id', fk: true }] },
      { name: 'orders', key: 'orders', x: 500, y: 100, w: 200, h: 200, columns: [{ name: 'id', pk: true }] }
    ],
    relations: [
      { fromTable: 'order_items', fromCols: ['order_id'], toTable: 'orders', toCols: ['id'] }
    ]
  };

  // Anchor fromTable to top face (nx: 0, ny: -1) and toTable to top face (nx: 0, ny: -1)
  const edgeAnchors = {
    'order_items.order_id->orders.id': {
      fromAnchor: { side: 'top', offset: 0.5 },
      toAnchor: { side: 'top', offset: 0.5 }
    }
  };

  const svg = exportSVG(model, 'dark', [], null, 'multi', null, 'ortho-sharp', null, edgeAnchors);
  assert.ok(svg, 'SVG must be generated');

  // For fromTable (order_items at x=100, y=300, w=200):
  // Top anchor is at x = 200, y = 300. Normal is nx = 0, ny = -1 (UP).
  // Crow's foot (many) apex must be at y = 300 - 11 = 289 (along vertical line).
  // Prongs spread horizontally: x = 200 - 5.5 = 194.5 and x = 200 + 5.5 = 205.5 at y = 300.
  assert.ok(svg.includes('M 200 289 L 205.5 300') || svg.includes('M 200 289 L 194.5 300'), 'Marker on top face must extend apex up to y=289 and spread prongs horizontally on y=300');

  // Single bar on orders (x=500, y=100, w=200):
  // Top anchor is at x = 600, y = 100. Normal is nx = 0, ny = -1 (UP).
  // Bar must be horizontal at y = 100 - 11 = 89, from x = 600 - 5.5 = 594.5 to x = 600 + 5.5 = 605.5.
  assert.ok(svg.includes('M 605.5 89 L 594.5 89') || svg.includes('M 594.5 89 L 605.5 89'), 'Single bar on top face must be horizontal at y=89');
});





