// Turn a canvas edit into a surgical text edit on the original SQL, using the
// source spans recorded by the parser. Only the touched identifier(s) change —
// comments, formatting and unsupported clauses are preserved.

// change kinds:
//   { kind: 'table',       tableKey, value }
//   { kind: 'column-name', tableKey, colName, value }
//   { kind: 'column-type', tableKey, colName, value }
//
// Returns { sql, newKey } or null if nothing could be applied.
export function applyEdit(sql, model, change) {
  const isDbml = model && model.format === 'dbml';
  const table = model.tables.find(t => t.key === change.tableKey);
  if (!table) return null;
  const value = change.value;
  const splices = [];   // { start, end, text }
  let newKey = null;

  if (change.kind === 'table') {
    if (!table.nameSpan) return null;
    splices.push({ start: table.nameSpan[0], end: table.nameSpan[1], text: value });
    if (isDbml) {
      // update DBML relations (both Ref: and inline [ref: > ...])
      for (const r of model.relations || []) {
        if (r.toTable.toLowerCase() === change.tableKey && r.toTableSpan) {
          splices.push({ start: r.toTableSpan[0], end: r.toTableSpan[1], text: value });
        }
        if (r.fromTable.toLowerCase() === change.tableKey && r.fromTableSpan) {
          splices.push({ start: r.fromTableSpan[0], end: r.fromTableSpan[1], text: value });
        }
      }
    } else {
      // keep FK references to this table valid
      for (const r of model.relations) {
        if (r.refSpan && r.toTable.toLowerCase() === change.tableKey) {
          splices.push({ start: r.refSpan[0], end: r.refSpan[1], text: value });
        }
      }
    }
    newKey = value.toLowerCase();
  } else if (change.kind === 'column-name') {
    const col = table.columns.find(c => c.name === change.colName);
    if (!col || !col.nameSpan) return null;
    splices.push({ start: col.nameSpan[0], end: col.nameSpan[1], text: value });
    if (isDbml) {
      // update DBML relations referencing this column
      for (const r of model.relations || []) {
        if (r.fromTable.toLowerCase() === change.tableKey && r.fromCols?.includes(change.colName) && r.fromColSpan) {
          splices.push({ start: r.fromColSpan[0], end: r.fromColSpan[1], text: value });
        }
        if (r.toTable.toLowerCase() === change.tableKey && r.toCols?.includes(change.colName) && r.toColSpan) {
          splices.push({ start: r.toColSpan[0], end: r.toColSpan[1], text: value });
        }
      }
    } else {
      // table-level PK/FK/UNIQUE clauses that list this column
      const lc = change.colName.toLowerCase();
      for (const ref of table.colRefs || []) {
        if (ref.name === lc) splices.push({ start: ref.start, end: ref.end, text: value });
      }
    }
  } else if (change.kind === 'column-type') {
    const col = table.columns.find(c => c.name === change.colName);
    if (!col) return null;
    if (col.typeSpan) {
      splices.push({ start: col.typeSpan[0], end: col.typeSpan[1], text: value });
    } else if (col.nameSpan) {
      // no type present — insert one right after the column name
      splices.push({ start: col.nameSpan[1], end: col.nameSpan[1], text: ' ' + value });
    } else return null;
  } else {
    return null;
  }

  return { sql: applySplices(sql, splices), newKey };
}

// Insert a new column definition into a table's CREATE body, preserving the
// existing indentation style. Returns { sql, colName } or null.
export function addColumn(sql, model, tableKey, name, type) {
  const table = model.tables.find(t => t.key === tableKey);
  if (!table || !table.bodySpan) return null;
  const isDbml = model && model.format === 'dbml';
  const [bs, be] = table.bodySpan;
  const body = sql.slice(bs, be);

  // insertion point = just after the last non-whitespace char of the body
  let i = body.length;
  while (i > 0 && /\s/.test(body[i - 1])) i--;
  const insAt = bs + i;

  const multiline = body.includes('\n');
  // reuse the indentation of the line we're inserting after
  let indent = '  ';
  if (multiline) {
    const before = sql.slice(0, insAt);
    const lineStart = before.lastIndexOf('\n') + 1;
    const m = sql.slice(lineStart, insAt).match(/^\s*/);
    if (m && m[0]) indent = m[0];
  }

  if (isDbml) {
    const def = `${name} ${type}`;
    const sep = multiline ? `\n${indent}` : ' ';
    const out = sql.slice(0, insAt) + sep + def + sql.slice(insAt);
    return { sql: out, colName: name };
  }

  const hasCols = table.columns.length > 0;
  const def = `${name} ${type}`;
  let sep;
  if (hasCols) sep = multiline ? `,\n${indent}` : ', ';
  else sep = multiline ? `\n${indent}` : '';

  const out = sql.slice(0, insAt) + sep + def + sql.slice(insAt);
  return { sql: out, colName: name };
}

