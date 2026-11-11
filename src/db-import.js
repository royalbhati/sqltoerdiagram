// "Import from a live database" without a backend: the user runs ONE read-only
// query in their own SQL client, pastes the result here, and we turn it into
// CREATE TABLE statements for the editor. The query only reads the catalog
// (table / column / key names) — never row data — and nothing leaves the page.

const PG = `-- PostgreSQL: run in psql, DBeaver, pgAdmin… then copy the single result cell
SELECT json_build_object(
  'columns', (
    SELECT coalesce(json_agg(json_build_object(
      'schema', c.table_schema, 'table', c.table_name, 'name', c.column_name,
      'type', CASE
        WHEN c.data_type = 'ARRAY' THEN ltrim(c.udt_name, '_') || '[]'
        WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name
        WHEN c.character_maximum_length IS NOT NULL THEN c.data_type || '(' || c.character_maximum_length || ')'
        WHEN c.data_type = 'numeric' AND c.numeric_precision IS NOT NULL THEN 'numeric(' || c.numeric_precision || ',' || c.numeric_scale || ')'
        ELSE c.data_type END,
      'nullable', c.is_nullable = 'YES'
    ) ORDER BY c.table_schema, c.table_name, c.ordinal_position), '[]'::json)
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
  ),
  'keys', (
    SELECT coalesce(json_agg(json_build_object(
      'schema', n.nspname, 'table', cl.relname, 'constraint', con.conname,
      'type', CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' ELSE 'UNIQUE' END,
      'column', a.attname
    ) ORDER BY n.nspname, cl.relname, con.conname, u.ord), '[]'::json)
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum
    WHERE con.contype IN ('p', 'u') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  ),
  'fks', (
    SELECT coalesce(json_agg(json_build_object(
      'schema', n.nspname, 'table', cl.relname, 'constraint', con.conname, 'column', a.attname,
      'ref_schema', fn.nspname, 'ref_table', fcl.relname, 'ref_column', fa.attname
    ) ORDER BY n.nspname, cl.relname, con.conname, u.ord), '[]'::json)
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    JOIN pg_class fcl ON fcl.oid = con.confrelid
    JOIN pg_namespace fn ON fn.oid = fcl.relnamespace
    CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(attnum, fattnum, ord)
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum
    JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = u.fattnum
    WHERE con.contype = 'f' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  )
) AS schema_json;`;

const MYSQL = `-- MySQL 8 / MariaDB 10.5+: run against the database you want, copy the single result cell
SELECT JSON_OBJECT(
  'columns', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'table', c.TABLE_NAME, 'name', c.COLUMN_NAME, 'type', c.COLUMN_TYPE,
      'nullable', c.IS_NULLABLE = 'YES', 'pos', c.ORDINAL_POSITION, 'comment', c.COLUMN_COMMENT))
    FROM information_schema.COLUMNS c
    JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
    WHERE c.TABLE_SCHEMA = DATABASE()
  ),
  'keys', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'table', tc.TABLE_NAME, 'constraint', tc.CONSTRAINT_NAME, 'type', tc.CONSTRAINT_TYPE,
      'column', k.COLUMN_NAME, 'pos', k.ORDINAL_POSITION))
    FROM information_schema.TABLE_CONSTRAINTS tc
    JOIN information_schema.KEY_COLUMN_USAGE k
      ON k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_NAME = tc.TABLE_NAME
    WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
  ),
  'fks', (
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'table', k.TABLE_NAME, 'constraint', k.CONSTRAINT_NAME, 'column', k.COLUMN_NAME,
      'ref_table', k.REFERENCED_TABLE_NAME, 'ref_column', k.REFERENCED_COLUMN_NAME, 'pos', k.ORDINAL_POSITION))
    FROM information_schema.KEY_COLUMN_USAGE k
    WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
  )
) AS schema_json;`;

const SQLITE = `-- SQLite: run in the sqlite3 shell (or any client) and copy all the output.
-- SQLite stores each table's original CREATE statement, so this returns SQL directly.
SELECT sql || ';' FROM sqlite_master
WHERE sql IS NOT NULL AND type IN ('table', 'index') AND name NOT LIKE 'sqlite_%';`;

const MSSQL = `-- SQL Server 2016+: run in SSMS / Azure Data Studio and copy the single result cell.
-- (In SSMS, click the result link to open the full JSON — the grid truncates long text.)
SELECT
  (SELECT c.TABLE_SCHEMA AS [schema], c.TABLE_NAME AS [table], c.COLUMN_NAME AS [name],
          c.DATA_TYPE + CASE
            WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN '(max)'
            WHEN c.CHARACTER_MAXIMUM_LENGTH IS NOT NULL THEN '(' + CAST(c.CHARACTER_MAXIMUM_LENGTH AS varchar(10)) + ')'
            WHEN c.DATA_TYPE IN ('decimal', 'numeric') THEN '(' + CAST(c.NUMERIC_PRECISION AS varchar(10)) + ',' + CAST(c.NUMERIC_SCALE AS varchar(10)) + ')'
            ELSE '' END AS [type],
          CAST(CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS bit) AS [nullable], c.ORDINAL_POSITION AS [pos]
   FROM INFORMATION_SCHEMA.COLUMNS c
   JOIN INFORMATION_SCHEMA.TABLES t
     ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
   FOR JSON PATH) AS [columns],
  (SELECT tc.TABLE_SCHEMA AS [schema], tc.TABLE_NAME AS [table], tc.CONSTRAINT_NAME AS [constraint],
          tc.CONSTRAINT_TYPE AS [type], k.COLUMN_NAME AS [column], k.ORDINAL_POSITION AS [pos]
   FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
   JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
     ON k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
   WHERE tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
   FOR JSON PATH) AS [keys],
  (SELECT SCHEMA_NAME(pt.schema_id) AS [schema], pt.name AS [table], fk.name AS [constraint], pc.name AS [column],
          SCHEMA_NAME(rt.schema_id) AS [ref_schema], rt.name AS [ref_table], rc.name AS [ref_column],
          fkc.constraint_column_id AS [pos]
   FROM sys.foreign_keys fk
   JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
   JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
   JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
   JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
   JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
   FOR JSON PATH) AS [fks]
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;`;

