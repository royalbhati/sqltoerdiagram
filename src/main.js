import './style.css';
import { parseSchema, FORMATS, detectFormat } from './parse.js';
import { layout } from './layout.js';
import { Diagram } from './diagram.js';
import { exportSVG } from './svg-export.js';
import { EDGE_COLORS } from './renderer.js';
import { serialize, SERIALIZERS, toDBMLLayout } from './formats/serialize.js';
import { applyEdit, addColumn, deleteColumn, toggleConstraint, addTable, deleteTable } from './edit.js';
import { createVisualEditor } from './visual-editor.js';
import { DIALECTS, DEFAULT_DIALECT } from './dialects.js';
import { highlightSQL } from './highlight.js';
import { encodeShare, decodeShare } from './share.js';
import { sanitizeAnnotations, computeGroupBounds, newId } from './annotations.js';
import { EXAMPLE_SQL } from './examples.js';
import { HistoryManager } from './history.js';
import { reorderWithGemini, reorderWithLocalAI, reorderWithExistingGroups } from './ai-layout.js';
import { arrangeGroupsCompact } from './group-layout-compact.js';
import { arrangeGroupsSingleAxis } from './group-layout-axis.js';
import { arrangeGroupsMinCrossings } from './group-layout-crossings.js';
import { orientDiagram, resetOrientation } from './rotate-diagram.js';
import { organizeLinesElkPorts, organizeLinesAStar, organizeLinesShortestPath, resetLines } from './line-organizer.js';

const $ = (id) => document.getElementById(id);
const sqlEl = $('sql');
const canvas = $('canvas');
const statusEl = $('status');
const emptyEl = $('empty');
const zoomLabel = $('zoom-reset');

const hlEl = $('hl');

const diagram = new Diagram(canvas);
diagram.onZoom = (s) => { zoomLabel.textContent = Math.round(s * 100) + '%'; };
window.__dbdiga = diagram;   // debug handle
let visualEditor = null;     // created after setup; refreshed on every model change

// History manager (Undo / Redo) with 50 steps
const history = new HistoryManager(50);
diagram.onHistorySnapshot = (snapshot) => {
  history.push(snapshot);
};

const btnUndo = $('btn-undo');
const btnRedo = $('btn-redo');

function updateUndoRedoButtons() {
  const canUndo = history.canUndo();
  const canRedo = history.canRedo();
  if (btnUndo) { btnUndo.disabled = !canUndo; btnUndo.setAttribute('aria-disabled', String(!canUndo)); }
  if (btnRedo) { btnRedo.disabled = !canRedo; btnRedo.setAttribute('aria-disabled', String(!canRedo)); }
}
history.onChange(updateUndoRedoButtons);

// Direction is state of the canvas: the menu always shows which way the diagram
// on screen actually flows, including after undo/redo or loading a layout.
function syncOrientation() {
  syncMenu();
}

function performUndo() {
  if (!history.canUndo()) return;
  const current = diagram.getSnapshot();
  const previous = history.undo(current);
  if (previous) {
    diagram.applySnapshot(previous);
    syncOrientation();
    saveLayoutDebounced();
    if (editorMode === 'layout') updateLayoutTextarea();
    if (editorMode === 'visual') visualEditor?.render();
  }
}

function performRedo() {
  if (!history.canRedo()) return;
  const current = diagram.getSnapshot();
  const next = history.redo(current);
  if (next) {
    diagram.applySnapshot(next);
    syncOrientation();
    saveLayoutDebounced();
    if (editorMode === 'layout') updateLayoutTextarea();
    if (editorMode === 'visual') visualEditor?.render();
  }
}

// Tool mode: Hand (Pan) vs Marquee (Select)
const btnToolPan = $('btn-tool-pan');
const btnToolSelect = $('btn-tool-select');

function syncToolModeButtons(mode) {
  if (btnToolPan) btnToolPan.classList.toggle('active', mode === 'pan');
  if (btnToolSelect) btnToolSelect.classList.toggle('active', mode === 'select');
}

btnToolPan?.addEventListener('click', () => {
  diagram.setToolMode('pan');
  syncToolModeButtons('pan');
});

btnToolSelect?.addEventListener('click', () => {
  diagram.setToolMode('select');
  syncToolModeButtons('select');
});

diagram.onToolModeChange = (mode) => syncToolModeButtons(mode);

btnUndo?.addEventListener('click', () => performUndo());
btnRedo?.addEventListener('click', () => performRedo());

// Global keyboard shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Ctrl+A, V, H, Space)
let preSpaceToolMode = null;

window.addEventListener('keydown', (e) => {
  const isCtrlOrCmd = e.ctrlKey || e.metaKey;
  const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  const isInput = tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable;

  // If user is actively typing in SQL or layout textarea, let native editor handle typing
  if (isInput && (document.activeElement === sqlEl || document.activeElement === layoutJsonEl)) {
    return;
  }

  if (isCtrlOrCmd) {
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      performUndo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      performRedo();
    } else if (key === 'a' && !isInput) {
      e.preventDefault();
      diagram.selectAll();
    }
    return;
  }

  if (!isInput) {
    if (e.key === ' ' && !e.repeat && !preSpaceToolMode) {
      preSpaceToolMode = diagram.toolMode;
      diagram.setToolMode('pan');
      syncToolModeButtons('pan');
    } else if (e.key.toLowerCase() === 'v') {
      diagram.setToolMode('select');
      syncToolModeButtons('select');
    } else if (e.key.toLowerCase() === 'h') {
      diagram.setToolMode('pan');
      syncToolModeButtons('pan');
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === ' ' && preSpaceToolMode) {
    diagram.setToolMode(preSpaceToolMode);
    syncToolModeButtons(preSpaceToolMode);
    preSpaceToolMode = null;
  }
});

// read-only embed view (?embed=1) — never editable, no matter the input format
const isEmbed = new URLSearchParams(location.search).has('embed');

// ---- syntax highlight layer (painted behind the transparent textarea) ----
let hlQueued = false;
function syncHighlight() {
  // coalesce to one repaint per frame so fast typing never blocks
  if (hlQueued) return;
  hlQueued = true;
  requestAnimationFrame(() => {
    hlQueued = false;
    hlEl.innerHTML = highlightSQL(sqlEl.value);
    hlEl.parentElement.scrollTop = sqlEl.scrollTop;
    hlEl.parentElement.scrollLeft = sqlEl.scrollLeft;
  });
}
sqlEl.addEventListener('scroll', () => {
  hlEl.parentElement.scrollTop = sqlEl.scrollTop;
  hlEl.parentElement.scrollLeft = sqlEl.scrollLeft;
});

// ---- layout persistence (table positions + camera) ----
const LAYOUT_KEY = 'dbdiga-layout';

