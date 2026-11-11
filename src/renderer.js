// Canvas renderer. Each table is rasterised once to an offscreen bitmap and
// re-used while panning/zooming, so frame cost is dominated by cheap drawImage
// + line drawing rather than per-glyph text layout. Off-screen tables/edges
// are culled. This keeps hundreds of tables smooth.

// Typefaces: Inter for names/labels, JetBrains Mono for columns and types
// (self-hosted, see style.css). The system stacks behind them are what Node
// (CLI / SVG export) and a not-yet-loaded page fall back to.
export const SANS = '"Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const MONO = '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const FONT_STACK = `13px ${MONO}`;
const HEADER_FONT = `600 14px ${SANS}`;
const TYPE_FONT = `12px ${MONO}`;
const PK_FONT = `600 13px ${MONO}`;
const COUNT_FONT = `500 11px ${MONO}`;

// Where a relation leaves one table and enters the other, and how it bends.
// Both ends leave horizontally. Facing sides are used when there is room
// between the tables; when they overlap horizontally (stacked tables, or a
// table referencing itself) the line loops out of the same side of both
// instead of cutting back through them.
//   from/to: tables {x, w}; returns { fx, tx, c1x, c2x } (y's are the caller's)
export function edgeGeometry(from, to, fy, ty) {
  const GAP = 36;                                   // room a facing connection needs
  const fl = from.x, fr = from.x + from.w, tl = to.x, tr = to.x + to.w;
  let fx, tx, fdir, tdir;
  if (tl - fr >= GAP) { fx = fr; tx = tl; fdir = 1; tdir = -1; }          // to is to the right
  else if (fl - tr >= GAP) { fx = fl; tx = tr; fdir = -1; tdir = 1; }     // to is to the left
  else if (Math.abs(fr - tr) <= Math.abs(fl - tl)) { fx = fr; tx = tr; fdir = 1; tdir = 1; }   // loop on the right
  else { fx = fl; tx = tl; fdir = -1; tdir = -1; }                        // loop on the left
  const span = Math.abs(tx - fx), rise = Math.abs(ty - fy);
  // longer, taller runs get a wider bend so the curve never turns into a kink
  const bend = fdir === tdir
    ? Math.min(140, 44 + span * 0.5 + rise * 0.12)
    : Math.max(36, Math.min(span * 0.5, 60 + rise * 0.25));
  return { fx, tx, c1x: fx + fdir * bend, c2x: tx + tdir * bend };
}

