// Django models parser — best-effort for models.py:
//
//   class Author(models.Model):
//       name = models.CharField(max_length=100)
//
//   class Book(models.Model):
//       author = models.ForeignKey(Author, on_delete=models.CASCADE)
//       tags = models.ManyToManyField("Tag")
//
// Follows Django's own rules where they shape the diagram: an implicit `id`
// primary key unless a field sets primary_key=True; ForeignKey / OneToOneField
// become an `<name>_id` column + relation; ManyToManyField becomes a junction
// table; fields of abstract base models are inherited. A table takes its name
// from `class Meta: db_table = "…"` when the model sets one, otherwise from the
// model class (Django's default `app_model` name needs the app label, which a
// models.py doesn't contain). Python isn't fully parsed — dynamic or unusual
// code may be missed.
import { makeTable, addColumn, finalize, balanced, splitTopCommas } from './util.js';

const REL = new Set(['ForeignKey', 'OneToOneField', 'ManyToManyField']);
const TYPES = {
  AutoField: 'int', BigAutoField: 'bigint', SmallAutoField: 'smallint', CharField: 'varchar', TextField: 'text', SlugField: 'varchar',
  EmailField: 'varchar', URLField: 'varchar', UUIDField: 'uuid', IntegerField: 'int', BigIntegerField: 'bigint', SmallIntegerField: 'smallint',
  PositiveIntegerField: 'int', PositiveBigIntegerField: 'bigint', PositiveSmallIntegerField: 'smallint', FloatField: 'float', DecimalField: 'decimal',
  BooleanField: 'boolean', NullBooleanField: 'boolean', DateField: 'date', DateTimeField: 'timestamp', TimeField: 'time', DurationField: 'interval',
  JSONField: 'json', BinaryField: 'bytea', FileField: 'varchar', ImageField: 'varchar', GenericIPAddressField: 'inet', IPAddressField: 'inet',
};
const kw = (args, key) => { const m = args.match(new RegExp(`\\b${key}\\s*=\\s*(?:['"]([^'"]*)['"]|([\\w.]+))`)); return m ? (m[1] ?? m[2]) : ''; };
const isTrue = (args, key) => kw(args, key) === 'True';
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

// the indented block that follows a `class …:` line
function classBody(text, from) {
  const lines = text.slice(from).split('\n');
  const out = [];
  let indent = null;
  for (const line of lines) {
    if (!line.trim()) { out.push(''); continue; }
    const ind = line.match(/^[ \t]*/)[0].length;
    if (indent === null) { if (ind === 0) break; indent = ind; }
    if (ind < indent) break;
    out.push(line);
  }
  return out.join('\n');
}

