import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './style.css';
import { parseSchema, FORMATS, resolveFormat, formatReady, loadFormat, loadAllFormats } from './parse.js';
import { computeLayout, warmLayout } from './layout-client.js';
import { Diagram } from './diagram.js';
import { applyEdit, addColumn, deleteColumn, toggleConstraint, addTable, deleteTable } from './edit.js';
import { createMinimap } from './minimap.js';
import { createHistory } from './history.js';
import { createPalette } from './palette.js';
import { createStore, hashText } from './store.js';
import { TABLE_COLORS, TABLE_COLOR_ORDER, THEMES, THEME_LIST } from './renderer.js';
import { DIALECTS, DEFAULT_DIALECT } from './dialects.js';
import { highlightSQL } from './highlight.js';
import { encodeShare, decodeShare } from './share.js';
import { sanitizeAnnotations } from './annotations.js';
import { EXAMPLE_SQL } from './examples.js';

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
let visualEditor = null;     // loaded on first use of Visual mode; refreshed on every model change
warmLayout();                // boot the layout worker now so the first arrange doesn't wait for it

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

// read-only embed view (?embed=1) — never editable, no matter the input format
const isEmbed = new URLSearchParams(location.search).has('embed');

// ---- syntax highlight layer (painted behind the transparent textarea) ----
let hlQueued = false;
let hlMarks = [];            // parse-problem ranges, underlined in the editor
function syncHighlight() {
  // coalesce to one repaint per frame so fast typing never blocks
  if (hlQueued) return;
  hlQueued = true;
  requestAnimationFrame(() => {
    hlQueued = false;
    hlEl.innerHTML = highlightSQL(sqlEl.value, hlMarks);
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
  const positions = {};
  // settled values: never persist a mid-animation frame
  for (const t of diagram.model.tables) {
    const p = diagram.settledPos(t);
    if (Number.isFinite(p.x)) positions[t.key] = { x: Math.round(p.x), y: Math.round(p.y) };
  }
  const cam = diagram.settledCam();
  return {
    positions,
    camera: { x: Math.round(cam.x), y: Math.round(cam.y), scale: +cam.scale.toFixed(4) },
    annotations: diagram.annotations.map(a => ({ ...a })),
    hidden: [...diagram.hidden],
    manualLinks: diagram.manualLinks.map(l => ({ from: { ...l.from }, to: { ...l.to } })),
    colors: { ...diagram.tableColors },
  };
}
// the layout part of a saved project / share link / version, in the shape rebuild({ restore }) takes
const restoreOf = (d) => ({
  positions: d && d.positions, camera: d && d.camera, annotations: d && d.annotations,
  hidden: d && d.hidden, manualLinks: d && d.manualLinks, colors: d && d.colors,
});
function saveLayout() {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(collectLayout())); } catch { /* quota */ }
  afterSave();
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
  if (!data || !data.positions) return false;
  let placed = 0;
  for (const t of model.tables) {
    const p = data.positions[t.key];
    if (p && Number.isFinite(p.x)) { t.x = p.x; t.y = p.y; placed++; }
  }
  return placed > 0;
}
// Position any tables that have no coordinates yet, beside the existing ones.
// Returns false when nothing is placed at all — the caller should run a full
// auto-layout instead.
function placeNewTables(model) {
  const missing = model.tables.filter(t => !Number.isFinite(t.x) && !diagram.hidden.has(t.key));
  if (!missing.length) return true;
  const placed = model.tables.filter(t => Number.isFinite(t.x));
  if (!placed.length) return false;
  let x1 = -Infinity, y0 = Infinity;
  for (const t of placed) { x1 = Math.max(x1, t.x + t.w); y0 = Math.min(y0, t.y); }
  let x = x1 + 80, y = Number.isFinite(y0) ? y0 : 40;
  for (const t of missing) { t.x = x; t.y = y; y += t.h + 40; }
  return true;
}

// ---- undo / redo: whole-diagram snapshots ----
const history = createHistory();
let restoring = false;       // applying a snapshot — don't record it as a new step
let layoutPending = false;   // an async auto-layout is in flight — state is mid-change
let historyHold = 0;         // >0 while a multi-step change is being applied (commit once, at the end)

function snapshot() {
  const l = collectLayout();
  return {
    sql: sqlEl.value, format: formatChoice,
    positions: l.positions, annotations: l.annotations, hidden: l.hidden, manualLinks: l.manualLinks, colors: l.colors,
  };
}
function historyCommit(kind) {
  if (restoring || layoutPending || historyHold) return;
  const snap = snapshot();
  history.commit(snap, JSON.stringify(snap), kind);
  syncUndoButtons();
}
function syncUndoButtons() {
  const u = $('btn-undo'), r = $('btn-redo');
  if (u) u.disabled = !history.canUndo;
  if (r) r.disabled = !history.canRedo;
}
function applySnapshot(snap) {
  const before = sqlEl.value;
  restoring = true;
  try {
    diagram._cancelEdit();
    if (snap.format !== formatChoice) {
      formatChoice = snap.format;
      localStorage.setItem('dbdiga-format', formatChoice);
      syncFormat();
    }
    sqlEl.value = snap.sql;
    rebuild({
      restore: {
        positions: snap.positions, annotations: snap.annotations, hidden: snap.hidden, colors: snap.colors,
        manualLinks: snap.manualLinks, camera: { ...diagram.settledCam() },   // undo never moves the view
      },
    });
  } finally { restoring = false; }
  // keep the caret at the change when undoing from the editor
  if (document.activeElement === sqlEl && before !== snap.sql) {
    let suffix = 0;
    const max = Math.min(before.length, snap.sql.length);
    while (suffix < max && before[before.length - 1 - suffix] === snap.sql[snap.sql.length - 1 - suffix]) suffix++;
    const caret = snap.sql.length - suffix;
    sqlEl.setSelectionRange(caret, caret);
  }
  saveLayoutDebounced();
  syncUndoButtons();
}
function flushTyping() {
  if (timer === null) return;
  clearTimeout(timer); timer = null;
  rebuild({ typing: true });
}
function undo() {
  flushTyping();
  const snap = history.undo();
  if (snap) applySnapshot(snap);
}
function redo() {
  flushTyping();
  const snap = history.redo();
  if (snap) applySnapshot(snap);
}

diagram.onLayoutChange = () => { saveLayoutDebounced(); historyCommit('layout'); };

// ---- toast: brief confirmation, optionally with one action (e.g. Undo) ----
const toastEl = document.createElement('div');
toastEl.className = 'toast';
toastEl.setAttribute('role', 'status');
toastEl.setAttribute('aria-live', 'polite');
toastEl.hidden = true;
canvas.parentElement.appendChild(toastEl);
let toastTimer = null;
function toast(message, { action = null, tone = '', ms = 3200 } = {}) {
  clearTimeout(toastTimer);
  toastEl.className = 'toast' + (tone ? ' ' + tone : '');
  toastEl.textContent = message;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => { toastEl.hidden = true; action.run(); });
    toastEl.appendChild(b);
  }
  toastEl.hidden = false;
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, action ? Math.max(ms, 5000) : ms);
}

