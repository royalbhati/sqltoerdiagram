// Parser regression corpus. Every file in test/fixtures is parsed (format
// auto-detected) and its summary — tables, columns, keys, relations, warnings —
// is compared with the checked-in snapshot. A parser change that alters what
// any real-world-shaped schema produces shows up here as a diff.
//
//   node test/parse.test.mjs            compare
//   node test/parse.test.mjs --update   rewrite the snapshot after reviewing a change
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSchema, loadAllFormats } from '../src/parse.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SNAP = join(DIR, 'snapshot.json');
await loadAllFormats();

function summarize(text) {
  const m = parseSchema(text, 'auto');
  return {
    format: m.format,
    tables: m.tables.map((t) => ({
      name: t.name,
      columns: t.columns.map((c) => [c.name, c.type || '', [c.pk && 'pk', c.fk && 'fk', c.unique && 'unique', c.nn && 'notnull'].filter(Boolean).join(' ')].join(' | ').replace(/ \| $/, '')),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    relations: m.relations.map((r) => `${r.fromTable}(${r.fromCols.join(',')}) -> ${r.toTable}(${r.toCols.join(',')})`).sort(),
    warnings: m.warnings.map((w) => w.message),
  };
}

const actual = {};
for (const f of readdirSync(DIR).filter((f) => f !== 'snapshot.json').sort()) {
  actual[f] = summarize(readFileSync(join(DIR, f), 'utf8'));
}

if (process.argv.includes('--update') || !existsSync(SNAP)) {
  writeFileSync(SNAP, JSON.stringify(actual, null, 2) + '\n');
  console.log(`snapshot written (${Object.keys(actual).length} fixtures)`);
  process.exit(0);
}

const expected = JSON.parse(readFileSync(SNAP, 'utf8'));
let pass = 0, fail = 0;
for (const f of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
  const a = JSON.stringify(actual[f], null, 2), e = JSON.stringify(expected[f], null, 2);
  if (a === e) { pass++; continue; }
  fail++;
  console.error(`  ✗ ${f}`);
  const al = (a || '(fixture missing)').split('\n'), el = (e || '(not in snapshot)').split('\n');
  for (let i = 0; i < Math.max(al.length, el.length); i++) {
    if (al[i] !== el[i]) { console.error(`      expected: ${el[i] ?? ''}\n      actual:   ${al[i] ?? ''}`); break; }
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
