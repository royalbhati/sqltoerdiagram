// Lightweight SQL tokeniser for the editor's highlight layer. One linear regex
// pass over the text produces span-wrapped HTML; it adds/removes NO characters
// (only wraps + HTML-escapes), so the result aligns glyph-for-glyph with the
// textarea behind it. Cheap enough to run every animation frame.

const KEYWORDS = new Set([
  'create', 'table', 'temporary', 'temp', 'if', 'not', 'exists', 'primary',
  'key', 'foreign', 'references', 'unique', 'constraint', 'check', 'index',
  'default', 'null', 'auto_increment', 'autoincrement', 'on', 'delete',
  'update', 'cascade', 'restrict', 'no', 'action', 'alter', 'add', 'column',
  'drop', 'and', 'or', 'generated', 'always', 'as', 'identity', 'with',
  'using', 'collate', 'character', 'set', 'comment', 'unsigned', 'zerofill',
  'first', 'after', 'rename', 'to', 'view', 'schema', 'database',
]);

const TYPES = new Set([
  'int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint', 'serial',
  'bigserial', 'smallserial', 'varchar', 'char', 'nvarchar', 'nchar',
  'varbinary', 'binary', 'text', 'longtext', 'mediumtext', 'tinytext',
  'boolean', 'bool', 'bit', 'timestamp', 'timestamptz', 'datetime',
  'datetime2', 'smalldatetime', 'date', 'time', 'year', 'interval', 'numeric',
  'decimal', 'dec', 'real', 'double', 'float', 'precision', 'money',
  'smallmoney', 'json', 'jsonb', 'uuid', 'blob', 'bytea', 'inet', 'cidr',
  'enum', 'set', 'array', 'uniqueidentifier', 'xml', 'geometry', 'point',
]);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// comment | string | quoted-ident | number | word | punctuation
const RE = /(\/\*[\s\S]*?\*\/|--[^\n]*|#[^\n]*)|('(?:[^'\\]|\\.)*'?)|("(?:[^"\\]|\\.)*"|`[^`]*`|\[[^\]]*\])|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([(),;])/g;

// `marks` (optional): sorted, non-overlapping [{start, end}] ranges to wrap in
// a squiggly-underline span (parse problems). Each piece is tokenised on its
// own; ranges sit on statement boundaries, so tokens don't straddle them.
export function highlightSQL(sql, marks) {
  if (!marks || !marks.length) return highlightPlain(sql);
  let out = '', pos = 0;
  for (const m of marks) {
    const s = Math.max(pos, Math.min(m.start, sql.length)), e = Math.min(Math.max(s, m.end), sql.length);
    if (e <= s) continue;
    out += highlightPlain(sql.slice(pos, s));
    out += '<span class="t-err">' + highlightPlain(sql.slice(s, e)) + '</span>';
    pos = e;
  }
  return out + highlightPlain(sql.slice(pos));
}

function highlightPlain(sql) {
  let out = '';
  let last = 0;
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(sql)) !== null) {
    if (m.index > last) out += esc(sql.slice(last, m.index));   // whitespace / other
    const tok = m[0];
    let cls;
    if (m[1]) cls = 't-com';
    else if (m[2]) cls = 't-str';
    else if (m[3]) cls = 't-id';
    else if (m[4]) cls = 't-num';
    else if (m[5]) {
      const lw = tok.toLowerCase();
      cls = KEYWORDS.has(lw) ? 't-kw' : (TYPES.has(lw) ? 't-type' : null);
    } else if (m[6]) cls = 't-punct';
    out += cls ? `<span class="${cls}">${esc(tok)}</span>` : esc(tok);
    last = RE.lastIndex;
    if (m.index === RE.lastIndex) RE.lastIndex++;   // guard against zero-width
  }
  if (last < sql.length) out += esc(sql.slice(last));
  return out;
}
