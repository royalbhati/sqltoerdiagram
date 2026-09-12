import test from 'node:test';
import assert from 'node:assert';
import { parseSchema } from '../src/parse.js';
import { parseDBML } from '../src/formats/dbml.js';
import {
  applyEdit,
  addColumn,
  deleteColumn,
  toggleConstraint,
  addTable,
  deleteTable,
  addRelation,
} from '../src/edit.js';

test('parseDBML records accurate spans for tables, columns, types, and relations', () => {
  const dbml = `// Database schema
Table users {
  id integer [pk, increment]
  username varchar(50) [unique, not null]
  bio text
}

Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
}

Ref: orders.id > order_items.order_id
`;

  const model = parseDBML(dbml);
  assert.strictEqual(model.tables.length, 2);

  const users = model.tables.find(t => t.name === 'users');
  assert.ok(users, 'users table found');
  assert.ok(users.nameSpan, 'users table has nameSpan');
  assert.strictEqual(dbml.slice(users.nameSpan[0], users.nameSpan[1]), 'users');

  const usernameCol = users.columns.find(c => c.name === 'username');
  assert.ok(usernameCol, 'username column found');
  assert.ok(usernameCol.nameSpan, 'username has nameSpan');
  assert.strictEqual(dbml.slice(usernameCol.nameSpan[0], usernameCol.nameSpan[1]), 'username');
  assert.ok(usernameCol.typeSpan, 'username has typeSpan');
  assert.strictEqual(dbml.slice(usernameCol.typeSpan[0], usernameCol.typeSpan[1]), 'varchar(50)');
  assert.ok(usernameCol.unique, 'username is unique');
  assert.ok(usernameCol.nn, 'username is not null');

  // Check inline ref relation
  const inlineRel = model.relations.find(r => r.fromTable === 'orders' && r.toTable === 'users');
  assert.ok(inlineRel, 'inline relation orders.user_id -> users.id found');
  assert.ok(inlineRel.toTableSpan, 'inline rel has toTableSpan');
  assert.strictEqual(dbml.slice(inlineRel.toTableSpan[0], inlineRel.toTableSpan[1]), 'users');

  // Check standalone ref relation
  const standaloneRel = model.relations.find(r => r.fromTable === 'orders' && r.toTable === 'order_items');
  assert.ok(standaloneRel, 'standalone relation orders.id -> order_items.order_id found');
  assert.ok(standaloneRel.fromTableSpan, 'standalone rel has fromTableSpan');
  assert.strictEqual(dbml.slice(standaloneRel.fromTableSpan[0], standaloneRel.fromTableSpan[1]), 'orders');
  assert.ok(standaloneRel.toTableSpan, 'standalone rel has toTableSpan');
  assert.strictEqual(dbml.slice(standaloneRel.toTableSpan[0], standaloneRel.toTableSpan[1]), 'order_items');
});

test('applyEdit renames DBML table and updates relations surgical spans', () => {
  const dbml = `Table users {
  id integer [pk]
}

Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
}

Ref: orders.id > users.id
`;

  const model = parseSchema(dbml, 'dbml');
  assert.strictEqual(model.editable, true, 'DBML model is marked editable');

  const res = applyEdit(dbml, model, { kind: 'table', tableKey: 'users', value: 'accounts' });
  assert.ok(res, 'applyEdit succeeded');
  assert.strictEqual(res.newKey, 'accounts');

  // Verify Table header renamed
  assert.ok(res.sql.includes('Table accounts {'));
  assert.ok(!res.sql.includes('Table users {'));

  // Verify inline ref renamed
  assert.ok(res.sql.includes('[ref: > accounts.id]'));

  // Verify standalone Ref renamed
  assert.ok(res.sql.includes('Ref: orders.id > accounts.id'));
});

