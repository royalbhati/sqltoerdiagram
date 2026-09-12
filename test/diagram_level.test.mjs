import test from 'node:test';
import assert from 'node:assert';
import { toLogicalType, getVisibleColumns, measureTable, columnY } from '../src/renderer.js';
import { exportSVG } from '../src/svg-export.js';

test('toLogicalType normalizes raw SQL and DBML types to universal logical types', () => {
  // Strings & text
  assert.strictEqual(toLogicalType('varchar(255)'), 'String');
  assert.strictEqual(toLogicalType('nvarchar(100)'), 'String');
  assert.strictEqual(toLogicalType('char(10)'), 'String');
  assert.strictEqual(toLogicalType('string'), 'String');
  assert.strictEqual(toLogicalType('text'), 'Text');
  assert.strictEqual(toLogicalType('longtext'), 'Text');

  // Integers & numeric
  assert.strictEqual(toLogicalType('int'), 'Integer');
  assert.strictEqual(toLogicalType('integer'), 'Integer');
  assert.strictEqual(toLogicalType('smallint'), 'Integer');
  assert.strictEqual(toLogicalType('serial'), 'Integer');
  assert.strictEqual(toLogicalType('bigint'), 'BigInt');
  assert.strictEqual(toLogicalType('bigserial'), 'BigInt');
  assert.strictEqual(toLogicalType('decimal(10,2)'), 'Decimal');
  assert.strictEqual(toLogicalType('numeric(8,4)'), 'Decimal');
  assert.strictEqual(toLogicalType('float'), 'Float');
  assert.strictEqual(toLogicalType('double precision'), 'Float');

  // Booleans
  assert.strictEqual(toLogicalType('bool'), 'Boolean');
  assert.strictEqual(toLogicalType('boolean'), 'Boolean');

  // Temporal
  assert.strictEqual(toLogicalType('timestamp with time zone'), 'DateTime');
  assert.strictEqual(toLogicalType('timestamptz'), 'DateTime');
  assert.strictEqual(toLogicalType('datetime'), 'DateTime');
  assert.strictEqual(toLogicalType('date'), 'Date');
  assert.strictEqual(toLogicalType('time'), 'Time');

  // Others
  assert.strictEqual(toLogicalType('json'), 'JSON');
  assert.strictEqual(toLogicalType('jsonb'), 'JSON');
  assert.strictEqual(toLogicalType('uuid'), 'UUID');
  assert.strictEqual(toLogicalType('bytea'), 'Binary');
  assert.strictEqual(toLogicalType('blob'), 'Binary');
});

test('getVisibleColumns filters and transforms columns according to diagram level', () => {
  const table = {
    name: 'order_items',
    columns: [
      { name: 'id', type: 'bigint', pk: true },
      { name: 'order_id', type: 'bigint', fk: true },
      { name: 'product_id', type: 'bigint', fk: true },
      { name: 'quantity', type: 'integer' },
      { name: 'unit_price', type: 'numeric(10,2)' },
      { name: 'is_gift', type: 'boolean' },
      { name: 'created_at', type: 'timestamptz' },
    ],
  };

  // Physical: exact copy
  const physicalCols = getVisibleColumns(table, 'physical');
  assert.strictEqual(physicalCols.length, 7);
  assert.strictEqual(physicalCols[0].type, 'bigint');
  assert.strictEqual(physicalCols[1].name, 'order_id');
  assert.strictEqual(physicalCols[1].fk, true);

  // Logical: all columns present, types simplified
  const logicalCols = getVisibleColumns(table, 'logical');
  assert.strictEqual(logicalCols.length, 7);
  assert.strictEqual(logicalCols[0].type, 'BigInt');
  assert.strictEqual(logicalCols[3].type, 'Integer');
  assert.strictEqual(logicalCols[4].type, 'Decimal');
  assert.strictEqual(logicalCols[5].type, 'Boolean');
  assert.strictEqual(logicalCols[6].type, 'DateTime');
  assert.strictEqual(logicalCols[1].fk, true);

  // Conceptual: pure FKs (order_id, product_id) hidden, types omitted
  const conceptualCols = getVisibleColumns(table, 'conceptual');
  assert.strictEqual(conceptualCols.length, 5); // id, quantity, unit_price, is_gift, created_at
  assert.deepStrictEqual(conceptualCols.map(c => c.name), ['id', 'quantity', 'unit_price', 'is_gift', 'created_at']);
  assert.strictEqual(conceptualCols[0].pk, true);
  assert.strictEqual(conceptualCols[0].type, '');
  assert.strictEqual(conceptualCols[1].type, '');
});

test('measureTable calculates appropriate dimensions per level', () => {
  const table = {
    name: 'orders',
    columns: [
      { name: 'id', type: 'bigint', pk: true },
      { name: 'user_id', type: 'bigint', fk: true },
      { name: 'status', type: 'varchar(50)' },
      { name: 'total_amount', type: 'numeric(12,2)' },
    ],
  };

  const phys = measureTable(table, 'physical');
  const logi = measureTable(table, 'logical');
  const conc = measureTable(table, 'conceptual');

  assert.strictEqual(phys.h, 34 + 4 * 26);
  assert.strictEqual(logi.h, 34 + 4 * 26);
  // In conceptual, user_id (pure FK) is omitted -> 3 rows
  assert.strictEqual(conc.h, 34 + 3 * 26);
  assert.ok(conc.h < phys.h, 'Conceptual height is shorter due to hidden FKs');
});

