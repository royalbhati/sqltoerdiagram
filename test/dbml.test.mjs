// Tests for DBML format parsing (TableGroup / boundaries), serialization, and SVG export.
// Run: node test/dbml.test.mjs
import { parseSchema, detectFormat } from '../src/parse.js';
import { parseDBML } from '../src/formats/dbml.js';
import { toDBML, toDBMLLayout } from '../src/formats/serialize.js';
import { computeGroupBounds, sanitizeAnnotations, resolveGroupColor } from '../src/annotations.js';
import { exportSVG } from '../src/svg-export.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error('  ✗ ' + msg);
  }
};

// --- Format Detection ---
{
  ok(detectFormat('TableGroup Auth { users }') === 'dbml', 'detectFormat: TableGroup recognized as dbml');
  ok(detectFormat('Table users { id int }') === 'dbml', 'detectFormat: Table recognized as dbml');
}

// --- DBML Parsing with TableGroups ---
{
  const dbmlCode = `
Table users {
  id integer [pk]
  username varchar [not null, unique]
  created_at timestamp
}

Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
  total decimal
}

Table products {
  id integer [pk]
  name varchar
  price decimal
}

Table order_items {
  id integer [pk]
  order_id integer [ref: > orders.id]
  product_id integer [ref: > products.id]
}

TableGroup "User Management" [color: #5aa7ff, note: "User and auth tables"] {
  users
}

TableGroup Ecommerce [color: #27ae60] {
  orders
  order_items
  products
  Note: 'Store tables'
}
`;

  const parsed = parseDBML(dbmlCode);
  ok(parsed.tables.length === 4, `parseDBML: 4 tables parsed (got ${parsed.tables.length})`);
  ok(parsed.relations.length === 3, `parseDBML: 3 relations parsed (got ${parsed.relations.length})`);
  ok(Array.isArray(parsed.groups) && parsed.groups.length === 2, `parseDBML: 2 groups parsed (got ${parsed.groups?.length})`);

  const g1 = parsed.groups[0];
  ok(g1.name === 'User Management', 'Group 1 name is "User Management"');
  ok(g1.color === '#5aa7ff', 'Group 1 color is #5aa7ff');
  ok(g1.note === 'User and auth tables', 'Group 1 note is "User and auth tables"');
  ok(g1.tables.length === 1 && g1.tables[0] === 'users', 'Group 1 contains users table');

  const g2 = parsed.groups[1];
  ok(g2.name === 'Ecommerce', 'Group 2 name is "Ecommerce"');
  ok(g2.color === '#27ae60', 'Group 2 color is #27ae60');
  ok(g2.tables.length === 3 && g2.tables.includes('orders') && g2.tables.includes('products'), 'Group 2 contains ecommerce tables');
}

// --- Group Bounds Calculation ---
{
  const mockTables = [
    { key: 'users', name: 'users', x: 100, y: 100, w: 200, h: 150 },
    { key: 'profiles', name: 'profiles', x: 350, y: 120, w: 180, h: 100 },
    { key: 'orders', name: 'orders', x: 100, y: 400, w: 200, h: 150 },
  ];

  const bounds = computeGroupBounds({ tables: ['users', 'profiles'] }, mockTables, { x: 20, top: 30, bottom: 20 });
  ok(bounds !== null, 'computeGroupBounds returned bounds');
  ok(bounds.x === 80, `bounds.x is 80 (got ${bounds.x})`);
  ok(bounds.y === 70, `bounds.y is 70 (got ${bounds.y})`);
  ok(bounds.w === (530 - 100) + 40, `bounds.w is 470 (got ${bounds.w})`);
  ok(bounds.h === (250 - 100) + 50, `bounds.h is 200 (got ${bounds.h})`);
}

// --- Serialization to DBML with TableGroups ---
{
  const model = {
    tables: [
      { name: 'users', key: 'users', columns: [{ name: 'id', type: 'int', pk: true }] },
      { name: 'orders', key: 'orders', columns: [{ name: 'id', type: 'int', pk: true }, { name: 'user_id', type: 'int', fk: true }] },
    ],
    relations: [
      { fromTable: 'orders', fromCols: ['user_id'], toTable: 'users', toCols: ['id'] },
    ],
    groups: [
      { name: 'Core', color: '#5aa7ff', tables: ['users', 'orders'] },
    ],
  };

  const serialized = toDBML(model);
  ok(serialized.includes('Table "users"'), 'toDBML includes Table "users"');
  ok(serialized.includes('Table "orders"'), 'toDBML includes Table "orders"');
  ok(serialized.includes('Ref: "orders"."user_id" > "users"."id"'), 'toDBML includes Ref');
  ok(serialized.includes('TableGroup "Core"'), 'toDBML includes TableGroup "Core"');
  ok(serialized.includes('"users"') && serialized.includes('"orders"'), 'toDBML includes member tables');
}