// ---- "Arranging…" chip: only shown when a layout takes long enough to notice ----
const busyEl = document.createElement('div');
busyEl.className = 'busy-chip';
busyEl.setAttribute('role', 'status');
busyEl.hidden = true;
canvas.parentElement.appendChild(busyEl);
let busyTimer = null;
function setBusy(text) {
  clearTimeout(busyTimer);
  if (!text) { busyEl.hidden = true; return; }
  busyTimer = setTimeout(() => { busyEl.textContent = text; busyEl.hidden = false; }, 180);
}

// theme: restore preference
const savedTheme = localStorage.getItem('dbdiga-theme') || 'dark';
diagram.setTheme(THEMES[savedTheme] ? savedTheme : 'dark');

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
diagram.onHiddenChange = () => { syncHiddenChip(); saveLayoutDebounced(); historyCommit('layout'); };

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const t = diagram.tableAt(sx, sy);
  const items = [];
  if (t) {
    const multi = diagram.selected.has(t) && diagram.selected.size > 1;
    items.push({ label: multi ? `Hide ${diagram.selected.size} tables` : 'Hide table', act: () => diagram.hideTable(t) });
  } else {
    const link = diagram.linkAt(sx, sy);
    if (link) items.push({ label: 'Remove link', act: () => diagram.removeManualLink(link) });
  }
  if (diagram.hiddenCount() > 0) items.push({ label: `Show all hidden (${diagram.hiddenCount()})`, act: () => diagram.showAllHidden() });
  if (diagram.manualLinkCount() > 0) items.push({ label: `Clear manual links (${diagram.manualLinkCount()})`, act: () => diagram.clearManualLinks() });
  if (!items.length) { hideCtx(); return; }
  ctxMenu.innerHTML = '';
  if (t && !isEmbed) {
    const row = document.createElement('div');
    row.className = 'ctx-colors';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Table colour');
    for (const name of [null, ...TABLE_COLOR_ORDER]) {
      const b = document.createElement('button');
      b.className = 'ctx-color' + ((t.color || null) === name ? ' active' : '') + (name ? '' : ' none');
      if (name) b.style.background = TABLE_COLORS[name];
      b.title = name ? name[0].toUpperCase() + name.slice(1) : 'No colour';
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => { diagram.setTableColor(t, name); hideCtx(); });
      row.appendChild(b);
    }
    ctxMenu.appendChild(row);
  }
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'ctx-item';
    b.textContent = it.label;
    b.addEventListener('click', () => { it.act(); hideCtx(); });
    ctxMenu.appendChild(b);
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
  dir: localStorage.getItem('dbdiga-dir') || 'LR',
  spacing: localStorage.getItem('dbdiga-spacing') || 'comfortable',
};

// input format: 'auto' detects SQL / Prisma / SQLAlchemy / Sequelize
let formatChoice = localStorage.getItem('dbdiga-format') || 'auto';
if (!FORMATS[formatChoice]) formatChoice = 'auto';

// Run the auto-layout (in a worker) and glide the tables to their new places.
// `from`: positions before the change (key -> {x,y}), the start of the glide.
let layoutGen = 0;
function arrangeTables(model, { from = null, animate = true, fit = true } = {}) {
  const gen = ++layoutGen;
  if (!model.tables.length) return;
  layoutPending = true;
  const n = model.tables.length;
  setBusy(`Arranging ${n} table${n !== 1 ? 's' : ''}…`);
  computeLayout(model, layoutOpts, diagram.hidden).then((positions) => {
    if (gen !== layoutGen) return;                     // a newer arrange owns the state
    layoutPending = false;
    setBusy(null);
    if (diagram.model !== model) return;               // schema changed while we were computing
    for (const t of model.tables) {
      const p = positions[t.key];
      if (p) { t.x = p.x; t.y = p.y; }
    }
    diagram._tmapDirty = true;
    diagram.transition(animate ? from : null, { fit, animate });
    saveLayoutDebounced();
    historyCommit('edit');
  }).catch((err) => {
    if (gen !== layoutGen) return;
    layoutPending = false;
    setBusy(null);
    console.error(err);
    toast('Could not arrange the diagram', { tone: 'err' });
  });
}

function rebuild(opts = {}) {
  historyHold++;
  let settled = false;
  try { settled = rebuildNow(opts); }
  finally { historyHold--; }
  // one history step for the whole change (an async arrange records its own)
  if (settled) { saveLayoutDebounced(); historyCommit(opts.typing ? 'type' : 'edit'); }
}

// Returns true when the new state is final, false if a parse error or a
// pending auto-layout means there is nothing to record yet.
function rebuildNow(opts) {
  const { arrange = false, restore = null } = opts;
  const sql = sqlEl.value;
  localStorage.setItem('dbdiga-sql', sql);

  // non-SQL parsers load on first use; come back once this one has arrived
  const fmt = resolveFormat(sql, formatChoice);
  if (!formatReady(fmt)) {
    loadFormat(fmt).then(
      () => { if (sqlEl.value === sql) rebuild(opts); },
      (err) => { console.error(err); toast(`Could not load the ${FORMATS[fmt] || fmt} parser — check your connection`, { tone: 'err' }); },
    );
    syncHighlight();
    return false;
  }

  let result;
  try {
    result = parseSchema(sql, formatChoice);
  } catch (err) {
    syncHighlight();
    statusEl.textContent = 'Parse error';
    statusEl.className = 'status err';
    console.error(err);
    return false;
  }
  hlMarks = result.warnings;
  syncHighlight();

  diagram.editable = result.editable && !isEmbed;   // only SQL supports edit-back; never in embed
  updateStatus(result, sql);

  const prevKeys = lastModel ? lastModel.tables.map(t => t.key).sort().join('|') : '';
  const newKeys = result.tables.map(t => t.key).sort().join('|');
  const structureChanged = prevKeys !== newKeys;

  // where every table is now — the starting point if we re-arrange
  const from = new Map(diagram.model.tables.map(t => [t.key, diagram.settledPos(t)]));

  diagram.setModel(result);
  diagram._tmapDirty = true;
  // setModel keeps the positions of tables that already existed; restored
  // positions (open / share link / undo) must win over those
  if (restore) applyLayoutData(result, restore);

  let needsLayout = false;
  if (arrange) {
    needsLayout = true;
  } else if (restore) {
    diagram.setHidden(restore.hidden);               // restore hidden tables before placing
    diagram.setManualLinks(restore.manualLinks);     // restore user-drawn / inferred links
    diagram.setTableColors(restore.colors);
    needsLayout = !placeNewTables(result);           // tables not in the saved layout
    diagram.setAnnotations(sanitizeAnnotations(restore.annotations));
    if (restore.camera) diagram.setCamera(restore.camera);
    else if (!needsLayout) diagram.fit();
  } else if (firstRender) {
    needsLayout = true;
  } else if (structureChanged) {
    needsLayout = !placeNewTables(result);           // keep manual layout, place only new tables
  }

  diagram.markDirty();
  lastModel = result;
  const animate = !firstRender;                      // nothing to glide from on first paint
  firstRender = false;
  renderTables();
  if (visualEditor) visualEditor.render();

  if (needsLayout && result.tables.length) {
    arrangeTables(result, { from, animate, fit: !(restore && restore.camera) });
    return false;
  }
  return true;
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
  syncIssues(result.warnings || []);
}