function collectLayout() {
  const tables = {};
  for (const t of diagram.model.tables) {
    if (Number.isFinite(t.x)) tables[t.key] = { x: Math.round(t.x), y: Math.round(t.y) };
  }

  const groups = {};
  for (const a of diagram.annotations) {
    if (a.type === 'group') {
      groups[a.text || 'Group'] = {
        color: a.color,
        note: a.note || '',
        tables: a.tables || [],
      };
    }
  }

  const connections = {};
  const allConnKeys = new Set([
    ...diagram.edgeColors.keys(),
    ...diagram.edgeRoutings.keys(),
    ...diagram.edgeWaypoints.keys(),
    ...diagram.edgeAnchors.keys(),
  ]);
  for (const k of allConnKeys) {
    const item = {};
    const col = diagram.edgeColors.get(k);
    if (col) item.color = col;
    const r = diagram.edgeRoutings.get(k);
    if (r) item.routing = r;
    const pts = diagram.edgeWaypoints.get(k);
    if (pts && pts.length) item.points = pts.map(p => ({ x: p.x, y: p.y }));
    const anch = diagram.edgeAnchors.get(k);
    if (anch) {
      if (anch.fromAnchor) item.fromAnchor = anch.fromAnchor;
      if (anch.toAnchor) item.toAnchor = anch.toAnchor;
    }
    if (Object.keys(item).length) connections[k] = item;
  }

  return {
    version: 1,
    diagramLevel: diagram.diagramLevel || 'physical',
    edgeColorMode: diagram.edgeColorMode || 'multi',
    edgeRouting: diagram.edgeRouting || 'curved',
    orientation: diagram.orientation || 'LR',
    tables,
    positions: tables, // backwards compatibility
    groups,
    connections,
    camera: { x: Math.round(diagram.cam.x), y: Math.round(diagram.cam.y), scale: +diagram.cam.scale.toFixed(4) },
    annotations: diagram.annotations.map(a => ({ ...a })),
    hidden: [...diagram.hidden],
    manualLinks: diagram.manualLinks.map(l => ({ from: { ...l.from }, to: { ...l.to } })),
  };
}
function saveLayout() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(collectLayout()));
    if (editorMode === 'layout') updateLayoutTextarea();
  } catch { /* quota */ }
}
let saveTimer = null;
function saveLayoutDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLayout, 400);
}
function loadSavedLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
// apply saved positions onto a freshly-parsed model; returns true if any matched
function applyLayoutData(model, data) {
  if (!data) return false;
  const pos = data.tables || data.positions;
  if (!pos) return false;
  let placed = 0;
  for (const t of model.tables) {
    const p = pos[t.key] || pos[t.name];
    if (p && Number.isFinite(p.x)) { t.x = p.x; t.y = p.y; placed++; }
  }
  if (data.diagramLevel) {
    diagram.setDiagramLevel(data.diagramLevel);
    syncDiagramLevelUI();
  }
  diagram.fitAllGroups();
  if (data.edgeColorMode) {
    diagram.setEdgeColorMode(data.edgeColorMode);
    syncEdgeColorsBtn();
  }
  if (data.edgeRouting) {
    diagram.setEdgeRouting(data.edgeRouting);
    syncRoutingMenu();
  }
  // A layout that does not say which way it flows is taken as left to right,
  // which is how every fresh arrangement comes out. Either way, the directions
  // remembered for the previous diagram no longer describe this one.
  resetOrientation(diagram);
  if (['TB', 'RL', 'BT'].includes(data.orientation)) diagram.orientation = data.orientation;
  syncOrientation();
  if (data.connections && typeof data.connections === 'object') {
    for (const [k, v] of Object.entries(data.connections)) {
      if (v.color) diagram.setEdgeColor(k, v.color);
      if (v.routing) diagram.setIndividualEdgeRouting(k, v.routing);
      if (Array.isArray(v.points)) diagram.setEdgeWaypoints(k, v.points);
      if (v.fromAnchor) diagram.setEdgeAnchor(k, v.fromAnchor.side, v.fromAnchor.offset, true);
      if (v.toAnchor) diagram.setEdgeAnchor(k, v.toAnchor.side, v.toAnchor.offset, false);
    }
  }
  return placed > 0;
}
// position any tables that have no coordinates yet, beside the existing ones
function placeNewTables(model) {
  const missing = model.tables.filter(t => !Number.isFinite(t.x));
  if (!missing.length) return;
  const placed = model.tables.filter(t => Number.isFinite(t.x));
  if (!placed.length) { layout(model, layoutOpts, diagram.hidden); resetOrientation(diagram); return; }
  let x1 = -Infinity, y0 = Infinity;
  for (const t of placed) { x1 = Math.max(x1, t.x + t.w); y0 = Math.min(y0, t.y); }
  let x = x1 + 80, y = Number.isFinite(y0) ? y0 : 40;
  for (const t of missing) { t.x = x; t.y = y; y += t.h + 40; }
}

diagram.onLayoutChange = () => {
  saveLayoutDebounced();
  if (editorMode === 'layout') updateLayoutTextarea();
};

// theme: restore preference
const savedTheme = localStorage.getItem('dbdiga-theme') || 'dark';
diagram.setTheme(savedTheme);

diagram.start();

// ---- hide tables: right-click context menu + "N hidden" restore chip ----
const ctxMenu = document.createElement('div');
ctxMenu.className = 'ctx-menu';
ctxMenu.hidden = true;
canvas.parentElement.appendChild(ctxMenu);
const hideCtx = () => { ctxMenu.hidden = true; };

const hiddenChip = document.createElement('button');
hiddenChip.className = 'hidden-chip';
hiddenChip.hidden = true;
hiddenChip.title = 'Show all hidden tables';
hiddenChip.addEventListener('click', () => diagram.showAllHidden());
canvas.parentElement.appendChild(hiddenChip);
function syncHiddenChip() {
  const n = diagram.hiddenCount();
  hiddenChip.hidden = n === 0;
  hiddenChip.textContent = n ? `${n} hidden · Show all` : '';
}
diagram.onHiddenChange = () => { syncHiddenChip(); saveLayoutDebounced(); };

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (diagram.toolMode === 'pan') {
    hideCtx();
    return;
  }
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const w = diagram.screenToWorld(sx, sy);
  const t = diagram.tableAt(sx, sy);
  const vHit = diagram.vertexAt(sx, sy);
  const edge = diagram.edgeAt(sx, sy);
  const items = [];

  if (vHit && vHit.isWaypoint) {
    diagram.selectedEdgeKey = vHit.key;
    diagram.markDirty();
    items.push({
      label: 'Delete this vertex',
      act: () => {
        diagram.removeWaypoint(vHit.key, vHit.index);
        saveLayoutDebounced();
        if (editorMode === 'layout') updateLayoutTextarea();
      },
    });
  } else if (t) {
    const multi = diagram.selected.has(t) && diagram.selected.size > 1;
    items.push({ label: multi ? `Hide ${diagram.selected.size} tables` : 'Hide table', act: () => diagram.hideTable(t) });
  } else if (edge) {
    diagram.selectedEdgeKey = edge.key;
    diagram.markDirty();
    items.push({ header: `${edge.fromTable}.${edge.fromCol} → ${edge.toTable}.${edge.toCol}` });
    items.push({
      type: 'palette',
      colors: EDGE_COLORS,
      current: edge.customColor,
      onSelect: (col) => {
        diagram.setEdgeColor(edge.key, col);
        saveLayoutDebounced();
        if (editorMode === 'layout') updateLayoutTextarea();
      },
    });
    items.push({
      label: 'Add vertex here',
      act: () => {
        diagram.addWaypoint(edge.key, Math.round(w.x), Math.round(w.y), edge.insertIndex);
        diagram.selectedEdgeKey = edge.key;
        saveLayoutDebounced();
        if (editorMode === 'layout') updateLayoutTextarea();
      },
    });
    if (edge.waypoints && edge.waypoints.length) {
      items.push({
        label: `Clear all vertices (${edge.waypoints.length})`,
        act: () => {
          diagram.setEdgeWaypoints(edge.key, []);
          saveLayoutDebounced();
          if (editorMode === 'layout') updateLayoutTextarea();
        },
      });
    }
    if (edge.customColor) {
      items.push({
        label: 'Reset connection color (Auto)',
        act: () => {
          diagram.setEdgeColor(edge.key, null);
          saveLayoutDebounced();
          if (editorMode === 'layout') updateLayoutTextarea();
        },
      });
    }

    const currentRouting = diagram.edgeRoutings.get(edge.key) || 'default';
    items.push({
      label: `Line Style: ${currentRouting === 'default' ? 'Default (' + diagram.edgeRouting + ')' : currentRouting}`,
      act: () => {
        const styles = ['default', 'curved', 'straight', 'ortho-sharp', 'ortho-rounded'];
        const nextIdx = (styles.indexOf(currentRouting) + 1) % styles.length;
        const nextStyle = styles[nextIdx];
        diagram.setIndividualEdgeRouting(edge.key, nextStyle === 'default' ? null : nextStyle);
        saveLayoutDebounced();
        if (editorMode === 'layout') updateLayoutTextarea();
      },
    });

    if (edge.isManual && edge.manualLink) {
      items.push({ label: 'Remove manual link', act: () => diagram.removeManualLink(edge.manualLink) });
    }
  }
  if (diagram.hiddenCount() > 0) items.push({ label: `Show all hidden (${diagram.hiddenCount()})`, act: () => diagram.showAllHidden() });
  if (diagram.manualLinkCount() > 0) items.push({ label: `Clear manual links (${diagram.manualLinkCount()})`, act: () => diagram.clearManualLinks() });
  if (!items.length) { hideCtx(); return; }
  ctxMenu.innerHTML = '';
  for (const it of items) {
    if (it.header) {
      const h = document.createElement('div');
      h.className = 'ctx-header';
      h.textContent = it.header;
      ctxMenu.appendChild(h);
    } else if (it.type === 'palette') {
      const p = document.createElement('div');
      p.className = 'ctx-palette';
      for (const col of it.colors) {
        const dot = document.createElement('button');
        dot.className = 'ctx-color-dot' + (it.current === col ? ' active' : '');
        dot.style.background = col;
        dot.title = col;
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          it.onSelect(col);
          hideCtx();
        });
        p.appendChild(dot);
      }
      ctxMenu.appendChild(p);
    } else {
      const b = document.createElement('button');
      b.className = 'ctx-item';
      b.textContent = it.label;
      b.addEventListener('click', () => { it.act(); hideCtx(); });
      ctxMenu.appendChild(b);
    }
  }
  ctxMenu.style.left = sx + 'px';
  ctxMenu.style.top = sy + 'px';
  ctxMenu.hidden = false;
});
window.addEventListener('mousedown', (e) => { if (!ctxMenu.contains(e.target)) hideCtx(); });
window.addEventListener('blur', hideCtx);

// ---- Tables panel: fuzzy search + select/deselect + hide/show ----
const tablesPanel = document.createElement('div');
tablesPanel.className = 'tables-panel';
tablesPanel.hidden = true;
tablesPanel.innerHTML =
  '<div class="tp-head"><input class="tp-search" type="text" placeholder="Search tables…" autocomplete="off" spellcheck="false" />' +
  '<button class="tp-close icon-btn" aria-label="Close">✕</button></div>' +
  '<div class="tp-bar"><span class="tp-meta"></span>' +
  '<span class="tp-actions"><button class="tp-bulk" data-act="hide">Hide all</button>' +
  '<button class="tp-bulk" data-act="show">Show all</button></span></div>' +
  '<div class="tp-list"></div>';