// --- Color Resolution and SVG Export ---
{
  ok(resolveGroupColor('blue') === '#5aa7ff', 'resolveGroupColor preset');
  ok(resolveGroupColor('#27ae60') === '#27ae60', 'resolveGroupColor custom hex');

  const model = {
    tables: [{ name: 'users', key: 'users', x: 50, y: 50, w: 100, h: 80, columns: [] }],
    relations: [],
  };
  const annotations = [
    { id: 'g1', type: 'group', x: 30, y: 20, w: 140, h: 130, text: 'Auth Group', color: '#27ae60' },
  ];

  const svg = exportSVG(model, 'dark', annotations);
  ok(svg.includes('<svg'), 'exportSVG produces SVG root');
  ok(svg.includes('Auth Group'), 'exportSVG includes group label');
  ok(svg.includes('#27ae60') || svg.includes('rgba(39,174,96'), 'exportSVG includes custom group color');
}

// --- Connection Colors and dddbml Layout Export ---
{
  const model = {
    tables: [
      { name: 'users', key: 'users', x: 50, y: 50, w: 100, h: 80, columns: [{ name: 'id', type: 'int', pk: true }] },
      { name: 'orders', key: 'orders', x: 300, y: 50, w: 100, h: 80, columns: [{ name: 'id', type: 'int', pk: true }, { name: 'user_id', type: 'int', fk: true }] }
    ],
    relations: [
      { fromTable: 'orders', fromCols: ['user_id'], toTable: 'users', toCols: ['id'] }
    ],
  };
  const annotations = [
    { id: 'g1', type: 'group', x: 30, y: 20, w: 400, h: 140, text: 'Core', color: '#5aa7ff', tables: ['users', 'orders'] },
  ];
  const customColors = new Map([
    ['orders.user_id->users.id', '#ff0055']
  ]);

  const svgMulti = exportSVG(model, 'dark', annotations, null, 'multi', customColors);
  ok(svgMulti.includes('#ff0055'), 'exportSVG includes custom edge color');

  const svgSingle = exportSVG(model, 'dark', annotations, null, 'single', null);
  ok(svgSingle.includes('stroke='), 'exportSVG single mode includes stroke');

  // Verify dddbml layout structure shape
  const layoutJson = {
    version: 1,
    edgeColorMode: 'multi',
    tables: {
      users: { x: 50, y: 50 },
      orders: { x: 300, y: 50 },
    },
    groups: {
      Core: { color: '#5aa7ff', tables: ['users', 'orders'] }
    },
    connections: {
      'orders.user_id->users.id': { color: '#ff0055' }
    },
    camera: { x: 0, y: 0, scale: 1 }
  };
  const str = JSON.stringify(layoutJson);
  const parsedLayout = JSON.parse(str);
  ok(parsedLayout.tables.users.x === 50, 'dddbml layout JSON parsed table x');
  ok(parsedLayout.connections['orders.user_id->users.id'].color === '#ff0055', 'dddbml layout JSON connection color preserved');
  ok(parsedLayout.groups.Core.color === '#5aa7ff', 'dddbml layout JSON group preserved');
}