// ---- parse issues: "2 issues" chip -> list -> click jumps to the line ----
const issuesBtn = document.createElement('button');
issuesBtn.className = 'issues-btn';
issuesBtn.hidden = true;
issuesBtn.setAttribute('aria-haspopup', 'true');
issuesBtn.setAttribute('aria-expanded', 'false');
const issuesMenu = document.createElement('div');
issuesMenu.className = 'menu up issues-menu';
issuesMenu.hidden = true;
const issuesWrap = document.createElement('div');
issuesWrap.className = 'menu-wrap issues-wrap';
issuesWrap.append(issuesBtn, issuesMenu);
statusEl.after(issuesWrap);
let issues = [];
function syncIssues(list) {
  issues = list;
  issuesBtn.hidden = list.length === 0;
  if (!list.length) { issuesMenu.hidden = true; issuesBtn.setAttribute('aria-expanded', 'false'); return; }
  issuesBtn.textContent = `${list.length} issue${list.length !== 1 ? 's' : ''}`;
  issuesBtn.title = 'Parts of the schema that could not be read — click to see them';
  if (!issuesMenu.hidden) renderIssues();
}
function renderIssues() {
  const text = sqlEl.value;
  issuesMenu.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'menu-label';
  head.textContent = 'Could not read';
  issuesMenu.appendChild(head);
  for (const w of issues.slice(0, 50)) {
    const line = text.slice(0, w.start).split('\n').length;
    const b = document.createElement('button');
    b.className = 'menu-item issue-item';
    const msg = document.createElement('span');
    msg.textContent = w.message;
    const ln = document.createElement('span');
    ln.className = 'issue-line';
    ln.textContent = 'line ' + line;
    b.append(msg, ln);
    b.addEventListener('click', () => { issuesMenu.hidden = true; issuesBtn.setAttribute('aria-expanded', 'false'); revealInEditor(w.start, w.end); });
    issuesMenu.appendChild(b);
  }
  if (issues.length > 50) {
    const more = document.createElement('div');
    more.className = 'menu-label';
    more.textContent = `…and ${issues.length - 50} more`;
    issuesMenu.appendChild(more);
  }
}
issuesBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  issuesMenu.hidden = !issuesMenu.hidden;
  issuesBtn.setAttribute('aria-expanded', String(!issuesMenu.hidden));
  if (!issuesMenu.hidden) renderIssues();
});
document.addEventListener('click', () => { issuesMenu.hidden = true; issuesBtn.setAttribute('aria-expanded', 'false'); });

// select a source range in the code editor and scroll it into view
function revealInEditor(start, end) {
  if (layoutEl.classList.contains('sql-hidden')) setSqlHidden(false);
  if (editorMode !== 'code') setMode('code');
  sqlEl.focus();
  sqlEl.setSelectionRange(start, end);
  const line = sqlEl.value.slice(0, start).split('\n').length - 1;
  const lh = parseFloat(getComputedStyle(sqlEl).lineHeight) || 20;
  sqlEl.scrollTop = Math.max(0, line * lh - sqlEl.clientHeight / 3);
}

// ---- shared commit: re-parse edited SQL, preserve positions, refresh views ----
// Every model-mutating edit (canvas or visual panel) funnels through here so the
// textarea, the diagram and the visual panel stay in lockstep.
function commitSql(newSql, { pinKey = null, renameFrom = null, renameTo = null } = {}) {
  sqlEl.value = newSql;
  localStorage.setItem('dbdiga-sql', newSql);
  // remember current positions so the edit doesn't reshuffle the diagram
  const oldPos = new Map(diagram.model.tables.map(t => [t.key, { x: t.x, y: t.y }]));
  if (renameTo && renameFrom !== renameTo && diagram.tableColors[renameFrom]) {   // a renamed table keeps its colour
    diagram.tableColors[renameTo] = diagram.tableColors[renameFrom];
    delete diagram.tableColors[renameFrom];
  }
  const model = parseSchema(newSql, 'sql');
  for (const t of model.tables) {
    let p = oldPos.get(t.key);
    if (!p && renameTo && t.key === renameTo) p = oldPos.get(renameFrom);   // renamed table keeps its spot
    if (p && Number.isFinite(p.x)) { t.x = p.x; t.y = p.y; }
  }
  diagram.setModel(model);          // measures sizes, keeps the positions we set
  const placed = placeNewTables(model);   // position any brand-new tables
  if (pinKey) diagram.pinByKey(pinKey);
  diagram.markDirty();
  hlMarks = model.warnings || [];
  syncHighlight();
  updateStatus(model, newSql);
  lastModel = model;
  renderTables();
  if (visualEditor) visualEditor.render();
  if (!placed) arrangeTables(model, { animate: false });   // first table(s) on an empty canvas
  else { saveLayoutDebounced(); historyCommit('edit'); }
}

// ---- canvas editing: edit a table/column on the diagram -> rewrite SQL ----
function applyChange(change) {
  const sql = sqlEl.value;
  const fresh = parseSchema(sql, 'sql');   // SQL parser for accurate spans
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
  const fresh = parseSchema(sql, 'sql');
  const table = fresh.tables.find(t => t.key === tableKey);
  if (!table) return null;
  // pick a unique default name
  const existing = new Set(table.columns.map(c => c.name.toLowerCase()));
  let name = 'new_column', i = 2;
  while (existing.has(name.toLowerCase())) name = `new_column_${i++}`;
  const res = addColumn(sql, fresh, tableKey, name, DIALECTS[dialect].default);
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
  timer = setTimeout(() => { timer = null; rebuild({ typing: true }); }, 180);
});
// the app owns undo for the editor too (one history for text + canvas), so
// route the browser's own undo/redo — Edit menu, shake, etc. — through it
sqlEl.addEventListener('beforeinput', (e) => {
  if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); }
  else if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); }
});

// ---- buttons ----
function loadExample() {
  if (formatChoice !== 'auto' && formatChoice !== 'sql') {
    formatChoice = 'auto';
    localStorage.setItem('dbdiga-format', formatChoice);
    syncFormat();
  }
  sqlEl.value = EXAMPLE_SQL;
  rebuild({ arrange: true });
}
$('btn-example').addEventListener('click', loadExample);
$('btn-example2')?.addEventListener('click', loadExample);
$('btn-open2')?.addEventListener('click', () => fileInput.click());
$('btn-import2')?.addEventListener('click', () => openDialog('import'));

// Arrange button: re-arrange with current opts; the ▾ part toggles the menu.
const arrangeMenu = $('arrange-menu');
function syncMenu() {
  for (const el of arrangeMenu.querySelectorAll('[data-dir]'))
    el.classList.toggle('active', el.dataset.dir === layoutOpts.dir);
  for (const el of arrangeMenu.querySelectorAll('[data-spacing]'))
    el.classList.toggle('active', el.dataset.spacing === layoutOpts.spacing);
  for (const el of arrangeMenu.querySelectorAll('[data-edges]'))
    el.classList.toggle('active', el.dataset.edges === diagram.edgeStyle);
}
diagram.setEdgeStyle(localStorage.getItem('dbdiga-edges') || 'angled');
syncMenu();

