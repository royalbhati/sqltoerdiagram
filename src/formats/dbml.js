// DBML (dbdiagram.io) importer — view-only. Produces the normalized model.
import { makeTable, addColumn, finalize, balanced } from './util.js';

const unq = (s) => {
  s = (s || '').trim();
  if ((s[0] === '"' && s.endsWith('"')) || (s[0] === '`' && s.endsWith('`')) || (s[0] === "'" && s.endsWith("'")))
    return s.slice(1, -1);
  return s;
};
// strip an optional schema qualifier:  public.users -> users
const bare = (s) => {
  s = unq(s);
  const dot = s.lastIndexOf('.');
  return dot >= 0 ? unq(s.slice(dot + 1)) : s;
};
// "a"."b"  ->  ['a','b'] ; a.b -> ['a','b']
function splitRef(ref) {
  const parts = [];
  let cur = '', q = null;
  for (let i = 0; i < ref.length; i++) {
    const c = ref[i];
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === '`') { q = c; continue; }
    if (c === '.') { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) parts.push(cur);
  return parts.map((p) => p.trim());
}

function findIdentifierSpan(str, ident, baseOffset) {
  if (!str || !ident) return [baseOffset, baseOffset + (str ? str.length : 0)];
  const idx = str.lastIndexOf(ident);
  if (idx >= 0) return [baseOffset + idx, baseOffset + idx + ident.length];
  return [baseOffset, baseOffset + str.length];
}

