// Compare two parsed schemas and produce (a) a human-readable change list and
// (b) migration SQL that turns the old one into the new one. Pure.
//
// Limits, stated in the generated script too: a rename is indistinguishable
// from a drop + add, so it is reported as one; dropped foreign keys need the
// constraint's real name, which the diagram doesn't know.
import { createTableSQL, addForeignKeySQL, convertType, classify } from './formats/sql-out.js';

const typeOf = (c) => (c.typeRaw || c.type || '').trim();
// "same type" across spellings: integer == int4, varchar(255) == character varying(255)
const sameType = (a, b) => {
  if (a.toLowerCase().replace(/\s+/g, '') === b.toLowerCase().replace(/\s+/g, '')) return true;
  const x = classify(a), y = classify(b);
  return x.kind !== 'unknown' && JSON.stringify(x) === JSON.stringify(y);
};
const relKey = (r) => `${r.fromTable}(${r.fromCols.join(',')})->${r.toTable}(${(r.toCols || []).join(',')})`.toLowerCase();

export function diffModels(oldM, newM) {
  const oldT = new Map(oldM.tables.map((t) => [t.key, t]));
  const newT = new Map(newM.tables.map((t) => [t.key, t]));
  const d = { addedTables: [], droppedTables: [], changedTables: [], addedRelations: [], droppedRelations: [] };

  for (const t of newM.tables) if (!oldT.has(t.key)) d.addedTables.push(t);
  for (const t of oldM.tables) if (!newT.has(t.key)) d.droppedTables.push(t);

  for (const nt of newM.tables) {
    const ot = oldT.get(nt.key);
    if (!ot) continue;
    const oc = new Map(ot.columns.map((c) => [c.name.toLowerCase(), c]));
    const nc = new Map(nt.columns.map((c) => [c.name.toLowerCase(), c]));
    const ch = { table: nt, added: [], dropped: [], changed: [] };
    for (const c of nt.columns) if (!oc.has(c.name.toLowerCase())) ch.added.push(c);
    for (const c of ot.columns) if (!nc.has(c.name.toLowerCase())) ch.dropped.push(c);
    for (const c of nt.columns) {
      const o = oc.get(c.name.toLowerCase());
      if (!o) continue;
      const what = [];
      if (!sameType(typeOf(o), typeOf(c))) what.push('type');
      if (!!o.nn !== !!c.nn && !c.pk && !o.pk) what.push('nullability');
      if (!!o.pk !== !!c.pk) what.push('pk');
      if (!!o.unique !== !!c.unique) what.push('unique');
      if (what.length) ch.changed.push({ from: o, to: c, what });
    }
    if (ch.added.length || ch.dropped.length || ch.changed.length) d.changedTables.push(ch);
  }

  // relations between tables that exist on both sides (new/dropped tables carry their own)
  const added = new Set(d.addedTables.map((t) => t.key)), dropped = new Set(d.droppedTables.map((t) => t.key));
  const oldR = new Map(oldM.relations.map((r) => [relKey(r), r]));
  const newR = new Map(newM.relations.map((r) => [relKey(r), r]));
  for (const [k, r] of newR) if (!oldR.has(k) && !r.toMissing) d.addedRelations.push(r);
  for (const [k, r] of oldR) if (!newR.has(k) && !dropped.has(r.fromTable.toLowerCase())) d.droppedRelations.push(r);
  d.addedRelations = d.addedRelations.filter((r) => !dropped.has(r.toTable.toLowerCase()));
  d._addedKeys = added;

  d.isEmpty = !d.addedTables.length && !d.droppedTables.length && !d.changedTables.length &&
    !d.addedRelations.length && !d.droppedRelations.length;
  return d;
}

// Plain-language change list: [{ kind: 'add' | 'drop' | 'change', text }]
export function describeDiff(d) {
  const out = [];
  for (const t of d.addedTables) out.push({ kind: 'add', text: `New table ${t.name} (${t.columns.length} column${t.columns.length !== 1 ? 's' : ''})` });
  for (const t of d.droppedTables) out.push({ kind: 'drop', text: `Removed table ${t.name}` });
  for (const ch of d.changedTables) {
    for (const c of ch.added) out.push({ kind: 'add', text: `${ch.table.name}: new column ${c.name} ${typeOf(c)}`.trimEnd() });
    for (const c of ch.dropped) out.push({ kind: 'drop', text: `${ch.table.name}: removed column ${c.name}` });
    for (const c of ch.changed) {
      const bits = [];
      if (c.what.includes('type')) bits.push(`type ${typeOf(c.from) || '(none)'} → ${typeOf(c.to) || '(none)'}`);
      if (c.what.includes('nullability')) bits.push(c.to.nn ? 'now NOT NULL' : 'now nullable');
      if (c.what.includes('pk')) bits.push(c.to.pk ? 'now part of the primary key' : 'no longer in the primary key');
      if (c.what.includes('unique')) bits.push(c.to.unique ? 'now UNIQUE' : 'no longer UNIQUE');
      out.push({ kind: 'change', text: `${ch.table.name}.${c.to.name}: ${bits.join(', ')}` });
    }
  }
  for (const r of d.addedRelations) out.push({ kind: 'add', text: `New foreign key ${r.fromTable}.${r.fromCols.join(',')} → ${r.toTable}` });
  for (const r of d.droppedRelations) out.push({ kind: 'drop', text: `Removed foreign key ${r.fromTable}.${r.fromCols.join(',')} → ${r.toTable}` });
  return out;
}