$('btn-arrange').addEventListener('click', (e) => {
  e.stopPropagation();
  if (arrangeMenu.hidden) { arrangeMenu.hidden = false; }
  else { arrangeMenu.hidden = true; rebuild({ arrange: true }); }
});
arrangeMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const item = e.target.closest('.menu-item');
  if (!item || item.id === 'btn-infer') return;
  if (item.dataset.edges) {                       // line style: a view setting, no re-layout
    diagram.setEdgeStyle(item.dataset.edges);
    localStorage.setItem('dbdiga-edges', diagram.edgeStyle);
    syncMenu();
    return;
  }
  if (item.dataset.dir) {
    layoutOpts.dir = item.dataset.dir;
    localStorage.setItem('dbdiga-dir', layoutOpts.dir);
  }
  if (item.dataset.spacing) {
    layoutOpts.spacing = item.dataset.spacing;
    localStorage.setItem('dbdiga-spacing', layoutOpts.spacing);
  }
  syncMenu();
  rebuild({ arrange: true });
});
document.addEventListener('click', () => { arrangeMenu.hidden = true; });

$('btn-fit').addEventListener('click', () => diagram.fit(60, { animate: true }));

$('btn-infer').addEventListener('click', () => {
  const n = diagram.inferLinks();
  arrangeMenu.hidden = true;
  toast(n ? `Added ${n} link${n !== 1 ? 's' : ''} from matching column names` : 'No new links found — column names don’t point at other tables',
    n ? { action: { label: 'Undo', run: undo } } : {});
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
    const res = toggleConstraint(sql, parseSchema(sql, 'sql'), tableKey, colName, kind, on);
    if (!res) return false;
    commitSql(res.sql, { pinKey: tableKey });
    return true;
  },
  deleteColumn(tableKey, colName) {
    const sql = sqlEl.value;
    const res = deleteColumn(sql, parseSchema(sql, 'sql'), tableKey, colName);
    if (res) commitSql(res.sql, { pinKey: tableKey });
  },
  addColumn(tableKey) { return addColumnTo(tableKey); },
  addTable() {
    const sql = sqlEl.value;
    const existing = new Set(parseSchema(sql, 'sql').tables.map(t => t.key));
    let name = 'new_table', i = 2;
    while (existing.has(name.toLowerCase())) name = `new_table_${i++}`;
    const idType = DIALECTS[dialect].types.find(t => /int|serial|number/i.test(t)) || 'bigint';
    const res = addTable(sql, name, idType);
    if (!res) return null;
    commitSql(res.sql, { pinKey: res.tableKey });
    return { key: res.tableKey, name };
  },
  deleteTable(tableKey) {
    const sql = sqlEl.value;
    const res = deleteTable(sql, parseSchema(sql, 'sql'), tableKey);
    if (res) commitSql(res.sql);
  },
  focusTable(tableKey) { diagram.centerOn(tableKey); diagram.pinByKey(tableKey); },
};
// The visual editor is only needed in Visual mode, so its code loads on first use.
let visualEditorLoading = null;
function ensureVisualEditor() {
  if (visualEditor) return Promise.resolve(visualEditor);
  if (!visualEditorLoading) {
    visualEditorLoading = import('./visual-editor.js').then(({ createVisualEditor }) => {
      visualEditor = createVisualEditor({
        mount: $('visual-editor'),
        getModel: () => diagram.model,
        getDialect: () => DIALECTS[dialect],
        getEditable: () => diagram.editable,
        getFormatLabel: () => FORMATS[lastModel && lastModel.format] || 'another format',
        actions: veActions,
      });
      return visualEditor;
    });
  }
  return visualEditorLoading;
}

const modeToggle = $('mode-toggle');
const visualPane = $('visual-editor');
let editorMode = localStorage.getItem('dbdiga-mode') || 'code';
function setMode(mode) {
  editorMode = mode === 'visual' ? 'visual' : 'code';
  localStorage.setItem('dbdiga-mode', editorMode);
  layoutEl.classList.toggle('visual-mode', editorMode === 'visual');
  visualPane.hidden = editorMode !== 'visual';
  for (const b of modeToggle.querySelectorAll('.seg-btn'))
    b.classList.toggle('active', b.dataset.mode === editorMode);
  if (editorMode === 'visual') ensureVisualEditor().then((ve) => { if (editorMode === 'visual') ve.render(); });
}
modeToggle.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (b) setMode(b.dataset.mode);
});
setMode(editorMode);

$('zoom-in').addEventListener('click', () => diagram.zoomBy(1.25));
$('zoom-out').addEventListener('click', () => diagram.zoomBy(0.8));
$('zoom-reset').addEventListener('click', () => diagram.resetZoom());

// ---- themes ----
const themeMenu = $('theme-menu');
function setTheme(name) {
  if (!THEMES[name]) return;
  diagram.setTheme(name);
  localStorage.setItem('dbdiga-theme', name);
  renderThemeMenu();
}
function renderThemeMenu() {
  themeMenu.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'menu-label'; label.textContent = 'Theme';
  themeMenu.appendChild(label);
  for (const t of THEME_LIST) {
    const b = document.createElement('button');
    b.className = 'menu-item theme-item' + (t.id === diagram.themeName ? ' active' : '');
    b.dataset.umamiEvent = 'theme-' + t.id;
    const dot = document.createElement('span');
    dot.className = 'theme-dot';
    dot.style.background = THEMES[t.id].tableBg;
    dot.style.setProperty('--dot-accent', THEMES[t.id].edgeHi);
    const name = document.createElement('span'); name.textContent = t.label;
    b.append(dot, name);
    b.addEventListener('click', () => { setTheme(t.id); themeMenu.hidden = true; });
    themeMenu.appendChild(b);
  }
}
renderThemeMenu();
$('btn-theme').addEventListener('click', (e) => { e.stopPropagation(); themeMenu.hidden = !themeMenu.hidden; });
themeMenu.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { themeMenu.hidden = true; });

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
function showCodeModal(title, text, filename, umamiLabel) {
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
  _modal.querySelector('.modal-hint').textContent = filename ? filename : '';
  ta.value = text;
  copyBtn.textContent = 'Copy';
  if (umamiLabel) copyBtn.setAttribute('data-umami-event', 'copy-' + umamiLabel);
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(ta.value); copyBtn.textContent = 'Copied ✓'; }
    catch { ta.select(); document.execCommand && document.execCommand('copy'); copyBtn.textContent = 'Copied ✓'; }
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  };
  dlBtn.hidden = !filename;
  dlBtn.onclick = () => downloadText(filename, ta.value, 'text/plain');
  _modal.hidden = false;
  ta.focus(); ta.setSelectionRange(0, 0);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  download(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Image + code exporters load on demand — most visits never export.
async function exportImage(kind) {
  if (!diagram.model.tables.length && !diagram.annotations.length) { toast('Nothing to export yet'); return; }
  if (kind === 'svg') {
    const { exportSVG } = await import('./svg-export.js');
    const svg = exportSVG(diagram.model, diagram.themeName, diagram.annotations, diagram.hidden, { edgeStyle: diagram.edgeStyle });
    if (svg) downloadText('schema.svg', svg, 'image/svg+xml');
    return;
  }
  if (kind === 'png-copy') {
    // hand the clipboard a pending blob so the write stays inside the click gesture (Safari)
    const pending = diagram.exportPNGBlob(2).then((blob) => {
      if (!blob) throw new Error('empty diagram');
      return blob;
    });
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pending })]);
      toast('Diagram copied — paste it into a doc, chat or slide');
    } catch (err) {
      // no image clipboard here (older browser / permission): download instead
      const blob = await pending.catch(() => null);
      if (blob) { downloadBlob('schema.png', blob); toast('Copy isn’t available in this browser — downloaded the PNG instead'); }
    }
    return;
  }
  const blob = await diagram.exportPNGBlob(2, { transparent: kind === 'png-transparent' });
  if (blob) downloadBlob('schema.png', blob);
  else toast('Could not render the PNG', { tone: 'err' });
}