// Delete a column: remove its full definition segment plus one adjacent
// top-level comma (trailing if present, otherwise the leading one). Returns
// { sql } or null. Table-level PK/FK/UNIQUE clauses that name the column are
// left untouched — a re-parse simply drops any relation that no longer resolves.
export function deleteColumn(sql, model, tableKey, colName) {
  const table = model.tables.find(t => t.key === tableKey);
  const col = table && table.columns.find(c => c.name === colName);
  if (!col || !col.defSpan || !table.bodySpan) return null;
  const isDbml = model && model.format === 'dbml';
  const [bs, be] = table.bodySpan;
  let [s, e] = col.defSpan;

  if (isDbml) {
    // Delete line including newline
    if (e < sql.length && sql[e] === '\r') e++;
    if (e < sql.length && sql[e] === '\n') e++;
    else if (s > 0 && sql[s - 1] === '\n') {
      s--;
      if (s > 0 && sql[s - 1] === '\r') s--;
    }
    return { sql: sql.slice(0, s) + sql.slice(e) };
  }

  // trailing comma? (skip whitespace up to the body end)
  let i = e;
  while (i < be && /\s/.test(sql[i])) i++;
  if (i < be && sql[i] === ',') {
    e = i + 1;
  } else {
    // last item — eat the preceding comma (and the whitespace before it)
    let j = s;
    while (j > bs && /\s/.test(sql[j - 1])) j--;
    if (j > bs && sql[j - 1] === ',') s = j - 1;
  }
  return { sql: sql.slice(0, s) + sql.slice(e) };
}

// Toggle an inline column constraint. kind ∈ 'nn' | 'unique' | 'pk'.
// Returns { sql } or null when the constraint can't be toggled inline (e.g. it
// lives in a table-level clause, or adding a second PRIMARY KEY would be invalid).
const CONSTRAINTS = {
  nn: { rx: /\bnot\s+null\b/i, kw: 'NOT NULL' },
  unique: { rx: /\bunique\b/i, kw: 'UNIQUE' },
  pk: { rx: /\bprimary\s+key\b/i, kw: 'PRIMARY KEY' },
};
export function toggleConstraint(sql, model, tableKey, colName, kind, on) {
  const isDbml = model && model.format === 'dbml';
  const table = model.tables.find(t => t.key === tableKey);
  const col = table && table.columns.find(x => x.name === colName);
  if (!col || !col.defSpan) return null;

  if (isDbml) {
    const lineStart = col.defSpan[0];
    const lineEnd = col.defSpan[1];
    const colLine = sql.slice(lineStart, lineEnd);
    const brOpen = colLine.indexOf('[');
    const brClose = colLine.lastIndexOf(']');

    const kw = kind === 'pk' ? 'pk' : (kind === 'unique' ? 'unique' : 'not null');
    const rx = kind === 'pk' ? /\b(pk|primary\s+key)\b/i : (kind === 'unique' ? /\bunique\b/i : /\bnot\s+null\b/i);

    if (brOpen >= 0 && brClose > brOpen) {
      const settingsContent = colLine.slice(brOpen + 1, brClose);
      const items = settingsContent.split(',').map(s => s.trim()).filter(Boolean);
      const hasMatch = items.some(it => rx.test(it));

      if (on) {
        if (hasMatch) return { sql };
        if (kind === 'pk' && table.columns.some(x => x.pk)) return null;
        items.push(kw);
        const newBr = `[${items.join(', ')}]`;
        const updatedLine = colLine.slice(0, brOpen) + newBr + colLine.slice(brClose + 1);
        return { sql: sql.slice(0, lineStart) + updatedLine + sql.slice(lineEnd) };
      } else {
        if (!hasMatch) return { sql };
        const newItems = items.filter(it => !rx.test(it));
        if (newItems.length === 0) {
          let cutStart = brOpen;
          if (cutStart > 0 && colLine[cutStart - 1] === ' ') cutStart--;
          const updatedLine = colLine.slice(0, cutStart) + colLine.slice(brClose + 1);
          return { sql: sql.slice(0, lineStart) + updatedLine + sql.slice(lineEnd) };
        } else {
          const newBr = `[${newItems.join(', ')}]`;
          const updatedLine = colLine.slice(0, brOpen) + newBr + colLine.slice(brClose + 1);
          return { sql: sql.slice(0, lineStart) + updatedLine + sql.slice(lineEnd) };
        }
      }
    } else {
      if (on) {
        if (kind === 'pk' && table.columns.some(x => x.pk)) return null;
        let endIdx = colLine.length;
        while (endIdx > 0 && /\s/.test(colLine[endIdx - 1])) endIdx--;
        const updatedLine = colLine.slice(0, endIdx) + ` [${kw}]` + colLine.slice(endIdx);
        return { sql: sql.slice(0, lineStart) + updatedLine + sql.slice(lineEnd) };
      }
      return { sql };
    }
  }

  const c = CONSTRAINTS[kind];
  if (!c) return null;
  const [s, e] = col.defSpan;
  const def = sql.slice(s, e);
  const m = def.match(c.rx);
  if (on) {
    if (m) return { sql };                                  // already present — no-op
    if (kind === 'pk' && table.columns.some(x => x.pk)) return null;  // one PK only
    let at = col.typeSpan ? col.typeSpan[1] : (col.nameSpan ? col.nameSpan[1] : null);
    if (at == null) return null;
    return { sql: sql.slice(0, at) + ' ' + c.kw + sql.slice(at) };
  }
  // off: remove the inline keyword (+ one preceding space)
  if (!m) return null;                                       // not inline — can't toggle here
  let rs = s + m.index, re = rs + m[0].length;
  if (rs > s && sql[rs - 1] === ' ') rs--;
  return { sql: sql.slice(0, rs) + sql.slice(re) };
}

