// Generates all programmatic SEO pages + the example gallery + the sitemap.
//   node scripts/gen-landing.mjs
//
// Besides the HTML it also writes, all derived from the same data files:
//   public/og/<key>.svg     the rendered diagram shown on the page (dark theme)
//   public/og/<key>.png     1200×630 social card (og:image / twitter:image)
//   public/sitemap.xml      lastmod comes from scripts/lastmod.json (content hashes)
//   public/llms.txt         index of every page, grouped, one line each
//   public/llms-full.txt    full plain-text content (guides, steps, FAQs) for LLMs
// Run scripts/check-landing.mjs afterwards to validate the output.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { PAGES, GLANCE, GLANCE_DEFAULTS } from './landing-data.mjs';
import { GUIDES } from './landing-guides.mjs';
import { GALLERY } from './gallery-data.mjs';
import { THIS_TOOL, COMPETITORS, HUB, DISCLOSURE } from './compare-data.mjs';
import { renderSchema, socialCard } from './render-diagram.mjs';
import { detectFormat } from '../src/parse.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://sqltoerdiagram.com';
const GH = 'https://github.com/royalbhati/sqltoerdiagram';

const TODAY = new Date().toISOString().slice(0, 10); // UTC date
const LASTMOD = '__LASTMOD__'; // placeholder, swapped for the page's real lastmod once its hash is known

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rarr: '→', larr: '←', hellip: '…', mdash: '—', ndash: '–', middot: '·' };
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
// HTML fragment → plain text (for JSON-LD, alt text, llms.txt): tags dropped, entities decoded.
const plain = (html) => decode(String(html).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
// HTML fragment → light Markdown (for llms-full.txt).
function md(html) {
  const pres = [];
  let s = String(html).replace(/<pre>(?:<code>)?([\s\S]*?)(?:<\/code>)?<\/pre>/g, (_, c) => {
    pres.push(decode(c).replace(/^\n+|\s+$/g, ''));
    return `\n\n@@PRE${pres.length - 1}@@\n\n`;
  });
  s = s
    .replace(/<h[34]>([\s\S]*?)<\/h[34]>/g, '\n\n#### $1\n\n')
    .replace(/<li>/g, '\n- ').replace(/<\/li>/g, '')
    .replace(/<\/?(ul|ol|p)>/g, '\n\n')
    .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
    .replace(/<\/?strong>/g, '**').replace(/<\/?em>/g, '*')
    .replace(/<[^>]+>/g, '');
  s = decode(s).replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s.replace(/@@PRE(\d+)@@/g, (_, i) => '```\n' + pres[+i] + '\n```');
}
// JSON-LD serialiser: `<` is escaped so no string can ever close the <script> element.
const ld = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
const list = (items) => items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// mirror src/share.js encodeShare(): deflate-raw + base64url, 'z' flag
function encodeShare(obj) {
  const bytes = deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8'));
  const b64 = bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'z' + b64;
}
const DIALECT_BY_SLUG = { mysql: 'mysql', mariadb: 'mysql', postgresql: 'postgres', sqlite: 'sqlite', 'sql-server': 'sqlserver', snowflake: 'snowflake' };
const shareHash = (sql, { dialect = 'postgres', format } = {}) =>
  '#s=' + encodeShare({ app: 'dbdiga', version: 1, sql, dialect, ...(format ? { format } : {}) });

const STYLE = `<style>
    :root { --bg:#0e1116; --panel:#161b22; --border:#262d38; --text:#e8edf4; --muted:#9aa4b2; --accent:#5aa7ff; }
    * { box-sizing:border-box; }
    html,body { margin:0; }
    body { background:var(--bg); color:var(--text); font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; line-height:1.6; -webkit-font-smoothing:antialiased; }
    a { color:var(--accent); text-decoration:none; }
    a:hover { text-decoration:underline; }
    .wrap { max-width:820px; margin:0 auto; padding:0 22px; }
    header { border-bottom:1px solid var(--border); }
    header .wrap { display:flex; align-items:center; gap:10px; height:58px; }
    header svg { width:22px; height:22px; color:var(--accent); }
    header .brand { font-weight:700; color:var(--text); }
    header nav { margin-left:auto; display:flex; gap:20px; font-size:14px; }
    .crumb { font-size:13px; color:var(--muted); padding:16px 0 0; }
    .hero { padding:26px 0 36px; }
    h1 { font-size:42px; line-height:1.1; letter-spacing:-.02em; margin:0 0 16px; }
    h1 .a { color:var(--accent); }
    .lead { font-size:19px; color:var(--muted); max-width:660px; margin:0 0 28px; }
    .cta { display:inline-block; background:var(--accent); color:#fff; font-weight:600; font-size:16px; padding:13px 24px; border-radius:10px; }
    .cta:hover { filter:brightness(1.08); text-decoration:none; }
    .cta.alt { background:transparent; color:var(--accent); border:1px solid var(--border); margin-left:8px; }
    .note { margin-top:14px; font-size:13px; color:var(--muted); }
    section { padding:30px 0; border-top:1px solid var(--border); }
    h2 { font-size:24px; letter-spacing:-.01em; margin:0 0 14px; }
    h3 { font-size:17px; margin:22px 0 4px; }
    p { color:#c4ccd6; }
    ol,ul { color:#c4ccd6; padding-left:22px; }
    li { margin:6px 0; }
    code { background:var(--panel); border:1px solid var(--border); border-radius:5px; padding:1px 5px; font-size:.92em; }
    pre { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:16px; overflow:auto; font-size:13px; line-height:1.5; color:#cdd6e0; font-family:ui-monospace,Menlo,Consolas,monospace; }
    pre code { background:none; border:0; padding:0; }
    .frame { width:100%; height:480px; border:1px solid var(--border); border-radius:12px; background:var(--panel); }
    .badges { display:flex; flex-wrap:wrap; gap:8px; margin:18px 0 0; }
    .badge { font-size:13px; color:#cdd6e0; background:var(--panel); border:1px solid var(--border); border-radius:999px; padding:6px 12px; }
    .related { display:flex; flex-wrap:wrap; gap:8px 18px; }
    .cols { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:4px 22px; width:100%; }
    .cols .col h4 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:14px 0 6px; }
    .cols .col a { display:block; font-size:14px; padding:2px 0; }
    .chips { display:flex; flex-wrap:wrap; gap:8px; }
    .chip { font-size:13px; color:#cdd6e0; background:var(--panel); border:1px solid var(--border); border-radius:999px; padding:4px 12px; font-family:ui-monospace,Menlo,Consolas,monospace; }
    .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px; padding:0; list-style:none; }
    .card { display:block; padding:16px; background:var(--panel); border:1px solid var(--border); border-radius:12px; }
    .card:hover { border-color:var(--accent); text-decoration:none; }
    .card .t { font-weight:600; color:var(--text); margin-bottom:4px; }
    .card .d { font-size:13px; color:var(--muted); }
    figure.diagram { margin:28px 0 0; }
    figure.diagram img { display:block; max-width:100%; height:auto; border:1px solid var(--border); border-radius:12px; background:#0e1116; }
    figcaption { font-size:13px; color:var(--muted); margin-top:8px; }
    .glance dl { display:grid; grid-template-columns:max-content 1fr; gap:10px 20px; margin:0; }
    .glance dt { color:var(--muted); font-weight:600; }
    .glance dd { margin:0; color:#c4ccd6; }
    @media (max-width:560px) { .glance dl { grid-template-columns:1fr; gap:2px; } .glance dd { margin-bottom:10px; } }
    .card img { display:block; width:100%; height:130px; object-fit:contain; background:#0e1116; border:1px solid var(--border); border-radius:8px; margin-bottom:12px; }
    .tablewrap { overflow-x:auto; }
    table.cmp { border-collapse:collapse; width:100%; font-size:15px; }
    table.cmp th, table.cmp td { text-align:left; vertical-align:top; padding:10px 12px; border-bottom:1px solid var(--border); color:#c4ccd6; }
    table.cmp th { color:var(--muted); font-size:13px; text-transform:uppercase; letter-spacing:.06em; }
    .fine { font-size:13px; color:var(--muted); }
    footer { border-top:1px solid var(--border); padding:26px 0 50px; color:var(--muted); font-size:14px; }
    footer .wrap { display:flex; gap:18px; flex-wrap:wrap; }
  </style>`;

// Umami: same cookieless analytics as the app. Landing pages are static, so plain
// auto-track is right here; data-exclude-hash keeps #fragments out of page stats.
// Never call umami.track() with a plain object — it replaces the payload (website id
// included) and the collector answers 400.
const UMAMI = `<script defer src="https://cloud.umami.is/script.js" data-website-id="27b5b4ba-93ad-4ef3-aaa0-af516881d308" data-exclude-hash="true"></script>`;

const HEADER = `<header>
    <div class="wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>
      <a class="brand" href="/">SQL to ER Diagram</a>
      <nav>
        <a href="/">Open tool</a>
        <a href="/examples/">Examples</a>
        <a href="${GH}" target="_blank" rel="noopener">GitHub</a>
      </nav>
    </div>
  </header>`;

// Full internal-link grid in the footer of every landing/gallery page.
const GROUPS = [
  { label: 'Databases', slugs: ['mysql', 'postgresql', 'sqlite', 'sql-server', 'oracle', 'mariadb', 'snowflake', 'bigquery'] },
  { label: 'Formats & ORMs', slugs: ['prisma', 'dbml', 'mermaid', 'sqlalchemy', 'sequelize', 'typeorm', 'django'] },
  { label: 'Converters', slugs: ['sql-to-mermaid', 'sql-to-dbml', 'sql-to-plantuml', 'prisma-to-dbml', 'dbml-to-mermaid', 'ddl-to-er-diagram', 'er-diagram-generator'] },
  { label: 'Viewers & visualizers', slugs: ['dbml-to-er-diagram', 'dbml-viewer', 'mermaid-to-erd', 'prisma-schema-visualizer', 'plantuml', 'plantuml-viewer'] },
];
const COMPARE_LINKS = [
  { href: `/${HUB.slug}/`, label: 'All alternatives' },
  ...COMPETITORS.map((c) => ({ href: `/vs/${c.slug}/`, label: `vs ${c.name}` })),
];
const bySlug = Object.fromEntries(PAGES.map((p) => [p.slug, p]));
{ // every landing page must be reachable from the footer grid
  const grouped = new Set(GROUPS.flatMap((g) => g.slugs));
  const missing = PAGES.filter((p) => !grouped.has(p.slug)).map((p) => p.slug);
  if (missing.length) throw new Error('landing pages missing from GROUPS (footer + llms.txt): ' + missing.join(', '));
}
function footerHtml() {
  const col = (label, links) => `      <div class="col"><h4>${label}</h4>\n${links.map((l) => `        <a href="${l.href}">${esc(l.label)}</a>`).join('\n')}\n      </div>`;
  const cols = [
    ...GROUPS.map((g) => col(g.label, g.slugs.filter((s) => bySlug[s]).map((s) => ({ href: `/${s}/`, label: bySlug[s].crumb })))),
    col('Compare', COMPARE_LINKS),
  ].join('\n');
  return `<footer>
    <div class="wrap">
      <div class="cols">
${cols}
      </div>
      <div style="display:flex; gap:18px; flex-wrap:wrap; margin-top:18px;">
        <a href="/">SQL to ER Diagram</a>
        <a href="/examples/">Schema examples</a>
        <a href="${GH}" target="_blank" rel="noopener">Open source on GitHub</a>
        <a href="https://yourbrowsercandoit.com/" target="_blank" rel="noopener">Part of yourbrowsercandoit.com ↗</a>
        <span>Free · runs in your browser</span>
      </div>
    </div>
  </footer>`;
}


// ---------- diagrams + social cards ----------
const OG_DIR = join(ROOT, 'public', 'og');
mkdirSync(OG_DIR, { recursive: true });
const DIAGRAMS = new Map();
// Render a schema once → public/og/<key>.svg. Returns null when nothing could be drawn.
function diagram(key, schema) {
  if (DIAGRAMS.has(key)) return DIAGRAMS.get(key);
  let d = null;
  try { d = renderSchema(schema); } catch (e) { console.warn(`! could not render diagram for ${key}: ${e.message}`); }
  if (d) {
    writeFileSync(join(OG_DIR, `${key}.svg`), d.svg);
    d = { ...d, key, src: `/og/${key}.svg` };
  }
  DIAGRAMS.set(key, d);
  return d;
}
const galleryDiagram = (slug) => {
  const g = GALLERY.find((x) => x.slug === slug);
  if (!g) throw new Error(`no gallery schema "${slug}"`);
  return { ...diagram(`examples-${g.slug}`, g.sql), label: `${g.name} example schema`, href: `/examples/${g.slug}/` };
};
const describeTables = (d) => `${list(d.tables)} (${plural(d.tables.length, 'table')}, ${plural(d.relations, 'relationship')})`;
function figureHtml(d, { alt, caption, eager = false }) {
  return `<figure class="diagram">
        <img src="${d.src}" width="${d.width}" height="${d.height}" alt="${attr(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" />
        <figcaption>${caption}</figcaption>
      </figure>`;
}
// 1200×630 card → public/og/<key>.png; returns the og:image descriptor for doc().
function card(key, title, d, alt) {
  writeFileSync(join(OG_DIR, `${key}.png`), socialCard({ title, diagram: d }));
  return { src: `${ORIGIN}/og/${key}.png`, alt };
}

function doc({ title, description, keywords, url, jsonld, body, image }) {
  const img = image || { src: `${ORIGIN}/og.png`, alt: 'SQL to ER Diagram' }; // generic fallback
  const scripts = jsonld.map(ld);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${attr(description)}" />
  <meta name="keywords" content="${attr(keywords)}" />
  <link rel="canonical" href="${url}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="SQL to ER Diagram" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="${attr(title)}" />
  <meta property="og:description" content="${attr(description)}" />
  <meta property="og:image" content="${img.src}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${attr(img.alt)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${attr(title)}" />
  <meta name="twitter:description" content="${attr(description)}" />
  <meta name="twitter:image" content="${img.src}" />
  <meta name="twitter:image:alt" content="${attr(img.alt)}" />
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />
  ${UMAMI}
${scripts.map((j) => `  <script type="application/ld+json">\n  ${j}\n  </script>`).join('\n')}
  ${STYLE}
</head>
<body>
  ${HEADER}
  ${body}
  ${footerHtml()}
</body>
</html>
`;
  // `core` is what lastmod is keyed on: the page's own content, not the shared chrome
  // (style, header, footer link grid), so adding a page elsewhere doesn't touch this one.
  return { html, core: JSON.stringify([title, description, img.alt, scripts, body]) };
}

const faqJsonLd = (faq) => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: faq.map((f) => ({ '@type': 'Question', name: plain(f.q), acceptedAnswer: { '@type': 'Answer', text: plain(f.a) } })),
});
// trail: [[name, url], …] after the home crumb
const crumbJsonLd = (...trail) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: [['SQL to ER Diagram', `${ORIGIN}/`], ...trail]
    .map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
});
// Short step name: the text up to the first clause break, capped at a word boundary.
function stepName(text) {
  let s = text.split(/\s[—–]\s|[.:;]\s/)[0];
  if (s.length > 70) s = s.slice(0, 70).replace(/\s+\S*$/, '') + '…';
  return s.replace(/[,.]$/, '');
}
const howToJsonLd = (p, url, image) => ({
  '@context': 'https://schema.org', '@type': 'HowTo',
  name: `How to use ${p.title.split(' — ')[0]}`,
  description: p.description,
  image: image.src,
  tool: [{ '@type': 'HowToTool', name: 'SQL to ER Diagram (web browser)' }],
  step: p.steps.map((s, i) => {
    const text = plain(s);
    return { '@type': 'HowToStep', position: i + 1, name: stepName(text), text, url: `${url}#how-it-works` };
  }),
});