async function exportCode(kind) {
  if (kind.startsWith('sql-')) {
    // the schema rewritten as CREATE TABLE for another database, types translated
    const { toSQL, SQL_DIALECTS } = await import('./formats/sql-out.js');
    const d = kind.slice(4);
    showCodeModal(`Export — SQL for ${SQL_DIALECTS[d]}`, toSQL(diagram.model, d), `schema.${d}.sql`, 'sql-' + d);
    return;
  }
  const { serialize, SERIALIZERS } = await import('./formats/serialize.js');
  const fmt = SERIALIZERS[kind];
  if (!fmt) return;
  showCodeModal(`Export — ${fmt.label}`, serialize(diagram.model, kind), `schema.${fmt.ext}`, fmt.label.toLowerCase());
}

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
  if (kind === 'svg' || kind.startsWith('png')) exportImage(kind);
  else exportCode(kind);
});
document.addEventListener('click', () => { exportMenu.hidden = true; });

// ---- File menu (open / save / embed) ----
const fileBtn = $('btn-file');
const fileMenu = $('file-menu');
fileBtn.addEventListener('click', (e) => { e.stopPropagation(); fileMenu.hidden = !fileMenu.hidden; });
document.addEventListener('click', () => { fileMenu.hidden = true; });

// ---- Save / Open project (SQL + layout + camera + dialect) ----
function saveProject() {
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
}
$('btn-save').addEventListener('click', saveProject);

// ---- Share link (project encoded in the URL hash; nothing stored server-side) ----
function flashButton(btn, text) {
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = orig; }, 1500);
}
async function shareLink() {
  const btn = $('btn-share');
  const project = { app: 'dbdiga', version: 1, sql: sqlEl.value, dialect, ...collectLayout() };
  let payload;
  try { payload = await encodeShare(project); }
  catch (err) { console.error(err); flashButton(btn, 'Failed'); return; }
  const hash = '#s=' + payload;
  history.replaceState(null, '', hash);                 // put it in the address bar too
  const url = location.origin + location.pathname + hash;
  try { await navigator.clipboard.writeText(url); flashButton(btn, 'Link copied ✓'); }
  catch { flashButton(btn, 'Link in URL ↑'); }          // clipboard blocked → it's in the URL
}
$('btn-share').addEventListener('click', shareLink);

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

// ---- Open: a saved project (.json) or any schema file (.sql, .prisma, .dbml, …) ----
function loadProject(data) {
  sqlEl.value = data.sql;
  localStorage.setItem('dbdiga-sql', data.sql);
  if (data.dialect && DIALECTS[data.dialect]) { dialect = data.dialect; localStorage.setItem('dbdiga-dialect', dialect); syncDialect(); }
  if (data.format && FORMATS[data.format] && data.format !== formatChoice) {
    formatChoice = data.format;
    localStorage.setItem('dbdiga-format', formatChoice);
    syncFormat();
  }
  rebuild({ restore: restoreOf(data) });
  saveLayout();
}

// Replace the current schema with raw schema text; the format is auto-detected.
function loadSchemaText(text) {
  if (formatChoice !== 'auto') {
    formatChoice = 'auto';
    localStorage.setItem('dbdiga-format', formatChoice);
    syncFormat();
  }
  sqlEl.value = text;
  historyHold++;                 // a new schema starts clean; recorded as one step by rebuild
  try {
    diagram.setAnnotations([]);
    diagram.setManualLinks([]);
    diagram.setTableColors({});
    diagram.setHidden([]);
  } finally { historyHold--; }
  rebuild({ arrange: true });
  return lastModel ? lastModel.tables.length : 0;
}

// A dropped / opened file: a project if it parses as one, otherwise schema text.
async function loadFileText(text, name) {
  let project = null;
  if (/^\s*\{/.test(text)) {
    try { const data = JSON.parse(text); if (data && typeof data.sql === 'string') project = data; } catch { /* not JSON: treat as schema text */ }
  }
  if (project) {
    loadProject(project);
    toast(`Opened ${name}`, { action: { label: 'Undo', run: undo } });
    return;
  }
  try { await loadFormat(resolveFormat(text, 'auto')); }
  catch { toast('Could not load the parser for this file — check your connection', { tone: 'err' }); return; }
  if (!parseSchema(text, 'auto').tables.length) {
    toast(`No tables found in ${name}`, { tone: 'err' });
    return;
  }
  const n = loadSchemaText(text);
  toast(`Loaded ${name} · ${n} table${n !== 1 ? 's' : ''}`, { action: { label: 'Undo', run: undo } });
}
function readFile(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { toast(`${file.name} is too large to open (over 20 MB)`, { tone: 'err' }); return; }
  const reader = new FileReader();
  reader.onload = () => loadFileText(String(reader.result), file.name);
  reader.onerror = () => toast(`Could not read ${file.name}`, { tone: 'err' });
  reader.readAsText(file);
}

const fileInput = $('file-open');
$('btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  readFile(fileInput.files && fileInput.files[0]);
  fileInput.value = '';          // allow re-opening the same file
});

// ---- drop a file anywhere on the page ----
const dropEl = document.createElement('div');
dropEl.className = 'drop-overlay';
dropEl.hidden = true;
dropEl.innerHTML = '<div class="drop-card"><strong>Drop to open</strong><span>.sql, Prisma, DBML, Mermaid, PlantUML, or a saved project</span></div>';
document.body.appendChild(dropEl);
let dragDepth = 0;
const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
if (!isEmbed) {
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dropEl.hidden = false; });
  window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropEl.hidden = true; });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0; dropEl.hidden = true;
    readFile(e.dataTransfer.files[0]);
  });

  // ---- paste a schema anywhere outside a text field ----
  document.addEventListener('paste', async (e) => {
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return;
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!text.trim()) return;
    e.preventDefault();
    try { await loadFormat(resolveFormat(text, 'auto')); } catch { return; }
    if (!parseSchema(text, 'auto').tables.length) { toast('The clipboard doesn’t look like a schema', { tone: 'err' }); return; }
    const n = loadSchemaText(text);
    toast(`Pasted schema · ${n} table${n !== 1 ? 's' : ''}`, { action: { label: 'Undo', run: undo } });
  });
}

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

// ---- My diagrams: several named diagrams + version history, all in this browser ----
const store = createStore();
const docBtn = $('doc-btn'), docName = $('doc-name'), docMenu = $('doc-menu'), docRename = $('doc-rename');
const currentContent = () => ({ sql: sqlEl.value, format: formatChoice, dialect, layout: collectLayout() });