// Append a new empty table (single PK column). Returns { sql, tableKey }.
export function addTable(sql, name, idType = 'INTEGER', format = 'sql') {
  let block;
  if (format === 'dbml') {
    block = `Table ${name} {\n  id integer [pk, increment]\n}`;
  } else {
    block = `CREATE TABLE ${name} (\n  id ${idType} PRIMARY KEY\n);`;
  }
  let out = sql || '';
  if (out && !out.endsWith('\n')) out += '\n';
  if (out.trim()) out += '\n';
  out += block + '\n';
  return { sql: out, tableKey: name.toLowerCase() };
}

// Delete a whole CREATE TABLE statement (from the start of its line through the
// terminating ';' and one trailing newline). Inline FKs go with it; separate
// ALTER TABLE … ADD FOREIGN KEY statements referencing it are left as-is.
export function deleteTable(sql, model, tableKey) {
  const table = model.tables.find(t => t.key === tableKey);
  if (!table || !table.stmtSpan) return null;
  const isDbml = model && model.format === 'dbml';
  let [s, e] = table.stmtSpan;

  if (isDbml) {
    while (e < sql.length && sql[e] !== '\n') e++;
    if (sql[e] === '\n') e++;
    while (s > 0 && sql[s - 1] !== '\n') s--;
    return { sql: sql.slice(0, s) + sql.slice(e) };
  }

  let i = e;
  while (i < sql.length && sql[i] !== ';' && sql[i] !== '\n') i++;
  if (sql[i] === ';') i++;
  if (sql[i] === '\n') i++;
  e = i;
  while (s > 0 && sql[s - 1] !== '\n') s--;                 // back to start of line
  return { sql: sql.slice(0, s) + sql.slice(e) };
}

// Add a foreign-key relationship as an ALTER TABLE statement (leaves CREATE
// bodies untouched). from/to are { table: key, col: name }. Returns { sql }.
export function addRelation(sql, model, from, to, format = 'sql') {
  const fromT = model.tables.find(t => t.key === from.table);
  const toT = model.tables.find(t => t.key === to.table);
  if (!fromT || !toT) return null;

  let stmt;
  if (format === 'dbml' || (model && model.format === 'dbml')) {
    stmt = `Ref: ${fromT.name}.${from.col} > ${toT.name}.${to.col}`;
  } else {
    stmt = `ALTER TABLE ${fromT.name} ADD FOREIGN KEY (${from.col}) REFERENCES ${toT.name} (${to.col});`;
  }
  let out = sql || '';
  if (out && !out.endsWith('\n')) out += '\n';
  out += stmt + '\n';
  return { sql: out };
}

// Apply non-overlapping splices right-to-left so earlier offsets stay valid.
function applySplices(sql, splices) {
  const sorted = splices.slice().sort((a, b) => b.start - a.start);
  let out = sql;
  let lastStart = Infinity;
  for (const s of sorted) {
    if (s.end > lastStart) continue;   // skip accidental overlap
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
    lastStart = s.start;
  }
  return out;
}
