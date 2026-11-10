// TypeORM parser — best-effort for decorator-style entities:
//
//   @Entity('users')
//   export class User {
//     @PrimaryGeneratedColumn('uuid') id: string;
//     @Column({ length: 255, unique: true }) email: string;
//     @ManyToOne(() => Team, (t) => t.members) @JoinColumn({ name: 'team_id' }) team: Team;
//     @ManyToMany(() => Tag) @JoinTable() tags: Tag[];
//   }
//
// Owning-side relations (@ManyToOne, and @OneToOne with @JoinColumn) become a
// foreign-key column + relation; @ManyToMany with @JoinTable becomes a
// junction table. Tables are named after the entity class. TypeScript isn't
// fully parsed — EntitySchema objects and unusual code may be missed.
import { makeTable, addColumn, finalize, balanced } from './util.js';

const TS_TYPES = { string: 'varchar', number: 'int', boolean: 'boolean', Date: 'timestamp', bigint: 'bigint', Buffer: 'bytea' };
const DATE_COLS = new Set(['CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn']);

// the first '…' / "…" string in a decorator's arguments
const firstString = (args) => { const m = args.match(/^\s*['"`]([^'"`]+)['"`]/); return m ? m[1] : ''; };
const opt = (args, key) => { const m = args.match(new RegExp(`\\b${key}\\s*:\\s*(?:['"\`]([^'"\`]*)['"\`]|([\\w.]+))`)); return m ? (m[1] ?? m[2]) : ''; };
// () => Target | type => Target | 'Target'
const target = (args) => { const m = args.match(/=>\s*([A-Za-z_]\w*)/) || args.match(/^\s*['"`]([A-Za-z_]\w*)['"`]/); return m ? m[1] : ''; };

// Walk a class body: each member is its decorators + "name: Type".
function members(body) {
  const out = [];
  let i = 0, decos = [];
  while (i < body.length) {
    const rest = body.slice(i);
    let m = rest.match(/^\s*@(\w+)\s*\(/);
    if (m) {
      const b = balanced(body, i + m[0].length - 1, '(', ')');
      if (!b) break;
      decos.push({ name: m[1], args: body.slice(b[0], b[1]) });
      i = b[2];
      continue;
    }
    m = rest.match(/^\s*@(\w+)\b/);                                  // decorator without parentheses
    if (m) { decos.push({ name: m[1], args: '' }); i += m[0].length; continue; }
    m = rest.match(/^\s*(?:(?:public|private|protected|readonly|declare)\s+)*([A-Za-z_$][\w$]*)\s*[?!]?\s*:\s*([^;=\n{]+)/);
    if (m) {
      if (decos.length) out.push({ name: m[1], tsType: m[2].trim(), decos });
      decos = [];
      i += m[0].length;
      continue;
    }
    decos = [];
    const nl = body.indexOf('\n', i);                                 // anything else: skip the line
    i = nl < 0 ? body.length : nl + 1;
  }
  return out;
}

export function parseTypeORM(src) {
  const text = (src || '').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
  const tables = [], rels = [], junctions = [];
  const entRe = /@Entity\s*\(/g;
  let m;
  while ((m = entRe.exec(text))) {
    const args = balanced(text, m.index + m[0].length - 1, '(', ')');
    if (!args) break;
    const cls = text.slice(args[2]).match(/^[\s\S]*?\bclass\s+([A-Za-z_]\w*)[^{]*\{/);
    if (!cls) continue;
    const bodyAt = args[2] + cls[0].length - 1;
    const b = balanced(text, bodyAt, '{', '}');
    if (!b) continue;
    entRe.lastIndex = b[2];

    const name = cls[1];
    const table = makeTable(name);
    tables.push(table);
    const has = (col) => table.colIndex.has(col.toLowerCase());

    for (const mem of members(text.slice(b[0], b[1]))) {
      const deco = (n) => mem.decos.find((d) => d.name === n);
      const col = deco('Column'), pkGen = deco('PrimaryGeneratedColumn'), pkCol = deco('PrimaryColumn');
      const dateCol = mem.decos.find((d) => DATE_COLS.has(d.name));
      const baseTs = mem.tsType.replace(/\s*\|\s*(null|undefined)/g, '').replace(/\[\]$/, '').trim();

      if (pkGen) {
        const kind = firstString(pkGen.args);
        addColumn(table, { name: mem.name, type: kind === 'uuid' ? 'uuid' : (opt(pkGen.args, 'type') || 'int'), pk: true, nn: true });
      } else if (pkCol || col) {
        const a = (pkCol || col).args;
        let type = firstString(a) || opt(a, 'type') || TS_TYPES[baseTs] || baseTs;
        const len = opt(a, 'length'), prec = opt(a, 'precision'), scale = opt(a, 'scale');
        if (len) type += `(${len})`;
        else if (prec) type += `(${prec}${scale ? ',' + scale : ''})`;
        const isPk = !!pkCol || opt(a, 'primary') === 'true';
        addColumn(table, { name: mem.name, type, pk: isPk, nn: isPk || opt(a, 'nullable') !== 'true', unique: opt(a, 'unique') === 'true' });
      } else if (dateCol || deco('VersionColumn')) {
        addColumn(table, { name: mem.name, type: dateCol ? 'timestamp' : 'int', nn: !deco('DeleteDateColumn') });
      }

      const m2o = deco('ManyToOne'), o2o = deco('OneToOne'), join = deco('JoinColumn');
      const owning = m2o || (o2o && join ? o2o : null);
      if (owning) {
        const to = target(owning.args);
        const fk = (join && opt(join.args, 'name')) || `${mem.name}Id`;
        if (!has(fk)) addColumn(table, { name: fk, type: 'int', nn: opt(owning.args, 'nullable') === 'false', unique: !!o2o });
        if (to) rels.push({ fromTable: name, fromCols: [fk], toTable: to, toCols: [(join && opt(join.args, 'referencedColumnName')) || null] });
      }
      const m2m = deco('ManyToMany'), jt = deco('JoinTable');
      if (m2m && jt) junctions.push({ from: name, prop: mem.name, to: target(m2m.args), name: opt(jt.args, 'name') });
    }
  }

  // resolve relation targets' primary keys, then build junction tables
  const byName = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  const pkOf = (n) => { const t = byName.get(String(n).toLowerCase()); const pk = t && t.columns.find((c) => c.pk); return pk ? pk.name : 'id'; };
  for (const r of rels) r.toCols = [r.toCols[0] || pkOf(r.toTable)];
  for (const j of junctions) {
    if (!j.to) continue;
    const t = makeTable(j.name || `${j.from}_${j.prop}_${j.to}`.toLowerCase());
    const a = `${j.from[0].toLowerCase()}${j.from.slice(1)}Id`, b = `${j.to[0].toLowerCase()}${j.to.slice(1)}Id`;
    addColumn(t, { name: a, type: 'int', pk: true, nn: true });
    if (b.toLowerCase() !== a.toLowerCase()) addColumn(t, { name: b, type: 'int', pk: true, nn: true });
    tables.push(t);
    rels.push({ fromTable: t.name, fromCols: [a], toTable: j.from, toCols: [pkOf(j.from)] });
    if (b.toLowerCase() !== a.toLowerCase()) rels.push({ fromTable: t.name, fromCols: [b], toTable: j.to, toCols: [pkOf(j.to)] });
  }
  return finalize(tables, rels);
}