let versionMark = { hash: '', at: Date.now(), any: false };   // last snapshot of the open diagram
function markVersions() {
  const v = store.versions()[0];
  versionMark = { hash: v ? hashText(v.sql || '') : '', at: v ? v.t : Date.now(), any: !!v };
}
function versionOf(extra) {
  // `kind` is the format the text was actually parsed as (the format choice may be 'auto')
  return { ...currentContent(), tables: lastModel ? lastModel.tables.length : 0, kind: lastModel ? lastModel.format : 'sql', ...extra };
}
// called after every autosave: keep the diagram list fresh and take an
// automatic snapshot now and then, so there is always something to go back to
function afterSave() {
  if (isEmbed || layoutPending) return;
  const sql = sqlEl.value, hash = hashText(sql);
  store.touch({ tables: lastModel ? lastModel.tables.length : 0, hash });
  if (!sql.trim() || hash === versionMark.hash) return;
  if (!versionMark.any || Date.now() - versionMark.at > 5 * 60 * 1000) {
    store.addVersion(versionOf({ auto: true }));
    markVersions();
  }
}

function syncDocUI() {
  docName.textContent = store.current.name;
  document.title = store.current.name === 'Untitled diagram' ? BASE_TITLE : `${store.current.name} · SQL to ER Diagram`;
}
const BASE_TITLE = document.title;

// load a diagram's content into the editor + canvas (null/empty = a blank diagram)
function applyContent(c) {
  diagram._cancelEdit();
  clearTimeout(timer); timer = null;
  if (c && c.dialect && DIALECTS[c.dialect]) { dialect = c.dialect; localStorage.setItem('dbdiga-dialect', dialect); syncDialect(); }
  formatChoice = c && c.format && FORMATS[c.format] ? c.format : 'auto';
  localStorage.setItem('dbdiga-format', formatChoice);
  syncFormat();
  sqlEl.value = (c && c.sql) || '';
  history.clear();                       // undo history belongs to one diagram
  rebuild({ restore: restoreOf((c && c.layout) || {}) });
  saveLayout();
  syncUndoButtons();
}
function switchDoc(id) {
  if (id === store.currentId) return;
  flushTyping();
  const content = store.open(id, currentContent());
  if (content === undefined) return;
  applyContent(content);
  markVersions();
  syncDocUI();
}
function newDoc(name = 'Untitled diagram', content = { sql: '' }) {
  const id = store.create(name, content);
  if (!id) { toast('This browser’s storage is full — delete a diagram or some versions first', { tone: 'err' }); return false; }
  switchDoc(id);
  return true;
}
function deleteDoc(id) {
  const d = store.get(id);
  if (!d || !window.confirm(`Delete “${d.name}” and its version history? This can’t be undone.`)) return;
  if (id === store.currentId) {
    const other = store.list().find((x) => x.id !== id);
    if (other) switchDoc(other.id);
    else if (!newDoc()) return;
  }
  store.remove(id);
  toast(`Deleted “${d.name}”`);
}
function startRename() {
  docMenu.hidden = true;
  docRename.value = store.current.name;
  docRename.hidden = false; docBtn.hidden = true;
  docRename.focus(); docRename.select();
}
function endRename(commit) {
  if (docRename.hidden) return;
  if (commit && docRename.value.trim()) { store.rename(store.currentId, docRename.value); syncDocUI(); }
  docRename.hidden = true; docBtn.hidden = false;
}
docRename.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); endRename(true); docBtn.focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); endRename(false); docBtn.focus(); }
  e.stopPropagation();
});
docRename.addEventListener('blur', () => endRename(true));

function renderDocMenu() {
  docMenu.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'menu-label';
  label.textContent = 'My diagrams · saved in this browser';
  docMenu.appendChild(label);
  const listEl = document.createElement('div');
  listEl.className = 'doc-list';
  for (const d of store.list()) {
    const row = document.createElement('div');
    row.className = 'doc-row' + (d.id === store.currentId ? ' active' : '');
    const open = document.createElement('button');
    open.className = 'doc-open';
    const nm = document.createElement('span'); nm.className = 'doc-row-name'; nm.textContent = d.name;
    const sub = document.createElement('span'); sub.className = 'doc-row-sub';
    sub.textContent = `${d.tables || 0} table${d.tables === 1 ? '' : 's'}`;
    open.append(nm, sub);
    open.addEventListener('click', () => { docMenu.hidden = true; switchDoc(d.id); });
    const del = document.createElement('button');
    del.className = 'icon-btn doc-del'; del.textContent = '✕';
    del.title = `Delete “${d.name}”`; del.setAttribute('aria-label', del.title);
    del.addEventListener('click', (e) => { e.stopPropagation(); docMenu.hidden = true; deleteDoc(d.id); });
    row.append(open, del);
    listEl.appendChild(row);
  }
  docMenu.appendChild(listEl);
  const sep = document.createElement('div'); sep.className = 'menu-sep'; docMenu.appendChild(sep);
  const item = (text, run) => {
    const b = document.createElement('button');
    b.className = 'menu-item'; b.textContent = text;
    b.addEventListener('click', () => { docMenu.hidden = true; run(); });
    docMenu.appendChild(b);
  };
  item('New diagram', () => { if (newDoc()) sqlEl.focus(); });
  item('Rename…', startRename);
  item('Duplicate', () => { flushTyping(); newDoc(store.current.name + ' copy', currentContent()); });
}
docBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  docMenu.hidden = !docMenu.hidden;
  if (!docMenu.hidden) renderDocMenu();
});
docBtn.addEventListener('dblclick', startRename);
docMenu.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { docMenu.hidden = true; });
$('btn-new').addEventListener('click', () => { fileMenu.hidden = true; if (newDoc()) sqlEl.focus(); });
syncDocUI();
markVersions();

