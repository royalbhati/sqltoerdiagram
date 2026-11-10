// SQL DDL parser — extracts tables, columns and foreign-key relations from
// CREATE TABLE / ALTER TABLE statements. Tolerant of MySQL, Postgres and
// SQL-Server-ish dialects (backticks, "quotes", [brackets], schema.qualified).
//
// It also records SOURCE SPANS (absolute character offsets into the original
// SQL) for table names, column names, column types and FK references. These
// power two-way editing: editing a table on the canvas becomes a precise text
// splice, so the user's comments / formatting / unsupported clauses survive.
//
// Offsets stay valid because comments are blanked to equal-length whitespace
// rather than removed.

// Replace comments with same-length whitespace (newlines preserved), so every
// offset in the returned string maps 1:1 to the original SQL.
function blankComments(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i], c2 = sql[i + 1];
    if (c === '-' && c2 === '-') {
      while (i < n && sql[i] !== '\n') { out += ' '; i++; }
    } else if (c === '#') {
      while (i < n && sql[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && c2 === '*') {
      out += '  '; i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) { out += sql[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '  '; i += 2; }
    } else if (c === "'" || c === '"' || c === '`') {
      out += c; i++;
      while (i < n) { out += sql[i]; const done = sql[i] === c && sql[i - 1] !== '\\'; i++; if (done) break; }
    } else {
      out += c; i++;
    }
  }
  return out;
}

// Split top-level statements on ';'. Returns [{text, start}] (start = offset).
function splitStatements(S) {
  const out = [];
  let depth = 0, start = 0, q = null;
  for (let i = 0; i < S.length; i++) {
    const c = S[i];
    if (q) { if (c === q && S[i - 1] !== '\\') q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ';' && depth === 0) { out.push({ text: S.slice(start, i), start }); start = i + 1; }
  }
  if (S.slice(start).trim()) out.push({ text: S.slice(start), start });
  return out;
}

// Split a parenthesised body on top-level commas. Returns [{text, start}].
function splitTopCommas(body, base) {
  const parts = [];
  let depth = 0, start = 0, q = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) { if (c === q && body[i - 1] !== '\\') q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push({ text: body.slice(start, i), start: base + start }); start = i + 1; }
  }
  parts.push({ text: body.slice(start), start: base + start });
  return parts;
}

// The values of every '…' literal in a fragment ('' and \' unescaped).
function sqlStrings(text) {
  const out = [];
  const re = /'((?:[^'\\]|\\.|'')*)'/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1].replace(/''/g, "'").replace(/\\(.)/g, '$1'));
  return out;
}

function clean(id) {
  if (!id) return id;
  id = id.trim();
  // Strip a *matched* wrapping delimiter pair only: `id`, "id", [id].
  // Stripping the sides independently would mangle e.g. the type TEXT[]
  // (no leading '[') into TEXT[ by dropping the trailing ']'.
  const close = { '`': '`', '"': '"', '[': ']' }[id[0]];
  if (id.length >= 2 && close && id[id.length - 1] === close) return id.slice(1, -1);
  return id;
}
function bareName(id) {
  const parts = id.split('.');
  return clean(parts[parts.length - 1]);
}

