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

export const EDGE_COLORS = [
  '#4ea8de', // sky blue
  '#f77f00', // vibrant orange
  '#06d6a0', // emerald green
  '#e63946', // coral crimson
  '#a06cd5', // soft violet / purple
  '#ffd166', // warm amber gold
  '#48cae4', // bright cyan
  '#f72585', // magenta pink
  '#80ed99', // mint lime
  '#b5179e', // deep orchid
  '#3a86ff', // royal blue
  '#fb8500', // orange peel
  '#52b788', // seafoam green
  '#9d4edd', // amethyst purple
  '#ff758f', // rose pink
  '#00b4d8', // cerulean blue
];

// A scratch context for text measurement (no DOM needed for sizing).
let measureCanvas = null;
function measureCtx() {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

export function toLogicalType(rawType) {
  if (!rawType) return '';
  const s = String(rawType).trim().toLowerCase();
  if (/^(bool|boolean)/.test(s)) return 'Boolean';
  if (/^(bigint|bigserial)/.test(s)) return 'BigInt';
  if (/^(int|integer|smallint|tinyint|mediumint|serial|smallserial|identity)/.test(s)) return 'Integer';
  if (/^(decimal|numeric|money|smallmoney)/.test(s)) return 'Decimal';
  if (/^(float|double|real)/.test(s)) return 'Float';
  if (/^(timestamp|timestamptz|datetime|datetime2|smalldatetime)/.test(s)) return 'DateTime';
  if (/^date$/.test(s)) return 'Date';
  if (/^time/.test(s)) return 'Time';
  if (/^(varchar|nvarchar|char|nchar|character|varying|string|enum)/.test(s)) return 'String';
  if (/^(text|tinytext|mediumtext|longtext|citext|clob)/.test(s)) return 'Text';
  if (/^(json|jsonb)/.test(s)) return 'JSON';
  if (/^(uuid|guid)/.test(s)) return 'UUID';
  if (/^(blob|bytea|binary|varbinary|image)/.test(s)) return 'Binary';
  const clean = rawType.replace(/\(.*?\)/g, '').trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : '';
}

export function getVisibleColumns(t, level = 'physical') {
  if (!t || !Array.isArray(t.columns)) return [];
  if (level === 'conceptual') {
    // Conceptual: show entity attributes but hide pure foreign keys (c.fk && !c.pk), and hide types
    return t.columns
      .filter(c => !(c.fk && !c.pk))
      .map(c => ({ ...c, type: '', fk: false }));
  }
  if (level === 'logical') {
    // Logical: show all columns and keys with simplified generic types
    return t.columns.map(c => ({
      ...c,
      type: toLogicalType(c.type),
    }));
  }
  return t.columns;
}

export function measureTable(t, level = 'physical') {
  const visibleCols = getVisibleColumns(t, level);
  const isConceptual = level === 'conceptual';
  if (typeof document === 'undefined') {
    // Node.js fallback: approximate with per-font character widths.
    const nameW = t.name.length * 8.5 + PAD_X * 2 + 24;
    let w = nameW;
    for (const c of visibleCols) {
      const typeW = isConceptual || !c.type ? 0 : (c.type.length * 7.2 + GAP);
      const total = BADGE_W + c.name.length * 7.8 + typeW + PAD_X * 2;
      if (total > w) w = total;
    }
    w = Math.max(MIN_W, Math.min(MAX_W, Math.ceil(w)));
    const h = HEADER_H + visibleCols.length * ROW_H;
    return { w, h, rowH: ROW_H, headerH: HEADER_H, visibleCols };
  }
  const ctx = measureCtx();
  ctx.font = HEADER_FONT;
  let w = ctx.measureText(t.name).width + PAD_X * 2 + 24;
  ctx.font = FONT_STACK;
  for (const c of visibleCols) {
    const nameW = ctx.measureText(c.name).width;
    let typeW = 0;
    if (!isConceptual && c.type) {
      ctx.font = TYPE_FONT;
      typeW = ctx.measureText(c.type).width + GAP;
      ctx.font = FONT_STACK;
    }
    const total = BADGE_W + nameW + typeW + PAD_X * 2;
    if (total > w) w = total;
  }
  w = Math.max(MIN_W, Math.min(MAX_W, Math.ceil(w)));
  const h = HEADER_H + visibleCols.length * ROW_H;
  return { w, h, rowH: ROW_H, headerH: HEADER_H, visibleCols };
}

// Rasterise one table to a bitmap at the given pixel ratio.
export function rasterizeTable(t, theme, dpr, level = 'physical') {
  const visibleCols = getVisibleColumns(t, level);
  const w = t.w, h = t.h;
  const isConceptual = level === 'conceptual';
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
  for (let i = 0; i < visibleCols.length; i++) {
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

  // header divider (only when columns are present)
  if (visibleCols.length > 0) {
    ctx.strokeStyle = theme.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, HEADER_H + 0.5);
    ctx.lineTo(w, HEADER_H + 0.5);
    ctx.stroke();
  }

  // columns
  ctx.textBaseline = 'middle';
  for (let i = 0; i < visibleCols.length; i++) {
    const c = visibleCols[i];
    const y = HEADER_H + i * ROW_H + ROW_H / 2;

    // PK / FK badge
    if (c.pk) {
      drawBadge(ctx, PAD_X - 2, y, 'PK', theme.pk);
    } else if (c.fk && !isConceptual) {
      drawBadge(ctx, PAD_X - 2, y, 'FK', theme.fk);
    }

    const nx = PAD_X + BADGE_W - 4;
    let typeReserve = 0;
    if (!isConceptual && c.type) {
      ctx.font = TYPE_FONT;
      typeReserve = Math.min(ctx.measureText(c.type).width, 120) + GAP;
    }
    ctx.font = FONT_STACK;
    ctx.fillStyle = theme.rowText;
    ctx.fillText(truncate(ctx, c.name, w - nx - PAD_X - typeReserve), nx, y);

    // type, right-aligned
    if (!isConceptual && c.type) {
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
export function columnY(t, colName, level = 'physical', relIdx = 0, totalRels = 1) {
  if (level === 'conceptual') {
    if (totalRels <= 1) return t.h / 2;
    const padding = 16;
    const available = Math.max(10, t.h - padding * 2);
    return padding + (relIdx + 0.5) * (available / totalRels);
  }
  const visibleCols = getVisibleColumns(t, level);
  if (!colName) return t.h / 2;
  const idx = visibleCols.findIndex(c => c.name.toLowerCase() === colName.toLowerCase());
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
