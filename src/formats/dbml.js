// DBML importer (view-only). Reads the language as people actually write it
// for dbdiagram.io / dbdocs:
//
//   Table ecommerce.users as U [headercolor: #3498db] { … }   schema, alias, settings
//   id integer [pk, increment, not null, unique, default: 1, note: '…', ref: > t.c]
//   Note: '…' / Note { '''…''' }                                table notes
//   indexes { (a, b) [pk]  email [unique, name: 'idx'] }        keys and indexes
//   Enum status { active  blocked [note: '…'] }
//   Ref name: orders.(a, b) > merchants.(x, y) [delete: cascade]   short form
//   Ref { a.b < c.d }                                           long form
//   TableGroup billing [color: #f00] { invoices  payments }     -> table colours
//   TablePartial timestamps { … }  +  ~timestamps               shared columns
//
// Anything that can't be read is reported in `warnings` with its position, so
// the editor can point at it instead of silently drawing less than was written.
import { makeTable, addColumn, finalize, balanced, splitTopCommas } from './util.js';
import { TABLE_COLORS, TABLE_COLOR_ORDER } from '../renderer.js';

// Replace comments with spaces (same length, newlines kept) so every offset
// still points into the original text. Strings are left alone.
function blankComments(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'" && src.startsWith("'''", i)) {                    // '''multi-line string'''
      const end = src.indexOf("'''", i + 3);
      const stop = end < 0 ? n : end + 3;
      out += src.slice(i, stop); i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, Math.min(n, j + 1)); i = Math.min(n, j + 1);
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' '); i = stop;
    } else { out += c; i++; }
  }
  return out;
}

// the value of a DBML string literal ('…', "…", '''…''') or the raw text otherwise
function str(raw) {
  let s = String(raw || '').trim();
  if (s.startsWith("'''") && s.endsWith("'''") && s.length >= 6) {
    // multi-line: drop the common indentation, as DBML does
    const lines = s.slice(3, -3).replace(/^\n/, '').replace(/\n\s*$/, '').split('\n');
    const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length), 99);
    return lines.map((l) => l.slice(pad)).join('\n').replace(/\\(.)/g, '$1');
  }
  if (s.length >= 2 && (s[0] === "'" || s[0] === '"') && s.endsWith(s[0])) return s.slice(1, -1).replace(/\\(.)/g, '$1');
  return s;
}

// Read a possibly-quoted, possibly-dotted name starting at s[i]:
//   users | "order items" | public.users | users.(a, b)
// -> { parts: [...], cols: [...]|null, end } or null
function readName(s, i = 0) {
  const parts = [];
  let cols = null;
  for (;;) {
    while (s[i] === ' ' || s[i] === '\t') i++;
    if (s[i] === '"' || s[i] === '`') {
      const q = s[i], j = s.indexOf(q, i + 1);
      if (j < 0) return null;
      parts.push(s.slice(i + 1, j)); i = j + 1;
    } else if (s[i] === '(') {                                      // composite column list
      const j = s.indexOf(')', i);
      if (j < 0) return null;
      cols = s.slice(i + 1, j).split(',').map((c) => str(c.trim().replace(/^"|"$/g, ''))).filter(Boolean);
      i = j + 1;
      break;
    } else {
      const m = /^[\w$]+/.exec(s.slice(i));
      if (!m) break;
      parts.push(m[0]); i += m[0].length;
    }
    if (s[i] === '.') { i++; continue; }
    break;
  }
  return parts.length || cols ? { parts, cols, end: i } : null;
}

// `key: value` settings inside [ … ]  ->  [{ key, value }] (flags have value '')
function settings(text) {
  return splitTopCommas(text).map((p) => {
    const part = p.trim();
    const m = /^([A-Za-z_ ]+?)\s*:\s*([\s\S]*)$/.exec(part);
    return m ? { key: m[1].trim().toLowerCase(), value: m[2].trim() } : { key: part.toLowerCase(), value: '' };
  }).filter((x) => x.key);
}