// Tokenise a definition; each token carries absolute start/end offsets.
function tokenize(def, base) {
  const tokens = [];
  let i = 0;
  const n = def.length;
  while (i < n) {
    const c = def[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') {
      let depth = 0, start = i;
      while (i < n) {
        if (def[i] === '(') depth++;
        if (def[i] === ')') { depth--; if (depth === 0) { i++; break; } }
        i++;
      }
      tokens.push({ text: def.slice(start, i), start: base + start, end: base + i });
    } else if (c === '`' || c === '"' || c === '[') {
      const close = c === '[' ? ']' : c;
      let start = i; i++;
      while (i < n && def[i] !== close) i++;
      i++;
      tokens.push({ text: def.slice(start, i), start: base + start, end: base + i });
    } else if (c === ',') {
      i++;
    } else {
      let start = i;
      while (i < n && !/[\s(,]/.test(def[i])) i++;
      tokens.push({ text: def.slice(start, i), start: base + start, end: base + i });
    }
  }
  return tokens;
}

function parseColumnsFromParen(group) {
  const inner = group.replace(/^\(/, '').replace(/\)$/, '');
  return splitTopCommas(inner, 0).map(p => bareName(p.text));
}

// Identifier spans for each column listed in a "(a, b, c)" clause, given the
// inner text and its absolute base offset. Used to keep PK/FK/UNIQUE clauses
// in sync when a column is renamed.
function colSpans(innerText, innerBase) {
  const out = [];
  for (const seg of splitTopCommas(innerText, innerBase)) {
    const m = seg.text.match(/\S+/);
    if (!m) continue;
    const raw = m[0];
    let s = seg.start + m.index, e = s + raw.length;
    if (/^[`"\[]/.test(raw)) { s += 1; e -= 1; }
    out.push({ name: bareName(raw).toLowerCase(), start: s, end: e });
  }
  return out;
}

const CREATE_RE = /create\s+(?:or\s+replace\s+)?(?:temporary\s+|temp\s+|transient\s+|volatile\s+)?table\s+(?:if\s+not\s+exists\s+)?/i;

export function parseSchema(sql) {
  const original = sql || '';
  const S = blankComments(original);
  const statements = splitStatements(S);

  const tables = new Map();   // lowerName -> table object
  const relations = [];
  const errors = [];
  // Non-fatal problems, each with a [start, end) span into the original SQL so
  // the editor can underline it and jump to it: [{ message, start, end }]
  const warnings = [];
  const headSpan = (base, stmt, idx) => {
    // the first line of the statement, from its CREATE keyword
    const nl = stmt.indexOf('\n', idx);
    return [base + idx, base + (nl < 0 ? stmt.length : nl)];
  };

  const ensureTable = (name, nameSpan) => {
    const key = name.toLowerCase();
    if (!tables.has(key)) {
      tables.set(key, { name, key, columns: [], colIndex: new Map(), colRefs: [], nameSpan, bodySpan: null });
    } else if (nameSpan && !tables.get(key).nameSpan) {
      tables.get(key).nameSpan = nameSpan;
    }
    return tables.get(key);
  };

  const enums = {};           // lower type name -> [values]  (CREATE TYPE … AS ENUM)
  const pendingComments = []; // COMMENT ON … may precede or follow its CREATE
  const pendingIndexes = [];

  for (const st of statements) {
    const stmt = st.text;
    const base = st.start;
    if (!stmt.trim()) continue;

    // CREATE TYPE mood AS ENUM ('sad', 'ok')
    const em = stmt.match(/create\s+type\s+(\S+)\s+as\s+enum\s*\(([\s\S]*)\)/i);
    if (em) { enums[bareName(em[1]).toLowerCase()] = sqlStrings(em[2]); continue; }

    // COMMENT ON TABLE t IS '…' / COMMENT ON COLUMN t.c IS '…'
    const cmm = stmt.match(/comment\s+on\s+(table|column)\s+(\S+)\s+is\s+('(?:[^']|'')*')/i);
    if (cmm) {
      const parts = cmm[2].split('.').map(clean);
      const text = sqlStrings(cmm[3])[0] || '';
      if (cmm[1].toLowerCase() === 'table') pendingComments.push({ table: parts[parts.length - 1], text });
      else if (parts.length >= 2) pendingComments.push({ table: parts[parts.length - 2], column: parts[parts.length - 1], text });
      continue;
    }

    // CREATE [UNIQUE] INDEX [name] ON t [USING x] (a, b)
    const im = stmt.match(/create\s+(unique\s+)?(?:clustered\s+|nonclustered\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:(\S+)\s+)?on\s+(?:only\s+)?([^\s(]+)\s*(?:using\s+\w+\s*)?\(([^)]*)\)/i);
    if (im) {
      pendingIndexes.push({ table: bareName(im[3]), name: im[2] ? bareName(im[2]) : '', unique: !!im[1], cols: parseColumnsFromParen('(' + im[4] + ')') });
      continue;
    }

    const cm = stmt.match(CREATE_RE);
    if (cm) {
      const afterStart = cm.index + cm[0].length;
      const after = stmt.slice(afterStart);
      const open = after.indexOf('(');
      if (open < 0) {
        const [ws, we] = headSpan(base, stmt, cm.index);
        const what = /\b(as\s+select|like)\b/i.test(after) ? 'has no column list (CREATE TABLE … AS / LIKE)' : 'has no column list';
        warnings.push({ message: `Skipped a CREATE TABLE that ${what}`, start: ws, end: we });
        continue;
      }
      // table name token sits between afterStart and the '('
      const nameRegion = after.slice(0, open);
      const rawNameMatch = nameRegion.match(/(\S+)/);
      if (!rawNameMatch) continue;
      const rawName = rawNameMatch[1];
      const nameLocal = afterStart + rawNameMatch.index;
      // span covers the bare table name (last dotted part) for clean rename
      const dotIdx = rawName.lastIndexOf('.');
      const bareStart = nameLocal + (dotIdx >= 0 ? dotIdx + 1 : 0);
      const name = bareName(rawName);
      const nameSpan = [base + bareStart, base + nameLocal + rawName.length];

      // balanced body
      let depth = 0, end = -1;
      for (let i = open; i < after.length; i++) {
        if (after[i] === '(') depth++;
        if (after[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) {
        errors.push(`Unbalanced parens in table "${name}"`);
        const [ws, we] = headSpan(base, stmt, cm.index);
        warnings.push({ message: `Skipped "${name}": its column list is missing a closing ")"`, start: ws, end: we });
        continue;
      }
      if (tables.has(name.toLowerCase()) && tables.get(name.toLowerCase()).bodySpan) {
        warnings.push({ message: `"${name}" is defined more than once — the definitions were merged`, start: nameSpan[0], end: nameSpan[1] });
      }
      const bodyLocal = afterStart + open + 1;
      const body = after.slice(open + 1, end);
      const table = ensureTable(name, nameSpan);
      table.bodySpan = [base + bodyLocal, base + afterStart + end];
      table.stmtSpan = [base + cm.index, base + stmt.length];   // CREATE … (sans ';')
      parseTableBody(body, base + bodyLocal, table, relations);
      // MySQL: ) ENGINE=… COMMENT='table comment'
      const tcm = after.slice(end + 1).match(/\bcomment\s*=?\s*('(?:[^'\\]|\\.|'')*')/i);
      if (tcm) table.comment = sqlStrings(tcm[1])[0] || '';
      if (!table.columns.length) {
        warnings.push({ message: `"${name}" has no columns that could be read`, start: nameSpan[0], end: nameSpan[1] });
      }
      continue;
    }

    // ALTER TABLE [ONLY] x ADD [CONSTRAINT y] FOREIGN KEY (a) REFERENCES z (b)
    // (pg_dump emits "ALTER TABLE ONLY schema.table")
    const am = stmt.match(/alter\s+table\s+(?:only\s+)?([^\s(]+(?:\.[^\s(]+)?)\s+add\s+/is);
    if (am) {
      const t = bareName(am[1]);
      const tail = stmt.slice(am.index + am[0].length);
      const tailBase = base + am.index + am[0].length;
      const rel = parseForeignKey(tail, tailBase, t);
      if (rel) { relations.push(rel); continue; }
      // ALTER TABLE x ADD [CONSTRAINT y] PRIMARY KEY (a, b) | UNIQUE (a) — how
      // pg_dump (and many migration tools) declare keys, after the CREATE
      const km = tail.match(/^(?:constraint\s+\S+\s+)?(primary\s+key|unique)\s*(?:(?:non)?clustered\s*)?\(([^)]*)\)/id);
      const target = km && tables.get(t.toLowerCase());
      if (target) {
        const flag = /^primary/i.test(km[1]) ? 'pk' : 'unique';
        for (const ref of colSpans(km[2], tailBase + km.indices[2][0])) {
          const col = target.colIndex.get(ref.name);
          if (col) col[flag] = true;
          target.colRefs.push(ref);
        }
      }
    }
  }

  for (const c of pendingComments) {
    const t = tables.get(c.table.toLowerCase());
    if (!t) continue;
    if (!c.column) t.comment = c.text;
    else { const col = t.colIndex.get(c.column.toLowerCase()); if (col) col.comment = c.text; }
  }
  for (const ix of pendingIndexes) {
    const t = tables.get(ix.table.toLowerCase());
    if (!t) continue;
    for (const name of ix.cols) {
      const col = t.colIndex.get(String(name).split(/\s/)[0].toLowerCase());   // "col DESC" -> col
      if (!col) continue;
      (col.indexes = col.indexes || []).push(ix.name || (ix.unique ? 'unique index' : 'index'));
      if (ix.unique && ix.cols.length === 1) col.unique = true;
    }
  }

  // resolve relations; mark fk columns
  const tableList = [...tables.values()];
  const resolved = [];
  for (const r of relations) {
    const from = tables.get(r.fromTable.toLowerCase());
    const to = tables.get(r.toTable.toLowerCase());
    if (!from) continue;
    if (!to) {
      const span = r.refSpan || from.nameSpan || [0, 0];
      warnings.push({
        message: `${from.name}.${r.fromCols[0] || '?'} references "${r.toTable}", which isn't defined here`,
        start: span[0], end: span[1],
      });
    }
    for (const c of r.fromCols) {
      const col = from.colIndex.get(c.toLowerCase());
      if (col) col.fk = true;
    }
    resolved.push({
      fromTable: from.name,
      fromCols: r.fromCols,
      toTable: to ? to.name : r.toTable,
      toCols: r.toCols,
      toMissing: !to,
      refSpan: r.refSpan || null,
    });
  }

  warnings.sort((a, b) => a.start - b.start);
  return { tables: tableList, relations: resolved, errors, warnings, enums, sql: original };
}

