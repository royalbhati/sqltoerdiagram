// Canvas renderer. Each table is rasterised once to an offscreen bitmap and
// re-used while panning/zooming, so frame cost is dominated by cheap drawImage
// + line drawing rather than per-glyph text layout. Off-screen tables/edges
// are culled. This keeps hundreds of tables smooth.

const FONT_STACK = "13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const HEADER_FONT = "600 14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const TYPE_FONT = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const ROW_H = 26;
const HEADER_H = 34;
const PAD_X = 12;
const GAP = 14;          // gap between name and type columns
const BADGE_W = 30;      // space reserved for PK/FK badges
const MIN_W = 140;
const MAX_W = 360;

export const THEMES = {
  dark: {
    bg: '#0e1116',
    grid: '#171c24',
    tableBg: '#1b212b',
    tableBorder: '#2b333f',
    header: '#222c3a',
    headerText: '#e8edf4',
    rowText: '#c4ccd6',
    typeText: '#6f7b8a',
    rowAlt: '#1e2530',
    pk: '#f5c451',
    fk: '#5aa7ff',
    edge: '#5d6b7d',
    edgeHi: '#5aa7ff',
    shadow: 'rgba(0,0,0,0.45)',
    divider: '#2b333f',
  },
  light: {
    bg: '#f4f6fa',
    grid: '#e6eaf0',
    tableBg: '#ffffff',
    tableBorder: '#d6dde6',
    header: '#eef2f7',
    headerText: '#1c2530',
    rowText: '#39424d',
    typeText: '#8a95a3',
    rowAlt: '#f7f9fc',
    pk: '#c8901a',
    fk: '#2f6fd0',
    edge: '#a9b4c2',
    edgeHi: '#2f6fd0',
    shadow: 'rgba(20,30,50,0.16)',
    divider: '#e3e8ef',
  },
};

// A scratch context for text measurement (no DOM needed for sizing).
let measureCanvas = null;
function measureCtx() {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

export function measureTable(t) {
  const ctx = measureCtx();
  ctx.font = HEADER_FONT;
  let w = ctx.measureText(t.name).width + PAD_X * 2 + 24;
  ctx.font = FONT_STACK;
  for (const c of t.columns) {
    const nameW = ctx.measureText(c.name).width;
    ctx.font = TYPE_FONT;
    const typeW = ctx.measureText(c.type || '').width;
    ctx.font = FONT_STACK;
    const total = BADGE_W + nameW + GAP + typeW + PAD_X * 2;
    if (total > w) w = total;
  }
  w = Math.max(MIN_W, Math.min(MAX_W, Math.ceil(w)));
  const h = HEADER_H + t.columns.length * ROW_H;
  return { w, h, rowH: ROW_H, headerH: HEADER_H };
}

// Rasterise one table to a bitmap at the given pixel ratio.
export function rasterizeTable(t, theme, dpr) {
  const w = t.w, h = t.h;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * dpr);
  cv.height = Math.ceil(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);

  const r = 10;
  // body
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, r);
  ctx.fillStyle = theme.tableBg;
  ctx.fill();

  // rows (alternating)
  for (let i = 0; i < t.columns.length; i++) {
    if (i % 2 === 1) {
      ctx.fillStyle = theme.rowAlt;
      ctx.fillRect(1, HEADER_H + i * ROW_H, w - 2, ROW_H);
    }
  }

  // header
  ctx.save();
  roundRectTop(ctx, 0.5, 0.5, w - 1, HEADER_H, r);
  ctx.clip();
  ctx.fillStyle = theme.header;
  ctx.fillRect(0, 0, w, HEADER_H);
  ctx.restore();

  ctx.fillStyle = theme.headerText;
  ctx.font = HEADER_FONT;
  ctx.textBaseline = 'middle';
  ctx.fillText(truncate(ctx, t.name, w - PAD_X * 2 - 18), PAD_X, HEADER_H / 2 + 1);

  // header divider
  ctx.strokeStyle = theme.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H + 0.5);
  ctx.lineTo(w, HEADER_H + 0.5);
  ctx.stroke();

  // columns
  ctx.textBaseline = 'middle';
  for (let i = 0; i < t.columns.length; i++) {
    const c = t.columns[i];
    const y = HEADER_H + i * ROW_H + ROW_H / 2;

    // PK / FK badge
    if (c.pk) {
      drawBadge(ctx, PAD_X - 2, y, 'PK', theme.pk);
    } else if (c.fk) {
      drawBadge(ctx, PAD_X - 2, y, 'FK', theme.fk);
    }

    const nx = PAD_X + BADGE_W - 4;
    // reserve only the space the type actually needs (not a fixed amount),
    // so short types don't force the column name to truncate
    let typeReserve = 0;
    if (c.type) {
      ctx.font = TYPE_FONT;
      typeReserve = Math.min(ctx.measureText(c.type).width, 120) + GAP;
    }
    ctx.font = FONT_STACK;
    ctx.fillStyle = theme.rowText;
    ctx.fillText(truncate(ctx, c.name, w - nx - PAD_X - typeReserve), nx, y);

    // type, right-aligned
    if (c.type) {
      ctx.font = TYPE_FONT;
      ctx.fillStyle = theme.typeText;
      ctx.textAlign = 'right';
      ctx.fillText(truncate(ctx, c.type, 120), w - PAD_X, y);
      ctx.textAlign = 'left';
    }
  }

  // border
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, r);
  ctx.strokeStyle = theme.tableBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  return cv;
}

function drawBadge(ctx, x, y, text, color) {
  ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.font = FONT_STACK;
}

// y-position (table-local) of a column's connection point.
export function columnY(t, colName) {
  if (!colName) return t.h / 2;
  const idx = t.columns.findIndex(c => c.name.toLowerCase() === colName.toLowerCase());
  if (idx < 0) return HEADER_H / 2;
  return HEADER_H + idx * ROW_H + ROW_H / 2;
}

function truncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function roundRectTop(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

export { ROW_H, HEADER_H };
