// Build a standalone SVG string of the current diagram (vector, theme-aware).
import { THEMES, columnY, edgeGeometry, ROW_H, HEADER_H, SANS, MONO, TABLE_COLORS, ICON_PK, ICON_FK } from './renderer.js';
import { NOTE_COLORS, GROUP_COLORS } from './annotations.js';
import { relationCardinality } from './cardinality.js';
import { routeEdge, roundedPath, pathToSVG, nearbyObstacles } from './edge-route.js';

// Crow's-foot cardinality marker at a line endpoint (world coords).
//   dir = +1 if the line extends in +x from (x,y), else -1.
function svgMarker(x, y, dir, kind, color) {
  const foot = 9, spread = 4.5, r = 2.8;
  const attr = `fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round"`;
  const many = kind === 'many' || kind === 'zero-or-many';
  const optional = kind === 'zero-or-one' || kind === 'zero-or-many';
  let out = '';
  if (many) {
    const ax = x + dir * foot;
    out += `<path d="M ${ax} ${y} L ${x} ${y - spread} M ${ax} ${y} L ${x} ${y + spread} M ${ax} ${y} L ${x} ${y}" ${attr}/>`;
  } else {
    const bx = x + dir * foot;
    out += `<path d="M ${bx} ${y - spread} L ${bx} ${y + spread}" ${attr}/>`;
  }
  if (optional) {
    const cx = x + dir * (foot + r + 2);
    out += `<circle cx="${cx}" cy="${y}" r="${r}" ${attr}/>`;
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

// opts.edgeStyle: 'angled' (default; elbow lines that avoid tables) | 'curved'
export function exportSVG(model, themeName, annotations = [], hidden = null, opts = {}) {
  const angled = opts.edgeStyle !== 'curved';
  const theme = THEMES[themeName] || THEMES.dark;
  const isHidden = (k) => !!(hidden && hidden.has(k));
  const ts = model.tables.filter(t => Number.isFinite(t.x) && !isHidden(t.key));
  if (!ts.length && !annotations.length) return null;

  const pad = 40;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of ts) {
    x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h);
  }
  for (const a of annotations) {
    x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y);
    x1 = Math.max(x1, a.x + a.w); y1 = Math.max(y1, a.y + a.h);
  }
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const W = x1 - x0, H = y1 - y0;

  const byKey = new Map(model.tables.map(t => [t.key, t]));
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}" viewBox="${x0} ${y0} ${W} ${H}" font-family="${esc(SANS)}">`);
  parts.push(`<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="${theme.bg}"/>`);

  // group boxes (behind everything)
  for (const a of annotations) {
    if (a.type !== 'group') continue;
    const color = GROUP_COLORS[a.color] || GROUP_COLORS.blue;
    parts.push(`<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="12" fill="${hexA(color, 0.08)}" stroke="${hexA(color, 0.7)}" stroke-width="1.5"/>`);
    if (a.text) parts.push(`<text x="${a.x + 10}" y="${a.y + 16}" dominant-baseline="middle" font-weight="600" font-size="13" fill="${color}">${esc(a.text)}</text>`);
  }

  // edges
  for (const r of model.relations) {
    const from = byKey.get(r.fromTable.toLowerCase());
    const to = byKey.get(r.toTable.toLowerCase());
    if (!from || !to || !Number.isFinite(from.x) || !Number.isFinite(to.x)) continue;
    if (isHidden(from.key) || isHidden(to.key)) continue;
    const fy = from.y + columnY(from, r.fromCols[0]);
    const ty = to.y + columnY(to, r.toCols[0]);
    const { fx, tx, c1x, c2x } = edgeGeometry(from, to, fy, ty);
    let d = `M ${fx} ${fy} C ${c1x} ${fy}, ${c2x} ${ty}, ${tx} ${ty}`;
    let fdir = Math.sign(c1x - fx) || 1, tdir = Math.sign(c2x - tx) || 1;
    if (angled) {
      const pts = routeEdge(from, to, fy, ty, ts.length <= 200 ? nearbyObstacles(from, to, ts) : []);
      d = pathToSVG(roundedPath(pts, 9));
      fdir = Math.sign(pts[1][0] - pts[0][0]) || 1;
      tdir = Math.sign(pts[pts.length - 2][0] - pts[pts.length - 1][0]) || 1;
    }
    parts.push(`<path d="${d}" fill="none" stroke="${theme.edge}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`);
    const card = relationCardinality(r, byKey);
    parts.push(svgMarker(fx, fy, fdir, card.from, theme.edge));
    parts.push(svgMarker(tx, ty, tdir, card.to, theme.edge));
  }

  // tables
  for (const t of ts) {
    const g = [];
    g.push(`<g transform="translate(${t.x} ${t.y})">`);
    g.push(`<rect x="0" y="0" width="${t.w}" height="${t.h}" rx="10" fill="${theme.tableBg}" stroke="${theme.tableBorder}"/>`);
    // header
    g.push(`<path d="M0 ${HEADER_H} V10 a10 10 0 0 1 10 -10 H${t.w - 10} a10 10 0 0 1 10 10 V${HEADER_H} Z" fill="${theme.header}"/>`);
    const accent = TABLE_COLORS[t.color];
    if (accent) {
      g.push(`<path d="M0 ${HEADER_H} V10 a10 10 0 0 1 10 -10 H${t.w - 10} a10 10 0 0 1 10 10 V${HEADER_H} Z" fill="${hexA(accent, 0.2)}"/>`);
      g.push(`<path d="M0.6 3 V10 a10 10 0 0 1 10 -10 H${t.w - 10.6} a10 10 0 0 1 10 10 V3 Z" fill="${accent}"/>`);
    }
    g.push(`<line x1="0" y1="${HEADER_H}" x2="${t.w}" y2="${HEADER_H}" stroke="${theme.divider}"/>`);
    g.push(`<text x="12" y="${HEADER_H / 2}" dominant-baseline="middle" font-weight="600" font-size="14" fill="${theme.headerText}">${esc(t.name)}</text>`);
    g.push(`<text x="${t.w - 12}" y="${HEADER_H / 2}" dominant-baseline="middle" text-anchor="end" font-size="11" font-family="${esc(MONO)}" fill="${theme.typeText}">${t.columns.length}</text>`);

    for (let i = 0; i < t.columns.length; i++) {
      const c = t.columns[i];
      const y = HEADER_H + i * ROW_H;
      if (i % 2 === 1) g.push(`<rect x="1" y="${y}" width="${t.w - 2}" height="${ROW_H}" fill="${theme.rowAlt}"/>`);
      const cy = y + ROW_H / 2;
      const icon = (d, color) => `<path d="${d}" transform="translate(11 ${cy - 6.5}) scale(${13 / 24})" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (c.pk) g.push(icon(ICON_PK, theme.pk));
      else if (c.fk) g.push(icon(ICON_FK, theme.fk));
      g.push(`<text x="38" y="${cy}" dominant-baseline="middle" font-size="13" font-family="${esc(MONO)}"${c.pk ? ' font-weight="600"' : ''} fill="${c.pk ? theme.headerText : theme.rowText}">${esc(c.name)}</text>`);
      if (c.type) g.push(`<text x="${t.w - 12}" y="${cy}" dominant-baseline="middle" text-anchor="end" font-size="12" font-family="${esc(MONO)}" fill="${theme.typeText}">${esc(c.type)}</text>`);
    }
    g.push('</g>');
    parts.push(g.join(''));
  }

  // sticky notes (front)
  for (const a of annotations) {
    if (a.type !== 'note') continue;
    const c = NOTE_COLORS[a.color] || NOTE_COLORS.yellow;
    parts.push(`<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="8" fill="${c.fill}"/>`);
    if (a.text) {
      const pad = 10, lh = 17, maxChars = Math.max(4, Math.floor((a.w - pad * 2) / 7));
      const lines = wrap(a.text, maxChars);
      const tspans = lines.map((ln, i) =>
        `<tspan x="${a.x + pad}" y="${a.y + pad + 12 + i * lh}">${esc(ln)}</tspan>`).join('');
      parts.push(`<text font-size="13" fill="${c.text}">${tspans}</text>`);
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

// rough word-wrap by character budget (SVG has no auto-wrap)
function wrap(text, maxChars) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > maxChars && line) { out.push(line); line = word; }
      else line = (line ? line + ' ' : '') + word;
    }
    out.push(line);
  }
  return out;
}