// Optional per-table accent colours (header tint + top stripe). Fixed hues
// that read on both themes.
export const TABLE_COLORS = {
  blue: '#5aa7ff', teal: '#34c3b1', green: '#5fbf83', amber: '#f0b048',
  orange: '#f08a4b', red: '#e8696b', pink: '#e879b9', purple: '#a98bff',
};
export const TABLE_COLOR_ORDER = ['blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'purple'];

// 24×24 icon outlines (drawn at half size) for key columns
export const ICON_PK = 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z M16.5 7.5h.01';
export const ICON_FK = 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71';

const ROW_H = 26;
const HEADER_H = 34;
const PAD_X = 12;
const GAP = 14;          // gap between name and type columns
const BADGE_W = 30;      // space reserved for PK/FK badges
const MIN_W = 140;
const MAX_W = 360;

export const THEMES = {
  dark: {
    bg: '#0d1015',
    grid: '#303947',          // canvas dot grid
    tableBg: '#171c25',
    tableBorder: '#2e3644',
    header: '#1f2733',
    headerText: '#f0f4f9',
    rowText: '#cdd5df',
    typeText: '#8591a3',
    rowAlt: '#1a202a',
    pk: '#f5c451',
    fk: '#6db1ff',
    edge: '#566375',
    edgeHi: '#5aa7ff',
    shadow: 'rgba(0,0,0,0.5)',
    divider: '#2b333f',
  },
  light: {
    bg: '#f3f5f9',
    grid: '#d5dbe5',          // canvas dot grid
    tableBg: '#ffffff',
    tableBorder: '#d3dae4',
    header: '#f1f4f8',
    headerText: '#1c2530',
    rowText: '#333c47',
    typeText: '#7b8696',
    rowAlt: '#f8fafc',
    pk: '#c8901a',
    fk: '#2f6fd0',
    edge: '#a9b4c2',
    edgeHi: '#2f6fd0',
    shadow: 'rgba(30,45,70,0.16)',
    divider: '#e3e8ef',
  },
};

// More themes. Each is a full canvas palette; the matching interface colours
// live in style.css under :root[data-theme="<name>"].
Object.assign(THEMES, {
  nord: {
    bg: '#2b303b', grid: '#454f63', tableBg: '#3b4252', tableBorder: '#4f5a70', header: '#434c5e',
    headerText: '#eceff4', rowText: '#e1e6ee', typeText: '#a6b0c3', rowAlt: '#3f4758',
    pk: '#ebcb8b', fk: '#88c0d0', edge: '#7b88a1', edgeHi: '#88c0d0', shadow: 'rgba(0,0,0,0.36)', divider: '#4c566a',
  },
  dracula: {
    bg: '#22232e', grid: '#3d4054', tableBg: '#2d2f3d', tableBorder: '#484b60', header: '#383a4c',
    headerText: '#f8f8f2', rowText: '#e6e6f0', typeText: '#9da3c0', rowAlt: '#313343',
    pk: '#f1fa8c', fk: '#8be9fd', edge: '#6f7699', edgeHi: '#bd93f9', shadow: 'rgba(0,0,0,0.45)', divider: '#44475a',
  },
  tokyo: {
    bg: '#16161e', grid: '#2e3352', tableBg: '#1f2335', tableBorder: '#363d60', header: '#292e42',
    headerText: '#d5dcfa', rowText: '#b9c3ee', typeText: '#7f89b5', rowAlt: '#232840',
    pk: '#e0af68', fk: '#7aa2f7', edge: '#5b6490', edgeHi: '#7aa2f7', shadow: 'rgba(0,0,0,0.5)', divider: '#343b5c',
  },
  solarized: {
    bg: '#fbf3dd', grid: '#d6cdb2', tableBg: '#fffbf0', tableBorder: '#d8cfb6', header: '#eee8d5',
    headerText: '#073642', rowText: '#33515b', typeText: '#6b8087', rowAlt: '#faf4e2',
    pk: '#b58900', fk: '#268bd2', edge: '#a3adaa', edgeHi: '#268bd2', shadow: 'rgba(90,70,20,0.14)', divider: '#e3dcc6',
  },
});
// order + labels for the theme picker; `light` tells the UI which base to use
export const THEME_LIST = [
  { id: 'dark', label: 'Midnight' }, { id: 'tokyo', label: 'Tokyo Night' }, { id: 'nord', label: 'Nord' },
  { id: 'dracula', label: 'Dracula' }, { id: 'light', label: 'Daylight', light: true }, { id: 'solarized', label: 'Solarized Light', light: true },
];

// A scratch context for text measurement (no DOM needed for sizing).
let measureCanvas = null;
function measureCtx() {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

export function measureTable(t) {
  if (typeof document === 'undefined') {
    // Node.js fallback: approximate with per-font character widths.
    // Monospace columns are highly predictable; sans-serif header is a reasonable average.
    const nameW = t.name.length * 8.5 + PAD_X * 2 + 24;
    let w = nameW;
    for (const c of t.columns) {
      const total = BADGE_W + c.name.length * 7.8 + GAP + (c.type || '').length * 7.2 + PAD_X * 2;
      if (total > w) w = total;
    }
    w = Math.max(MIN_W, Math.min(MAX_W, Math.ceil(w)));
    return { w, h: HEADER_H + t.columns.length * ROW_H, rowH: ROW_H, headerH: HEADER_H };
  }
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
  // body — everything inside is clipped to the rounded card, so the last row
  // and the header keep their corners
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, r);
  ctx.fillStyle = theme.tableBg;
  ctx.fill();
  ctx.save();
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, r);
  ctx.clip();

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
  const accent = TABLE_COLORS[t.color];
  if (accent) {
    ctx.fillStyle = hexA(accent, 0.2);
    ctx.fillRect(0, 0, w, HEADER_H);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, 3);
  }
  ctx.restore();

  // a hairline of light along the top edge gives the header a little lift
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, accent ? 3 : 1, w, 1);

  ctx.fillStyle = theme.headerText;
  ctx.font = HEADER_FONT;
  ctx.textBaseline = 'middle';
  ctx.fillText(truncate(ctx, t.name, w - PAD_X * 2 - 34), PAD_X, HEADER_H / 2 + 1);
  // column count, quietly, at the right of the header
  ctx.font = COUNT_FONT;
  ctx.fillStyle = theme.typeText;
  ctx.textAlign = 'right';
  ctx.fillText(String(t.columns.length), w - PAD_X, HEADER_H / 2 + 1);
  ctx.textAlign = 'left';

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
      drawIcon(ctx, PAD_X - 1, y, ICON_PK, theme.pk);
    } else if (c.fk) {
      drawIcon(ctx, PAD_X - 1, y, ICON_FK, theme.fk);
    }

    const nx = PAD_X + BADGE_W - 4;
    // reserve only the space the type actually needs (not a fixed amount),
    // so short types don't force the column name to truncate
    let typeReserve = 0;
    if (c.type) {
      ctx.font = TYPE_FONT;
      typeReserve = Math.min(ctx.measureText(c.type).width, 120) + GAP;
    }
    ctx.font = c.pk ? PK_FONT : FONT_STACK;       // the key reads first
    ctx.fillStyle = c.pk ? theme.headerText : theme.rowText;
    ctx.fillText(truncate(ctx, c.name, w - nx - PAD_X - typeReserve), nx, y);
    ctx.font = FONT_STACK;

    // type, right-aligned
    if (c.type) {
      ctx.font = TYPE_FONT;
      ctx.fillStyle = theme.typeText;
      ctx.textAlign = 'right';
      ctx.fillText(truncate(ctx, c.type, 120), w - PAD_X, y);
      ctx.textAlign = 'left';
    }
  }

  ctx.restore();   // end of the card clip

  // border
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, r);
  ctx.strokeStyle = theme.tableBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  return cv;
}

// a 13px outline icon, left edge at x, vertically centred on y
const iconPaths = new Map();
function drawIcon(ctx, x, y, d, color) {
  let path = iconPaths.get(d);
  if (!path) { path = new Path2D(d); iconPaths.set(d, path); }
  const k = 13 / 24;
  ctx.save();
  ctx.translate(x, y - 6.5);
  ctx.scale(k, k);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.restore();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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