const glanceFor = (slug) => {
  const g = GLANCE[slug];
  if (!g) throw new Error(`landing-data.mjs: no GLANCE entry for "${slug}"`);
  return {
    what: `SQL to ER Diagram is a free, open-source browser tool that turns ${g.thing} into ${g.outThing || GLANCE_DEFAULTS.outThing}.`,
    input: g.input,
    output: g.output || GLANCE_DEFAULTS.output,
    cost: GLANCE_DEFAULTS.cost, privacy: GLANCE_DEFAULTS.privacy, limits: GLANCE_DEFAULTS.limits,
  };
};
const GLANCE_ROWS = [['what', 'What it is'], ['input', 'Input'], ['output', 'Output'], ['cost', 'Cost'], ['privacy', 'Privacy'], ['limits', 'Limits']];
const glanceHtml = (g, rows = GLANCE_ROWS) => `<section class="glance" id="at-a-glance"><h2>At a glance</h2>
      <dl>
${rows.map(([k, label]) => `        <dt>${label}</dt><dd>${g[k]}</dd>`).join('\n')}
      </dl>
    </section>`;

// ---------- landing page ----------
function landingPage(p) {
  const url = `${ORIGIN}/${p.slug}/`;
  const head = p.title.split(' — ')[0];
  // the page's own sample schema, or a relevant gallery one if it has none / can't be drawn
  const own = p.example ? diagram(p.slug, p.example) : null;
  const d = own || galleryDiagram('ecommerce');
  const alt = own
    ? `ER diagram of the ${p.crumb} example schema: ${describeTables(d)}`
    : `ER diagram of the ${d.label}: ${describeTables(d)}`;
  const caption = own
    ? `The ${esc(p.crumb)} example below, drawn by the tool: ${esc(describeTables(d))}.`
    : `The <a href="${d.href}">${esc(d.label)}</a>, drawn by the tool: ${esc(describeTables(d))}.`;
  const image = card(p.slug, head, d, alt);
  const steps = p.steps.map((s) => `        <li>${s}</li>`).join('\n');
  const why = p.why.map((s) => `        <li>${s}</li>`).join('\n');
  const badges = p.badges.map((b) => `<span class="badge">${b}</span>`).join('');
  const faqHtml = p.faq.map((f) => `      <h3>${esc(f.q)}</h3>\n      <p>${f.a}</p>`).join('\n');
  const related = p.related.map((r) => `<a href="${r.href}">${r.label}</a>`).join('');
  const guide = p.guide ? `\n    <section><h2>${esc(p.guideTitle || 'Guide')}</h2>\n${p.guide}\n    </section>` : '';
  const example2 = p.example2 ? `      <p>${p.example2label || '…becomes:'}</p>\n      <pre>${esc(p.example2)}</pre>\n` : '';
  const body = `<main class="wrap">
    <div class="crumb"><a href="/">Home</a> › ${esc(p.crumb)}</div>
    <div class="hero">
      <h1>${p.h1}</h1>
      <p class="lead">${p.lead}</p>
      <a class="cta" href="/${shareHash(p.example, { dialect: DIALECT_BY_SLUG[p.slug], format: detectFormat(p.example) })}">Open the diagram tool →</a>
      <div class="note">No signup · nothing uploaded · export PNG / SVG / Mermaid / DBML · shareable link</div>
      ${figureHtml(d, { alt, caption, eager: true })}
    </div>
    ${glanceHtml(glanceFor(p.slug))}
    <section id="how-it-works"><h2>How it works</h2><ol>
${steps}
    </ol></section>
    <section><h2>Example</h2>
      <p>${p.exampleIntro}</p>
      <pre>${esc(p.example)}</pre>
${example2}      <p>${p.exampleAfter} <a href="/">Try it with your own &rarr;</a></p>
    </section>${guide}
    <section><h2>Why use it</h2><ul>
${why}
    </ul><div class="badges">${badges}</div></section>
    <section><h2>FAQ</h2>
${faqHtml}
    </section>
    <section><h2>Related</h2><div class="related">${related}</div></section>
  </main>`;
  return doc({
    title: p.title, description: p.description, keywords: p.keywords, url, image, body,
    jsonld: [faqJsonLd(p.faq), howToJsonLd(p, url, image), crumbJsonLd([p.crumb, url])],
  });
}