canvas.parentElement.appendChild(tablesPanel);
const tpSearch = tablesPanel.querySelector('.tp-search');
const tpList = tablesPanel.querySelector('.tp-list');
const tpMeta = tablesPanel.querySelector('.tp-meta');
const tpHideAll = tablesPanel.querySelector('.tp-bulk[data-act="hide"]');
const tpShowAll = tablesPanel.querySelector('.tp-bulk[data-act="show"]');
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYEOFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a18.5 18.5 0 0 1-2.2 3"/><path d="M6.6 6.6A18.5 18.5 0 0 0 1 12s4 7 11 7a10.9 10.9 0 0 0 4-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

function fuzzy(q, s) {
  if (!q) return true;
  q = q.toLowerCase(); s = s.toLowerCase();
  if (s.includes(q)) return true;
  let i = 0;
  for (const ch of s) { if (ch === q[i]) i++; if (i === q.length) return true; }
  return false;
}
function filteredTables() {
  const q = tpSearch.value.trim();
  return diagram.model.tables.filter((t) => fuzzy(q, t.name));
}
function renderTables() {
  if (tablesPanel.hidden) return;
  const all = diagram.model.tables.slice().sort((a, b) => a.name.localeCompare(b.name));
  const q = tpSearch.value.trim();
  const rows = all.filter((t) => fuzzy(q, t.name));
  tpMeta.textContent = `${rows.length}/${all.length} table${all.length !== 1 ? 's' : ''} · ${diagram.hiddenCount()} hidden`;
  const shownInFilter = rows.filter((t) => !diagram.hidden.has(t.key)).length;
  tpHideAll.disabled = shownInFilter === 0;
  tpShowAll.disabled = rows.length - shownInFilter === 0;
  tpList.innerHTML = '';
  for (const t of rows) {
    const hidden = diagram.hidden.has(t.key);
    const sel = diagram.isSelected(t.key);
    const row = document.createElement('div');
    row.className = 'tp-row' + (hidden ? ' is-hidden' : '') + (sel ? ' is-sel' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'tp-sel'; cb.checked = sel; cb.title = 'Select';
    cb.addEventListener('change', () => diagram.selectByKey(t.key, cb.checked));
    const name = document.createElement('button');
    name.className = 'tp-name'; name.textContent = t.name; name.title = 'Center on ' + t.name;
    name.addEventListener('click', () => diagram.centerOn(t.key));
    const eye = document.createElement('button');
    eye.className = 'tp-hide'; eye.innerHTML = hidden ? EYEOFF : EYE; eye.title = hidden ? 'Show' : 'Hide';
    eye.addEventListener('click', () => diagram.setTableHidden(t.key, !hidden));
    row.append(cb, name, eye);
    tpList.appendChild(row);
  }
  if (!rows.length) {
    const e = document.createElement('div');
    e.className = 'tp-empty';
    e.textContent = all.length ? 'No matches' : 'No tables yet';
    tpList.appendChild(e);
  }
}
function toggleTablesPanel(show) {
  tablesPanel.hidden = show === undefined ? !tablesPanel.hidden : !show;
  $('btn-tables').classList.toggle('active', !tablesPanel.hidden);
  if (!tablesPanel.hidden) { renderTables(); tpSearch.focus(); }
}
$('btn-tables').addEventListener('click', () => toggleTablesPanel());
tablesPanel.querySelector('.tp-close').addEventListener('click', () => toggleTablesPanel(false));
tpSearch.addEventListener('input', renderTables);
tpHideAll.addEventListener('click', () => diagram.setTablesHidden(filteredTables().map((t) => t.key), true));
tpShowAll.addEventListener('click', () => diagram.setTablesHidden(filteredTables().map((t) => t.key), false));
const _prevHiddenChange = diagram.onHiddenChange;
diagram.onHiddenChange = () => { if (_prevHiddenChange) _prevHiddenChange(); renderTables(); };
diagram.onSelectionChange = renderTables;

let lastModel = null;
let firstRender = true;

// layout options (persisted)
const layoutOpts = {
  algo: localStorage.getItem('dbdiga-algo') || 'dagre',
  dir: 'LR',   // every arrangement flows left to right; the Direction buttons turn it afterwards
  spacing: localStorage.getItem('dbdiga-spacing') || 'comfortable',
};

// Which rearrange method is picked in the Arrange menu. One pick across both of
// its sections, so 'algo:dagre' and 'group:btn-groups-compact' rule each other out.
let rearrangePick = localStorage.getItem('dbdiga-rearrange') || `algo:${layoutOpts.algo}`;

// input format: 'auto' detects SQL / Prisma / SQLAlchemy / Sequelize / DBML
let formatChoice = localStorage.getItem('dbdiga-format') || 'auto';
if (!FORMATS[formatChoice]) formatChoice = 'auto';

const DBML_DIALECT = {
  name: 'DBML',
  types: ['integer', 'int', 'bigint', 'varchar', 'text', 'boolean', 'timestamp', 'datetime', 'date', 'decimal', 'float', 'json'],
  default: 'integer',
};

function currentFormat() {
  if (formatChoice && formatChoice !== 'auto') return formatChoice;
  return (lastModel && lastModel.format) || detectFormat(sqlEl.value);
}

function syncModelGroups(model, existingAnnotations = []) {
  if (!model || !Array.isArray(model.groups) || !model.groups.length) {
    return existingAnnotations;
  }
  const notes = existingAnnotations.filter(a => a.type === 'note');
  const existingGroups = existingAnnotations.filter(a => a.type === 'group');

  const groupsOut = [];
  for (const g of model.groups) {
    const memberKeys = (g.tables || []).map(k => String(k).toLowerCase());
    const bounds = computeGroupBounds({ tables: memberKeys }, model.tables);
    const existing = existingGroups.find(a => (a.text || '').toLowerCase() === (g.name || '').toLowerCase());
    const id = existing?.id || newId();
    const color = g.color || existing?.color || 'blue';
    const x = bounds ? bounds.x : (existing?.x ?? 40);
    const y = bounds ? bounds.y : (existing?.y ?? 40);
    const w = bounds ? bounds.w : (existing?.w ?? 320);
    const h = bounds ? bounds.h : (existing?.h ?? 240);

    groupsOut.push({
      id,
      type: 'group',
      x, y, w, h,
      text: g.name || 'Group',
      color,
      note: g.note || '',
      tables: memberKeys,
    });
  }

  return [...groupsOut, ...notes];
}

function rebuild({ arrange = false, restore = null } = {}) {
  const sql = sqlEl.value;
  localStorage.setItem('dbdiga-sql', sql);
  syncHighlight();

  let result;
  try {
    result = parseSchema(sql, formatChoice);
  } catch (err) {
    statusEl.textContent = 'Parse error';
    statusEl.className = 'status err';
    console.error(err);
    return;
  }

  diagram.editable = result.editable && !isEmbed;   // SQL & DBML support edit-back; never in embed
  diagram.typeSuggestions = result.format === 'dbml' ? DBML_DIALECT.types : DIALECTS[dialect].types;
  updateStatus(result, sql);

  const prevKeys = lastModel ? lastModel.tables.map(t => t.key).sort().join('|') : '';
  const newKeys = result.tables.map(t => t.key).sort().join('|');
  const structureChanged = prevKeys !== newKeys;

  // Diagram level, line style, direction and lines come from the restored layout.
  if (restore) applyLayoutData(result, restore);

  diagram.setModel(result);
  diagram._tmapDirty = true;

  // setModel keeps the positions of tables already on the canvas, so a live edit
  // does not make them jump. A restored layout — a project file or a share link
  // opened over a diagram with the same tables — must win over that, or its
  // direction and lines land on the old positions.
  if (restore) {
    const pos = restore.tables || restore.positions;
    if (pos) {
      for (const t of result.tables) {
        const p = pos[t.key] || pos[t.name];
        if (p && Number.isFinite(p.x)) { t.x = p.x; t.y = p.y; }
      }
    }
  }

  if (arrange) {
    diagram.onHistorySnapshot?.(diagram.getSnapshot());
    // Every table is about to move, so stored vertices and anchor positions would
    // describe geometry that no longer exists: drop them, as the group layouts do.
    diagram.edgeWaypoints.clear();
    diagram.edgeAnchors.clear();
    layout(result, layoutOpts, diagram.hidden);
    // This lays the tables out with the without-groups algorithm, so that is what
    // the menu shows, rather than a with-groups option picked earlier.
    rearrangePick = `algo:${layoutOpts.algo}`;
    localStorage.setItem('dbdiga-rearrange', rearrangePick);
    syncMenu();
    resetOrientation(diagram);
    syncOrientation();
    if (result.groups?.length) {
      diagram.setAnnotations(syncModelGroups(result, diagram.annotations));
    }
    diagram.fit();
  } else if (restore) {
    diagram.setHidden(restore.hidden);               // restore hidden tables before placing
    diagram.setManualLinks(restore.manualLinks);     // restore user-drawn / inferred links
    placeNewTables(result);                          // tables not in the saved layout
    let annos = sanitizeAnnotations(restore.annotations);
    if (result.groups?.length && !annos.some(a => a.type === 'group')) {
      annos = syncModelGroups(result, annos);
    }
    diagram.setAnnotations(annos);
    if (restore.camera) diagram.setCamera(restore.camera);
    else diagram.fit();
  } else if (firstRender) {
    layout(result, layoutOpts, diagram.hidden);
    // This lays the tables out with the without-groups algorithm, so that is what
    // the menu shows, rather than a with-groups option picked earlier.
    rearrangePick = `algo:${layoutOpts.algo}`;
    localStorage.setItem('dbdiga-rearrange', rearrangePick);
    syncMenu();
    resetOrientation(diagram);
    if (result.groups?.length) {
      diagram.setAnnotations(syncModelGroups(result, diagram.annotations));
    }
    diagram.fit();
  } else if (structureChanged) {
    placeNewTables(result);                          // keep manual layout, place only new tables
    if (result.groups?.length) {
      diagram.setAnnotations(syncModelGroups(result, diagram.annotations));
    }
  } else if (result.groups?.length) {
    diagram.setAnnotations(syncModelGroups(result, diagram.annotations));
  }

  diagram.fitAllGroups();
  diagram.markDirty();
  lastModel = result;
  firstRender = false;
  saveLayoutDebounced();
  if (editorMode === 'layout') updateLayoutTextarea();
  renderTables();
  if (visualEditor) visualEditor.render();
}

function updateStatus(result, sql) {
  const hasTables = result.tables.length > 0;
  emptyEl.style.display = hasTables ? 'none' : 'grid';
  const nT = result.tables.length;
  const nR = result.relations.length;
  if (!hasTables && sql.trim()) {
    statusEl.textContent = result.errors[0] || 'No CREATE TABLE found';
    statusEl.className = 'status warn';
  } else if (hasTables) {
    const fmt = result.format && result.format !== 'sql' ? `${FORMATS[result.format] || result.format} · ` : '';
    statusEl.textContent = `${fmt}${nT} table${nT !== 1 ? 's' : ''} · ${nR} relation${nR !== 1 ? 's' : ''}`;
    statusEl.className = 'status ok';
  } else {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }
}

// ---- shared commit: re-parse edited SQL, preserve positions, refresh views ----
// Every model-mutating edit (canvas or visual panel) funnels through here so the
// textarea, the diagram and the visual panel stay in lockstep.
function commitSql(newSql, { pinKey = null, renameFrom = null, renameTo = null } = {}) {
  sqlEl.value = newSql;
  localStorage.setItem('dbdiga-sql', newSql);
  syncHighlight();
  // remember current positions so the edit doesn't reshuffle the diagram
  const oldPos = new Map(diagram.model.tables.map(t => [t.key, { x: t.x, y: t.y }]));
  const fmt = currentFormat();
  const model = parseSchema(newSql, fmt);
  for (const t of model.tables) {
    let p = oldPos.get(t.key);
    if (!p && renameTo && t.key === renameTo) p = oldPos.get(renameFrom);   // renamed table keeps its spot
    if (p && Number.isFinite(p.x)) { t.x = p.x; t.y = p.y; }
  }
  diagram.setModel(model);          // measures sizes, keeps the positions we set
  placeNewTables(model);            // position any brand-new tables
  if (pinKey) diagram.pinByKey(pinKey);
  diagram.markDirty();
  updateStatus(model, newSql);
  lastModel = model;
  saveLayoutDebounced();
  renderTables();
  if (visualEditor) visualEditor.render();
}

// ---- canvas editing: edit a table/column on the diagram -> rewrite SQL ----
function applyChange(change) {
  const sql = sqlEl.value;
  const fmt = currentFormat();
  const fresh = parseSchema(sql, fmt);
  const result = applyEdit(sql, fresh, change);
  if (!result) return;
  commitSql(result.sql, { renameFrom: change.tableKey, renameTo: result.newKey });
}
diagram.onEdit = applyChange;

// ---- dialect (drives default column type + type suggestions) ----
let dialect = localStorage.getItem('dbdiga-dialect') || DEFAULT_DIALECT;
if (!DIALECTS[dialect]) dialect = DEFAULT_DIALECT;
diagram.typeSuggestions = DIALECTS[dialect].types;

// ---- add a column with the dialect default; returns its name (or null) ----
function addColumnTo(tableKey) {
  const sql = sqlEl.value;
  const fmt = currentFormat();
  const fresh = parseSchema(sql, fmt);
  const table = fresh.tables.find(t => t.key === tableKey);
  if (!table) return null;
  // pick a unique default name
  const existing = new Set(table.columns.map(c => c.name.toLowerCase()));
  let name = 'new_column', i = 2;
  while (existing.has(name.toLowerCase())) name = `new_column_${i++}`;
  const defaultType = fmt === 'dbml' ? DBML_DIALECT.default : DIALECTS[dialect].default;
  const res = addColumn(sql, fresh, tableKey, name, defaultType);
  if (!res) return null;
  commitSql(res.sql, { pinKey: tableKey });
  return name;
}
// on the canvas: add the column, then open it inline for naming
diagram.onAddColumn = (tableKey) => {
  const name = addColumnTo(tableKey);
  if (name) diagram.editColumn(tableKey, name);
};

// debounced live parsing; highlight repaints immediately (rAF-coalesced)
let timer = null;
sqlEl.addEventListener('input', () => {
  syncHighlight();
  clearTimeout(timer);
  timer = setTimeout(() => rebuild(), 180);
});

// ---- buttons ----
function loadExample() {
  sqlEl.value = EXAMPLE_SQL;
  firstRender = true;
  rebuild({ arrange: true });
}
$('btn-example').addEventListener('click', loadExample);
$('btn-example2')?.addEventListener('click', loadExample);

// Arrange button: re-arrange with current opts; the ▾ part toggles the menu.
const arrangeMenu = $('arrange-menu');
function syncMenu() {
  // Both rearrange sections share one pick: choosing a with-groups option
  // unchecks the without-groups one, and the other way round.
  for (const el of arrangeMenu.querySelectorAll('[data-algo]'))
    el.classList.toggle('active', rearrangePick === `algo:${el.dataset.algo}`);
  for (const el of arrangeMenu.querySelectorAll('[id^="btn-groups-"]'))
    el.classList.toggle('active', rearrangePick === `group:${el.id}`);
  for (const el of arrangeMenu.querySelectorAll('[data-orient]'))
    el.classList.toggle('active', el.dataset.orient === (diagram.orientation || 'LR'));
  for (const el of arrangeMenu.querySelectorAll('[data-spacing]'))
    el.classList.toggle('active', el.dataset.spacing === layoutOpts.spacing);
}

function setRearrangePick(pick) {
  rearrangePick = pick;
  localStorage.setItem('dbdiga-rearrange', pick);
  syncMenu();
}

// Every section of the Arrange and Line Style menus is a button that expands its
// own options. One open at a time, so a menu never runs off the screen.
function wireMenuSections(menu) {
  menu.addEventListener('click', (e) => {
    const head = e.target.closest('.menu-section');
    if (!head) return;
    const wasOpen = head.getAttribute('aria-expanded') === 'true';
    for (const h of menu.querySelectorAll('.menu-section')) {
      const show = !wasOpen && h === head;
      h.setAttribute('aria-expanded', show ? 'true' : 'false');
      const body = menu.querySelector(`[data-section-body="${h.dataset.section}"]`);
      if (body) body.hidden = !show;
    }
  });
}

syncMenu();
wireMenuSections(arrangeMenu);

$('btn-arrange').addEventListener('click', (e) => {
  e.stopPropagation();
  // Only opens and closes the menu. Arranging is always an explicit pick inside
  // it, so closing the menu can never re-arrange the diagram behind your back.
  arrangeMenu.hidden = !arrangeMenu.hidden;
});

arrangeMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const item = e.target.closest('.menu-item');
  if (!item) return;

  const groupArrangers = {
    'btn-groups-fast-grid': executeExistingGroupsReorder,
    'btn-groups-single-axis': () => runGroupArrange(arrangeGroupsSingleAxis, 'Optimized grid'),
    'btn-groups-min-crossings': () => runGroupArrange(arrangeGroupsMinCrossings, 'Fewest crossings'),
    'btn-groups-compact': () => runGroupArrange(arrangeGroupsCompact, 'Short lines, compact'),
  };
  if (groupArrangers[item.id]) {
    arrangeMenu.hidden = true;
    setRearrangePick(`group:${item.id}`);
    groupArrangers[item.id]();
    return;
  }

  if (item.id === 'btn-arrange-ai') {
    arrangeMenu.hidden = true;
    openAIModal();
    return;
  }

  if (item.dataset.algo) {
    layoutOpts.algo = item.dataset.algo;
    localStorage.setItem('dbdiga-algo', layoutOpts.algo);
    rearrangePick = `algo:${layoutOpts.algo}`;
    localStorage.setItem('dbdiga-rearrange', rearrangePick);
  }
  if (item.dataset.orient) {
    // Direction turns what is on the canvas; it never re-arranges anything.
    // Every direction visited is remembered, so coming back to one with nothing
    // touched in between restores it exactly.
    const target = item.dataset.orient;
    if (target !== (diagram.orientation || 'LR')) {
      // A quarter turn re-traces the lines it breaks, which takes seconds on a
      // big diagram, so park the Arrange button on a spinner and paint first.
      const btn = $('btn-arrange');
      endFlash(btn);
      const original = btn.innerHTML;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span>';
      btn.disabled = true;
      arrangeMenu.hidden = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        let res;
        try {
          res = orientDiagram(diagram, target);
        } finally {
          btn.disabled = false;
          btn.innerHTML = original;
        }
        syncMenu();
        diagram.fit();
        saveLayoutDebounced();
        if (editorMode === 'layout') updateLayoutTextarea();
        if (editorMode === 'visual') visualEditor?.render();
        if (res.repaired) {
          flashButton(btn, `${res.repaired} line${res.repaired !== 1 ? 's' : ''} re-routed`);
        }
      }));
    }
    return;
  }
  if (item.dataset.spacing) {
    layoutOpts.spacing = item.dataset.spacing;
    localStorage.setItem('dbdiga-spacing', layoutOpts.spacing);
    // Re-run whatever is picked, so the new spacing lands on the arrangement you
    // chose instead of throwing you back to the hierarchical one.
    if (rearrangePick.startsWith('group:')) {
      syncMenu();
      arrangeMenu.hidden = true;
      groupArrangers[rearrangePick.slice(6)]?.();
      return;
    }
  }
  syncMenu();
  rebuild({ arrange: true });
});
document.addEventListener('click', () => { arrangeMenu.hidden = true; });