// nearest of our table colours to a #rgb / #rrggbb value
function nearestColor(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 24) return null;      // greys carry no hue to match
  let best = null, bestD = Infinity;
  for (const name of TABLE_COLOR_ORDER) {
    const m = parseInt(TABLE_COLORS[name].slice(1), 16);
    const d = (r - (m >> 16)) ** 2 + (g - ((m >> 8) & 255)) ** 2 + (b - (m & 255)) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

export function parseDBML(text) {
  const src = text || '';
  const t = blankComments(src);
  const tables = [], rels = [], warnings = [];
  const enums = {};
  const alias = new Map();        // alias (lower) -> table name
  const partials = new Map();     // TablePartial name (lower) -> [{ name, type, opts }]
  const groups = [];              // [{ name, color, tables: [names] }]
  const warn = (message, start, end) => warnings.push({ message, start, end: Math.max(end, start + 1) });
  const tableName = (parts) => parts[parts.length - 1];
  const col = (table, name) => table.colIndex.get(String(name).toLowerCase());

  // Parse the lines of a table / partial body into column specs + side effects.
  // `base` is the body's offset in the source (for warnings).
  function readBody(body, base, table) {
    const cols = [];
    let i = 0;
    while (i < body.length) {
      const nl = body.indexOf('\n', i);
      let lineEnd = nl < 0 ? body.length : nl;
      const lead = body.slice(i, lineEnd);
      const trimmed = lead.trim();
      const at = base + i + (lead.length - lead.trimStart().length);
      if (!trimmed) { i = lineEnd + 1; continue; }

      // nested blocks: indexes { … } / Note { … } / checks { … }
      const blk = /^(indexes|note|checks)\s*\{/i.exec(trimmed);
      if (blk) {
        const b = balanced(body, i, '{', '}');
        if (!b) { warn(`Unclosed "${blk[1]}" block`, at, at + trimmed.length); break; }
        const inner = body.slice(b[0], b[1]);
        if (/^indexes/i.test(blk[1])) readIndexes(inner, table);
        else if (/^note/i.test(blk[1])) table.comment = str(inner);
        i = b[2];
        continue;
      }
      // Note: '…'  (may be a ''' multi-line ''' string)
      const note = /^note\s*:\s*/i.exec(trimmed);
      if (note) {
        const from = i + lead.indexOf(trimmed) + note[0].length;
        if (body.startsWith("'''", from)) {
          const end = body.indexOf("'''", from + 3);
          const stop = end < 0 ? body.length : end + 3;
          table.comment = str(body.slice(from, stop));
          i = stop;
        } else { table.comment = str(body.slice(from, lineEnd)); i = lineEnd + 1; }
        continue;
      }
      // ~partial  (columns shared through a TablePartial)
      if (trimmed[0] === '~') {
        const p = partials.get(trimmed.slice(1).trim().toLowerCase());
        if (p) cols.push(...p.map((c) => ({ ...c })));
        else warn(`Unknown table partial "${trimmed.slice(1).trim()}"`, at, at + trimmed.length);
        i = lineEnd + 1;
        continue;
      }

      // a column:  name type [settings]   — the settings bracket may span lines
      let line = trimmed, optText = '';
      const open = line.search(/\s\[(?!\])/);                       // " [" but not the "[]" of an array type
      if (open >= 0) {
        const absOpen = i + lead.indexOf(trimmed) + open + 1;
        const b = balanced(body, absOpen, '[', ']');
        if (b) { optText = body.slice(b[0], b[1]); line = line.slice(0, open).trim(); lineEnd = Math.max(lineEnd, b[2]); }
      }
      const nm = readName(line);
      if (!nm || !nm.parts.length) { warn(`Could not read this line: ${trimmed.slice(0, 40)}`, at, at + trimmed.length); i = lineEnd + 1; continue; }
      const type = line.slice(nm.end).trim().replace(/^"(.*)"$/, '$1');
      cols.push({ name: nm.parts[nm.parts.length - 1], type, opts: settings(optText), at, len: trimmed.length });
      i = lineEnd + 1;
    }
    return cols;
  }

  function readIndexes(inner, table) {
    for (const raw of inner.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const open = line.search(/\[(?=[^\]]*\]\s*$)/);
      const opts = open >= 0 ? settings(line.slice(open + 1, line.lastIndexOf(']'))) : [];
      const head = (open >= 0 ? line.slice(0, open) : line).trim();
      if (head.startsWith('`')) continue;                            // expression index: nothing to mark
      const names = head.startsWith('(')
        ? head.slice(1, head.lastIndexOf(')')).split(',').map((c) => str(c.trim().replace(/^"|"$/g, ''))).filter((c) => c && !c.startsWith('`'))
        : [str(head.replace(/^"|"$/g, ''))];
      const flag = (k) => opts.some((o) => o.key === k);
      const idxName = str((opts.find((o) => o.key === 'name') || {}).value || '') || (flag('unique') ? 'unique index' : 'index');
      (table._indexes = table._indexes || []).push({ names, pk: flag('pk') || flag('primary key'), unique: flag('unique'), name: idxName });
    }
  }

  function applyColumn(table, c) {
    const flag = (k) => c.opts.some((o) => o.key === k);
    const val = (k) => (c.opts.find((o) => o.key === k) || {}).value;
    const pk = flag('pk') || flag('primary key');
    addColumn(table, { name: c.name, type: c.type, pk, nn: pk || flag('not null'), unique: flag('unique') });
    const column = col(table, c.name);
    if (!column) return;
    if (val('note') !== undefined) column.comment = str(val('note'));
    if (val('default') !== undefined) column.default = val('default').replace(/^`(.*)`$/, '$1');
    if (flag('increment')) column.increment = true;
    for (const o of c.opts) {
      if (o.key !== 'ref') continue;                                 // inline ref: > other.col
      const m = /^(<>|[<>-])\s*([\s\S]+)$/.exec(o.value);
      const end = m && readName(m[2]);
      if (!end || end.parts.length < 2) { warn(`Could not read the ref on "${c.name}"`, c.at, c.at + c.len); continue; }
      pendingRefs.push({
        a: { table: table.name, cols: [c.name], resolved: true }, op: m[1],
        b: { table: end.parts[end.parts.length - 2], cols: [end.parts[end.parts.length - 1]] }, at: c.at, len: c.len,
      });
    }
  }

  const pendingRefs = [];
  // ---- top-level elements, in source order ----
  const topRe = /(^|\n)[ \t]*(TablePartial|TableGroup|Table|Enum|Ref|Project|Note)\b/gi;
  const elements = [];
  let m;
  while ((m = topRe.exec(t))) elements.push({ kind: m[2].toLowerCase(), at: m.index + m[0].length - m[2].length, after: m.index + m[0].length });

  // partials first: a table may use one that is declared later in the file
  const order = [...elements.filter((e) => e.kind === 'tablepartial'), ...elements.filter((e) => e.kind !== 'tablepartial')];
  const consumed = [];                                              // [start, end) of blocks already read
  const inside = (pos) => consumed.some(([a, b]) => pos > a && pos < b);

  for (const el of order) {
    if (inside(el.at)) continue;                                     // e.g. "Note" or "Ref" text inside another block
    const lineEnd = (() => { const n = t.indexOf('\n', el.after); return n < 0 ? t.length : n; })();
    const head = t.slice(el.after, lineEnd);
    const hasBrace = head.includes('{');
    const b = hasBrace ? balanced(t, el.after, '{', '}') : null;

    if (el.kind === 'ref') {
      const body = b && /^\s*[\w"]*\s*\{/.test(head) ? t.slice(b[0], b[1]) : head.replace(/^[^:]*:/, '');
      if (b && /^\s*[\w"]*\s*\{/.test(head)) consumed.push([el.at, b[2]]);
      const baseAt = b && /^\s*[\w"]*\s*\{/.test(head) ? b[0] : el.after + head.indexOf(':') + 1;
      let off = 0;
      for (const raw of body.split('\n')) {
        const line = raw.trim();
        const at = baseAt + off + (raw.length - raw.trimStart().length);
        off += raw.length + 1;
        if (!line) continue;
        const a = readName(line);
        const rest = a ? line.slice(a.end).trim() : '';
        const op = /^(<>|[<>-])/.exec(rest);
        const b2 = op ? readName(rest.slice(op[0].length)) : null;
        const side = (x) => (x.cols ? { table: x.parts[x.parts.length - 1], cols: x.cols } : { table: x.parts[x.parts.length - 2], cols: [x.parts[x.parts.length - 1]] });
        if (!a || !op || !b2 || (!a.cols && a.parts.length < 2) || (!b2.cols && b2.parts.length < 2)) {
          warn(`Could not read this Ref: ${line.slice(0, 50)}`, at, at + line.length);
          continue;
        }
        pendingRefs.push({ a: side(a), op: op[0], b: side(b2), at, len: line.length });
      }
      continue;
    }
    if (!b) {
      if (el.kind !== 'note' && el.kind !== 'project') warn(`"${t.slice(el.at, lineEnd).trim().slice(0, 40)}" has no { … } block`, el.at, lineEnd);
      continue;
    }
    consumed.push([el.at, b[2]]);
    const headText = t.slice(el.after, b[0] - 1);
    const body = t.slice(b[0], b[1]);
    if (el.kind === 'project' || el.kind === 'note') continue;

    const nm = readName(headText);
    if (!nm || !nm.parts.length) { warn('This block has no name', el.at, b[0]); continue; }
    const name = tableName(nm.parts);
    const restHead = headText.slice(nm.end);
    const headOpts = /\[([\s\S]*)\]/.exec(restHead);

    if (el.kind === 'enum') {
      enums[name.toLowerCase()] = body.split('\n').map((l) => l.trim()).filter(Boolean)
        .map((l) => { const v = readName(l.replace(/\s*\[[\s\S]*$/, '')); return v ? v.parts.join('.') : ''; }).filter(Boolean);
    } else if (el.kind === 'tablepartial') {
      partials.set(name.toLowerCase(), readBody(body, b[0], { colIndex: new Map() }));
    } else if (el.kind === 'tablegroup') {
      const color = headOpts ? (settings(headOpts[1]).find((o) => o.key === 'color') || {}).value : '';
      groups.push({
        name, color: nearestColor(color),
        tables: body.split('\n').map((l) => l.trim()).filter((l) => l && !/^note\b/i.test(l)).map((l) => { const x = readName(l); return x ? tableName(x.parts) : ''; }).filter(Boolean),
      });
    } else {                                                        // table
      const table = makeTable(name);
      const as = /^\s*as\s+("[^"]+"|[\w$]+)/i.exec(restHead);
      if (as) alias.set(str(as[1]).toLowerCase(), name);
      if (headOpts) {
        const o = settings(headOpts[1]);
        const hc = (o.find((x) => x.key === 'headercolor') || {}).value;
        const note = (o.find((x) => x.key === 'note') || {}).value;
        if (hc) table.defaultColor = nearestColor(hc);
        if (note) table.comment = str(note);
      }
      for (const c of readBody(body, b[0], table)) applyColumn(table, c);
      for (const ix of table._indexes || []) {
        for (const n of ix.names) {
          const column = col(table, n);
          if (!column) continue;
          if (ix.pk) { column.pk = true; column.nn = true; }
          else {
            (column.indexes = column.indexes || []).push(ix.name);
            if (ix.unique && ix.names.length === 1) column.unique = true;
          }
        }
      }
      delete table._indexes;
      if (!table.columns.length) warn(`"${name}" has no columns that could be read`, el.at, b[0]);
      tables.push(table);
    }
  }

  // ---- table groups -> a colour per group (unless a table set its own) ----
  const byName = new Map(tables.map((x) => [x.name.toLowerCase(), x]));
  groups.forEach((g, i) => {
    const color = g.color || TABLE_COLOR_ORDER[i % TABLE_COLOR_ORDER.length];
    for (const n of g.tables) { const tb = byName.get(n.toLowerCase()); if (tb && !tb.defaultColor) { tb.defaultColor = color; tb.group = g.name; } }
  });

  // ---- relations: resolve aliases, orient by the operator, check both ends exist ----
  const real = (n) => alias.get(String(n).toLowerCase()) || n;
  for (const r of pendingRefs) {
    const a = { table: real(r.a.table), cols: r.a.cols }, b = { table: real(r.b.table), cols: r.b.cols };
    // `a > b`: a holds the foreign key.  `a < b`: b does.  `a - b` (one-to-one)
    // doesn't say, so the side that isn't its table's primary key is taken as the key holder.
    const isPk = (end) => { const tb = byName.get(end.table.toLowerCase()); const c = tb && col(tb, end.cols[0]); return !!(c && c.pk); };
    const flip = r.op === '<' || (r.op === '-' && isPk(a) && !isPk(b));
    const [from, to] = flip ? [b, a] : [a, b];
    for (const end of [from, to]) {
      const tb = byName.get(end.table.toLowerCase());
      if (!tb) warn(`Ref points at "${end.table}", which isn't defined here`, r.at, r.at + r.len);
      else for (const c of end.cols) if (!col(tb, c)) warn(`Ref points at ${end.table}.${c}, which isn't a column of that table`, r.at, r.at + r.len);
    }
    rels.push({ fromTable: from.table, fromCols: from.cols, toTable: to.table, toCols: to.cols });
  }

  const model = finalize(tables, rels);
  model.enums = enums;
  model.groups = groups.map((g) => ({ name: g.name, tables: g.tables }));
  model.warnings = warnings.sort((x, y) => x.start - y.start);
  return model;
}
