// Input-format dispatcher. SQL is the editable core; Prisma / SQLAlchemy /
// Sequelize are parse-only. Auto-detects from the text unless a format is forced.
import { parseSchema as parseSQL } from './parser.js';
import { parseBigQuery } from './formats/bigquery.js';
import { parsePrisma } from './formats/prisma.js';
import { parseSQLAlchemy } from './formats/sqlalchemy.js';
import { parseSequelize } from './formats/sequelize.js';
import { parseDBML } from './formats/dbml.js';
import { parseMermaid } from './formats/mermaid.js';
import { parsePlantUML } from './formats/plantuml.js';

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
};

export function detectFormat(text) {
  const t = text || '';
  if (/^\s*erDiagram\b/m.test(t)) return 'mermaid';
  if (/@startuml\b/.test(t) || (/\b(entity|class)\s+("?\w)/.test(t) && /\|\|--|\}o|--\{|<<PK>>/.test(t))) return 'plantuml';
  if (/^\s*Table\s+[^\s{]+\s*\{/m.test(t) || /^\s*Ref\b[^:]*:/m.test(t) || /^\s*TableGroup\b/m.test(t)) return 'dbml';
  if (/^\s*model\s+\w+\s*\{/m.test(t) || /\b(datasource|generator)\s+\w+\s*\{/.test(t)) return 'prisma';
  if (/\.define\s*\(\s*['"]/.test(t) || (/DataTypes\./.test(t) && /\.init\s*\(/.test(t))) return 'sequelize';
  if (/\bColumn\s*\(|mapped_column\s*\(/.test(t) && /\b(Base|db\.Model|DeclarativeBase|declarative_base|__tablename__)\b/.test(t)) return 'sqlalchemy';
  if (/^\s*with\b/i.test(t) && /`[^`]+\.[^`]+`/.test(t)) return 'bigquery';
  return 'sql';
}

export function parseSchema(text, format = 'auto') {
  const fmt = format && format !== 'auto' ? format : detectFormat(text);
  let res;
  try {
    switch (fmt) {
      case 'bigquery': res = parseBigQuery(text); break;
      case 'prisma': res = parsePrisma(text); break;
      case 'dbml': res = parseDBML(text); break;
      case 'mermaid': res = parseMermaid(text); break;
      case 'plantuml': res = parsePlantUML(text); break;
      case 'sqlalchemy': res = parseSQLAlchemy(text); break;
      case 'sequelize': res = parseSequelize(text); break;
      default: res = parseSQL(text);
    }
  } catch (e) {
    res = { tables: [], relations: [], errors: [String(e && e.message || e)] };
  }
  res.format = fmt;
  res.editable = fmt === 'sql' || fmt === 'dbml';   // SQL & DBML support two-way canvas editing
  return res;
}
