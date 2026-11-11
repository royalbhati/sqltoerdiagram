// Validates the output of scripts/gen-landing.mjs. Read-only.
//   node scripts/check-landing.mjs
// Per generated page: exactly one <h1>, a canonical matching its sitemap URL, every JSON-LD
// block parses, og:image / twitter:image exist on disk and are 1200×630, every local <img>
// exists. Also: sitemap is well-formed with each page listed once, and llms.txt links every page.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngSize } from './render-diagram.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const ORIGIN = 'https://sqltoerdiagram.com';
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (f === 'index.html') acc.push(p);
  }
  return acc;
}
const pages = walk(PUB);
const urls = new Set();
const types = {};

for (const file of pages) {
  const rel = relative(PUB, file);
  const html = readFileSync(file, 'utf8');
  const url = `${ORIGIN}/${rel.replace(/index\.html$/, '')}`;
  urls.add(url);

  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) fail(rel, `${h1} <h1> elements`);
  const canon = html.match(/<link rel="canonical" href="([^"]*)"/g) || [];
  if (canon.length !== 1) fail(rel, `${canon.length} canonical links`);
  else if (!canon[0].includes(`href="${url}"`)) fail(rel, `canonical is ${canon[0]}, expected ${url}`);
  if (html.includes('__LASTMOD__')) fail(rel, 'unreplaced __LASTMOD__ placeholder');
  if (/\bundefined\b|\[object Object\]|\bNaN\b/.test(html.replace(/<pre>[\s\S]*?<\/pre>/g, ''))) fail(rel, 'contains "undefined" / "[object Object]" / "NaN"');

  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length) fail(rel, 'no JSON-LD');
  for (const [, json] of blocks) {
    try {
      const o = JSON.parse(json);
      types[o['@type']] = (types[o['@type']] || 0) + 1;
      if (/<[a-z/][^>]*>/i.test(JSON.stringify(o))) fail(rel, `JSON-LD ${o['@type']} contains HTML tags`);
      if (o['@type'] === 'TechArticle' && !/^\d{4}-\d\d-\d\d$/.test(o.dateModified)) fail(rel, `bad dateModified ${o.dateModified}`);
    } catch (e) { fail(rel, `invalid JSON-LD: ${e.message}`); }
  }

  for (const prop of ['property="og:image"', 'name="twitter:image"']) {
    const m = html.match(new RegExp(`<meta ${prop} content="([^"]*)"`));
    if (!m) { fail(rel, `missing ${prop}`); continue; }
    if (m[1] === `${ORIGIN}/og.png`) fail(rel, `${prop} is the generic fallback`);
    const p = join(PUB, m[1].replace(ORIGIN, ''));
    if (!existsSync(p)) { fail(rel, `${prop} file missing: ${m[1]}`); continue; }
    const { width, height } = pngSize(readFileSync(p));
    if (width !== 1200 || height !== 630) fail(rel, `${m[1]} is ${width}×${height}`);
  }
  for (const need of ['og:image:width', 'og:image:height', 'og:image:alt']) if (!html.includes(`property="${need}"`)) fail(rel, `missing ${need}`);

  const imgs = [...html.matchAll(/<img\s[^>]*>/g)].map((m) => m[0]);
  if (!imgs.length) fail(rel, 'no <img> on the page');
  if (!/<figure class="diagram">/.test(html) && rel !== 'examples/index.html') fail(rel, 'no diagram <figure>');
  for (const img of imgs) {
    const src = (img.match(/src="([^"]*)"/) || [])[1];
    if (!src || !existsSync(join(PUB, src))) fail(rel, `img file missing: ${src}`);
    else if (statSync(join(PUB, src)).size < 500) fail(rel, `img file suspiciously small: ${src}`);
    if (!/\swidth="\d+"/.test(img) || !/\sheight="\d+"/.test(img)) fail(rel, `img without width/height: ${src}`);
    if (!/\salt="[^"]{10,}"/.test(img)) fail(rel, `img without descriptive alt: ${src}`);
  }
}

// sitemap: well-formed enough to round-trip, every page exactly once, nothing extra but the home page
const sm = readFileSync(join(PUB, 'sitemap.xml'), 'utf8');
const open = (sm.match(/<url>/g) || []).length, close = (sm.match(/<\/url>/g) || []).length;
if (!sm.startsWith('<?xml') || open !== close || !sm.trimEnd().endsWith('</urlset>')) fail('sitemap.xml', 'not well-formed');
const locs = [...sm.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
const lastmods = [...sm.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map((m) => m[1]);
if (lastmods.length !== open || lastmods.some((d) => !/^\d{4}-\d\d-\d\d$/.test(d))) fail('sitemap.xml', 'bad or missing lastmod');
if (/&(?!amp;|lt;|gt;|quot;|apos;)/.test(sm)) fail('sitemap.xml', 'unescaped &');
for (const u of urls) {
  const n = locs.filter((l) => l === u).length;
  if (n !== 1) fail('sitemap.xml', `${u} listed ${n} times`);
}
for (const l of locs) if (l !== `${ORIGIN}/` && !urls.has(l)) fail('sitemap.xml', `${l} has no generated page`);
for (const [, img] of sm.matchAll(/<image:loc>([^<]*)<\/image:loc>/g)) if (!existsSync(join(PUB, img.replace(ORIGIN, '')))) fail('sitemap.xml', `image missing: ${img}`);

// manifest + llms files
const manifest = JSON.parse(readFileSync(join(ROOT, 'scripts', 'lastmod.json'), 'utf8'));
for (const l of locs) if (!manifest[l]) fail('lastmod.json', `no entry for ${l}`);
const llms = readFileSync(join(PUB, 'llms.txt'), 'utf8');
for (const u of urls) if (!llms.includes(`(${u})`)) fail('llms.txt', `does not link ${u}`);
const full = readFileSync(join(PUB, 'llms-full.txt'), 'utf8');
for (const u of urls) if (!full.includes(u)) fail('llms-full.txt', `does not mention ${u}`);
if (/<\/?(p|code|strong|ul|li|h3|pre|em|ol)>|&(amp|lt|gt|rarr);/.test(full)) fail('llms-full.txt', 'contains leftover HTML');

console.log(`${pages.length} pages · ${locs.length} sitemap urls · JSON-LD: ${Object.entries(types).map(([k, v]) => `${k}×${v}`).join(', ')}`);
console.log(`lastmod dates: ${[...new Set(lastmods)].join(', ')} · llms.txt ${llms.length} bytes · llms-full.txt ${full.length} bytes`);
if (errors.length) { console.error(`\n${errors.length} problem(s):\n` + errors.map((e) => '  - ' + e).join('\n')); process.exit(1); }
console.log('all checks passed');