const Q = {
  postgres: (s) => (/^[A-Za-z_]\w*$/.test(s) ? s : `"${s}"`), sqlite: (s) => (/^[A-Za-z_]\w*$/.test(s) ? s : `"${s}"`),
  snowflake: (s) => (/^[A-Za-z_]\w*$/.test(s) ? s : `"${s}"`), mysql: (s) => '`' + s + '`', sqlserver: (s) => `[${s}]`,
};

// Migration script for `dialect` that applies the diff.
export function migrationSQL(d, dialect = 'postgres') {
  if (d.isEmpty) return '-- No schema changes.\n';
  const q = Q[dialect] || Q.postgres;
  const ty = (c) => convertType(typeOf(c), dialect);
  const L = ['-- Migration generated by sqltoerdiagram.com — review before running.',
    '-- A renamed table or column appears as a drop + add; rewrite those by hand to keep the data.', ''];

  for (const r of d.droppedRelations) {
    L.push(`-- Dropped foreign key ${r.fromTable}(${r.fromCols.join(', ')}) -> ${r.toTable}: look up its constraint name, then:`);
    L.push(dialect === 'mysql' ? `-- ALTER TABLE ${q(r.fromTable)} DROP FOREIGN KEY <constraint_name>;` : `-- ALTER TABLE ${q(r.fromTable)} DROP CONSTRAINT <constraint_name>;`);
  }
  for (const t of d.addedTables) L.push(createTableSQL(t, dialect), '');

  for (const ch of d.changedTables) {
    const T = q(ch.table.name);
    for (const c of ch.added) {
      L.push(`ALTER TABLE ${T} ADD ${dialect === 'sqlserver' ? '' : 'COLUMN '}${q(c.name)} ${ty(c)}${c.nn ? ' NOT NULL' : ''}${c.unique ? ' UNIQUE' : ''};` +
        (c.nn ? '  -- NOT NULL on a table with rows needs a DEFAULT or a backfill first' : ''));
    }
    for (const c of ch.changed) {
      const name = q(c.to.name), nn = c.to.nn ? ' NOT NULL' : '';
      const typeChanged = c.what.includes('type'), nullChanged = c.what.includes('nullability');
      if (dialect === 'sqlite') {
        if (typeChanged || nullChanged) L.push(`-- SQLite cannot alter ${ch.table.name}.${c.to.name} in place (${c.what.join(', ')}): recreate the table and copy the rows.`);
      } else if (dialect === 'mysql') {
        if (typeChanged || nullChanged) L.push(`ALTER TABLE ${T} MODIFY COLUMN ${name} ${ty(c.to)}${nn};`);
      } else if (dialect === 'sqlserver') {
        if (typeChanged || nullChanged) L.push(`ALTER TABLE ${T} ALTER COLUMN ${name} ${ty(c.to)}${c.to.nn ? ' NOT NULL' : ' NULL'};`);
      } else {
        if (typeChanged) L.push(`ALTER TABLE ${T} ALTER COLUMN ${name} ${dialect === 'snowflake' ? 'SET DATA TYPE' : 'TYPE'} ${ty(c.to)};`);
        if (nullChanged) L.push(`ALTER TABLE ${T} ALTER COLUMN ${name} ${c.to.nn ? 'SET' : 'DROP'} NOT NULL;`);
      }
      if (c.what.includes('unique') && c.to.unique) L.push(`ALTER TABLE ${T} ADD UNIQUE (${name});`);
      if (c.what.includes('unique') && !c.to.unique) L.push(`-- ${ch.table.name}.${c.to.name} is no longer UNIQUE: drop its unique constraint/index by name.`);
      if (c.what.includes('pk')) L.push(`-- Primary key of ${ch.table.name} changed (${c.to.name}): drop and re-create the PRIMARY KEY constraint.`);
    }
    for (const c of ch.dropped) L.push(`ALTER TABLE ${T} DROP COLUMN ${q(c.name)};`);
    L.push('');
  }

  // FKs of new tables + new FKs between existing tables
  const fks = [];
  for (const t of d.addedTables) for (const r of d._newModelRelations || []) if (r.fromTable.toLowerCase() === t.key && !r.toMissing) fks.push(r);
  for (const r of d.addedRelations) if (!d._addedKeys.has(r.fromTable.toLowerCase())) fks.push(r);
  for (const r of fks) {
    L.push(dialect === 'sqlite'
      ? `-- SQLite cannot add a foreign key to an existing table: ${r.fromTable}(${r.fromCols.join(', ')}) -> ${r.toTable}`
      : addForeignKeySQL(r, dialect));
  }
  if (fks.length) L.push('');
  for (const t of d.droppedTables) L.push(`DROP TABLE ${q(t.name)};`);
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// convenience: diff + keep the new model's relations for CREATE'd tables' FKs
export function compareSchemas(oldM, newM) {
  const d = diffModels(oldM, newM);
  d._newModelRelations = newM.relations;
  return d;
}