test('applyEdit renames DBML column and updates column types', () => {
  const dbml = `Table users {
  id integer [pk]
  email varchar
}

Ref: orders.user_id > users.id
`;

  const model = parseSchema(dbml, 'dbml');

  // Rename column
  const renameRes = applyEdit(dbml, model, { kind: 'column-name', tableKey: 'users', colName: 'id', value: 'user_id' });
  assert.ok(renameRes);
  assert.ok(renameRes.sql.includes('user_id integer [pk]'));
  assert.ok(renameRes.sql.includes('Ref: orders.user_id > users.user_id'));

  // Change type
  const typeRes = applyEdit(dbml, model, { kind: 'column-type', tableKey: 'users', colName: 'email', value: 'text' });
  assert.ok(typeRes);
  assert.ok(typeRes.sql.includes('email text'));
});

test('addColumn in DBML preserves clean indentation without commas', () => {
  const dbml = `Table users {
  id integer [pk]
}`;

  const model = parseSchema(dbml, 'dbml');
  const res = addColumn(dbml, model, 'users', 'created_at', 'timestamp');
  assert.ok(res);
  assert.strictEqual(res.colName, 'created_at');
  assert.ok(!res.sql.includes(','), 'DBML column addition must not contain commas');
  assert.ok(res.sql.includes('  id integer [pk]\n  created_at timestamp\n}'));
});

test('deleteColumn in DBML removes the column line cleanly', () => {
  const dbml = `Table users {
  id integer [pk]
  temp_code varchar
  created_at timestamp
}`;

  const model = parseSchema(dbml, 'dbml');
  const res = deleteColumn(dbml, model, 'users', 'temp_code');
  assert.ok(res);
  assert.ok(!res.sql.includes('temp_code'));
  assert.ok(res.sql.includes('  id integer [pk]\n  created_at timestamp'));
});

test('toggleConstraint in DBML handles bracket settings correctly', () => {
  const dbml = `Table users {
  id integer
  email varchar [unique]
  bio text [not null]
}`;

  const model = parseSchema(dbml, 'dbml');

  // 1. Add [pk] to id (no bracket previously)
  const pkRes = toggleConstraint(dbml, model, 'users', 'id', 'pk', true);
  assert.ok(pkRes);
  assert.ok(pkRes.sql.includes('id integer [pk]'));

  // 2. Add not null to email (existing [unique])
  const emailRes = toggleConstraint(dbml, model, 'users', 'email', 'nn', true);
  assert.ok(emailRes);
  assert.ok(emailRes.sql.includes('email varchar [unique, not null]'));

  // 3. Remove unique from email
  const removeUniqueRes = toggleConstraint(dbml, model, 'users', 'email', 'unique', false);
  assert.ok(removeUniqueRes);
  assert.ok(removeUniqueRes.sql.includes('email varchar\n'));
  assert.ok(!removeUniqueRes.sql.includes('email varchar []'), 'Empty brackets should be removed cleanly');
});

test('addTable, deleteTable, and addRelation in DBML follow standard DBML format', () => {
  const dbml = `Table users {
  id integer [pk]
}`;

  const model = parseSchema(dbml, 'dbml');

  // 1. addTable
  const added = addTable(dbml, 'orders', 'integer', 'dbml');
  assert.ok(added);
  assert.ok(added.sql.includes('Table orders {\n  id integer [pk, increment]\n}'));

  // 2. addRelation
  const modelWithBoth = parseSchema(added.sql, 'dbml');
  const relRes = addRelation(added.sql, modelWithBoth, { table: 'orders', col: 'user_id' }, { table: 'users', col: 'id' }, 'dbml');
  assert.ok(relRes);
  assert.ok(relRes.sql.includes('Ref: orders.user_id > users.id'));

  // 3. deleteTable
  const deleted = deleteTable(added.sql, modelWithBoth, 'orders');
  assert.ok(deleted);
  assert.ok(!deleted.sql.includes('Table orders'));
  assert.ok(deleted.sql.includes('Table users'));
});