// ---------- gallery example page ----------
function galleryPage(g) {
  const url = `${ORIGIN}/examples/${g.slug}/`;
  const hash = shareHash(g.sql);
  const others = GALLERY.filter((x) => x.slug !== g.slug).map((x) => `<a href="/examples/${x.slug}/">${x.name}</a>`).join('');
  const tableNames = [...g.sql.matchAll(/CREATE TABLE (\w+)\s*\(/gi)].map((m) => m[1]);
  const chips = tableNames.map((t) => `<span class="chip">${t}</span>`).join('');
  const d = diagram(`examples-${g.slug}`, g.sql);
  if (!d) throw new Error(`gallery schema "${g.slug}" produced no diagram`);
  const alt = `ER diagram of the ${g.name} database schema: ${describeTables(d)}`;
  const image = card(`examples-${g.slug}`, `${g.name} database schema`, d, alt);
  const jsonld = [crumbJsonLd(['Examples', `${ORIGIN}/examples/`], [g.name + ' schema', url]), {
    '@context': 'https://schema.org', '@type': 'TechArticle',
    headline: g.title, description: g.description, url,
    image: [image.src, `${ORIGIN}${d.src}`],
    dateModified: LASTMOD,
    author: { '@type': 'Organization', name: 'SQL to ER Diagram', url: ORIGIN },
  }];
  const body = `<main class="wrap">
    <div class="crumb"><a href="/">Home</a> › <a href="/examples/">Examples</a> › ${esc(g.name)}</div>
    <div class="hero">
      <h1>${esc(g.name)} <span class="a">Schema</span></h1>
      <p class="lead">${g.lead}</p>
      <a class="cta" href="/${hash}">Open this schema in the editor →</a>
      <a class="cta alt" href="/examples/">All examples</a>
    </div>
    <section>
      <h2>Interactive diagram</h2>
      <iframe class="frame" src="/?embed=1${hash}" loading="lazy" title="${attr(g.name)} ER diagram"></iframe>
      <p class="note">Drag to pan, scroll to zoom. <a href="/${hash}">Open it in the full editor</a> to edit, rearrange and export.</p>
    </section>
    <section><h2>About this schema</h2><p>${g.about}</p></section>
    <section><h2>Tables in this schema</h2>
      <div class="chips">${chips}</div>
      <p>That's ${tableNames.length} tables connected by foreign keys — open the diagram to see every relationship drawn.</p>
      ${figureHtml(d, { alt, caption: `${esc(g.name)} ER diagram: ${esc(describeTables(d))}. <a href="${d.src}">Open the SVG</a>.` })}
    </section>
    <section><h2>Schema (SQL)</h2><pre>${esc(g.sql)}</pre>
      <p><a href="/${hash}">Open in the editor →</a> to export it as PNG, SVG, Mermaid or DBML. You can also convert it: <a href="/sql-to-mermaid/">SQL to Mermaid</a> · <a href="/sql-to-dbml/">SQL to DBML</a> · <a href="/sql-to-plantuml/">SQL to PlantUML</a>.</p>
    </section>
    <section><h2>More examples</h2><div class="related">${others}</div></section>
  </main>`;
  return doc({ title: g.title, description: g.description, keywords: g.keywords, url, jsonld, body, image });
}

// ---------- gallery index ----------
function galleryIndex() {
  const url = `${ORIGIN}/examples/`;
  const cards = GALLERY.map((g) => {
    const d = diagram(`examples-${g.slug}`, g.sql);
    const thumb = d ? `<img src="${d.src}" width="${d.width}" height="${d.height}" alt="${attr(`${g.name} schema ER diagram: ${list(d.tables)}`)}" loading="lazy" decoding="async" />` : '';
    return `<li><a class="card" href="/examples/${g.slug}/">${thumb}<div class="t">${esc(g.name)}</div><div class="d">${esc(g.description.split(' — ')[0])}</div></a></li>`;
  }).join('\n      ');
  const itemList = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: GALLERY.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: g.name + ' schema', url: `${ORIGIN}/examples/${g.slug}/` })),
  };
  const d = galleryDiagram('ecommerce');
  const image = card('examples', 'Database schema examples', d, `ER diagram of the ${d.label}: ${describeTables(d)}`);
  const body = `<main class="wrap">
    <div class="crumb"><a href="/">Home</a> › Examples</div>
    <div class="hero">
      <h1>Database Schema <span class="a">Examples</span></h1>
      <p class="lead">Ready-made example database schemas — e-commerce, blog, SaaS, social, and more — each as an interactive ER diagram you can open, edit and export.</p>
    </div>
    <section><ul class="cards">
      ${cards}
    </ul></section>
  </main>`;
  return doc({
    title: 'Database Schema Examples — Interactive ER Diagrams',
    description: 'A gallery of example database schemas (e-commerce, blog, SaaS, social network, project management, inventory) as interactive ER diagrams you can open and edit for free.',
    keywords: 'database schema examples, example er diagrams, sample database design, database schema templates',
    url, jsonld: [itemList, crumbJsonLd(['Examples', url])], body, image,
  });
}

