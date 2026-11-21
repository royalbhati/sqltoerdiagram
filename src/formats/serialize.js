// Serialize the normalized model ({ tables, relations }) to text formats.
// Used by the Export menu and by the converter landing pages.
//
// Model shape (see formats/util.js):
//   table:  { name, key, columns:[{ name, type, pk, nn, unique, fk }] }
//   rel:    { fromTable, fromCols[], toTable, toCols[], toMissing }
// A relation means fromTable.fromCols references toTable.toCols (FK -> PK side).

const WORD = /^[A-Za-z_]\w*$/;

// ---- Mermaid erDiagram ----
function mmName(s) {
  return WORD.test(s) ? s : '"' + String(s).replace(/"/g, '') + '"';
}
function mmType(t) {
  if (!t) return 'unknown';
  // Mermaid attribute types must be a single token: collapse whitespace,
  // keep parens/commas so numeric(10,2) survives.
  return t.trim().replace(/\s+/g, '_').replace(/[^\w(),]/g, '') || 'unknown';
}
export function toMermaid(model) {
  const L = ['erDiagram'];
  for (const t of model.tables) {
    L.push('    ' + mmName(t.name) + ' {');
    for (const c of t.columns) {
      const keys = [];
      if (c.pk) keys.push('PK');
      if (c.fk) keys.push('FK');
      if (c.unique && !c.pk) keys.push('UK');
      L.push('        ' + mmType(c.type) + ' ' + mmName(c.name) + (keys.length ? ' ' + keys.join(',') : ''));
    }
    L.push('    }');
  }
  for (const r of model.relations) {
    if (r.toMissing) continue;
    const label = (r.fromCols && r.fromCols[0]) || 'fk';
    // parent (PK side) ||--o{ child (FK side)
    L.push('    ' + mmName(r.toTable) + ' ||--o{ ' + mmName(r.fromTable) + ' : ' + JSON.stringify(label));
  }
  return L.join('\n') + '\n';
}

// ---- DBML (dbdiagram.io) ----
// Names are written bare when DBML allows it and quoted otherwise.
const dbName = (s) => (/^[A-Za-z_]\w*$/.test(String(s)) ? String(s) : '"' + String(s).replace(/"/g, '') + '"');
const dbStr = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
function dbmlType(t) {
  if (!t) return 'unknown';
  const s = t.trim();
  // single-token types stay unquoted; anything with spaces gets quoted
  return /^[\w()[\],.]+$/.test(s) ? s : '"' + s.replace(/"/g, '') + '"';
}
// a column default as DBML: numbers / true / false / null bare, 'strings' kept, expressions in backticks
function dbmlDefault(d) {
  const v = String(d).trim();
  if (/^-?\d+(\.\d+)?$/.test(v) || /^(true|false|null)$/i.test(v)) return v.toLowerCase();
  const q = /^'((?:[^']|'')*)'(?:::[\w. "]+)?$/.exec(v);            // 'x' or 'x'::type
  if (q) return dbStr(q[1].replace(/''/g, "'"));
  return '`' + v.replace(/`/g, '') + '`';
}
// Keeps what DBML can express: enums, notes, defaults, composite keys,
// indexes and multi-column refs — not just names and types.
export function toDBML(model) {
  const L = [];
  for (const [name, values] of Object.entries(model.enums || {})) {
    L.push('Enum ' + dbName(name) + ' {');
    for (const v of values) L.push('  ' + dbName(v));
    L.push('}', '');
  }
  for (const t of model.tables) {
    const pks = t.columns.filter((c) => c.pk);
    const compositePk = pks.length > 1;
    L.push('Table ' + dbName(t.name) + ' {');
    for (const c of t.columns) {
      const set = [];
      if (c.pk && !compositePk) set.push('pk');
      if (c.increment) set.push('increment');
      if (c.unique && !c.pk) set.push('unique');
      if (c.nn && !(c.pk && !compositePk)) set.push('not null');
      if (c.default !== undefined && c.default !== '') set.push('default: ' + dbmlDefault(c.default));
      if (c.comment) set.push('note: ' + dbStr(c.comment));
      L.push('  ' + dbName(c.name) + ' ' + dbmlType(c.typeRaw || c.type) + (set.length ? ' [' + set.join(', ') + ']' : ''));
    }
    // indexes: the composite primary key, then named indexes grouped across their columns
    const idx = [];
    if (compositePk) idx.push('(' + pks.map((c) => dbName(c.name)).join(', ') + ') [pk]');
    const named = new Map();
    for (const c of t.columns) {
      for (const n of new Set(c.indexes || [])) {
        if (n === 'index' || n === 'unique index') idx.push(dbName(c.name) + (n === 'unique index' ? ' [unique]' : ''));
        else { if (!named.has(n)) named.set(n, []); named.get(n).push(c); }
      }
    }
    for (const [n, cols] of named) {
      const unique = cols.length === 1 && cols[0].unique;
      const target = cols.length > 1 ? '(' + cols.map((c) => dbName(c.name)).join(', ') + ')' : dbName(cols[0].name);
      idx.push(`${target} [${unique ? 'unique, ' : ''}name: ${dbStr(n)}]`);
    }
    if (idx.length) { L.push('', '  indexes {'); for (const i of idx) L.push('    ' + i); L.push('  }'); }
    if (t.comment) L.push('', '  Note: ' + dbStr(t.comment));
    L.push('}', '');
  }
  for (const r of model.relations) {
    if (r.toMissing) continue;
    const from = (r.fromCols || []).filter(Boolean), to = (r.toCols || []).filter(Boolean);
    if (!from.length || from.length !== to.length) continue;
    const side = (table, cols) => dbName(table) + '.' + (cols.length > 1 ? '(' + cols.map(dbName).join(', ') + ')' : dbName(cols[0]));
    L.push('Ref: ' + side(r.fromTable, from) + ' > ' + side(r.toTable, to));
  }
  for (const g of model.groups || []) {
    if (!g.tables || !g.tables.length) continue;
    L.push('', 'TableGroup ' + dbName(g.name) + ' {');
    for (const n of g.tables) L.push('  ' + dbName(n));
    L.push('}');
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---- PlantUML (entity / IE notation) ----
function puAlias(s, used) {
  let a = String(s).replace(/[^A-Za-z0-9_]/g, '_');
  if (!a || /^\d/.test(a)) a = 'e_' + a;
  let base = a, i = 2;
  while (used.has(a)) a = base + '_' + (i++);
  used.add(a);
  return a;
}
export function toPlantUML(model) {
  const L = ['@startuml', 'hide circle', 'skinparam linetype ortho', ''];
  const alias = new Map();
  const used = new Set();
  for (const t of model.tables) alias.set(t.key, puAlias(t.name, used));
  for (const t of model.tables) {
    L.push('entity ' + JSON.stringify(t.name) + ' as ' + alias.get(t.key) + ' {');
    const pks = t.columns.filter((c) => c.pk);
    const rest = t.columns.filter((c) => !c.pk);
    for (const c of pks) L.push('  * ' + c.name + ' : ' + (c.type || '') + ' <<PK>>');
    if (pks.length && rest.length) L.push('  --');
    for (const c of rest) L.push('  ' + c.name + ' : ' + (c.type || '') + (c.fk ? ' <<FK>>' : ''));
    L.push('}');
    L.push('');
  }
  for (const r of model.relations) {
    if (r.toMissing) continue;
    const a = alias.get((r.fromTable || '').toLowerCase());
    const b = alias.get((r.toTable || '').toLowerCase());
    if (!a || !b) continue;
    L.push(b + ' ||--o{ ' + a);
  }
  L.push('@enduml');
  return L.join('\n') + '\n';
}

// dispatcher used by the Export menu
export const SERIALIZERS = {
  mermaid: { label: 'Mermaid', ext: 'mmd', fn: toMermaid },
  dbml: { label: 'DBML', ext: 'dbml', fn: toDBML },
  plantuml: { label: 'PlantUML', ext: 'puml', fn: toPlantUML },
};

export function serialize(model, fmt) {
  const s = SERIALIZERS[fmt];
  return s ? s.fn(model) : '';
}