// --- Routing Styles, Waypoints and Perimeter Anchors ---
{
  const {
    getTableAnchor,
    buildOrthogonalPoints,
    getOrthogonalSegments,
    moveOrthogonalSegment,
    moveOrthogonalCorner,
    buildSVGPath,
    pointToSegmentDistance,
  } = await import('../src/routing.js');

  const table = { x: 100, y: 100, w: 200, h: 100, columns: [{ name: 'id' }] };
  const targetRight = { x: 400, y: 150 };
  const targetTop = { x: 200, y: 0 };

  const anchorRight = getTableAnchor(table, 'id', targetRight);
  ok(anchorRight.side === 'right' && anchorRight.x === 300, 'getTableAnchor connects on right');

  const anchorTop = getTableAnchor(table, 'id', targetTop);
  ok(anchorTop.side === 'top' && anchorTop.y === 100, 'getTableAnchor connects on top');

  const manualAnchor = getTableAnchor(table, 'id', null, { side: 'bottom', offset: 0.5 });
  ok(manualAnchor.side === 'bottom' && manualAnchor.x === 200 && manualAnchor.y === 200, 'getTableAnchor custom bottom anchor');

  // Orthogonal points & segments (dbdiagram.io model)
  const p1 = { x: 100, y: 100, nx: 1, ny: 0 };
  const p2 = { x: 400, y: 300, nx: -1, ny: 0 };
  const { segments, points } = getOrthogonalSegments(p1, p2, []);
  ok(segments.length >= 3, 'getOrthogonalSegments produced segments');

  // Move vertical segment (e.g. middle segment at index 1)
  const movedWaypoints = moveOrthogonalSegment(p1, p2, [], 1, 320, 200);
  ok(movedWaypoints.length >= 2, 'moveOrthogonalSegment updated orthogonal waypoints');
  ok(movedWaypoints[0].x === 320, 'moveOrthogonalSegment shifted vertical segment X');

  // Corner movement
  const movedCorner = moveOrthogonalCorner(p1, p2, movedWaypoints, 0, 310, 120);
  ok(movedCorner.length >= 2, 'moveOrthogonalCorner updated corners orthogonally');

  // SVG Paths
  const svgStraight = buildSVGPath('straight', p1, p2, [{ x: 200, y: 150 }]);
  ok(svgStraight.startsWith('M 100 100 L 200 150 L 400 300'), 'buildSVGPath straight path');

  const svgOrtho = buildSVGPath('ortho-sharp', p1, p2, []);
  ok(svgOrtho.startsWith('M 100 100'), 'buildSVGPath ortho-sharp path');

  const svgOrthoRounded = buildSVGPath('ortho-rounded', p1, p2, []);
  ok(svgOrthoRounded.includes('Q') || svgOrthoRounded.includes('L'), 'buildSVGPath ortho-rounded path');

  // Distance
  const dist = pointToSegmentDistance(200, 155, 100, 150, 300, 150);
  ok(dist.dist === 5, 'pointToSegmentDistance calculates accurate distance');
}

// --- toDBMLLayout (Layout JSON generation for separate download on DBML export) ---
{
  const mockModel = {
    tables: [
      { key: 'users', name: 'users', x: 120, y: 180, w: 200, h: 150 },
      { key: 'orders', name: 'orders', x: 450, y: 220, w: 220, h: 160 },
    ],
    relations: [],
  };

  const mockAnnotations = [
    {
      id: 'g1',
      type: 'group',
      text: 'Ecommerce',
      color: '#3b82f6',
      note: 'Order tables',
      tables: ['orders'],
    },
    {
      id: 'n1',
      type: 'note',
      text: 'Remember to verify indexes',
      x: 100,
      y: 50,
      w: 150,
      h: 80,
    },
  ];

  const camera = { x: 50, y: 80, scale: 1.25 };
  const options = {
    diagramLevel: 'logical',
    edgeColorMode: 'single',
    edgeRouting: 'ortho-sharp',
    connections: {
      'users->orders': { color: '#ef4444', routing: 'straight' },
    },
  };

  const layoutJsonStr = toDBMLLayout(mockModel, mockAnnotations, camera, options);
  const layout = JSON.parse(layoutJsonStr);

  ok(layout.version === 1, 'toDBMLLayout: version is 1');
  ok(layout.diagramLevel === 'logical', 'toDBMLLayout: preserves diagramLevel');
  ok(layout.edgeColorMode === 'single', 'toDBMLLayout: preserves edgeColorMode');
  ok(layout.edgeRouting === 'ortho-sharp', 'toDBMLLayout: preserves edgeRouting');
  ok(layout.tables.users.x === 120 && layout.tables.users.y === 180, 'toDBMLLayout: tables contains users coords');
  ok(layout.tables.orders.x === 450 && layout.tables.orders.y === 220, 'toDBMLLayout: tables contains orders coords');
  ok(layout.groups.Ecommerce.color === '#3b82f6', 'toDBMLLayout: groups contains Ecommerce');
  ok(Array.isArray(layout.groups.Ecommerce.tables) && layout.groups.Ecommerce.tables[0] === 'orders', 'toDBMLLayout: group contains orders table');
  ok(layout.camera.scale === 1.25, 'toDBMLLayout: camera scale preserved');
  ok(Array.isArray(layout.customNotes) && layout.customNotes.length === 1, 'toDBMLLayout: customNotes contains note annotation');
  ok(layout.connections['users->orders'].color === '#ef4444', 'toDBMLLayout: connections preserved');
}

console.log(`\nDBML tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