// ---- AI Arrange Modal wiring ----
const modalAI = $('modal-ai-arrange');
const btnCloseAIModal = $('btn-close-ai-modal');
const btnCancelAI = $('btn-cancel-ai');
const btnRunLocalAI = $('btn-run-local-ai');
const btnRunGeminiAI = $('btn-run-gemini-ai');
const btnRunExistingGroups = $('btn-run-existing-groups');
const aiKeyInput = $('ai-gemini-key');
const aiLineStyle = $('ai-line-style');
const aiCreateGroups = $('ai-create-groups');
const aiStatusBox = $('ai-status');
const aiStatusText = $('ai-status-text');

function openAIModal() {
  if (!modalAI) return;
  modalAI.hidden = false;
  if (aiKeyInput) {
    aiKeyInput.value = localStorage.getItem('gemini_api_key') || '';
  }
  if (aiLineStyle) {
    aiLineStyle.value = diagram.edgeRouting === 'curved' ? 'curved' : 'ortho-rounded';
  }
  if (aiStatusBox) aiStatusBox.hidden = true;
}

function closeAIModal() {
  if (!modalAI) return;
  modalAI.hidden = true;
  if (aiStatusBox) aiStatusBox.hidden = true;
}

btnCloseAIModal?.addEventListener('click', closeAIModal);
btnCancelAI?.addEventListener('click', closeAIModal);
modalAI?.addEventListener('click', (e) => {
  if (e.target === modalAI) closeAIModal();
});