export function parseDBML(text) {
  // replace comments with spaces of equal length so character offsets are 100% preserved
  let t = (text || '')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  const tables = [];
  const rels = [];

  // --- Table blocks ---
  const tableRe = /\bTable\b\s+([^\s{]+(?:\s+as\s+\S+)?)\s*\{/gi;
  let m;
  while ((m = tableRe.exec(t))) {
    const rawHead = m[1];
    const headRaw = rawHead.replace(/\s+as\s+\S+$/i, '');
    const name = bare(headRaw);
    const b = balanced(t, m.index, '{', '}');
    if (!b) continue;
    const body = t.slice(b[0], b[1]);
    const table = makeTable(name);

    // Spans for table
    const headOffset = m[0].indexOf(rawHead);
    const headStart = m.index + headOffset;
    table.nameSpan = findIdentifierSpan(headRaw, name, headStart);
    table.bodySpan = [b[0], b[1]];
    table.stmtSpan = [m.index, b[1] + 1];

    // Scan lines in body preserving offsets
    let lineStart = 0;
    while (lineStart < body.length) {
      let lineEnd = body.indexOf('\n', lineStart);
      if (lineEnd < 0) lineEnd = body.length;
      const rawLine = body.slice(lineStart, lineEnd);
      const absLineStart = b[0] + lineStart;
      const absLineEnd = b[0] + lineEnd;

      const leadSpaces = rawLine.search(/\S/);
      if (leadSpaces >= 0) {
        const trimmed = rawLine.trim();
        const contentStart = absLineStart + leadSpaces;
        const contentEnd = contentStart + trimmed.length;

        // skip nested blocks/notes or closing brace
        if (!/^(Note|indexes|note)\b/i.test(trimmed) && trimmed !== '}' && !trimmed.startsWith('}')) {
          let settings = '';
          let settingsSpan = null;
          const br = trimmed.indexOf('[');
          let beforeBracket = trimmed;
          if (br >= 0 && trimmed.endsWith(']')) {
            settings = trimmed.slice(br + 1, -1);
            settingsSpan = [contentStart + br, contentEnd];
            beforeBracket = trimmed.slice(0, br).trim();
          }

          const parts = beforeBracket.split(/\s+/);
          if (parts.length >= 1) {
            const rawColName = parts[0];
            const colName = unq(rawColName);
            if (colName) {
              const colNameOffset = beforeBracket.indexOf(rawColName);
              const colNameSpan = findIdentifierSpan(rawColName, colName, contentStart + colNameOffset);
              const rest = beforeBracket.slice(colNameOffset + rawColName.length).trim();
              let typeSpan = null;
              let type = '';
              if (rest) {
                const typeOffset = beforeBracket.indexOf(rest, colNameOffset + rawColName.length);
                typeSpan = [contentStart + typeOffset, contentStart + typeOffset + rest.length];
                type = rest;
              }

              const lc = settings.toLowerCase();
              const col = {
                name: colName,
                type,
                pk: /\bpk\b|\bprimary key\b/.test(lc),
                nn: /\bnot null\b/.test(lc),
                unique: /\bunique\b/.test(lc),
                nameSpan: colNameSpan,
                typeSpan,
                defSpan: [absLineStart, absLineEnd],
                settingsSpan,
              };
              addColumn(table, col);

              // inline ref: [ref: > other.col]
              const rm = /ref:\s*([<>-])\s*([^,\]]+)/i.exec(settings);
              if (rm) {
                const dir = rm[1];
                const rawTgt = rm[2].trim();
                const tgt = splitRef(rawTgt);
                if (tgt.length >= 2) {
                  const tt = bare(tgt[0]), tc = unq(tgt[tgt.length - 1]);
                  const refContentOffset = settingsSpan[0] + 1 + rm.index + rm[0].indexOf(rawTgt);
                  const refSpan = [refContentOffset, refContentOffset + rawTgt.length];
                  const tgtTableOffset = rawTgt.indexOf(tgt[0]);
                  const tgtTableSpan = findIdentifierSpan(tgt[0], tt, refContentOffset + tgtTableOffset);
                  const tgtColOffset = rawTgt.lastIndexOf(tgt[tgt.length - 1]);
                  const tgtColSpan = findIdentifierSpan(tgt[tgt.length - 1], tc, refContentOffset + tgtColOffset);

                  if (dir === '<') {
                    rels.push({
                      fromTable: tt, fromCols: [tc], toTable: name, toCols: [colName],
                      refSpan,
                      fromTableSpan: tgtTableSpan, fromColSpan: tgtColSpan,
                      toTableSpan: table.nameSpan, toColSpan: colNameSpan
                    });
                  } else {
                    rels.push({
                      fromTable: name, fromCols: [colName], toTable: tt, toCols: [tc],
                      refSpan,
                      fromTableSpan: table.nameSpan, fromColSpan: colNameSpan,
                      toTableSpan: tgtTableSpan, toColSpan: tgtColSpan
                    });
                  }
                }
              }
            }
          }
        }
      }

      lineStart = lineEnd + 1;
    }

    tables.push(table);
  }

  // --- standalone Ref: a.b > c.d  (optionally "Ref name:") ---
  const refRe = /\bRef\b\s*(?:\w+\s*)?:\s*([^\s]+(?:\.[^\s]+)*)\s*([<>-])\s*([^\s\n;]+)/gi;
  while ((m = refRe.exec(t))) {
    const rawA = m[1];
    const dir = m[2];
    const rawB = m[3];
    const a = splitRef(rawA);
    const b2 = splitRef(rawB);
    if (a.length < 2 || b2.length < 2) continue;
    const aT = bare(a[0]), aC = unq(a[a.length - 1]);
    const bT = bare(b2[0]), bC = unq(b2[b2.length - 1]);

    const stmtSpan = [m.index, m.index + m[0].length];
    const aStart = m.index + m[0].indexOf(rawA);
    const bStart = m.index + m[0].lastIndexOf(rawB);

    const aTableSpan = findIdentifierSpan(a[0], aT, aStart + rawA.indexOf(a[0]));
    const aColSpan = findIdentifierSpan(a[a.length - 1], aC, aStart + rawA.lastIndexOf(a[a.length - 1]));

    const bTableSpan = findIdentifierSpan(b2[0], bT, bStart + rawB.indexOf(b2[0]));
    const bColSpan = findIdentifierSpan(b2[b2.length - 1], bC, bStart + rawB.lastIndexOf(b2[b2.length - 1]));

    if (dir === '<') {
      rels.push({
        fromTable: bT, fromCols: [bC], toTable: aT, toCols: [aC],
        stmtSpan,
        fromTableSpan: bTableSpan, fromColSpan: bColSpan,
        toTableSpan: aTableSpan, toColSpan: aColSpan
      });
    } else {
      rels.push({
        fromTable: aT, fromCols: [aC], toTable: bT, toCols: [bC],
        stmtSpan,
        fromTableSpan: aTableSpan, fromColSpan: aColSpan,
        toTableSpan: bTableSpan, toColSpan: bColSpan
      });
    }
  }

  // --- TableGroup blocks: TableGroup name [color: #hex, note: '...'] { table1 table2 } ---
  const groups = [];
  const groupRe = /\bTableGroup\b\s+((?:[^\s{\[]+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`))(?:\s*\[([^\]]*)\])?\s*\{/gi;
  while ((m = groupRe.exec(t))) {
    const rawName = m[1];
    const settingsStr = m[2] || '';
    const name = unq(rawName);
    const b = balanced(t, m.index, '{', '}');
    if (!b) continue;
    const body = t.slice(b[0], b[1]);

    let color = 'blue';
    const colorMatch = /color:\s*['"]?(#[0-9a-fA-F]{3,8}|[a-zA-Z0-9_-]+)['"]?/i.exec(settingsStr);
    if (colorMatch) {
      color = colorMatch[1];
    }
    let note = '';
    const noteMatch = /note:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|([^,\]]+))/i.exec(settingsStr);
    if (noteMatch) {
      note = (noteMatch[1] || noteMatch[2] || noteMatch[3] || noteMatch[4] || '').trim();
    }

    const memberTables = [];
    for (let line of body.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('//') || line.startsWith('/*')) continue;
      if (/^Note\b/i.test(line)) {
        const nm = /^Note(?:\s*:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)|(?:\s*\{([\s\S]*?)\}))?/i.exec(line);
        if (nm && !note) {
          note = (nm[1] || nm[2] || nm[3] || nm[4] || '').trim();
        }
        continue;
      }
      if (line === '}' || line.startsWith('}')) continue;
      const firstToken = line.split(/\s+/)[0];
      if (firstToken) {
        const tName = bare(firstToken);
        if (tName) memberTables.push(tName);
      }
    }

    groups.push({
      name,
      color,
      note,
      tables: memberTables,
    });
  }

  return finalize(tables, rels, groups);
}