// ---------- comparison pages ----------
const HUB_URL = `${ORIGIN}/${HUB.slug}/`;
const COMPARE_GLANCE = {
  what: 'SQL to ER Diagram is a free, open-source browser tool that turns a schema you already have into an interactive entity-relationship (ER) diagram.',
  input: 'SQL DDL for PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle, Snowflake and BigQuery, plus Prisma, DBML, Mermaid, PlantUML, SQLAlchemy and Sequelize schemas.',
  output: GLANCE_DEFAULTS.output, cost: GLANCE_DEFAULTS.cost, privacy: GLANCE_DEFAULTS.privacy, limits: GLANCE_DEFAULTS.limits,
};
const ul = (items) => `<ul>\n${items.map((s) => `        <li>${s}</li>`).join('\n')}\n      </ul>`;
const extLink = (c) => `<a href="${c.url}" target="_blank" rel="noopener nofollow">${esc(c.name)}</a>`;

function vsPage(c) {
  const url = `${ORIGIN}/vs/${c.slug}/`;
  const d = galleryDiagram(c.figure);
  const alt = `ER diagram drawn by SQL to ER Diagram from the ${d.label}: ${describeTables(d)}`;
  const image = card(`vs-${c.slug}`, `SQL to ER Diagram vs ${c.name}`, d, alt);
  const faq = [...c.faq, HUB.faq[2], HUB.faq[1]];
  const others = [{ href: `/${HUB.slug}/`, label: 'All alternatives' },
    ...COMPETITORS.filter((x) => x.slug !== c.slug).map((x) => ({ href: `/vs/${x.slug}/`, label: `SQL to ER Diagram vs ${x.name}` })),
    { href: '/er-diagram-generator/', label: 'ER diagram generator from SQL' }, { href: '/examples/', label: 'Schema examples' }];
  const body = `<main class="wrap">
    <div class="crumb"><a href="/">Home</a> › <a href="/${HUB.slug}/">Alternatives</a> › vs ${esc(c.name)}</div>
    <div class="hero">
      <h1>SQL to ER Diagram vs <span class="a">${esc(c.name)}</span></h1>
      <p class="lead">${c.lead}</p>
      <a class="cta" href="/">Open SQL to ER Diagram →</a>
      <div class="note">No signup · nothing uploaded · free and open source (MIT)</div>
      ${figureHtml(d, { alt, eager: true, caption: `Output of SQL to ER Diagram for the <a href="${d.href}">${esc(d.label)}</a>: ${esc(describeTables(d))}.` })}
    </div>
    ${glanceHtml(COMPARE_GLANCE)}
    <section><h2>What ${esc(c.name)} is</h2>
      <p>${c.about.join(' ')}</p>
      <p class="fine">See ${extLink(c)} for its current features and pricing.</p>
    </section>
    <section><h2>What SQL to ER Diagram is</h2>
      ${ul(THIS_TOOL.facts)}
    </section>
    <section><h2>When to choose which</h2>
      <h3>Choose SQL to ER Diagram when</h3>
      ${ul(c.chooseUs)}
      <h3>Choose ${esc(c.name)} when</h3>
      ${ul(c.chooseThem)}
      <h3>What SQL to ER Diagram does not do</h3>
      ${ul(THIS_TOOL.limits)}
    </section>
    <section><h2>FAQ</h2>
${faq.map((f) => `      <h3>${esc(f.q)}</h3>\n      <p>${f.a}</p>`).join('\n')}
    </section>
    <section><h2>Related</h2><div class="related">${others.map((r) => `<a href="${r.href}">${esc(r.label)}</a>`).join('')}</div>
      <p class="fine">${esc(DISCLOSURE)}</p>
    </section>
  </main>`;
  return doc({
    title: c.title, description: c.description, keywords: c.keywords, url, image, body,
    jsonld: [faqJsonLd(faq), crumbJsonLd(['Alternatives', HUB_URL], [`vs ${c.name}`, url])],
  });
}

