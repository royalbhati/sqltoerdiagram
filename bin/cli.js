#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseSchema } from '../src/parse.js';
import { layout } from '../src/layout.js';
import { exportSVG } from '../src/svg-export.js';

const HELP = `
Usage: sql-to-er-diagram [options] [input-file]

  input-file           SQL (or other supported format) file. Reads stdin if omitted.

Options:
  -o, --output <file>  Write SVG to file instead of stdout
  --format <fmt>       auto|sql|bigquery|prisma|dbml|mermaid|plantuml|sqlalchemy|sequelize  (default: auto)
  --theme <theme>      dark|light  (default: dark)
  --direction <dir>    LR|TB  (default: LR)
  --spacing <s>        compact|comfortable|spacious  (default: comfortable)
  -h, --help           Show this help

Examples:
  sql-to-er-diagram schema.sql > schema.svg
  sql-to-er-diagram schema.sql -o schema.svg --theme=light
  cat schema.sql | sql-to-er-diagram -o schema.svg
`.trim();

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    format:    { type: 'string', default: 'auto' },
    theme:     { type: 'string', default: 'dark' },
    direction: { type: 'string', default: 'LR' },
    spacing:   { type: 'string', default: 'comfortable' },
    output:    { type: 'string', short: 'o' },
    help:      { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  process.stdout.write(HELP + '\n');
  process.exit(0);
}

const inputFile = positionals[0];
const sql = inputFile
  ? readFileSync(inputFile, 'utf8')
  : readFileSync(process.stdin.fd, 'utf8');

const model = parseSchema(sql, values.format);
layout(model, { dir: values.direction, spacing: values.spacing });
const svg = exportSVG(model, values.theme);

if (!svg) {
  process.stderr.write('No tables found in input.\n');
  process.exit(1);
}

if (values.output) {
  writeFileSync(values.output, svg, 'utf8');
} else {
  process.stdout.write(svg);
}
