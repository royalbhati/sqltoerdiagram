// Serialize the normalized model ({ tables, relations }) to text formats.
// Used by the Export menu and by the converter landing pages.
//
// Model shape (see formats/util.js):
//   table:  { name, key, columns:[{ name, type, pk, nn, unique, fk }] }
//   rel:    { fromTable, fromCols[], toTable, toCols[], toMissing }
// A relation means fromTable.fromCols references toTable.toCols (FK -> PK side).

const WORD = /^[A-Za-z_]\w*$/;

// ---- Mermaid erDiagram ----
function mmName(s) {
  return WORD.test(s) ? s : '"' + String(s).replace(/"/g, '') + '"';
}
function mmType(t) {
  if (!t) return 'unknown';
  // Mermaid attribute types must be a single token: collapse whitespace,
  // keep parens/commas so numeric(10,2) survives.
  return t.trim().replace(/\s+/g, '_').replace(/[^\w(),]/g, '') || 'unknown';
}
export function toMermaid(model) {
  const L = ['erDiagram'];
  for (const t of model.tables) {
    L.push('    ' + mmName(t.name) + ' {');
    for (const c of t.columns) {
      const keys = [];
      if (c.pk) keys.push('PK');
      if (c.fk) keys.push('FK');
      if (c.unique && !c.pk) keys.push('UK');
      L.push('        ' + mmType(c.type) + ' ' + mmName(c.name) + (keys.length ? ' ' + keys.join(',') : ''));
    }
    L.push('    }');
  }
  for (const r of model.relations) {
    if (r.toMissing) continue;
    const label = (r.fromCols && r.fromCols[0]) || 'fk';
    // parent (PK side) ||--o{ child (FK side)
    L.push('    ' + mmName(r.toTable) + ' ||--o{ ' + mmName(r.fromTable) + ' : ' + JSON.stringify(label));
  }
  return L.join('\n') + '\n';
}

// ---- DBML (dbdiagram.io) ----
function dq(s) { return '"' + String(s).replace(/"/g, '') + '"'; }
function dbmlType(t) {
  if (!t) return 'unknown';
  const s = t.trim();
  // bare single-token types stay unquoted; anything with spaces gets quoted
  return /^[\w()]+$/.test(s) ? s : dq(s);
}
export function toDBML(model, annotations = []) {
  const L = [];
  for (const t of model.tables) {
    L.push('Table ' + dq(t.name) + ' {');
    for (const c of t.columns) {
      const set = [];
      if (c.pk) set.push('pk');
      if (c.unique && !c.pk) set.push('unique');
      if (c.nn && !c.pk) set.push('not null');
      L.push('  ' + dq(c.name) + ' ' + dbmlType(c.type) + (set.length ? ' [' + set.join(', ') + ']' : ''));
    }
    L.push('}');
    L.push('');
  }
  for (const r of model.relations) {
    if (r.toMissing) continue;
    const fc = r.fromCols && r.fromCols[0];
    const tc = r.toCols && r.toCols[0];
    if (!fc || !tc) continue;
    L.push('Ref: ' + dq(r.fromTable) + '.' + dq(fc) + ' > ' + dq(r.toTable) + '.' + dq(tc));
  }
  if (model.relations.length) L.push('');

  // Groups from annotations or model.groups
  const byKey = new Map(model.tables.map(t => [t.key, t]));
  const groupAnnotations = Array.isArray(annotations) ? annotations.filter(a => a.type === 'group') : [];
  if (groupAnnotations.length) {
    for (const a of groupAnnotations) {
      let memberNames = [];
      if (Array.isArray(a.tables) && a.tables.length) {
        memberNames = a.tables.map(k => byKey.get(String(k).toLowerCase())?.name).filter(Boolean);
      } else {
        for (const t of model.tables) {
          if (Number.isFinite(t.x) && t.x >= a.x - 10 && t.x + t.w <= a.x + a.w + 10 &&
              t.y >= a.y - 10 && t.y + t.h <= a.y + a.h + 10) {
            memberNames.push(t.name);
          }
        }
      }
      if (!memberNames.length) continue;
      const settings = [];
      if (a.color && a.color !== 'blue') settings.push('color: ' + a.color);
      if (a.note) settings.push('note: ' + dq(a.note));
      const setStr = settings.length ? ' [' + settings.join(', ') + ']' : '';
      L.push('TableGroup ' + dq(a.text || 'Group') + setStr + ' {');
      for (const name of memberNames) {
        L.push('  ' + dq(name));
      }
      L.push('}');
      L.push('');
    }
  } else if (Array.isArray(model.groups) && model.groups.length) {
    for (const g of model.groups) {
      const memberNames = (g.tables || []).map(k => byKey.get(String(k).toLowerCase())?.name || k);
      if (!memberNames.length) continue;
      const settings = [];
      if (g.color && g.color !== 'blue') settings.push('color: ' + g.color);
      if (g.note) settings.push('note: ' + dq(g.note));
      const setStr = settings.length ? ' [' + settings.join(', ') + ']' : '';
      L.push('TableGroup ' + dq(g.name || 'Group') + setStr + ' {');
      for (const name of memberNames) {
        L.push('  ' + dq(name));
      }
      L.push('}');
      L.push('');
    }
  }

  return L.join('\n').trim() + '\n';
}

// ---- PlantUML (entity / IE notation) ----
function puAlias(s, used) {
  let a = String(s).replace(/[^A-Za-z0-9_]/g, '_');
  if (!a || /^\d/.test(a)) a = 'e_' + a;
  let base = a, i = 2;
  while (used.has(a)) a = base + '_' + (i++);
  used.add(a);
  return a;
}
export function toPlantUML(model) {
  const L = ['@startuml', 'hide circle', 'skinparam linetype ortho', ''];
  const alias = new Map();
  const used = new Set();
  for (const t of model.tables) alias.set(t.key, puAlias(t.name, used));
  for (const t of model.tables) {
    L.push('entity ' + JSON.stringify(t.name) + ' as ' + alias.get(t.key) + ' {');
    const pks = t.columns.filter((c) => c.pk);
    const rest = t.columns.filter((c) => !c.pk);
    for (const c of pks) L.push('  * ' + c.name + ' : ' + (c.type || '') + ' <<PK>>');
    if (pks.length && rest.length) L.push('  --');
    for (const c of rest) L.push('  ' + c.name + ' : ' + (c.type || '') + (c.fk ? ' <<FK>>' : ''));
    L.push('}');
    L.push('');
  }
  for (const r of model.relations) {
    if (r.toMissing) continue;
    const a = alias.get((r.fromTable || '').toLowerCase());
    const b = alias.get((r.toTable || '').toLowerCase());
    if (!a || !b) continue;
    L.push(b + ' ||--o{ ' + a);
  }
  L.push('@enduml');
  return L.join('\n') + '\n';
}

export function toDBMLLayout(model, annotations = [], camera = null, options = {}) {
  const tables = {};
  for (const t of (model?.tables || [])) {
    if (Number.isFinite(t.x)) {
      tables[t.key || t.name] = { x: Math.round(t.x), y: Math.round(t.y) };
    }
  }

  const groups = {};
  for (const a of (annotations || [])) {
    if (a.type === 'group') {
      groups[a.text || 'Group'] = {
        color: a.color,
        note: a.note || '',
        tables: a.tables || [],
      };
    }
  }

  const out = {
    version: 1,
    diagramLevel: options.diagramLevel || 'physical',
    edgeColorMode: options.edgeColorMode || 'multi',
    edgeRouting: options.edgeRouting || 'curved',
    orientation: options.orientation || 'LR',
    tables,
    groups,
    connections: options.connections || {},
    camera: camera || { x: 0, y: 0, scale: 1 },
  };

  const customNotes = (annotations || []).filter(a => a.type === 'note');
  if (customNotes.length) {
    out.customNotes = customNotes;
  }

  return JSON.stringify(out, null, 2);
}

// dispatcher used by the Export menu
export const SERIALIZERS = {
  mermaid: { label: 'Mermaid', ext: 'mmd', fn: toMermaid },
  dbml: { label: 'DBML', ext: 'dbml', fn: toDBML },
  plantuml: { label: 'PlantUML', ext: 'puml', fn: toPlantUML },
};

export function serialize(model, fmt, annotations = []) {
  const s = SERIALIZERS[fmt];
  return s ? s.fn(model, annotations) : '';
}

