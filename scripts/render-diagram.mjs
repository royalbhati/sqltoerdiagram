// Build-time diagram rendering for the landing-page generator.
//   renderSchema(text)  → { svg, width, height, tables, relations }   (same pipeline as bin/cli.js)
//   socialCard({...})   → 1200×630 PNG Buffer (title + diagram on the dark page background)
import { existsSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { parseSchema, loadAllFormats } from '../src/parse.js';
import { inferLinks } from '../src/infer-links.js';
import { layout } from '../src/layout.js';
import { exportSVG } from '../src/svg-export.js';

await loadAllFormats();

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderSchema(text, { theme = 'dark' } = {}) {
  const model = parseSchema(text, 'auto');
  model.relations.push(...inferLinks(model));
  layout(model, { dir: 'LR', spacing: 'comfortable' });
  const svg = exportSVG(model, theme);
  if (!svg) return null;
  const m = svg.match(/^<svg[^>]*\swidth="(\d+(?:\.\d+)?)"[^>]*\sheight="(\d+(?:\.\d+)?)"/);
  if (!m) throw new Error('exportSVG returned an <svg> without width/height');
  return {
    svg,
    width: Math.round(+m[1]),
    height: Math.round(+m[2]),
    tables: model.tables.map((t) => t.name),
    relations: model.relations.length,
  };
}

// resvg has no web fonts: map the app's font stacks onto fonts that exist on the
// build machine. (Only affects the PNG social cards; the on-page SVGs keep the
// app's own font stack and are drawn by the visitor's browser.)
// Scanning every system font costs seconds per card, so on macOS load just the two
// files we need; anywhere else fall back to a full system-font scan.
const MAC_FONTS = ['/System/Library/Fonts/HelveticaNeue.ttc', '/System/Library/Fonts/Menlo.ttc'];
const haveMacFonts = MAC_FONTS.every((f) => existsSync(f));
const FONT = {
  loadSystemFonts: !haveMacFonts,
  ...(haveMacFonts ? { fontFiles: MAC_FONTS } : {}),
  defaultFontFamily: 'Helvetica Neue',
  sansSerifFamily: 'Helvetica Neue',
  monospaceFamily: 'Menlo',
};
const CARD_SANS = 'Helvetica Neue, Helvetica, Arial, sans-serif';

// Greedy word-wrap on an approximate glyph width (bold sans ≈ 0.56em per char).
function wrap(text, fontSize, maxWidth, maxLines) {
  const perLine = Math.max(8, Math.floor(maxWidth / (fontSize * 0.56)));
  const lines = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    if (cur && (cur + ' ' + w).length > perLine) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, '') + '…';
  }
  return lines;
}

const W = 1200, H = 630, PAD = 56;

export function socialCard({ title, kicker = 'sqltoerdiagram.com', diagram }) {
  const size = title.length > 34 ? 46 : 56;
  const lines = wrap(title, size, W - PAD * 2, 2);
  const titleTop = 112;
  const titleBottom = titleTop + (lines.length - 1) * (size + 8);
  const titleSvg = lines.map((l, i) =>
    `<text x="${PAD}" y="${titleTop + i * (size + 8)}" font-family="${CARD_SANS}" font-weight="700" font-size="${size}" fill="#e8edf4">${xml(l)}</text>`).join('');

  // diagram box: everything below the title, inside the padding
  const boxX = PAD, boxY = titleBottom + 34, boxW = W - PAD * 2, boxH = H - boxY - PAD + 8;
  let inner = '';
  if (diagram) {
    // never upscale small diagrams past 1.7× — two giant tables look worse than whitespace
    const scale = Math.min((boxW - 24) / diagram.width, (boxH - 24) / diagram.height, 1.7);
    const dw = diagram.width * scale, dh = diagram.height * scale;
    const dx = boxX + (boxW - dw) / 2, dy = boxY + (boxH - dh) / 2;
    // nest the exported <svg>: re-point its viewport, keep its viewBox + fonts
    inner = diagram.svg.replace(/^<svg([^>]*)>/, (_, attrs) => {
      const rest = attrs.replace(/\s(width|height)="[^"]*"/g, '')
        .replace(/font-family="[^"]*"/, `font-family="${CARD_SANS}"`);
      return `<svg${rest} x="${dx.toFixed(1)}" y="${dy.toFixed(1)}" width="${dw.toFixed(1)}" height="${dh.toFixed(1)}">`;
    }).replace(/font-family="[^"]*(?:monospace)"/g, 'font-family="Menlo, monospace"');
  }

  const card = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#0e1116"/>
<g transform="translate(${PAD} 30)" fill="none" stroke="#5aa7ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></g>
<text x="${PAD + 34}" y="48" font-family="${CARD_SANS}" font-weight="600" font-size="20" fill="#9aa4b2">${xml(kicker)}</text>
<text x="${W - PAD}" y="48" text-anchor="end" font-family="${CARD_SANS}" font-size="18" fill="#6f7b8a">Free · open source · runs in your browser</text>
${titleSvg}
<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="14" fill="#0e1116" stroke="#262d38" stroke-width="1.5"/>
${inner}
</svg>`;
  return new Resvg(card, { font: FONT, fitTo: { mode: 'width', value: W }, background: '#0e1116' }).render().asPng();
}

// Width/height straight from a PNG's IHDR chunk (used by the generator's self-check).
export function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
