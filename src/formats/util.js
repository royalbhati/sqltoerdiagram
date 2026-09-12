// Shared helpers for the non-SQL schema parsers (Prisma / SQLAlchemy / Sequelize).
// Each parser builds a list of tables + raw relations, then finalize() resolves
// them into the same normalized shape the diagram consumes (no source spans —
// these formats are parse-only / view-only).

export function makeTable(name) {
  return { name, key: name.toLowerCase(), columns: [], colIndex: new Map(), colRefs: [], nameSpan: null, bodySpan: null, stmtSpan: null };
}

export function addColumn(table, col) {
  if (!col.name) return;
  const c = {
    name: col.name,
    type: col.type || '',
    typeRaw: col.type || '',
    pk: !!col.pk,
    nn: !!col.nn,
    unique: !!col.unique,
    fk: false,
    nameSpan: col.nameSpan || null,
    typeSpan: col.typeSpan || null,
    defSpan: col.defSpan || null,
    settingsSpan: col.settingsSpan || null,
  };
  table.columns.push(c);
  table.colIndex.set(col.name.toLowerCase(), c);
}

// rels: [{ fromTable, fromCols, toTable, toCols }]  (names, not keys)
export function finalize(tables, rels, groups = []) {
  const byKey = new Map(tables.map((t) => [t.key, t]));
  const resolved = [];
  const seen = new Set();
  for (const r of rels) {
    const from = byKey.get((r.fromTable || '').toLowerCase());
    const fromName = from ? from.name : r.fromTable;
    const to = byKey.get((r.toTable || '').toLowerCase());
    if (from) {
      for (const c of r.fromCols || []) {
        const col = from.colIndex.get((c || '').toLowerCase());
        if (col) col.fk = true;
      }
    }
    const fromKey = (r.fromTable || '').toLowerCase();
    const key = `${fromKey}.${(r.fromCols || [])[0] || ''}->${(r.toTable || '').toLowerCase()}.${(r.toCols || [])[0] || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({
      fromTable: fromName,
      fromCols: r.fromCols || [],
      toTable: to ? to.name : r.toTable,
      toCols: r.toCols || [],
      toMissing: !to,
      fromMissing: !from,
      refSpan: r.refSpan || null,
      stmtSpan: r.stmtSpan || null,
      fromTableSpan: r.fromTableSpan || null,
      fromColSpan: r.fromColSpan || null,
      toTableSpan: r.toTableSpan || null,
      toColSpan: r.toColSpan || null,
    });
  }
  return { tables, relations: resolved, errors: [], groups: groups || [] };
}

// Return [innerStart, innerEnd, afterClose] for the bracket group whose opening
// bracket is the first `open` at or after `from`. Respects strings & nesting.
export function balanced(text, from, open, close) {
  let i = text.indexOf(open, from);
  if (i < 0) return null;
  const start = i + 1;
  let depth = 0, q = null;
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === q && text[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return [start, i, i + 1]; }
  }
  return null;
}

// split on top-level commas (respecting (), [], {}, strings)
export function splitTopCommas(s) {
  const parts = [];
  let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q && s[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}