function alternativesHub() {
  const d = galleryDiagram(HUB.figure);
  const alt = `ER diagram drawn by SQL to ER Diagram from the ${d.label}: ${describeTables(d)}`;
  const image = card(HUB.slug, 'ER diagram tool alternatives', d, alt);
  const cards = COMPETITORS.map((c) =>
    `<li><a class="card" href="/vs/${c.slug}/"><div class="t">SQL to ER Diagram vs ${esc(c.name)}</div><div class="d">${esc(plain(c.lead))}</div></a></li>`).join('\n      ');
  const rows = [
    `<tr><td><a href="/">SQL to ER Diagram</a></td><td>${esc(HUB.bestFor)}</td><td>This site</td></tr>`,
    ...COMPETITORS.map((c) => `<tr><td>${extLink(c)}</td><td>${esc(c.bestFor)}</td><td><a href="/vs/${c.slug}/">Comparison</a></td></tr>`),
  ].join('\n          ');
  const itemList = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: COMPETITORS.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: `SQL to ER Diagram vs ${c.name}`, url: `${ORIGIN}/vs/${c.slug}/` })),
  };
  const body = `<main class="wrap">
    <div class="crumb"><a href="/">Home</a> › Alternatives</div>
    <div class="hero">
      <h1>ER Diagram Tool <span class="a">Alternatives</span></h1>
      <p class="lead">${HUB.lead}</p>
      <a class="cta" href="/">Open SQL to ER Diagram →</a>
      <div class="note">No signup · nothing uploaded · free and open source (MIT)</div>
      ${figureHtml(d, { alt, eager: true, caption: `Output of SQL to ER Diagram for the <a href="${d.href}">${esc(d.label)}</a>: ${esc(describeTables(d))}.` })}
    </div>
    ${glanceHtml(COMPARE_GLANCE)}
    <section><h2>Which tool is built for what</h2>
      <div class="tablewrap"><table class="cmp">
        <thead><tr><th>Tool</th><th>Built for</th><th>Details</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table></div>
    </section>
    <section><h2>Comparisons</h2><ul class="cards">
      ${cards}
    </ul></section>
    <section><h2>What SQL to ER Diagram is</h2>
      ${ul(THIS_TOOL.facts)}
      <h3>What it does not do</h3>
      ${ul(THIS_TOOL.limits)}
    </section>
    <section><h2>FAQ</h2>
${HUB.faq.map((f) => `      <h3>${esc(f.q)}</h3>\n      <p>${f.a}</p>`).join('\n')}
      <p class="fine">${esc(DISCLOSURE)}</p>
    </section>
  </main>`;
  return doc({
    title: HUB.title, description: HUB.description, keywords: HUB.keywords, url: HUB_URL, image, body,
    jsonld: [faqJsonLd(HUB.faq), itemList, crumbJsonLd(['Alternatives', HUB_URL])],
  });
}