// ---- dialogs (import / versions / compare): loaded on first use ----
function restoreVersion(v) {
  if (v.dialect && DIALECTS[v.dialect]) { dialect = v.dialect; localStorage.setItem('dbdiga-dialect', dialect); syncDialect(); }
  if (v.format && FORMATS[v.format] && v.format !== formatChoice) { formatChoice = v.format; localStorage.setItem('dbdiga-format', formatChoice); syncFormat(); }
  sqlEl.value = v.sql || '';
  rebuild({ restore: restoreOf(v.layout || {}) });
  toast(`Restored ${v.label ? `“${v.label}”` : 'that version'}`, { action: { label: 'Undo', run: undo } });
}
async function openDialog(kind) {
  flushTyping();
  let dialogs;
  try { dialogs = await import('./dialogs.js'); }
  catch { toast('Could not load that dialog — check your connection', { tone: 'err' }); return; }
  const ctx = {
    dialect, docName: store.current.name, model: lastModel || { tables: [], relations: [], editable: true },
    versions: () => store.versions(),
    saveVersion: (label) => { store.addVersion(versionOf({ auto: false, label })); markVersions(); toast(label ? `Saved version “${label}”` : 'Version saved'); },
    removeVersion: (t) => { store.removeVersion(t); markVersions(); },
    restoreVersion,
    download: (name, text) => downloadText(name, text, 'text/plain'),
    onImport: (sql, srcDialect, n) => {
      // never overwrite what's open: a non-empty diagram gets a new sibling
      if (sqlEl.value.trim() && !newDoc('Imported database')) return;
      if (DIALECTS[srcDialect]) { dialect = srcDialect; localStorage.setItem('dbdiga-dialect', dialect); syncDialect(); }
      loadSchemaText(sql);
      toast(`Imported ${n} table${n !== 1 ? 's' : ''}`);
    },
  };
  if (kind === 'snapshot') {
    if (!diagram.model.tables.length && !diagram.annotations.length) { toast('Nothing to snapshot yet'); return; }
    dialogs.openSnapshotDialog({
      diagram, docName: store.current.name === 'Untitled diagram' ? '' : store.current.name,
      toast, downloadBlob, copyLink: shareLink,
    });
    return;
  }
  if (kind === 'import') dialogs.openImportDialog(ctx);
  else if (kind === 'versions') dialogs.openVersionsDialog(ctx);
  else dialogs.openCompareDialog(ctx);
}
$('btn-import-db').addEventListener('click', () => { fileMenu.hidden = true; openDialog('import'); });
$('btn-snapshot').addEventListener('click', (e) => { e.stopPropagation(); exportMenu.hidden = true; openDialog('snapshot'); });
$('btn-versions').addEventListener('click', () => { fileMenu.hidden = true; openDialog('versions'); });
$('btn-compare').addEventListener('click', () => { fileMenu.hidden = true; openDialog('compare'); });
$('btn-example').addEventListener('click', () => { fileMenu.hidden = true; });

// ---- column / table tooltip: everything the compact card can't show ----
const tipEl = document.createElement('div');
tipEl.className = 'col-tip';
tipEl.setAttribute('role', 'tooltip');
tipEl.hidden = true;
canvas.parentElement.appendChild(tipEl);
let tipTimer = null;
function tipContent(info) {
  const { table, column: c } = info;
  const frag = document.createDocumentFragment();
  const add = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; frag.appendChild(d); return d; };
  if (!c) {
    if (!table.comment) return null;                    // a header tip only earns its place with a comment
    add('tip-name', table.name);
    add('tip-comment', table.comment);
    return frag;
  }
  add('tip-name', `${table.name}.${c.name}`);
  if (c.typeRaw || c.type) add('tip-type', c.typeRaw || c.type);
  const facts = [];
  if (c.pk) facts.push('Primary key');
  const rel = (lastModel ? lastModel.relations : []).find((r) => r.fromTable.toLowerCase() === table.key && r.fromCols.some((x) => x.toLowerCase() === c.name.toLowerCase()));
  if (rel) facts.push(`References ${rel.toTable}${rel.toCols && rel.toCols.length ? '.' + rel.toCols.join(', ') : ''}`);
  if (!c.pk && c.nn !== undefined) facts.push(c.nn ? 'NOT NULL' : 'Nullable');
  if (c.unique && !c.pk) facts.push('Unique');
  if (c.indexes && c.indexes.length) facts.push(`Indexed (${[...new Set(c.indexes)].join(', ')})`);
  if (c.default) facts.push(`Default ${c.default}`);
  if (facts.length) add('tip-facts', facts.join(' · '));
  const enumKey = String(c.typeRaw || c.type || '').toLowerCase().split('.').pop();
  const values = lastModel && lastModel.enums && lastModel.enums[enumKey];
  if (values && values.length) add('tip-enum', 'One of: ' + values.slice(0, 12).join(', ') + (values.length > 12 ? ` … +${values.length - 12}` : ''));
  if (c.comment) add('tip-comment', c.comment);
  return frag;
}
diagram.onHoverInfo = (info) => {
  clearTimeout(tipTimer);
  tipEl.hidden = true;
  if (!info) return;
  tipTimer = setTimeout(() => {
    const content = tipContent(info);
    if (!content) return;
    tipEl.innerHTML = '';
    tipEl.appendChild(content);
    tipEl.hidden = false;
    const pane = canvas.parentElement.getBoundingClientRect();
    const w = tipEl.offsetWidth, hh = tipEl.offsetHeight;
    tipEl.style.left = Math.max(8, Math.min(info.sx + 14, pane.width - w - 8)) + 'px';
    tipEl.style.top = (info.sy + 18 + hh > pane.height - 8 ? Math.max(8, info.sy - hh - 12) : info.sy + 18) + 'px';
  }, 450);
};

// ---- first-run tips (shown once) ----
if (!isEmbed && !localStorage.getItem('dbdiga-coach')) {
  const coach = document.createElement('div');
  coach.className = 'coach';
  coach.setAttribute('role', 'note');
  coach.innerHTML =
    '<div class="coach-title">Three things worth knowing</div>' +
    '<ol class="coach-steps">' +
    '<li><strong>Bring a schema.</strong> Paste SQL on the left, drop a file anywhere, or import from a live database (File menu).</li>' +
    `<li><strong>Find anything.</strong> <kbd>${isMac ? '⌘K' : 'Ctrl K'}</kbd> jumps to any table or column. Click a table to see only its relationships.</li>` +
    '<li><strong>Share it.</strong> Share copies a link with the whole diagram inside it — nothing is uploaded.</li>' +
    '</ol>' +
    '<button class="btn primary coach-ok">Got it</button>';
  canvas.parentElement.appendChild(coach);
  coach.querySelector('.coach-ok').addEventListener('click', () => {
    localStorage.setItem('dbdiga-coach', '1');
    coach.remove();
  });
}

// ---- minimap (bottom-left overview; M toggles it) ----
const minimap = createMinimap(diagram, canvas.parentElement);
minimap.setEnabled(localStorage.getItem('dbdiga-minimap') !== '0' && !isEmbed);
diagram.onFrame = () => minimap.draw();
function toggleMinimap() {
  minimap.setEnabled(!minimap.enabled);
  localStorage.setItem('dbdiga-minimap', minimap.enabled ? '1' : '0');
}

// ---- undo / redo buttons ----
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-undo').title = `Undo (${MOD}+Z)`;
$('btn-redo').title = `Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`;
syncUndoButtons();