async function executeAIReorder(isGemini = false) {
  if (!diagram.model || !diagram.model.tables || !diagram.model.tables.length) {
    alert('The diagram has no tables to arrange.');
    return;
  }

  const createGroups = aiCreateGroups ? aiCreateGroups.checked : true;
  const selectedLineStyle = aiLineStyle ? aiLineStyle.value : (diagram.edgeRouting || 'ortho-rounded');

  if (aiStatusBox) {
    aiStatusBox.hidden = false;
    aiStatusText.textContent = isGemini ? 'Asking Google Gemini AI...' : 'Running the local semantic AI...';
  }

  diagram.onHistorySnapshot?.(diagram.getSnapshot());

  try {
    let res;
    if (isGemini) {
      const apiKey = aiKeyInput ? aiKeyInput.value.trim() : '';
      if (!apiKey) {
        throw new Error('Por favor ingresa tu Gemini API Key o haz clic en "Ejecutar con IA Local".');
      }
      localStorage.setItem('gemini_api_key', apiKey);
      res = await reorderWithGemini(diagram.model, apiKey, { createGroups, lineStyle: selectedLineStyle });
    } else {
      res = reorderWithLocalAI(diagram.model, { createGroups, lineStyle: selectedLineStyle });
    }

    if (res.annotations && res.annotations.length) {
      const notes = diagram.annotations.filter(a => a.type === 'note');
      diagram.setAnnotations([...notes, ...res.annotations]);
    }

    if (selectedLineStyle) {
      diagram.setEdgeRouting(selectedLineStyle);
    }

    resetOrientation(diagram);
    syncMenu();
    diagram.markDirty();
    diagram.fit();
    diagram.onLayoutChange?.();
    saveLayoutDebounced();
    if (editorMode === 'layout') updateLayoutTextarea();
    if (editorMode === 'visual') visualEditor?.render();

    closeAIModal();

    if (res.fallbackToLocal) {
      flashButton($('btn-arrange'), 'IA Local (Cuota Gemini)');
    }
  } catch (err) {
    console.error('AI Arrange Error:', err);
    if (aiStatusBox) {
      aiStatusBox.hidden = false;
      aiStatusText.textContent = 'Error: ' + (err.message || 'Rearrange failed');
    }
  }
}

// Re-arranges the existing groups (and the tables inside them) for short,
// untangled connections. Only the cheap estimate runs here; the user applies
// "Ruta Optima" afterwards once they are happy with the arrangement.
// The three group-layout algorithms are independent, deliberately frozen
// alternatives that trade crossings against canvas shape differently; the tooltip
// on each menu entry carries the measured numbers. They all run the cheap
// estimate only — the user applies "Ruta Óptima" afterwards for the real routing.
function runGroupArrange(arrange, label) {
  // Even the fast one can take a moment on a big schema, so paint before blocking.
  const btn = $('btn-arrange');
  endFlash(btn);
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span>';
  btn.disabled = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    let res;
    try {
      // Every arrangement flows left to right; pick another direction afterwards.
      res = arrange(diagram, { spacing: layoutOpts.spacing });
      resetOrientation(diagram);
      syncMenu();
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = original;
      console.warn(`${label} warning:`, err);
      alert(err.message || 'Could not arrange the groups.');
      return;
    }
    btn.disabled = false;
    btn.innerHTML = original;
    diagram.fit();
    saveLayoutDebounced();
    if (editorMode === 'layout') updateLayoutTextarea();
    if (editorMode === 'visual') visualEditor?.render();
    const loose = res?.loose ? ` + ${res.loose} loose` : '';
    const groups = res?.groups ?? 0;
    // With no groups the whole diagram was one invisible group: say so, rather
    // than a baffling "0 grupos".
    flashButton(btn, res?.implicit
      ? `No groups · ${res.tables} tables`
      : `${groups} group${groups !== 1 ? 's' : ''}${loose}`);
  }));
}

function executeExistingGroupsReorder() {
  if (!diagram.model || !diagram.model.tables || !diagram.model.tables.length) {
    alert('The diagram has no tables to arrange.');
    return;
  }

  const selectedLineStyle = aiLineStyle ? aiLineStyle.value : (diagram.edgeRouting || 'ortho-rounded');

  try {
    const res = reorderWithExistingGroups(diagram.model, diagram.annotations, {
      createGroups: true,
      lineStyle: selectedLineStyle,
      spacing: layoutOpts.spacing,
    });

    diagram.onHistorySnapshot?.(diagram.getSnapshot());

    // Every table just moved, so any stored vertex or anchor position now refers
    // to geometry that no longer exists. Wipe them, as the other three group
    // algorithms do, and let the lines be re-derived from scratch.
    diagram.edgeWaypoints.clear();
    diagram.edgeAnchors.clear();

    // Without groups there is no box to put back, but a stale empty group box
    // still goes, exactly as the other three algorithms drop it.
    if (res.annotations && (res.annotations.length || res.implicit)) {
      const notes = diagram.annotations.filter(a => a.type === 'note');
      diagram.setAnnotations([...notes, ...res.annotations]);
    }

    resetOrientation(diagram);
    syncMenu();

    if (selectedLineStyle) {
      diagram.setEdgeRouting(selectedLineStyle);
    }

    diagram.markDirty();
    diagram.fit();
    diagram.onLayoutChange?.();
    saveLayoutDebounced();
    if (editorMode === 'layout') updateLayoutTextarea();
    if (editorMode === 'visual') visualEditor?.render();

    closeAIModal();
    flashButton($('btn-arrange'), res.implicit ? 'Arranged without groups' : 'Groups arranged');
  } catch (err) {
    console.warn('Arrange existing groups warning:', err);
    alert(err.message || 'Could not arrange the existing groups.');
  }
}