// ---------- llms.txt / llms-full.txt ----------
const FORMATS_LINE = 'PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle, Snowflake and BigQuery DDL';
const FEATURES = [
  'Undo and redo across both the canvas and the SQL text.',
  'A ⌘K command palette that jumps to any table or column.',
  'A minimap for large diagrams.',
  'Drop a .sql, Prisma, DBML, Mermaid or PlantUML file anywhere on the page to load it.',
  'Parse problems are underlined in the editor and listed in a clickable issue list.',
  'Copy the diagram to the clipboard as PNG, transparent PNG or SVG.',
  'Layout runs in a Web Worker and stays smooth at around 300 tables.',
  'Works offline after the first visit.',
  'Share links encode the diagram in the URL fragment, which is never sent to a server.',
  'Diagrams can be embedded in another page with an iframe.',
  'A headless CLI (`sql-to-er-diagram schema.sql -o schema.svg`) renders a schema file to SVG.',
];
const INTRO = `# SQL to ER Diagram

> Free, open-source tool that converts a SQL schema (CREATE TABLE / DDL) into an interactive entity-relationship diagram (ERD), entirely in the browser. Nothing is uploaded; no signup.

- Works with ${FORMATS_LINE}.
- Also reads Prisma, DBML, Mermaid, PlantUML, SQLAlchemy and Sequelize schemas.
- Exports PNG, SVG, Mermaid, DBML and PlantUML, saves projects as files, and shares diagrams as links that encode the diagram in the URL.
- MIT-licensed. No accounts, no paid plans. It never connects to a database itself (you paste schema text or the result of one read-only catalog query) and has no real-time multi-user editing.`;