function parseTableBody(body, base, table, relations) {
  const items = splitTopCommas(body, base);
  for (const part of items) {
    const item = part.text;
    if (!item.trim()) continue;
    const tokens = tokenize(item, part.start);
    if (!tokens.length) continue;
    const head = clean(tokens[0].text).toLowerCase();

    if (head === 'primary' && tokens[1] && /key/i.test(tokens[1].text)) {
      markKeyCols(tokens, table, 'pk');
      continue;
    }
    if (head === 'unique') {
      markKeyCols(tokens, table, 'unique');
      continue;
    }
    if (head === 'foreign' && tokens[1] && /key/i.test(tokens[1].text)) {
      const rel = parseForeignKey(item, part.start, table.name);
      if (rel) { relations.push(rel); table.colRefs.push(...rel.localColSpans); }
      continue;
    }
    if (head === 'constraint') {
      if (/foreign\s+key/i.test(item)) {
        const rel = parseForeignKey(item, part.start, table.name);
        if (rel) { relations.push(rel); table.colRefs.push(...rel.localColSpans); }
      } else if (/primary\s+key/i.test(item)) {
        markKeyCols(tokens, table, 'pk');
      }
      continue;
    }
    if (head === 'key' || head === 'index') {            // MySQL: KEY idx_name (a, b)
      const grp = tokens.find(t => t.text.startsWith('('));
      const idxName = tokens[1] && !tokens[1].text.startsWith('(') ? bareName(tokens[1].text) : 'index';
      if (grp) for (const ref of colSpans(grp.text.slice(1, -1), grp.start + 1)) {
        const col = table.colIndex.get(ref.name);
        if (col) (col.indexes = col.indexes || []).push(idxName);
        table.colRefs.push(ref);
      }
      continue;
    }
    if (head === 'check' || head === 'fulltext' || head === 'spatial') continue;

    // column definition
    const nameTok = tokens[0];
    const colName = bareName(nameTok.text);
    if (!colName) continue;
    // name span = bare identifier (strip wrapping quotes from the token span)
    let ns = nameTok.start, ne = nameTok.end;
    if (/^[`"\[]/.test(nameTok.text)) { ns += 1; ne -= 1; }

    let type = '', typeSpan = null;
    if (tokens[1] && !/^\(/.test(tokens[1].text)) {
      const t1 = tokens[1];
      const low = (i) => (tokens[i] ? tokens[i].text.toLowerCase() : '');
      type = clean(t1.text);
      let last = 1;                                      // index of the type's final token
      // two-word type names (pg_dump spells these out): character varying, double precision…
      if ((/^(character|char|bit|nchar)$/.test(low(1)) && low(2) === 'varying') ||
          (low(1) === 'double' && low(2) === 'precision')) {
        type += ' ' + tokens[2].text;
        last = 2;
      }
      if (tokens[last + 1] && tokens[last + 1].text.startsWith('(')) { // e.g. varchar (255)
        type += tokens[last + 1].text;
        last += 1;
      } else if (t1.text.includes('(')) {
        type = t1.text;
      }
      // timestamp / time [(p)] with|without time zone
      if (/^(timestamp|time)\b/.test(low(1)) && /^(with|without)$/.test(low(last + 1)) &&
          low(last + 2) === 'time' && low(last + 3) === 'zone') {
        type += ` ${low(last + 1)} time zone`;
        last += 3;
      }
      typeSpan = [t1.start, tokens[last].end];
    }

    const rest = item.toLowerCase();
    const col = {
      name: colName,
      type: prettyType(type),
      typeRaw: type,
      pk: /\bprimary\s+key\b/.test(rest),
      nn: /\bnot\s+null\b/.test(rest),
      unique: /\bunique\b/.test(rest),
      fk: false,
      nameSpan: [ns, ne],
      typeSpan,
      defSpan: [part.start, part.start + item.length],   // full "name type …" segment
    };
    const ccm = item.match(/\bcomment\s+('(?:[^'\\]|\\.|'')*')/i);   // MySQL inline COMMENT '…'
    if (ccm) col.comment = sqlStrings(ccm[1])[0] || '';
    const dfm = item.match(/\bdefault\s+('(?:[^'\\]|\\.|'')*'|[^\s,(]+(?:\([^)]*\))?)/i);
    if (dfm) col.default = dfm[1];
    table.columns.push(col);
    table.colIndex.set(colName.toLowerCase(), col);

    // inline REFERENCES other(col)
    const refm = item.match(/references\s+([^\s(]+(?:\.[^\s(]+)?)\s*(\([^)]*\))?/id);
    if (refm) {
      col.fk = true;
      const toTable = bareName(refm[1]);
      const toCols = refm[2] ? parseColumnsFromParen(refm[2]) : [];
      const gi = refm.indices[1];
      const dotIdx = refm[1].lastIndexOf('.');
      const refStart = part.start + gi[0] + (dotIdx >= 0 ? dotIdx + 1 : 0);
      relations.push({
        fromTable: table.name,
        fromCols: [colName],
        toTable,
        toCols,
        refSpan: [refStart, part.start + gi[1]],
      });
    }
  }
}

// Mark a table-level key clause's columns and record their spans for renames.
function markKeyCols(tokens, table, flag) {
  const grp = tokens.find(t => t.text.startsWith('('));
  if (!grp) return;
  for (const ref of colSpans(grp.text.slice(1, -1), grp.start + 1)) {
    const col = table.colIndex.get(ref.name);
    if (col) col[flag] = true;
    table.colRefs.push(ref);
  }
}

function parseForeignKey(text, base, fromTable) {
  const m = text.match(
    /foreign\s+key\s*\(([^)]*)\)\s*references\s+([^\s(]+(?:\.[^\s(]+)?)\s*(\(([^)]*)\))?/id
  );
  if (!m) return null;
  const fromCols = m[1].split(',').map(s => bareName(s)).filter(Boolean);
  const toTable = bareName(m[2]);
  const toCols = m[4] ? m[4].split(',').map(s => bareName(s)).filter(Boolean) : [];
  const gi = m.indices[2];
  const dotIdx = m[2].lastIndexOf('.');
  const refStart = base + gi[0] + (dotIdx >= 0 ? dotIdx + 1 : 0);
  const localColSpans = colSpans(m[1], base + m.indices[1][0]);
  return { fromTable, fromCols, toTable, toCols, refSpan: [refStart, base + gi[1]], localColSpans };
}

function prettyType(t) {
  if (!t) return '';
  // one space between words (character varying), none around ( ) , — and keep
  // the case of anything after the type name (enum values etc.)
  t = t.replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').replace(/\)(?=\w)/g, ') ').trim();
  const m = t.match(/^([a-zA-Z_ ]+)(.*)$/s);
  if (!m) return t.toLowerCase();
  return m[1].toLowerCase() + (m[2] || '');
}