// ---- command palette (Cmd/Ctrl+K) ----
const K = (k) => [MOD, k];
function paletteCommands() {
  const cmds = [
    { id: 'fit', label: 'Fit diagram to screen', keys: ['F'], run: () => diagram.fit(60, { animate: true }) },
    { id: 'arrange', label: 'Auto-arrange tables', keys: K('↵'), run: () => rebuild({ arrange: true }) },
    { id: 'undo', label: 'Undo', keys: K('Z'), run: undo },
    { id: 'redo', label: 'Redo', keys: isMac ? ['⇧', '⌘', 'Z'] : ['Ctrl', 'Y'], run: redo },
    { id: 'share', label: 'Copy share link', run: shareLink },
    { id: 'snapshot', label: 'Snapshot — share-ready picture…', run: () => openDialog('snapshot') },
    { id: 'copy-png', label: 'Copy diagram as PNG', run: () => exportImage('png-copy') },
    { id: 'png', label: 'Export PNG', run: () => exportImage('png') },
    { id: 'png-t', label: 'Export PNG (transparent background)', run: () => exportImage('png-transparent') },
    { id: 'svg', label: 'Export SVG', run: () => exportImage('svg') },
    { id: 'mermaid', label: 'Export as Mermaid', run: () => exportCode('mermaid') },
    { id: 'dbml', label: 'Export as DBML', run: () => exportCode('dbml') },
    { id: 'plantuml', label: 'Export as PlantUML', run: () => exportCode('plantuml') },
    { id: 'open', label: 'Open file…', hint: '.sql or project', run: () => fileInput.click() },
    { id: 'save', label: 'Save project', run: saveProject },
    { id: 'infer', label: 'Infer links from column names', run: () => $('btn-infer').click() },
    { id: 'new', label: 'New diagram', run: () => { if (newDoc()) sqlEl.focus(); } },
    { id: 'rename', label: 'Rename this diagram', run: startRename },
    { id: 'import', label: 'Import from a database…', hint: 'Postgres · MySQL · SQLite · SQL Server', run: () => openDialog('import') },
    { id: 'versions', label: 'Version history…', run: () => openDialog('versions') },
    { id: 'compare', label: 'Compare & migrate…', hint: 'schema diff', run: () => openDialog('compare') },
    { id: 'save-version', label: 'Save a version now', run: () => { store.addVersion(versionOf({ auto: false })); markVersions(); toast('Version saved'); } },
    ...['postgres', 'mysql', 'sqlite', 'sqlserver', 'snowflake'].map((d) => ({ id: 'sql-' + d, label: `Export SQL for ${DIALECTS[d].label}`, run: () => exportCode('sql-' + d) })),
    { id: 'note', label: 'Add sticky note', run: () => diagram.addAnnotation('note') },
    { id: 'group', label: 'Add group box', run: () => diagram.addAnnotation('group') },
    { id: 'tables', label: 'Show tables panel', run: () => toggleTablesPanel(true) },
    { id: 'sql', label: layoutEl.classList.contains('sql-hidden') ? 'Show SQL panel' : 'Hide SQL panel', run: () => setSqlHidden(!layoutEl.classList.contains('sql-hidden')) },
    { id: 'minimap', label: minimap.enabled ? 'Hide minimap' : 'Show minimap', keys: ['M'], run: toggleMinimap },
    ...THEME_LIST.filter((t) => t.id !== diagram.themeName).map((t) => ({ id: 'theme-' + t.id, label: `Theme: ${t.label}`, run: () => setTheme(t.id) })),
    { id: 'example', label: 'Load example schema', run: loadExample },
  ];
  for (const d of store.list()) if (d.id !== store.currentId) cmds.push({ id: 'doc-' + d.id, label: `Open diagram: ${d.name}`, hint: `${d.tables || 0} tables`, run: () => switchDoc(d.id) });
  if (diagram.hiddenCount() > 0) cmds.push({ id: 'show-hidden', label: `Show ${diagram.hiddenCount()} hidden table${diagram.hiddenCount() !== 1 ? 's' : ''}`, run: () => diagram.showAllHidden() });
  return cmds;
}
const palette = createPalette({
  getTables: () => diagram.model.tables,
  getCommands: paletteCommands,
  onJump: (key) => diagram.centerOn(key, { minScale: 0.8 }),
});
$('btn-palette').addEventListener('click', () => palette.open());
$('btn-palette').title = `Search tables, columns and actions (${MOD}+K)`;
$('palette-kbd').textContent = isMac ? '⌘K' : 'Ctrl K';

// keyboard shortcuts
window.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const typing = ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT');
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'k') {
    if (isEmbed) return;
    e.preventDefault();
    palette.toggle();
  } else if (mod && !e.altKey && (key === 'z' || key === 'y') && (!typing || ae === sqlEl)) {
    // one history for the code editor and the canvas; other inputs keep native undo
    e.preventDefault();
    if (key === 'y' || e.shiftKey) redo(); else undo();
  } else if (mod && e.key === 'Enter') {
    e.preventDefault();
    rebuild({ arrange: true });
  } else if (typing || mod || e.altKey) {
    return;
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && diagram.selectedAnno) {
    e.preventDefault();
    diagram.deleteSelectedAnnotation();
  } else if (key === 'h' && diagram.selected.size > 0) {
    e.preventDefault();
    diagram.hideTable(null);   // hide the current selection
  } else if (key === 'f') {
    e.preventDefault();
    diagram.fit(60, { animate: true });
  } else if (key === 'm' && !isEmbed) {
    e.preventDefault();
    toggleMinimap();
  } else if (e.key === '/') {
    if (isEmbed) return;
    e.preventDefault();
    palette.open();
  } else if (e.key === '+' || e.key === '=') {
    diagram.zoomBy(1.25);
  } else if (e.key === '-') {
    diagram.zoomBy(0.8);
  } else if (e.key === 'Escape') {
    hideCtx();
    diagram.clearSelection();
  }
});

// keep the canvas sized to its pane however the pane changes (splitter, panel
// toggle, window, device rotation)
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => diagram.resize()).observe(canvas.parentElement);
}

// ---- offline support: cache the app shell so it opens without a connection ----
if (import.meta.env.PROD && !isEmbed && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is optional */ });
    // Once the page is idle, pull in the on-demand chunks too so every feature
    // (all formats, exports, visual mode) is in the offline cache.
    const warm = () => {
      loadAllFormats().catch(() => {});
      import('./svg-export.js').catch(() => {});
      import('./formats/serialize.js').catch(() => {});
      ensureVisualEditor().catch(() => {});
    };
    if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 8000 });
    else setTimeout(warm, 4000);
  });
}

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

// a share link pasted into an already-open tab only changes the fragment: load it
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#s=')) location.reload(); });

// ---- boot: shared link > last session > example ----
(async () => {
  // Give the diagram typefaces a moment to arrive so the first paint is
  // measured with them; if they're slow, paint now and re-measure when they land.
  if (document.fonts && document.fonts.load) {
    const fonts = Promise.all([
      document.fonts.load('13px "JetBrains Mono Variable"'),
      document.fonts.load('600 14px "Inter Variable"'),
    ]).catch(() => {});
    let late = false;
    await Promise.race([fonts, new Promise((r) => setTimeout(() => { late = true; r(); }, 300))]);
    if (late) fonts.then(() => diagram.refreshMetrics());
  }
  // 1) shared link (#s=…) takes precedence
  if (location.hash.startsWith('#s=')) {
    try {
      const data = await decodeShare(location.hash.slice(3));
      // A shared link must not overwrite the diagram you were working on: it
      // opens as its own entry in My diagrams (reusing it on a repeat visit).
      const working = localStorage.getItem('dbdiga-sql') || '';
      const sharedHash = hashText(data.sql || '');
      if (!isEmbed && working.trim() && hashText(working) !== sharedHash) {
        const parked = { sql: working, format: formatChoice, dialect, layout: loadSavedLayout() };
        const known = store.findByHash(sharedHash);
        const id = known ? known.id : store.create('Shared diagram', null, { hash: sharedHash });
        if (id) { store.open(id, parked); history.clear(); markVersions(); syncDocUI(); }
      }
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
        rebuild({ restore: restoreOf(data) });
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
