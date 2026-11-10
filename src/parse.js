// Input-format dispatcher. SQL is the editable core; Prisma / SQLAlchemy /
// Sequelize are parse-only. Auto-detects from the text unless a format is forced.
import { parseSchema as parseSQL } from './parser.js';

// SQL ships in the main bundle; every other format's parser is fetched the
// first time that format is seen, so most visits never download them.
const LOADERS = {
  bigquery: () => import('./formats/bigquery.js').then(m => m.parseBigQuery),
  prisma: () => import('./formats/prisma.js').then(m => m.parsePrisma),
  dbml: () => import('./formats/dbml.js').then(m => m.parseDBML),
  mermaid: () => import('./formats/mermaid.js').then(m => m.parseMermaid),
  plantuml: () => import('./formats/plantuml.js').then(m => m.parsePlantUML),
  sqlalchemy: () => import('./formats/sqlalchemy.js').then(m => m.parseSQLAlchemy),
  sequelize: () => import('./formats/sequelize.js').then(m => m.parseSequelize),
  typeorm: () => import('./formats/typeorm.js').then(m => m.parseTypeORM),
  django: () => import('./formats/django.js').then(m => m.parseDjango),
};
const parsers = { sql: parseSQL };   // format -> parse function, once loaded
const loading = {};                  // format -> in-flight promise

// The concrete format a (text, choice) pair will be parsed as.
export function resolveFormat(text, format = 'auto') {
  const fmt = format && format !== 'auto' ? format : detectFormat(text);
  return LOADERS[fmt] || fmt === 'sql' ? fmt : 'sql';
}
export function formatReady(fmt) { return !!parsers[fmt]; }
// Make a format's parser available. Resolves immediately if it already is.
export function loadFormat(fmt) {
  if (parsers[fmt] || !LOADERS[fmt]) return Promise.resolve();
  if (!loading[fmt]) {
    loading[fmt] = LOADERS[fmt]()
      .then((fn) => { parsers[fmt] = fn; })
      .finally(() => { delete loading[fmt]; });
  }
  return loading[fmt];
}
// For non-interactive callers (CLI, tests): load everything up front.
export function loadAllFormats() { return Promise.all(Object.keys(LOADERS).map(loadFormat)); }

export const FORMATS = {
  auto: 'Auto-detect',
  sql: 'SQL',
  bigquery: 'BigQuery',
  prisma: 'Prisma',
  dbml: 'DBML',
  mermaid: 'Mermaid',
  plantuml: 'PlantUML',
  sqlalchemy: 'SQLAlchemy',
  sequelize: 'Sequelize',
  typeorm: 'TypeORM',
  django: 'Django',
};

export function detectFormat(text) {
  const t = text || '';
  if (/^\s*erDiagram\b/m.test(t)) return 'mermaid';
  if (/@startuml\b/.test(t) || (/\b(entity|class)\s+("?\w)/.test(t) && /\|\|--|\}o|--\{|<<PK>>/.test(t))) return 'plantuml';
  if (/^\s*Table\s+[^\s{]+\s*\{/m.test(t) || /^\s*Ref\b[^:]*:/m.test(t)) return 'dbml';
  if (/^\s*model\s+\w+\s*\{/m.test(t) || /\b(datasource|generator)\s+\w+\s*\{/.test(t)) return 'prisma';
  if (/@Entity\s*\(/.test(t) && /@(Column|PrimaryGeneratedColumn|PrimaryColumn)\s*\(/.test(t)) return 'typeorm';
  if (/\bmodels\.Model\b/.test(t) && /\bmodels\.(\w+Field|ForeignKey)\s*\(/.test(t)) return 'django';
  if (/\.define\s*\(\s*['"]/.test(t) || (/DataTypes\./.test(t) && /\.init\s*\(/.test(t))) return 'sequelize';
  if (/\bColumn\s*\(|mapped_column\s*\(/.test(t) && /\b(Base|db\.Model|DeclarativeBase|declarative_base|__tablename__)\b/.test(t)) return 'sqlalchemy';
  if (/^\s*with\b/i.test(t) && /`[^`]+\.[^`]+`/.test(t)) return 'bigquery';
  return 'sql';
}

// Synchronous. The format's parser must be loaded first (see loadFormat) —
// SQL always is.
export function parseSchema(text, format = 'auto') {
  const fmt = resolveFormat(text, format);
  const parse = parsers[fmt];
  if (!parse) throw new Error(`Parser for "${fmt}" is not loaded yet — await loadFormat("${fmt}") first`);
  let res;
  try {
    res = parse(text);
  } catch (e) {
    res = { tables: [], relations: [], errors: [String(e && e.message || e)] };
  }
  if (!Array.isArray(res.warnings)) res.warnings = [];
  res.format = fmt;
  res.editable = fmt === 'sql';   // only SQL supports two-way canvas editing
  return res;
}
