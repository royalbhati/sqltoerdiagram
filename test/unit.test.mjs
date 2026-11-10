// Unit tests for the pure modules behind undo/redo, the command palette, the
// parse warnings and the layout core.  Run: node test/unit.test.mjs
import { createHistory } from '../src/history.js';
import { score, search } from '../src/palette.js';
import { parseSchema } from '../src/parser.js';
import { highlightSQL } from '../src/highlight.js';
import { layoutSized } from '../src/layout-core.js';
import { createStore, hashText } from '../src/store.js';
import { compareSchemas, describeDiff, migrationSQL } from '../src/diff.js';
import { toSQL, convertType } from '../src/formats/sql-out.js';
import { importToSQL, DB_SOURCES } from '../src/db-import.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

// ---- history ----
{
  const h = createHistory({ limit: 3, mergeMs: 1000 });
  const c = (v, kind, t) => h.commit(v, String(v), kind, t);
  ok(c('a', 'edit', 0) && !h.canUndo, 'first commit is the base (nothing to undo)');
  ok(!c('a', 'edit', 1), 'identical state is not recorded');
  c('b', 'edit', 2);
  ok(h.canUndo && h.undo() === 'a' && h.canRedo, 'undo returns the previous state');
  ok(h.redo() === 'b' && !h.canRedo, 'redo returns the undone state');
  h.undo(); c('c', 'edit', 3);
  ok(!h.canRedo && h.undo() === 'a', 'a new step discards the redo tail');
  h.redo();
  c('c1', 'type', 100); c('c2', 'type', 200); c('c3', 'type', 300);
  ok(h.undo() === 'c', 'a burst of typing undoes as one step');
  h.redo(); c('d', 'type', 5000);
  ok(h.undo() === 'c3', 'typing after a pause is its own step');
  c('x', 'type', 6000); c('c3', 'type', 6100);
  ok(h.size <= 3, 'history is capped at the limit');
  const g = createHistory();
  g.commit(1, '1', 'edit', 0); g.commit(2, '2', 'type', 10); g.commit(1, '1', 'type', 20);
  ok(!g.canUndo, 'typing back to the previous state leaves no step');
  ok(g.undo() === null && g.redo() === null, 'undo/redo at the ends return null');
}

// ---- palette ranking ----
{
  ok(score('us', 'users') > score('us', 'status'), 'prefix beats substring');
  ok(score('item', 'order_items') > score('item', 'limited_time'), 'word start beats mid-word');
  ok(score('oi', 'order_items') > 0 && score('zz', 'order_items') === 0, 'subsequence matches; non-match is 0');
  const tables = [
    { key: 'users', name: 'users', columns: [{ name: 'id', type: 'int' }, { name: 'email', type: 'text' }] },
    { key: 'orders', name: 'orders', columns: [{ name: 'id', type: 'int' }, { name: 'user_id', type: 'int' }] },
  ];
  const cmds = [{ id: 'fit', label: 'Fit diagram to screen' }, { id: 'undo', label: 'Undo' }];
  const r = search('user', tables, cmds);
  ok(r[0].kind === 'table' && r[0].table.key === 'users', 'the matching table ranks first');
  ok(r.some((x) => x.kind === 'column' && x.column.name === 'user_id'), 'columns are searched too');
  const dotted = search('orders.user', tables, cmds);
  ok(dotted.length === 1 && dotted[0].kind === 'column' && dotted[0].table.key === 'orders', 'table.column narrows to that table');
  ok(search('und', tables, cmds)[0].command.id === 'undo', 'commands are searchable');
  const empty = search('', tables, cmds);
  ok(empty.filter((x) => x.kind === 'table').length === 2 && empty.filter((x) => x.kind === 'command').length === 2, 'empty query lists tables then actions');
  ok(search('qqq', tables, cmds).length === 0, 'no match returns nothing');
}

