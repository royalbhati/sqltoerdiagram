// Write the model back out as CREATE TABLE DDL for a chosen SQL dialect, with
// column types translated between dialects (e.g. Postgres jsonb -> MySQL json,
// MySQL tinyint(1) -> Postgres boolean). Types we don't recognise pass through
// unchanged rather than being guessed at.

const BARE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const QUOTE = {
  postgres: (s) => (BARE.test(s) ? s : '"' + s.replace(/"/g, '""') + '"'),
  sqlite: (s) => (BARE.test(s) ? s : '"' + s.replace(/"/g, '""') + '"'),
  snowflake: (s) => (BARE.test(s) ? s : '"' + s.replace(/"/g, '""') + '"'),
  mysql: (s) => '`' + s.replace(/`/g, '``') + '`',
  sqlserver: (s) => '[' + s.replace(/]/g, ']]') + ']',
};
export const SQL_DIALECTS = { postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite', sqlserver: 'SQL Server', snowflake: 'Snowflake' };

// Reduce any dialect's type to a neutral { kind, args } description.
export function classify(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return { kind: 'unknown', raw };
  const m = t.match(/^([a-z_][a-z_0-9]*(?: (?:varying|precision))?)\s*(?:\(([^)]*)\))?\s*(.*)$/);
  const base = (m ? m[1] : t).trim();
  const args = m && m[2] ? m[2].split(',').map((x) => x.trim()) : [];
  const tail = m ? m[3] : '';
  const array = /\[\]$/.test(t);
  if (array) return { kind: 'array', raw };
  switch (base) {
    case 'serial': case 'serial4': return { kind: 'int', size: 4, auto: true };
    case 'bigserial': case 'serial8': return { kind: 'int', size: 8, auto: true };
    case 'smallserial': return { kind: 'int', size: 2, auto: true };
    case 'tinyint':
      return args[0] === '1' ? { kind: 'bool' } : { kind: 'int', size: 2 };
    case 'smallint': case 'int2': return { kind: 'int', size: 2 };
    case 'int': case 'integer': case 'int4': case 'mediumint': return { kind: 'int', size: 4 };
    case 'bigint': case 'int8': return { kind: 'int', size: 8 };
    case 'boolean': case 'bool': case 'bit': return { kind: 'bool' };
    case 'decimal': case 'numeric': case 'dec': case 'number': case 'money': case 'smallmoney':
      if (base === 'number' && (!args.length || args[1] === '0')) return { kind: 'int', size: args[0] && +args[0] <= 9 ? 4 : 8 };
      return { kind: 'decimal', p: args[0] || (base.includes('money') ? '19' : ''), s: args[1] || (base.includes('money') ? '4' : '') };
    case 'real': case 'float4': return { kind: 'float', size: 4 };
    case 'float': case 'double': case 'double precision': case 'float8': return { kind: 'float', size: 8 };
    case 'varchar': case 'character varying': case 'nvarchar': case 'varchar2': case 'nvarchar2': case 'string':
      return args[0] && args[0] !== 'max' ? { kind: 'varchar', n: args[0].replace(/\s*(byte|char)$/, '') } : { kind: 'text' };
    case 'char': case 'character': case 'nchar': case 'bpchar':
      return { kind: 'char', n: (args[0] || '1').replace(/\s*(byte|char)$/, '') };
    case 'text': case 'tinytext': case 'mediumtext': case 'longtext': case 'ntext': case 'clob': case 'citext': return { kind: 'text' };
    case 'uuid': case 'uniqueidentifier': return { kind: 'uuid' };
    case 'date': return { kind: 'date' };
    case 'time': case 'timetz': return { kind: 'time' };
    case 'timestamptz': case 'timestamp_tz': case 'timestamp_ltz': case 'datetimeoffset': return { kind: 'timestamp', tz: true };
    case 'timestamp': case 'datetime': case 'datetime2': case 'smalldatetime': case 'timestamp_ntz':
      return { kind: 'timestamp', tz: /with time zone/.test(tail) };
    case 'json': case 'jsonb': case 'variant': case 'object': return { kind: 'json' };
    case 'blob': case 'tinyblob': case 'mediumblob': case 'longblob': case 'bytea': case 'binary': case 'varbinary': case 'image': case 'raw':
      return { kind: 'binary' };
    case 'enum': return { kind: 'enum', values: args };
    default: return { kind: 'unknown', raw };
  }
}

const dec = (name, c) => (c.p ? `${name}(${c.p}${c.s ? ',' + c.s : ''})` : name);
const TYPES = {
  postgres: (c) => ({
    int: c.auto ? { 2: 'smallserial', 4: 'serial', 8: 'bigserial' }[c.size] : { 2: 'smallint', 4: 'integer', 8: 'bigint' }[c.size],
    bool: 'boolean', decimal: dec('numeric', c), float: c.size === 4 ? 'real' : 'double precision',
    varchar: `varchar(${c.n})`, char: `char(${c.n})`, text: 'text', uuid: 'uuid', date: 'date', time: 'time',
    timestamp: c.tz ? 'timestamptz' : 'timestamp', json: 'jsonb', binary: 'bytea', enum: 'text',
  }[c.kind]),
  mysql: (c) => ({
    int: { 2: 'smallint', 4: 'int', 8: 'bigint' }[c.size] + (c.auto ? ' AUTO_INCREMENT' : ''),
    bool: 'tinyint(1)', decimal: dec('decimal', c), float: c.size === 4 ? 'float' : 'double',
    varchar: `varchar(${c.n})`, char: `char(${c.n})`, text: 'text', uuid: 'char(36)', date: 'date', time: 'time',
    timestamp: c.tz ? 'timestamp' : 'datetime', json: 'json', binary: 'blob',
    enum: c.values && c.values.length ? `enum(${c.values.join(',')})` : 'varchar(255)',
  }[c.kind]),
  sqlite: (c) => ({
    int: 'INTEGER', bool: 'INTEGER', decimal: 'NUMERIC', float: 'REAL', varchar: 'TEXT', char: 'TEXT', text: 'TEXT',
    uuid: 'TEXT', date: 'TEXT', time: 'TEXT', timestamp: 'TEXT', json: 'TEXT', binary: 'BLOB', enum: 'TEXT',
  }[c.kind]),
  sqlserver: (c) => ({
    int: { 2: 'smallint', 4: 'int', 8: 'bigint' }[c.size] + (c.auto ? ' IDENTITY(1,1)' : ''),
    bool: 'bit', decimal: dec('decimal', c), float: c.size === 4 ? 'real' : 'float',
    varchar: `nvarchar(${c.n})`, char: `nchar(${c.n})`, text: 'nvarchar(max)', uuid: 'uniqueidentifier', date: 'date', time: 'time',
    timestamp: c.tz ? 'datetimeoffset' : 'datetime2', json: 'nvarchar(max)', binary: 'varbinary(max)', enum: 'nvarchar(255)',
  }[c.kind]),
  snowflake: (c) => ({
    int: 'NUMBER(38,0)' + (c.auto ? ' AUTOINCREMENT' : ''), bool: 'BOOLEAN', decimal: dec('NUMBER', c), float: 'FLOAT',
    varchar: `VARCHAR(${c.n})`, char: `CHAR(${c.n})`, text: 'VARCHAR', uuid: 'VARCHAR(36)', date: 'DATE', time: 'TIME',
    timestamp: c.tz ? 'TIMESTAMP_TZ' : 'TIMESTAMP_NTZ', json: 'VARIANT', binary: 'BINARY', enum: 'VARCHAR',
  }[c.kind]),
};

// A column type translated for `dialect` (unchanged when it isn't recognised).
export function convertType(raw, dialect) {
  const c = classify(raw);
  const out = TYPES[dialect] && c.kind !== 'unknown' && c.kind !== 'array' ? TYPES[dialect](c) : null;
  return out || String(raw || '').trim() || (dialect === 'sqlite' ? 'TEXT' : 'text');
}

export function createTableSQL(t, dialect, relations = []) {
  const q = QUOTE[dialect] || QUOTE.postgres;
  const pks = t.columns.filter((c) => c.pk);
  const lines = t.columns.map((c) => {
    let s = `  ${q(c.name)} ${convertType(c.typeRaw || c.type, dialect)}`;
    if (pks.length === 1 && c.pk) s += ' PRIMARY KEY';
    else if (c.nn) s += ' NOT NULL';
    if (c.unique && !(pks.length === 1 && c.pk)) s += ' UNIQUE';
    return s;
  });
  if (pks.length > 1) lines.push(`  PRIMARY KEY (${pks.map((c) => q(c.name)).join(', ')})`);
  for (const r of relations) lines.push('  ' + fkClause(r, q));       // inline FKs (SQLite)
  return `CREATE TABLE ${q(t.name)} (\n${lines.join(',\n')}\n);`;
}

function fkClause(r, q) {
  const to = r.toCols && r.toCols.length ? ` (${r.toCols.map(q).join(', ')})` : '';
  return `FOREIGN KEY (${r.fromCols.map(q).join(', ')}) REFERENCES ${q(r.toTable)}${to}`;
}
export function addForeignKeySQL(r, dialect) {
  const q = QUOTE[dialect] || QUOTE.postgres;
  const name = `fk_${r.fromTable}_${r.fromCols.join('_')}`.replace(/\W+/g, '_').slice(0, 60);
  return `ALTER TABLE ${q(r.fromTable)} ADD CONSTRAINT ${q(name)} ${fkClause(r, q)};`;
}

// Whole schema: tables first, then foreign keys (so table order never matters).
// SQLite can't add a constraint afterwards, so its FKs go inside CREATE TABLE.
export function toSQL(model, dialect = 'postgres') {
  const rels = model.relations.filter((r) => !r.toMissing && r.fromCols.length);
  const inline = dialect === 'sqlite';
  const out = [`-- ${SQL_DIALECTS[dialect] || dialect} schema · generated by sqltoerdiagram.com`, ''];
  for (const t of model.tables) {
    const mine = inline ? rels.filter((r) => r.fromTable.toLowerCase() === t.key) : [];
    out.push(createTableSQL(t, dialect, mine), '');
  }
  if (!inline) for (const r of rels) out.push(addForeignKeySQL(r, dialect));
  return out.join('\n').trimEnd() + '\n';
}