btnRunLocalAI?.addEventListener('click', () => executeAIReorder(false));
btnRunGeminiAI?.addEventListener('click', () => executeAIReorder(true));
btnRunExistingGroups?.addEventListener('click', executeExistingGroupsReorder);

$('btn-fit').addEventListener('click', () => diagram.fit());

$('btn-infer').addEventListener('click', () => {
  const n = diagram.inferLinks();
  flashButton($('btn-infer'), n ? `+${n} link${n !== 1 ? 's' : ''}` : 'No links found');
});

// ---- annotation tools (note / group) ----
$('tool-note').addEventListener('click', () => diagram.addAnnotation('note'));
$('tool-group').addEventListener('click', () => diagram.addAnnotation('group'));

// ---- input-format dropdown ----
const formatBtn = $('btn-format');
const formatMenu = $('format-menu');
const dialectWrap = $('dialect-wrap');
for (const [key, label] of Object.entries(FORMATS)) {
  const b = document.createElement('button');
  b.className = 'menu-item';
  b.dataset.format = key;
  b.textContent = label;
  formatMenu.appendChild(b);
}
function syncFormat() {
  formatBtn.textContent = formatChoice === 'auto' ? 'Auto' : FORMATS[formatChoice];
  for (const el of formatMenu.querySelectorAll('[data-format]'))
    el.classList.toggle('active', el.dataset.format === formatChoice);
  // dialect picker only matters for SQL
  const sqlish = formatChoice === 'auto' || formatChoice === 'sql';
  dialectWrap.style.display = sqlish ? '' : 'none';
}
syncFormat();
formatBtn.addEventListener('click', (e) => { e.stopPropagation(); formatMenu.hidden = !formatMenu.hidden; });
formatMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const item = e.target.closest('.menu-item');
  if (!item) return;
  formatChoice = item.dataset.format;
  localStorage.setItem('dbdiga-format', formatChoice);
  syncFormat();
  formatMenu.hidden = true;
  rebuild({ arrange: true });   // re-parse with the chosen format
});
document.addEventListener('click', () => { formatMenu.hidden = true; });

// ---- dialect dropdown ----
const dialectBtn = $('btn-dialect');
const dialectMenu = $('dialect-menu');
for (const [key, d] of Object.entries(DIALECTS)) {
  const b = document.createElement('button');
  b.className = 'menu-item';
  b.dataset.dialect = key;
  b.dataset.umamiEvent = 'dialect-' + key;
  b.textContent = d.label;
  dialectMenu.appendChild(b);
}
function syncDialect() {
  dialectBtn.textContent = DIALECTS[dialect].label;
  for (const el of dialectMenu.querySelectorAll('[data-dialect]'))
    el.classList.toggle('active', el.dataset.dialect === dialect);
  diagram.typeSuggestions = DIALECTS[dialect].types;
}
syncDialect();
dialectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  dialectMenu.hidden = !dialectMenu.hidden;
});
dialectMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const item = e.target.closest('.menu-item');
  if (!item) return;
  dialect = item.dataset.dialect;
  localStorage.setItem('dbdiga-dialect', dialect);
  syncDialect();
  dialectMenu.hidden = true;
});
document.addEventListener('click', () => { dialectMenu.hidden = true; });

// ---- hide / show SQL panel (collapse from inside the panel, reopen from the canvas) ----
const layoutEl = $('layout');
function setSqlHidden(hidden) {
  localStorage.setItem('dbdiga-sql-hidden', hidden ? '1' : '0');
  layoutEl.classList.toggle('sql-hidden', hidden);
  diagram.resize();
}
$('btn-collapse-sql').addEventListener('click', () => setSqlHidden(true));
$('btn-open-sql').addEventListener('click', () => setSqlHidden(false));
// default: panel hidden on phones (diagram-first), shown on desktop
const savedSqlHidden = localStorage.getItem('dbdiga-sql-hidden');
setSqlHidden(savedSqlHidden === null ? window.matchMedia('(max-width: 720px)').matches : savedSqlHidden === '1');

// ---- Visual editor: a form-based lens on the same SQL ----
const veActions = {
  rename(kind, tableKey, colName, value) {
    applyChange({ kind: kind === 'table' ? 'table' : 'column-name', tableKey, colName, value });
  },
  setType(tableKey, colName, value) {
    applyChange({ kind: 'column-type', tableKey, colName, value });
  },
  toggleConstraint(tableKey, colName, kind, on) {
    const sql = sqlEl.value;
    const fmt = currentFormat();
    const res = toggleConstraint(sql, parseSchema(sql, fmt), tableKey, colName, kind, on);
    if (!res) return false;
    commitSql(res.sql, { pinKey: tableKey });
    return true;
  },
  deleteColumn(tableKey, colName) {
    const sql = sqlEl.value;
    const fmt = currentFormat();
    const res = deleteColumn(sql, parseSchema(sql, fmt), tableKey, colName);
    if (res) commitSql(res.sql, { pinKey: tableKey });
  },
  addColumn(tableKey) { return addColumnTo(tableKey); },
  addTable() {
    const sql = sqlEl.value;
    const fmt = currentFormat();
    const fresh = parseSchema(sql, fmt);
    const existing = new Set(fresh.tables.map(t => t.key));
    let name = 'new_table', i = 2;
    while (existing.has(name.toLowerCase())) name = `new_table_${i++}`;
    const idType = fmt === 'dbml' ? 'integer' : (DIALECTS[dialect].types.find(t => /int|serial|number/i.test(t)) || 'bigint');
    const res = addTable(sql, name, idType, fmt);
    if (!res) return null;
    commitSql(res.sql, { pinKey: res.tableKey });
    return { key: res.tableKey, name };
  },
  deleteTable(tableKey) {
    const sql = sqlEl.value;
    const fmt = currentFormat();
    const res = deleteTable(sql, parseSchema(sql, fmt), tableKey);
    if (res) commitSql(res.sql);
  },
  focusTable(tableKey) { diagram.centerOn(tableKey); diagram.pinByKey(tableKey); },
};
visualEditor = createVisualEditor({
  mount: $('visual-editor'),
  getModel: () => diagram.model,
  getDialect: () => (currentFormat() === 'dbml' ? DBML_DIALECT : DIALECTS[dialect]),
  getEditable: () => diagram.editable,
  getFormatLabel: () => FORMATS[lastModel && lastModel.format] || 'another format',
  actions: veActions,
});

const modeToggle = $('mode-toggle');
const visualPane = $('visual-editor');
const layoutPane = $('layout-editor');
const layoutJsonEl = $('layout-json');
let editorMode = localStorage.getItem('dbdiga-mode') || 'code';

function generateLayoutJson() {
  const data = collectLayout();
  return toDBMLLayout(diagram.model, diagram.annotations, data.camera, {
    diagramLevel: diagram.diagramLevel || 'physical',
    edgeColorMode: diagram.edgeColorMode || 'multi',
    edgeRouting: diagram.edgeRouting || 'curved',
    orientation: diagram.orientation || 'LR',
    connections: data.connections,
  });
}

function updateLayoutTextarea() {
  if (layoutJsonEl && document.activeElement !== layoutJsonEl) {
    layoutJsonEl.value = generateLayoutJson();
  }
}

let layoutJsonDebounce = null;
if (layoutJsonEl) {
  layoutJsonEl.addEventListener('input', () => {
    clearTimeout(layoutJsonDebounce);
    layoutJsonDebounce = setTimeout(() => {
      try {
        const parsed = JSON.parse(layoutJsonEl.value);
        if (parsed && typeof parsed === 'object') {
          applyLayoutData(diagram.model, parsed);
          if (parsed.camera) diagram.setCamera(parsed.camera);
          diagram.markDirty();
          saveLayoutDebounced();
          statusEl.textContent = 'Layout updated';
          statusEl.className = 'status ok';
        }
      } catch (err) {
        statusEl.textContent = 'Invalid JSON in Layout';
        statusEl.className = 'status warn';
      }
    }, 300);
  });
}

const btnDlLayout = $('btn-dl-layout');
if (btnDlLayout) {
  btnDlLayout.addEventListener('click', () => {
    downloadText('schema.dbml.layout.json', generateLayoutJson(), 'application/json');
  });
}

function setMode(mode) {
  editorMode = mode === 'visual' ? 'visual' : (mode === 'layout' ? 'layout' : 'code');
  localStorage.setItem('dbdiga-mode', editorMode);
  layoutEl.classList.toggle('visual-mode', editorMode === 'visual');
  layoutEl.classList.toggle('layout-mode', editorMode === 'layout');
  visualPane.hidden = editorMode !== 'visual';
  if (layoutPane) layoutPane.hidden = editorMode !== 'layout';
  for (const b of modeToggle.querySelectorAll('.seg-btn'))
    b.classList.toggle('active', b.dataset.mode === editorMode);
  if (editorMode === 'visual') visualEditor.render();
  if (editorMode === 'layout') updateLayoutTextarea();
}
modeToggle.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (b) setMode(b.dataset.mode);
});
setMode(editorMode);

