// Snapshot: the diagram composed into a shareable picture — a backdrop, the
// diagram on a rounded card, an optional title and credit. Used by the
// Snapshot dialog; all drawing is local (canvas), nothing is uploaded.
import { SANS } from './renderer.js';

export const BACKDROPS = {
  aurora: { label: 'Aurora', stops: ['#4f8dfd', '#a779f7'] },
  sunset: { label: 'Sunset', stops: ['#ff9a5a', '#e8588c'] },
  mint: { label: 'Mint', stops: ['#2fc6a8', '#4f9dfd'] },
  slate: { label: 'Slate', stops: ['#39424f', '#12161d'] },
  paper: { label: 'Paper', stops: ['#f1f4f8', '#dde4ee'] },
  plain: { label: 'Plain', stops: null },          // just the diagram on the theme's canvas colour
  none: { label: 'Transparent', stops: null },     // no backdrop at all
};
export const PADDINGS = { s: 32, m: 64, l: 110 };

const MAX_SIDE = 4096;       // keeps the picture easy to paste and share

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// is this colour light? (decides the credit / title ink on a backdrop)
function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150;
}

// opts: { backdrop, padding, title (string | ''), credit (bool) } -> canvas | null
export function composeSnapshot(diagram, opts = {}) {
  const backdrop = BACKDROPS[opts.backdrop] ? opts.backdrop : 'aurora';
  const b = diagram.bounds();
  if (b.w === 0) return null;
  // render the diagram at up to 2x, smaller for very large schemas
  const scale = Math.max(0.25, Math.min(2, (MAX_SIDE - 2 * PADDINGS.l) / Math.max(b.w, b.h)));
  const art = diagram.renderExport(scale, { transparent: true });
  if (!art) return null;
  const theme = diagram.theme;
  const k = Math.max(1, scale);                    // UI chrome scales with the art, never below 1x
  const title = String(opts.title || '').trim();

  if (backdrop === 'plain' || backdrop === 'none') {
    const head = title ? 54 * k : 0, foot = opts.credit ? 34 * k : 0;
    const cv = document.createElement('canvas');
    cv.width = art.width; cv.height = art.height + head + foot;
    const ctx = cv.getContext('2d');
    if (backdrop === 'plain') { ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.drawImage(art, 0, head);
    const ink = theme.headerText, soft = theme.typeText;
    if (title) {
      ctx.fillStyle = ink; ctx.textBaseline = 'middle';
      ctx.font = `650 ${20 * k}px ${SANS}`;
      ctx.fillText(title, 40 * scale, head / 2 + 6 * k);
    }
    if (opts.credit) drawCredit(ctx, cv.width - 40 * scale, cv.height - foot / 2 - 4 * k, k, soft);
    return cv;
  }

  const pad = (PADDINGS[opts.padding] || PADDINGS.m) * k;
  const bar = title ? 46 * k : 0;                  // title bar inside the card
  const foot = opts.credit ? 30 * k : 0;           // room for the credit under the card
  const cardW = art.width, cardH = art.height + bar;
  const cv = document.createElement('canvas');
  cv.width = Math.round(cardW + pad * 2);
  cv.height = Math.round(cardH + pad * 2 + foot * 0.6);
  const ctx = cv.getContext('2d');

  const stops = BACKDROPS[backdrop].stops;
  const g = ctx.createLinearGradient(0, 0, cv.width, cv.height);
  g.addColorStop(0, stops[0]); g.addColorStop(1, stops[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cv.width, cv.height);

  // the card
  const r = 16 * k;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 50 * k; ctx.shadowOffsetY = 22 * k;
  roundRect(ctx, pad, pad, cardW, cardH, r);
  ctx.fillStyle = theme.bg;
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, pad, pad, cardW, cardH, r);
  ctx.clip();
  if (title) {
    ctx.fillStyle = theme.tableBg;
    ctx.fillRect(pad, pad, cardW, bar);
    ctx.fillStyle = theme.tableBorder;
    ctx.fillRect(pad, pad + bar - 1, cardW, 1);
    ctx.fillStyle = theme.headerText; ctx.textBaseline = 'middle';
    ctx.font = `650 ${15 * k}px ${SANS}`;
    ctx.fillText(title, pad + 20 * k, pad + bar / 2 + 1);
    const n = diagram.model.tables.filter((t) => !diagram.hidden.has(t.key)).length;
    ctx.fillStyle = theme.typeText; ctx.textAlign = 'right';
    ctx.font = `500 ${12.5 * k}px ${SANS}`;
    ctx.fillText(`${n} table${n !== 1 ? 's' : ''}`, pad + cardW - 20 * k, pad + bar / 2 + 1);
    ctx.textAlign = 'left';
  }
  ctx.drawImage(art, pad, pad + bar);
  ctx.restore();
  roundRect(ctx, pad + 0.5, pad + 0.5, cardW - 1, cardH - 1, r);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = Math.max(1, k);
  ctx.stroke();

  if (opts.credit) {
    const ink = isLight(stops[1]) ? 'rgba(20,30,45,0.6)' : 'rgba(255,255,255,0.82)';
    drawCredit(ctx, pad + cardW, pad + cardH + (pad + foot * 0.6) / 2, k, ink);
  }
  return cv;
}

function drawCredit(ctx, right, y, k, ink) {
  ctx.save();
  ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.font = `600 ${12.5 * k}px ${SANS}`;
  ctx.fillText('sqltoerdiagram.com', right, y);
  ctx.restore();
}

export const toBlob = (cv) => new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