function llmsTxt() {
  const line = (href, label, desc) => `- [${label}](${ORIGIN}${href}): ${plain(desc)}`;
  const out = [INTRO, '',
    '## Tool', '',
    `- [SQL to ER Diagram](${ORIGIN}/): the editor. Paste a schema, get a diagram.`,
    `- [Source code on GitHub](${GH}): MIT-licensed`,
    `- [Full text of every guide and FAQ](${ORIGIN}/llms-full.txt): one plain-text file`, ''];
  for (const g of GROUPS) {
    out.push(`## ${g.label}`, '');
    for (const s of g.slugs) if (bySlug[s]) out.push(line(`/${s}/`, bySlug[s].title.split(' — ')[0], bySlug[s].description));
    out.push('');
  }
  out.push('## Comparisons', '', line(`/${HUB.slug}/`, 'ER diagram tool alternatives', HUB.description));
  for (const c of COMPETITORS) out.push(line(`/vs/${c.slug}/`, `SQL to ER Diagram vs ${c.name}`, c.description));
  out.push('', '## Schema examples', '', line('/examples/', 'Database schema examples', 'Gallery of example database schemas, each with the full SQL and an interactive ER diagram.'));
  for (const g of GALLERY) out.push(line(`/examples/${g.slug}/`, `${g.name} database schema`, g.description));
  return out.join('\n') + '\n';
}

