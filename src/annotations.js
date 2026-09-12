// Simple annotation layer: group boxes (labelled frames to cluster sections)
// and sticky notes (free text). Colours are fixed so they read on both themes.

export const NOTE_COLORS = {
  yellow: { fill: '#ffe49c', text: '#3a3320' },
  blue:   { fill: '#bcd9ff', text: '#1f2f45' },
  green:  { fill: '#c4f0d0', text: '#1d3a28' },
  pink:   { fill: '#ffc9d8', text: '#46202e' },
};

export const GROUP_COLORS = {
  blue:   '#5aa7ff',
  green:  '#4ec9b0',
  amber:  '#f5b14a',
  purple: '#b488ff',
};

export const NOTE_ORDER = ['yellow', 'blue', 'green', 'pink'];
export const GROUP_ORDER = ['blue', 'green', 'amber', 'purple'];

export function resolveGroupColor(col) {
  if (!col) return GROUP_COLORS.blue;
  if (GROUP_COLORS[col]) return GROUP_COLORS[col];
  if (typeof col === 'string') {
    const s = col.trim();
    if (s.startsWith('#') || s.startsWith('rgb') || s.startsWith('hsl')) return s;
  }
  return GROUP_COLORS.blue;
}

let seq = 0;
export function newId() {
  seq += 1;
  return 'a' + Date.now().toString(36) + '-' + seq.toString(36);
}

export function makeAnnotation(type, x, y) {
  if (type === 'group') {
    return { id: newId(), type: 'group', x: x - 160, y: y - 120, w: 320, h: 240, text: 'Group', color: 'blue' };
  }
  return { id: newId(), type: 'note', x: x - 90, y: y - 60, w: 180, h: 120, text: '', color: 'yellow' };
}

// Compute bounding box wrapping member tables of a group
export function computeGroupBounds(group, tables, padding = { x: 28, top: 38, bottom: 24 }) {
  if (!group || !Array.isArray(group.tables) || !group.tables.length) return null;
  const tableKeys = new Set(group.tables.map(k => String(k).toLowerCase()));
  const memberTables = tables.filter(t => tableKeys.has(t.key) && Number.isFinite(t.x));
  if (!memberTables.length) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of memberTables) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + t.w);
    maxY = Math.max(maxY, t.y + t.h);
  }

  return {
    x: Math.round(minX - padding.x),
    y: Math.round(minY - padding.top),
    w: Math.round(Math.max(120, (maxX - minX) + padding.x * 2)),
    h: Math.round(Math.max(80, (maxY - minY) + padding.top + padding.bottom)),
  };
}

// tolerant normaliser for loaded/shared annotations
export function sanitizeAnnotations(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const a of arr) {
    if (!a || (a.type !== 'group' && a.type !== 'note')) continue;
    if (![a.x, a.y, a.w, a.h].every(Number.isFinite)) continue;
    let col = a.color;
    if (a.type === 'group') {
      col = GROUP_COLORS[col] || (typeof col === 'string' && (col.startsWith('#') || col.startsWith('rgb') || col.startsWith('hsl'))) ? col : 'blue';
    } else {
      col = NOTE_COLORS[col] ? col : 'yellow';
    }
    out.push({
      id: typeof a.id === 'string' ? a.id : newId(),
      type: a.type,
      x: a.x, y: a.y,
      w: Math.max(80, a.w), h: Math.max(50, a.h),
      text: typeof a.text === 'string' ? a.text : '',
      color: col,
      tables: Array.isArray(a.tables) ? a.tables.map(s => String(s).toLowerCase()) : undefined,
    });
  }
  return out;
}