test('columnY distributes anchors in conceptual mode and matches visible rows in logical/physical', () => {
  const table = {
    name: 'orders',
    w: 200,
    h: 112,
    columns: [
      { name: 'id', type: 'bigint', pk: true },
      { name: 'user_id', type: 'bigint', fk: true },
      { name: 'status', type: 'varchar(50)' },
    ],
  };

  const yPhys = columnY(table, 'user_id', 'physical');
  assert.strictEqual(yPhys, 34 + 1 * 26 + 13); // 2nd row (index 1)

  // In conceptual, distributes along entity lateral boundary
  const yConc0 = columnY(table, null, 'conceptual', 0, 2);
  const yConc1 = columnY(table, null, 'conceptual', 1, 2);
  assert.ok(yConc0 > 16 && yConc0 < table.h);
  assert.ok(yConc1 > yConc0 && yConc1 < table.h);
});

test('vertical centering formula preserves entity center when switching levels', () => {
  const table = {
    name: 'order_items',
    x: 100,
    y: 200,
    columns: [
      { name: 'id', type: 'bigint', pk: true },
      { name: 'order_id', type: 'bigint', fk: true },
      { name: 'product_id', type: 'bigint', fk: true },
      { name: 'quantity', type: 'integer' },
    ],
  };

  const physDims = measureTable(table, 'physical');
  table.w = physDims.w;
  table.h = physDims.h;
  const initialCenterY = table.y + table.h / 2;

  // Switch to conceptual
  const concDims = measureTable(table, 'conceptual');
  const oldH = table.h;
  table.w = concDims.w;
  table.h = concDims.h;
  table.y = Math.round(table.y + (oldH - table.h) / 2);

  const conceptualCenterY = table.y + table.h / 2;
  assert.strictEqual(Math.round(conceptualCenterY), Math.round(initialCenterY), 'Center Y remains unchanged after switching to conceptual');

  // Switch back to physical
  const backDims = measureTable(table, 'physical');
  const concH = table.h;
  table.w = backDims.w;
  table.h = backDims.h;
  table.y = Math.round(table.y + (concH - table.h) / 2);

  const backCenterY = table.y + table.h / 2;
  assert.strictEqual(Math.round(backCenterY), Math.round(initialCenterY), 'Center Y returns to original after switching back to physical');
  assert.strictEqual(table.y, 200, 'Original Y is restored');
});

test('exportSVG reflects diagramLevel faithfully', () => {
  const model = {
    tables: [
      {
        name: 'users',
        key: 'users',
        x: 50,
        y: 50,
        w: 200,
        h: 112,
        columns: [
          { name: 'id', type: 'bigint', pk: true },
          { name: 'email', type: 'varchar(255)' },
          { name: 'created_at', type: 'timestamptz' },
        ],
      },
      {
        name: 'posts',
        key: 'posts',
        x: 350,
        y: 50,
        w: 200,
        h: 138,
        columns: [
          { name: 'id', type: 'bigint', pk: true },
          { name: 'author_id', type: 'bigint', fk: true },
          { name: 'title', type: 'varchar(120)' },
          { name: 'published', type: 'boolean' },
        ],
      },
    ],
    relations: [
      { fromTable: 'posts', fromCols: ['author_id'], toTable: 'users', toCols: ['id'] },
    ],
  };

  // Physical SVG: contains exact native types and FK badge
  const svgPhys = exportSVG(model, 'dark', [], null, 'multi', null, 'curved', null, null, null, 'physical');
  assert.ok(svgPhys.includes('varchar(255)'), 'Physical SVG contains native varchar');
  assert.ok(svgPhys.includes('timestamptz'), 'Physical SVG contains native timestamptz');
  assert.ok(svgPhys.includes('FK'), 'Physical SVG contains FK badge');

  // Logical SVG: contains normalized logical types (String, DateTime, Boolean) and FK badge
  const svgLogi = exportSVG(model, 'dark', [], null, 'multi', null, 'curved', null, null, null, 'logical');
  assert.ok(svgLogi.includes('String'), 'Logical SVG contains String');
  assert.ok(svgLogi.includes('DateTime'), 'Logical SVG contains DateTime');
  assert.ok(svgLogi.includes('Boolean'), 'Logical SVG contains Boolean');
  assert.ok(svgLogi.includes('FK'), 'Logical SVG contains FK badge');

  // Conceptual SVG: hides pure FK (author_id) and hides all types
  const svgConc = exportSVG(model, 'dark', [], null, 'multi', null, 'curved', null, null, null, 'conceptual');
  assert.ok(!svgConc.includes('author_id'), 'Conceptual SVG hides pure FK author_id');
  assert.ok(!svgConc.includes('varchar'), 'Conceptual SVG has no varchar');
  assert.ok(!svgConc.includes('FK'), 'Conceptual SVG hides FK badge');
  assert.ok(svgConc.includes('PK'), 'Conceptual SVG retains PK badge');
});