// Connection colors live in the Line Style menu, one item per mode.
function syncEdgeColorsBtn() {
  const mode = diagram.edgeColorMode === 'single' ? 'single' : 'multi';
  for (const el of document.querySelectorAll('[data-edge-colors]'))
    el.classList.toggle('active', el.dataset.edgeColors === mode);
}
syncEdgeColorsBtn();

// ... and the menu ticks the line style the diagram is actually drawn with.
function syncRoutingMenu() {
  const style = diagram.edgeRouting || 'ortho-rounded';
  for (const el of document.querySelectorAll('[data-routing]'))
    el.classList.toggle('active', el.dataset.routing === style);
}
syncRoutingMenu();

// Line routing style selector button and menu
const btnEdgeRouting = $('btn-edge-routing');
const routingMenu = $('routing-menu');
if (btnEdgeRouting && routingMenu) {
  wireMenuSections(routingMenu);
  btnEdgeRouting.addEventListener('click', (e) => {
    e.stopPropagation();
    routingMenu.hidden = !routingMenu.hidden;
  });
  routingMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.menu-item');
    if (!item) return;
    routingMenu.hidden = true;

    if (item.dataset.edgeColors) {
      diagram.setEdgeColorMode(item.dataset.edgeColors);
      syncEdgeColorsBtn();
      saveLayoutDebounced();
      if (editorMode === 'layout') updateLayoutTextarea();
      return;
    }

    const selectedKeys = diagram.selectedEdgeKey ? [diagram.selectedEdgeKey] : null;

    if (item.id === 'btn-route-shortest-path') {
      // Rip-up and reroute is heavy on big diagrams, so park the button on a
      // spinner and let the browser paint before the search blocks the thread.
      endFlash(btnEdgeRouting);
      const icon = btnEdgeRouting.innerHTML;
      const title = btnEdgeRouting.title;
      btnEdgeRouting.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span>';
      btnEdgeRouting.disabled = true;
      btnEdgeRouting.title = 'Calculating routes…';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        let summary;
        try {
          summary = organizeLinesShortestPath(diagram, selectedKeys);
        } finally {
          btnEdgeRouting.disabled = false;
          btnEdgeRouting.innerHTML = icon;
          btnEdgeRouting.title = title;
        }
        saveLayoutDebounced();
        if (editorMode === 'layout') updateLayoutTextarea();
        const n = summary.routed;
        flashButton(btnEdgeRouting, n
          ? `${n} route${n !== 1 ? 's' : ''} · ${summary.crossings} crossing${summary.crossings !== 1 ? 's' : ''}`
          : 'No lines');
      }));
      return;
    }


    if (item.id === 'btn-route-elk-ports') {
      const count = organizeLinesElkPorts(diagram, selectedKeys);
      saveLayoutDebounced();
      if (editorMode === 'layout') updateLayoutTextarea();
      flashButton(btnEdgeRouting, count ? `${count} route${count !== 1 ? 's' : ''}` : 'Clean routes');
      return;
    }



    if (item.id === 'btn-route-astar-grid') {
      const count = organizeLinesAStar(diagram, selectedKeys);
      saveLayoutDebounced();
      if (editorMode === 'layout') updateLayoutTextarea();
      flashButton(btnEdgeRouting, count ? `${count} route${count !== 1 ? 's' : ''}` : 'Clean routes');
      return;
    }

    if (item.id === 'btn-route-reset-lines') {
      resetLines(diagram, selectedKeys);
      saveLayoutDebounced();
      if (editorMode === 'layout') updateLayoutTextarea();
      flashButton(btnEdgeRouting, 'Direct lines');
      return;
    }

    const style = item.dataset.routing;
    if (style) {
      diagram.setEdgeRouting(style);
      syncRoutingMenu();
      saveLayoutDebounced();
      if (editorMode === 'layout') updateLayoutTextarea();
    }
  });
  document.addEventListener('click', () => { routingMenu.hidden = true; });
}

$('zoom-in').addEventListener('click', () => diagram.zoomBy(1.25));
$('zoom-out').addEventListener('click', () => diagram.zoomBy(0.8));
$('zoom-reset').addEventListener('click', () => diagram.resetZoom());

$('btn-theme').addEventListener('click', () => {
  const next = diagram.themeName === 'dark' ? 'light' : 'dark';
  diagram.setTheme(next);
  localStorage.setItem('dbdiga-theme', next);
});

function download(filename, href) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  download(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Reusable "here's some text — copy or download it" modal (export code, embed snippet).
let _modal = null;
function showCodeModal(title, text, filename, umamiLabel, extraDownload = null) {
  if (!_modal) {
    _modal = document.createElement('div');
    _modal.className = 'modal';
    _modal.hidden = true;
    _modal.innerHTML =
      '<div class="modal-card">' +
      '<div class="modal-head"><span class="modal-title"></span>' +
      '<button class="modal-close icon-btn" aria-label="Close">✕</button></div>' +
      '<textarea class="modal-text" readonly spellcheck="false"></textarea>' +
      '<div class="modal-actions"><span class="modal-hint"></span>' +
      '<button class="btn ghost modal-dl">Download</button>' +
      '<button class="btn primary modal-copy">Copy</button></div></div>';
    document.body.appendChild(_modal);
    const close = () => { _modal.hidden = true; };
    _modal.querySelector('.modal-close').addEventListener('click', close);
    _modal.addEventListener('click', (e) => { if (e.target === _modal) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !_modal.hidden) close(); });
  }
  const ta = _modal.querySelector('.modal-text');
  const copyBtn = _modal.querySelector('.modal-copy');
  const dlBtn = _modal.querySelector('.modal-dl');
  _modal.querySelector('.modal-title').textContent = title;
  const hint = filename ? (extraDownload ? `${filename} + ${extraDownload.filename}` : filename) : '';
  _modal.querySelector('.modal-hint').textContent = hint;
  ta.value = text;
  copyBtn.textContent = 'Copy';
  if (umamiLabel) copyBtn.setAttribute('data-umami-event', 'copy-' + umamiLabel);
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(ta.value); copyBtn.textContent = 'Copied ✓'; }
    catch { ta.select(); document.execCommand && document.execCommand('copy'); copyBtn.textContent = 'Copied ✓'; }
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  };
  dlBtn.hidden = !filename;
  dlBtn.onclick = () => {
    downloadText(filename, ta.value, 'text/plain');
    if (extraDownload) {
      const extraContent = typeof extraDownload.content === 'function' ? extraDownload.content() : extraDownload.content;
      setTimeout(() => {
        downloadText(extraDownload.filename, extraContent, extraDownload.mime || 'application/json');
      }, 150);
    }
  };
  _modal.hidden = false;
  ta.focus(); ta.setSelectionRange(0, 0);
}

function exportImage(kind) {
  if (kind === 'png') {
    const url = diagram.exportPNG(2);
    if (url) download('schema.png', url);
  } else {
    const svg = exportSVG(
      diagram.model,
      diagram.themeName,
      diagram.annotations,
      diagram.hidden,
      diagram.edgeColorMode,
      diagram.edgeColors,
      diagram.edgeRouting,
      diagram.edgeWaypoints,
      diagram.edgeAnchors,
      diagram.edgeRoutings,
      diagram.diagramLevel
    );
    if (svg) downloadText('schema.svg', svg, 'image/svg+xml');
  }
}

// ---- Diagram Level menu (Physical / Logical / Conceptual) ----
const diagramLevelBtn = $('btn-diagram-level');
const diagramLevelMenu = $('diagram-level-menu');
const diagramLevelLabel = $('diagram-level-label');

const LEVEL_META = {
  physical: { label: 'Physical' },
  logical: { label: 'Logical' },
  conceptual: { label: 'Conceptual' },
};

function syncDiagramLevelUI() {
  const current = diagram.diagramLevel || 'physical';
  const meta = LEVEL_META[current] || LEVEL_META.physical;
  if (diagramLevelLabel) diagramLevelLabel.textContent = meta.label;
  if (diagramLevelMenu) {
    for (const btn of diagramLevelMenu.querySelectorAll('[data-level]')) {
      btn.classList.toggle('active', btn.dataset.level === current);
    }
  }
}

if (diagramLevelBtn && diagramLevelMenu) {
  diagramLevelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    diagramLevelMenu.hidden = !diagramLevelMenu.hidden;
  });
  diagramLevelMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.target.closest('[data-level]');
    if (!btn) return;
    const level = btn.dataset.level;
    diagram.setDiagramLevel(level);
    localStorage.setItem('dbdiga-diagram-level', level);
    syncDiagramLevelUI();
    diagramLevelMenu.hidden = true;
    saveLayout();
  });
  document.addEventListener('click', () => {
    diagramLevelMenu.hidden = true;
  });
}