export const DB_SOURCES = {
  postgres: { label: 'PostgreSQL', query: PG, dialect: 'postgres', quote: (s) => (/^[a-z_][a-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`) },
  mysql: { label: 'MySQL / MariaDB', query: MYSQL, dialect: 'mysql', quote: (s) => '`' + s.replace(/`/g, '``') + '`' },
  sqlite: { label: 'SQLite', query: SQLITE, dialect: 'sqlite', quote: (s) => `"${s}"` },
  sqlserver: { label: 'SQL Server', query: MSSQL, dialect: 'sqlserver', quote: (s) => `[${s.replace(/]/g, ']]')}]` },
};

// Pull the JSON object out of whatever the client printed around it (column
// headers, "(1 row)", quoting of a CSV/grid cell).
function extractJSON(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let raw = text.slice(a, b + 1);
  try { return JSON.parse(raw); } catch { /* try CSV-style doubled quotes next */ }
  try { return JSON.parse(raw.replace(/""/g, '"')); } catch { return null; }
}
const arr = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
};
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

// Turn the pasted query result into CREATE TABLE SQL for the editor.
// Returns { sql, tables } or throws an Error with a message fit to show the user.
export function importToSQL(text, source) {
  const src = DB_SOURCES[source];
  if (!src) throw new Error('Unknown database type');
  if (!text.trim()) throw new Error('Paste the query result first');
  // SQLite's query returns DDL; so might anyone who pasted a dump by mistake
  if (/^\s*create\s+(table|index|unique)/im.test(text) && text.indexOf('"columns"') < 0) {
    return { sql: text.trim() + '\n', tables: (text.match(/create\s+table/gi) || []).length };
  }
  const data = extractJSON(text);
  if (!data) throw new Error('That doesn’t look like the query’s result — copy the whole JSON cell, from the first { to the last }');
  const columns = arr(data.columns);
  if (!columns.length) throw new Error('The result has no columns in it — is the database empty, or was only part of the cell copied?');
  const keys = arr(data.keys), fks = arr(data.fks);
  const q = src.quote;

  // qualify with the schema only when the same table name exists in two schemas
  const seen = new Map();
  for (const c of columns) {
    const s = seen.get(c.table) || new Set(); s.add(c.schema || ''); seen.set(c.table, s);
  }
  const id = (schema, table) => `${schema || ''}\u0000${table}`;
  const name = (schema, table) => ((seen.get(table) || new Set()).size > 1 && schema ? `${q(schema)}.${q(table)}` : q(table));

  const byPos = (a, b) => (a.pos || 0) - (b.pos || 0);
  const tables = new Map();
  for (const c of columns.slice().sort((a, b) => (id(a.schema, a.table) === id(b.schema, b.table) ? byPos(a, b) : 0))) {
    const k = id(c.schema, c.table);
    if (!tables.has(k)) tables.set(k, { schema: c.schema, table: c.table, cols: [], pk: [], uniques: new Map(), fks: new Map() });
    tables.get(k).cols.push(c);
  }
  for (const key of keys.slice().sort(byPos)) {
    const t = tables.get(id(key.schema, key.table));
    if (!t) continue;
    if (/primary/i.test(key.type)) t.pk.push(key.column);
    else { const u = t.uniques.get(key.constraint) || []; u.push(key.column); t.uniques.set(key.constraint, u); }
  }
  for (const f of fks.slice().sort(byPos)) {
    const t = tables.get(id(f.schema, f.table));
    if (!t) continue;
    const e = t.fks.get(f.constraint) || { cols: [], refSchema: f.ref_schema, refTable: f.ref_table, refCols: [] };
    e.cols.push(f.column); e.refCols.push(f.ref_column);
    t.fks.set(f.constraint, e);
  }

  const out = [];
  for (const t of tables.values()) {
    const lines = t.cols.map((c) => {
      let s = `  ${q(c.name)} ${c.type || 'text'}`;
      if (!truthy(c.nullable) && c.nullable !== undefined) s += ' NOT NULL';
      if (c.comment && source === 'mysql') s += ` COMMENT '${String(c.comment).replace(/'/g, "''")}'`;
      return s;
    });
    if (t.pk.length) lines.push(`  PRIMARY KEY (${t.pk.map(q).join(', ')})`);
    for (const cols of t.uniques.values()) lines.push(`  UNIQUE (${cols.map(q).join(', ')})`);
    for (const f of t.fks.values()) {
      lines.push(`  FOREIGN KEY (${f.cols.map(q).join(', ')}) REFERENCES ${name(f.refSchema, f.refTable)} (${f.refCols.map(q).join(', ')})`);
    }
    out.push(`CREATE TABLE ${name(t.schema, t.table)} (\n${lines.join(',\n')}\n);`);
  }
  return { sql: out.join('\n\n') + '\n', tables: tables.size };
}