export function parseDjango(src) {
  const text = (src || '').replace(/#[^\n'"]*$/gm, '');          // drop trailing comments without quotes in them
  const models = [];                                              // { name, bases, fields, abstract }
  const classRe = /^class\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/gm;
  let m;
  while ((m = classRe.exec(text))) {
    const body = classBody(text, m.index + m[0].length);
    const fields = [];
    const fieldRe = /^[ \t]+([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*(?:[\w.]+\.)?([A-Z]\w*Field|ForeignKey)\s*\(/gm;
    let f;
    while ((f = fieldRe.exec(body))) {
      const b = balanced(body, f.index + f[0].length - 1, '(', ')');
      if (!b) continue;
      fields.push({ name: f[1], kind: f[2], args: body.slice(b[0], b[1]) });
      fieldRe.lastIndex = b[2];
    }
    const bases = m[2].split(',').map((s) => s.trim().split('.').pop()).filter(Boolean);
    const abstract = /class\s+Meta\b[\s\S]*?\babstract\s*=\s*True/.test(body);
    const dbTable = (body.match(/class\s+Meta\b[\s\S]*?\bdb_table\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
    if (fields.length || bases.includes('Model') || abstract) models.push({ name: m[1], bases, fields, abstract, dbTable });
  }

  const byName = new Map(models.map((x) => [x.name, x]));
  const allFields = (model, seen = new Set()) => {                // own fields after inherited abstract ones
    if (seen.has(model.name)) return [];
    seen.add(model.name);
    const inherited = model.bases.map((b) => byName.get(b)).filter((b) => b && b.abstract).flatMap((b) => allFields(b, seen));
    return [...inherited, ...model.fields];
  };
  // only real models: concrete, and a Django model directly or through a parsed base
  const isModel = (x, seen = new Set()) => !seen.has(x.name) && (seen.add(x.name), x.bases.includes('Model') || x.bases.some((b) => byName.has(b) && isModel(byName.get(b), seen)));

  const tables = [], rels = [], junctions = [];
  const tableOf = new Map();
  for (const model of models) {
    if (model.abstract || !isModel(model)) continue;
    const fields = allFields(model);
    const table = makeTable(model.dbTable || model.name);
    if (!fields.some((f) => isTrue(f.args, 'primary_key'))) addColumn(table, { name: 'id', type: 'bigint', pk: true, nn: true });
    for (const f of fields) {
      const first = (splitTopCommas(f.args)[0] || '').trim();
      if (REL.has(f.kind)) {
        // target: Author | "Author" | "app.Author" | "self"
        let to = first.replace(/^to\s*=\s*/, '').replace(/['"]/g, '').split('.').pop();
        if (to === 'self') to = model.name;
        if (f.kind === 'ManyToManyField') { junctions.push({ from: model.name, field: f.name, to, through: kw(f.args, 'through') }); continue; }
        const col = kw(f.args, 'db_column') || `${f.name}_id`;
        addColumn(table, { name: col, type: 'bigint', pk: isTrue(f.args, 'primary_key'), nn: !isTrue(f.args, 'null'), unique: f.kind === 'OneToOneField' || isTrue(f.args, 'unique') });
        rels.push({ fromTable: table.name, fromCols: [col], toModel: to, toCols: [null] });
        continue;
      }
      let type = TYPES[f.kind] || f.kind.replace(/Field$/, '').toLowerCase();
      const len = kw(f.args, 'max_length'), digits = kw(f.args, 'max_digits'), places = kw(f.args, 'decimal_places');
      if (len && /^\d+$/.test(len)) type += `(${len})`;
      else if (digits) type += `(${digits}${places ? ',' + places : ''})`;
      const pk = isTrue(f.args, 'primary_key');
      addColumn(table, { name: kw(f.args, 'db_column') || f.name, type, pk, nn: pk || !isTrue(f.args, 'null'), unique: isTrue(f.args, 'unique') });
    }
    tables.push(table);
    tableOf.set(model.name, table);
  }

  const pkOf = (name) => { const t = tableOf.get(name); const pk = t && t.columns.find((c) => c.pk); return pk ? pk.name : 'id'; };
  // relations were recorded by model name; the diagram links tables
  const nameOf = (model) => (tableOf.get(model) ? tableOf.get(model).name : model);
  for (const r of rels) { r.toCols = [pkOf(r.toModel)]; r.toTable = nameOf(r.toModel); }
  for (const j of junctions) {
    if (j.through || !j.to) continue;                              // an explicit through model is already a table
    const t = makeTable(`${byName.get(j.from).dbTable || snake(j.from)}_${j.field}`);
    const a = `${snake(j.from)}_id`, b = j.to === j.from ? `to_${snake(j.to)}_id` : `${snake(j.to)}_id`;
    addColumn(t, { name: 'id', type: 'bigint', pk: true, nn: true });
    addColumn(t, { name: a, type: 'bigint', nn: true });
    addColumn(t, { name: b, type: 'bigint', nn: true });
    tables.push(t);
    rels.push({ fromTable: t.name, fromCols: [a], toTable: nameOf(j.from), toCols: [pkOf(j.from)] });
    rels.push({ fromTable: t.name, fromCols: [b], toTable: nameOf(j.to), toCols: [pkOf(j.to)] });
  }
  return finalize(tables, rels);
}