diagram.onDiagramLevelChange = (level) => {
  syncDiagramLevelUI();
  saveLayout();
};

const savedDiagramLevel = localStorage.getItem('dbdiga-diagram-level');
if (savedDiagramLevel && ['physical', 'logical', 'conceptual'].includes(savedDiagramLevel)) {
  diagram.setDiagramLevel(savedDiagramLevel);
}
syncDiagramLevelUI();

// ---- Export menu (image + code formats) ----
const exportBtn = $('btn-export');
const exportMenu = $('export-menu');
exportBtn.addEventListener('click', (e) => { e.stopPropagation(); exportMenu.hidden = !exportMenu.hidden; });
exportMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const item = e.target.closest('.menu-item');
  if (!item) return;
  exportMenu.hidden = true;
  const kind = item.dataset.export;
  if (kind === 'png' || kind === 'svg') { exportImage(kind); return; }
  const s = SERIALIZERS[kind];
  if (!s) return;
  const text = serialize(diagram.model, kind, diagram.annotations);
  const extraDownload = (kind === 'dbml') ? {
    filename: 'schema.dbml.layout.json',
    content: () => generateLayoutJson(),
    mime: 'application/json',
  } : null;
  showCodeModal(`Export — ${s.label}`, text, `schema.${s.ext}`, s.label.toLowerCase(), extraDownload);
});
document.addEventListener('click', () => { exportMenu.hidden = true; });

// ---- File menu (open / save / embed) ----
const fileBtn = $('btn-file');
const fileMenu = $('file-menu');
fileBtn.addEventListener('click', (e) => { e.stopPropagation(); fileMenu.hidden = !fileMenu.hidden; });
document.addEventListener('click', () => { fileMenu.hidden = true; });

// ---- Save / Open project (SQL + layout + camera + dialect) ----
$('btn-save').addEventListener('click', () => {
  const project = {
    app: 'dbdiga',
    version: 1,
    sql: sqlEl.value,
    dialect,
    ...collectLayout(),
  };
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  download('schema.sqltoerdiagram.json', url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ---- Share link (project encoded in the URL hash; nothing stored server-side) ----
// What each button really says while a flash message covers it. Remembered the
// first time only: a flash that starts while another is still showing (clicking
// through the Direction buttons does exactly that) must not mistake that message
// for the button's own content, or the button keeps the message for good.
const flashState = new WeakMap();

function flashButton(btn, text) {
  let st = flashState.get(btn);
  if (!st) {
    // innerHTML, not textContent: icon buttons carry an <svg> that must survive.
    st = { html: btn.innerHTML, icon: btn.classList.contains('icon'), timer: null };
    flashState.set(btn, st);
  }
  clearTimeout(st.timer);
  if (st.icon) btn.classList.remove('icon');   // let the button size to the message
  btn.textContent = text;
  st.timer = setTimeout(() => endFlash(btn), 1500);
}

// Put a button back to its own content now, cancelling any flash still showing.
// Call it before capturing a button's innerHTML to swap in a spinner.
function endFlash(btn) {
  const st = flashState.get(btn);
  if (!st) return;
  clearTimeout(st.timer);
  btn.innerHTML = st.html;
  if (st.icon) btn.classList.add('icon');
  flashState.delete(btn);
}
$('btn-share').addEventListener('click', async () => {
  const btn = $('btn-share');
  const project = { app: 'dbdiga', version: 1, sql: sqlEl.value, dialect, ...collectLayout() };
  let payload;
  try { payload = await encodeShare(project); }
  catch (err) { console.error(err); flashButton(btn, 'Failed'); return; }
  const hash = '#s=' + payload;
  // window.history: in this module `history` is the undo/redo manager, which
  // shadows the browser's and has no replaceState, so Share used to throw here.
  window.history.replaceState(null, '', hash);          // put it in the address bar too
  const url = location.origin + location.pathname + hash;
  try { await navigator.clipboard.writeText(url); flashButton(btn, 'Link copied ✓'); }
  catch { flashButton(btn, 'Link in URL ↑'); }          // clipboard blocked → it's in the URL
});

// ---- Embed: an <iframe> snippet that renders this diagram read-only & live ----
$('btn-embed').addEventListener('click', async () => {
  const project = { app: 'dbdiga', version: 1, sql: sqlEl.value, dialect, ...collectLayout() };
  let payload;
  try { payload = await encodeShare(project); }
  catch (err) { console.error(err); return; }
  const src = location.origin + location.pathname + '?embed=1#s=' + payload;
  const snippet =
    `<iframe src="${src}" width="100%" height="500" loading="lazy"\n` +
    `        style="border:1px solid #e5e7eb;border-radius:10px" title="ER diagram"></iframe>`;
  showCodeModal('Embed this diagram', snippet, null, 'embed');
});

const fileInput = $('file-open');
$('btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (typeof data.sql !== 'string') throw new Error('not a dbdiga project');
      sqlEl.value = data.sql;
      localStorage.setItem('dbdiga-sql', data.sql);
      if (data.dialect && DIALECTS[data.dialect]) { dialect = data.dialect; localStorage.setItem('dbdiga-dialect', dialect); syncDialect(); }
      firstRender = true;          // ensure a clean restore even if a model exists
      rebuild({ restore: data });   // the whole saved layout: positions, lines, line style, direction
      saveLayout();
    } catch (err) {
      statusEl.textContent = 'Invalid project file';
      statusEl.className = 'status err';
      console.error(err);
    }
    fileInput.value = '';          // allow re-opening the same file
  };
  reader.readAsText(file);
});

// ---- splitter (resize editor pane) ----
const splitter = $('splitter');
const editorPane = $('editor-pane');
let dragSplit = null;
splitter.addEventListener('mousedown', (e) => {
  dragSplit = { startX: e.clientX, startW: editorPane.offsetWidth };
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!dragSplit) return;
  const w = Math.max(220, Math.min(window.innerWidth - 320, dragSplit.startW + (e.clientX - dragSplit.startX)));
  editorPane.style.width = w + 'px';
  diagram.resize();
});
window.addEventListener('mouseup', () => {
  if (dragSplit) { dragSplit = null; document.body.style.cursor = ''; }
});

window.addEventListener('resize', () => diagram.resize());

// keyboard shortcuts
window.addEventListener('keydown', (e) => {
  const typing = document.activeElement &&
    (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT');
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    rebuild({ arrange: true });
  } else if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && diagram.selectedAnno) {
    e.preventDefault();
    diagram.deleteSelectedAnnotation();
  } else if (!typing && (e.key === 'h' || e.key === 'H') && diagram.selected.size > 0) {
    e.preventDefault();
    diagram.hideTable(null);   // hide the current selection
  } else if (e.key === 'Escape' && !typing) {
    hideCtx();
    diagram.clearSelection();
  }
});

// ---- embed mode: read-only, chrome-free, with a click-through backlink ----
if (isEmbed) {
  document.body.classList.add('embed');
  diagram.editable = false;
  const brand = document.createElement('a');
  brand.className = 'embed-brand';
  brand.target = '_blank';
  brand.rel = 'noopener';
  brand.href = location.origin + location.pathname + location.hash; // open full editor, same diagram
  brand.title = 'Open in SQL to ER Diagram';
  brand.innerHTML =
    '<span class="logo" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg></span>' +
    'sqltoerdiagram.com';
  document.querySelector('.canvas-pane').appendChild(brand);
}

// ---- boot: shared link > last session > example ----
(async () => {
  // 1) shared link (#s=…) takes precedence
  if (location.hash.startsWith('#s=')) {
    try {
      const data = await decodeShare(location.hash.slice(3));
      sqlEl.value = data.sql || '';
      localStorage.setItem('dbdiga-sql', sqlEl.value);
      if (data.dialect && DIALECTS[data.dialect]) {
        dialect = data.dialect;
        localStorage.setItem('dbdiga-dialect', dialect);
        syncDialect();
      }
      if (data.format && FORMATS[data.format]) {
        formatChoice = data.format;
        localStorage.setItem('dbdiga-format', formatChoice);
        syncFormat();
      }
      firstRender = true;
      // a shared schema with no saved positions (e.g. gallery links) → auto-arrange
      const hasPositions = data.positions && Object.keys(data.positions).length > 0;
      if (hasPositions) {
        rebuild({ restore: data });   // the whole saved layout: positions, lines, line style, direction
      } else {
        rebuild({ arrange: true });
      }
      saveLayout();
      return;
    } catch (err) {
      console.error('Could not read shared link', err);
      statusEl.textContent = 'Bad share link';
      statusEl.className = 'status err';
    }
  }
  // 2) last session
  const saved = localStorage.getItem('dbdiga-sql');
  if (saved && saved.trim()) {
    sqlEl.value = saved;
    const savedLayout = loadSavedLayout();
    if (savedLayout) rebuild({ restore: savedLayout });
    else rebuild();
    return;
  }
  // 3) first visit
  loadExample();
})();