// ---- parse warnings carry usable spans ----
{
  const sql = 'CREATE TABLE a (id int primary key, c_id int references zz(id));\nCREATE TABLE c AS SELECT 1;\nCREATE TABLE d (id int;';
  const m = parseSchema(sql);
  ok(m.tables.length === 1 && m.warnings.length === 3, 'one table read, three problems reported');
  ok(sql.slice(m.warnings[0].start, m.warnings[0].end) === 'zz', 'missing FK target points at the referenced name');
  ok(sql.slice(m.warnings[1].start, m.warnings[1].end) === 'CREATE TABLE c AS SELECT 1', 'CTAS warning spans the statement head');
  ok(/closing/.test(m.warnings[2].message), 'unbalanced parens are explained');
  ok(parseSchema('CREATE TABLE ok (id int);').warnings.length === 0, 'clean SQL has no warnings');
  const html = highlightSQL(sql, m.warnings);
  ok((html.match(/class="t-err"/g) || []).length === 3, 'each warning is underlined once');
  ok(html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') === sql, 'highlighting adds no characters');
}

// ---- layout core: pure, no overlaps, hidden tables skipped ----
{
  const tables = Array.from({ length: 40 }, (_, i) => ({ key: 't' + i, w: 180, h: 100 + (i % 5) * 26 }));
  const relations = tables.slice(1).map((t, i) => ({ fromTable: t.key, toTable: 't' + Math.floor(i / 3) }));
  layoutSized({ tables, relations }, { dir: 'LR', spacing: 'compact' }, new Set(['t39']));
  const shown = tables.filter((t) => t.key !== 't39');
  ok(shown.every((t) => Number.isFinite(t.x) && Number.isFinite(t.y)), 'every visible table gets a position');
  ok(!Number.isFinite(tables[39].x), 'hidden tables are not laid out');
  let overlap = false;
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    const a = shown[i], b = shown[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap = true;
  }
  ok(!overlap, 'no two tables overlap');
}

// ---- diagram store + version history ----
{
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const st = createStore(storage);
  ok(st.list().length === 1 && st.current.name === 'Untitled diagram', 'a first diagram exists by default');
  const first = st.currentId;
  const id = st.create('Shop', { sql: 'CREATE TABLE a (id int);' }, { tables: 1, hash: 'h1' });
  ok(id && st.list().length === 2 && st.currentId === first, 'create adds a diagram without opening it');
  const content = st.open(id, { sql: 'FIRST' });
  ok(content.sql === 'CREATE TABLE a (id int);' && st.currentId === id, 'open returns the stored content');
  ok(st.open(first, { sql: 'SHOP NOW' }).sql === 'FIRST', 'the diagram you left is parked and comes back intact');
  ok(st.create('Shop', null) && st.list().some((d) => d.name === 'Shop 2'), 'duplicate names get a number');
  ok(!st.remove(st.currentId), 'the open diagram cannot be removed');
  ok(st.remove(id) && !st.get(id), 'other diagrams can be removed');
  ok(st.rename(first, '  Billing  ') && st.current.name === 'Billing', 'rename trims');
  for (let i = 0; i < 45; i++) st.addVersion({ t: i + 1, auto: i !== 0, sql: 'x' + i });
  const vs = st.versions();
  ok(vs.length === 40 && vs[0].t === 45, 'versions are newest-first and capped');
  ok(vs.some((v) => v.t === 1), 'a named version outlives older automatic ones');
  st.removeVersion(45);
  ok(st.versions()[0].t === 44, 'a version can be deleted');
  ok(createStore(storage).current.name === 'Billing', 'the index persists');
  ok(hashText('a') !== hashText('b') && hashText('a') === hashText('a'), 'hash is stable');
}

// ---- schema diff + migration ----
{
  const a = parseSchema('CREATE TABLE users (id serial primary key, email varchar(255) not null, age int, bio text);\nCREATE TABLE old_t (id int);');
  const b = parseSchema('CREATE TABLE users (id serial primary key, email character varying(255) not null, age bigint not null, nick text);\nCREATE TABLE tags (id int primary key, user_id int references users(id));');
  const d = compareSchemas(a, b);
  const lines = describeDiff(d).map((x) => x.text);
  ok(lines.includes('New table tags (2 columns)') && lines.includes('Removed table old_t'), 'added and removed tables are reported');
  ok(lines.some((l) => /users: new column nick/.test(l)) && lines.some((l) => /users: removed column bio/.test(l)), 'added and removed columns are reported');
  ok(lines.some((l) => /users\.age: type int → bigint, now NOT NULL/.test(l)), 'type and nullability changes are reported');
  ok(!lines.some((l) => /users\.email/.test(l)), 'varchar vs character varying is not a change');
  const pg = migrationSQL(d, 'postgres');
  ok(/ALTER TABLE users ALTER COLUMN age TYPE bigint;/.test(pg) && /ALTER COLUMN age SET NOT NULL/.test(pg) && /DROP TABLE old_t;/.test(pg), 'postgres migration alters, then drops');
  ok(/ADD CONSTRAINT fk_tags_user_id FOREIGN KEY \(user_id\) REFERENCES users \(id\)/.test(pg), 'a new table brings its foreign key');
  ok(/MODIFY COLUMN `age` bigint NOT NULL/.test(migrationSQL(d, 'mysql')), 'mysql uses MODIFY COLUMN');
  ok(/cannot alter/.test(migrationSQL(d, 'sqlite')), 'sqlite says what it cannot do');
  ok(compareSchemas(a, a).isEmpty && /No schema changes/.test(migrationSQL(compareSchemas(a, a))), 'identical schemas produce no migration');
}

// ---- dialect conversion ----
{
  ok(convertType('serial', 'mysql') === 'int AUTO_INCREMENT' && convertType('jsonb', 'mysql') === 'json', 'postgres → mysql types');
  ok(convertType('tinyint(1)', 'postgres') === 'boolean' && convertType('datetime', 'postgres') === 'timestamp', 'mysql → postgres types');
  ok(convertType('character varying(40)', 'sqlserver') === 'nvarchar(40)' && convertType('uuid', 'sqlserver') === 'uniqueidentifier', 'postgres → sql server types');
  ok(convertType('geometry', 'mysql') === 'geometry' && convertType('text[]', 'mysql') === 'text[]', 'unknown types pass through untouched');
  const m = parseSchema('CREATE TABLE a (id int primary key);\nCREATE TABLE b (x int, y int, a_id int references a(id), primary key (x, y));');
  const back = parseSchema(toSQL(m, 'mysql'));
  ok(back.tables.length === 2 && back.relations.length === 1 && back.tables[1].columns.filter((c) => c.pk).length === 2, 'generated DDL parses back to the same shape');
  ok(/FOREIGN KEY \(a_id\) REFERENCES a \(id\)\n\);/.test(toSQL(m, 'sqlite')), 'sqlite keeps foreign keys inside CREATE TABLE');
}