function llmsFullTxt(pages) {
  const g0 = GLANCE_DEFAULTS;
  const out = [INTRO, '',
    `Source: ${ORIGIN}/ · Code: ${GH} · Index of pages: ${ORIGIN}/llms.txt`, '',
    '## What it is', '',
    'SQL to ER Diagram is a free, open-source web tool that turns a database schema written as text into an interactive entity-relationship (ER) diagram. It is a static page: the schema is parsed and drawn in the browser.', '',
    '## Supported inputs', '',
    `- SQL DDL (CREATE TABLE / ALTER TABLE): ${FORMATS_LINE.replace(' DDL', '')}.`,
    '- Schema languages: Prisma (schema.prisma), DBML, Mermaid erDiagram, PlantUML entity and class diagrams.',
    '- ORM models: SQLAlchemy (Python) and Sequelize (JavaScript).',
    '- TypeORM and Django are supported through the SQL they generate, not by reading entity or model files.',
    '- BigQuery: CTE (WITH … AS) queries are drawn as a lineage diagram; BigQuery CREATE TABLE DDL is drawn as an ER diagram.', '',
    '## Outputs', '',
    '- Images: PNG, transparent PNG and SVG.',
    '- Schema code: Mermaid erDiagram, DBML and PlantUML.',
    '- A share link that encodes the whole diagram in the URL fragment, a saved project file, or an embeddable iframe.', '',
    '## Cost and privacy', '',
    `- ${g0.cost}`, `- ${g0.privacy}`, '',
    '## Limits', '',
    `- ${g0.limits}`, '',
    '## Features', '',
    ...FEATURES.map((f) => `- ${f}`), '',
    '## How to use it', '',
    '1. Paste a schema into the editor, or drop a schema file anywhere on the page. The format is detected automatically.',
    '2. Arrange the diagram: drag tables, auto-arrange, hide tables you do not need.',
    '3. Export it as PNG, SVG, Mermaid, DBML or PlantUML, or copy a share link.', ''];

  const seenQ = new Set();
  const faqMd = (faq) => {
    const fresh = faq.filter((f) => !seenQ.has(f.q));
    fresh.forEach((f) => seenQ.add(f.q));
    return fresh.flatMap((f) => [`**Q: ${plain(f.q)}**`, '', `A: ${md(f.a)}`, '']);
  };
  out.push('## General FAQ', '', ...faqMd(pages[0].faq.slice(-3).concat(HUB.faq)));

  for (const g of GROUPS) {
    out.push(`## ${g.label}`, '');
    for (const p of pages.filter((x) => g.slugs.includes(x.slug))) {
      const gl = glanceFor(p.slug);
      out.push(`### ${p.title.split(' — ')[0]}`, '', `URL: ${ORIGIN}/${p.slug}/`, '', md(p.lead), '',
        `- Input: ${md(gl.input)}`, `- Output: ${md(gl.output)}`, '',
        '#### Steps', '', ...p.steps.map((s, i) => `${i + 1}. ${md(s)}`), '',
        '#### Example', '', md(p.exampleIntro), '', '```', p.example, '```', '');
      if (p.example2) out.push(md(p.example2label || '…becomes:'), '', '```', p.example2, '```', '');
      out.push(md(p.exampleAfter), '');
      if (p.guide) out.push(`#### ${p.guideTitle || 'Guide'}`, '', md(p.guide), '');
      const faq = faqMd(p.faq);
      if (faq.length) out.push('#### FAQ', '', ...faq);
    }
  }

  out.push('## Comparisons', '', `URL: ${HUB_URL}`, '', DISCLOSURE, '',
    '### What SQL to ER Diagram is', '', ...THIS_TOOL.facts.map((f) => `- ${md(f)}`), '',
    '### What SQL to ER Diagram does not do', '', ...THIS_TOOL.limits.map((f) => `- ${md(f)}`), '');
  for (const c of COMPETITORS) {
    out.push(`### SQL to ER Diagram vs ${c.name}`, '', `URL: ${ORIGIN}/vs/${c.slug}/`, '', md(c.lead), '',
      `About ${c.name}: ${md(c.about.join(' '))}`, '',
      'Choose SQL to ER Diagram when:', '', ...c.chooseUs.map((s) => `- ${md(s)}`), '',
      `Choose ${c.name} when:`, '', ...c.chooseThem.map((s) => `- ${md(s)}`), '', ...faqMd(c.faq));
  }

  out.push('## Schema examples', '', `URL: ${ORIGIN}/examples/`, '');
  for (const g of GALLERY) {
    const d = DIAGRAMS.get(`examples-${g.slug}`);
    out.push(`### ${g.name} database schema`, '', `URL: ${ORIGIN}/examples/${g.slug}/`, '', md(g.about), '',
      `Tables: ${describeTables(d)}.`, '', '```sql', g.sql, '```', '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------- write everything ----------
// Each entry: { loc, priority, file?, html?, core, image? }. lastmod is resolved below.
const out = [];
const add = (path, priority, page, d) => out.push({
  loc: `${ORIGIN}/${path}`, priority, file: join(ROOT, 'public', path, 'index.html'), ...page,
  image: d ? `${ORIGIN}${d.src}` : null, label: `public/${path}index.html`,
});

// The home page is the app itself (not generated here): key its lastmod on the root index.html.
out.push({ loc: `${ORIGIN}/`, priority: '1.0', core: readFileSync(join(ROOT, 'index.html'), 'utf8') });

const pages = PAGES.map((raw) => ({ ...raw, guide: raw.guide ?? GUIDES[raw.slug] }));
for (const p of pages) add(`${p.slug}/`, '0.7', landingPage(p), DIAGRAMS.get(p.slug));
add('examples/', '0.7', galleryIndex());
for (const g of GALLERY) add(`examples/${g.slug}/`, '0.6', galleryPage(g), DIAGRAMS.get(`examples-${g.slug}`));
add(`${HUB.slug}/`, '0.7', alternativesHub());
for (const c of COMPETITORS) add(`vs/${c.slug}/`, '0.6', vsPage(c));

// lastmod: only moves when the page's own content hash changes (scripts/lastmod.json is checked in).
const MANIFEST = join(ROOT, 'scripts', 'lastmod.json');
const prev = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const manifest = {};
let bumped = 0;
for (const e of out) {
  const hash = createHash('sha256').update(e.core).digest('hex').slice(0, 16);
  const old = prev[e.loc];
  e.lastmod = old && old.hash === hash ? old.lastmod : TODAY;
  if (!old || old.lastmod !== e.lastmod) bumped++;
  manifest[e.loc] = { hash, lastmod: e.lastmod };
  if (e.file) {
    mkdirSync(dirname(e.file), { recursive: true });
    writeFileSync(e.file, e.html.replaceAll(LASTMOD, e.lastmod));
    console.log('wrote ' + e.label);
  }
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
  out.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${u.priority}</priority>${u.image ? `\n    <image:image><image:loc>${u.image}</image:loc></image:image>` : ''}\n  </url>`).join('\n') +
  '\n</urlset>\n';
writeFileSync(join(ROOT, 'public', 'sitemap.xml'), sitemap);
writeFileSync(join(ROOT, 'public', 'llms.txt'), llmsTxt());
writeFileSync(join(ROOT, 'public', 'llms-full.txt'), llmsFullTxt(pages));

console.log(`\nwrote public/sitemap.xml (${out.length} urls, ${bumped} lastmod ${bumped === 1 ? 'date' : 'dates'} changed), public/llms.txt, public/llms-full.txt`);
console.log(`${PAGES.length} landing pages + ${GALLERY.length} gallery pages + ${COMPETITORS.length + 1} comparison pages; ${DIAGRAMS.size} diagrams and ${out.length - 1} social cards in public/og/.`);