// ---- database import ----
{
  const json = JSON.stringify({
    columns: [{ schema: 'public', table: 'users', name: 'id', type: 'integer', nullable: false }, { schema: 'public', table: 'users', name: 'email', type: 'text', nullable: true },
      { schema: 'public', table: 'orders', name: 'id', type: 'bigint', nullable: false }, { schema: 'public', table: 'orders', name: 'user_id', type: 'integer', nullable: false }],
    keys: [{ schema: 'public', table: 'users', constraint: 'users_pkey', type: 'PRIMARY KEY', column: 'id' }],
    fks: [{ schema: 'public', table: 'orders', constraint: 'o_fk', column: 'user_id', ref_schema: 'public', ref_table: 'users', ref_column: 'id' }],
  });
  const r = importToSQL(' schema_json\n-----\n ' + json + '\n(1 row)\n', 'postgres');
  const m = parseSchema(r.sql);
  ok(r.tables === 2 && m.tables.length === 2 && m.relations.length === 1 && m.warnings.length === 0, 'a pasted psql result becomes a clean schema');
  ok(m.tables.find((t) => t.key === 'users').columns[0].pk, 'primary keys survive the import');
  let msg = '';
  try { importToSQL('hello', 'postgres'); } catch (e) { msg = e.message; }
  ok(/look like/.test(msg), 'a bad paste gets a helpful error');
  ok(importToSQL('CREATE TABLE a(id integer);\nCREATE TABLE b(id integer);', 'sqlite').tables === 2, 'sqlite DDL output is accepted as-is');
  ok(Object.values(DB_SOURCES).every((s) => /SELECT/i.test(s.query) && !/\b(insert|update|delete|drop|alter|create)\b/i.test(s.query.replace(/--.*$/gm, '').replace(/'[^']*'/g, ''))), 'every import query is read-only');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
