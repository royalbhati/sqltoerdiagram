// Diagram controller: owns the camera, input handling (pan / zoom / drag),
// the render loop, edge routing and export. Renders only when dirty and only
// what is on screen.
import { THEMES, rasterizeTable, columnY, measureTable, getVisibleColumns, ROW_H, HEADER_H, EDGE_COLORS } from './renderer.js';
import { NOTE_COLORS, GROUP_COLORS, NOTE_ORDER, GROUP_ORDER, makeAnnotation, resolveGroupColor, computeGroupBounds } from './annotations.js';
import { ROUTING_STYLES, getTableAnchor, drawRoutePath, distanceToRoute, pointToSegmentDistance, buildOrthogonalPoints, getOrthogonalSegments, moveOrthogonalSegment, moveOrthogonalCorner, cleanOrthogonalPoints, filterRedundantWaypoints, projectPointToPerimeter } from './routing.js';
import { relationCardinality } from './cardinality.js';
import { inferLinks as inferLinksCore } from './infer-links.js';

export class Diagram {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cam = { x: 0, y: 0, scale: 1 };
    this.model = { tables: [], relations: [] };
    this.diagramLevel = 'physical'; // 'physical' | 'logical' | 'conceptual'
    this.onDiagramLevelChange = null; // fired when diagramLevel changes
    this.themeName = 'dark';
    this.theme = THEMES.dark;
    this.bitmaps = new Map();      // table.key -> offscreen canvas
    this.dirty = true;
    this.frameQueued = false;
    this.drag = null;              // active single-table drag
    this.dragGroup = null;         // active multi-table drag
    this.marquee = null;           // active rubber-band selection (world coords)
    this.selected = new Set();     // multi-selected tables (for group drag)
    this.selectedAnnos = new Set();// multi-selected annotations/groups
    this.toolMode = 'pan';         // 'pan' | 'select'
    this._potentialSingleSelect = null; // clicked table in multi-selection to collapse on mouseup if not dragged
    this._potentialSingleAnno = null;   // clicked annotation in multi-selection
    this.onToolModeChange = null;  // fired when toolMode changes
    this.hidden = new Set();       // keys of hidden tables (node + edges suppressed)
    this.onHiddenChange = null;    // fired when the hidden set changes
    this.onSelectionChange = null; // fired when the selected set changes
    this.manualLinks = [];         // user-drawn / inferred links {from:{table,col},to:{table,col}}
    this.edgeColorMode = 'multi';  // 'multi' | 'single'
    this.edgeColors = new Map();   // relKey -> hex/color
    this.edgeRouting = 'curved';   // 'curved' | 'straight' | 'ortho-sharp' | 'ortho-rounded'
    this.orientation = 'LR';       // 'LR' | 'TB' — which way the canvas is turned (rotate-diagram.js)
    this.edgeRoutings = new Map(); // relKey -> routing style override
    this.edgeWaypoints = new Map();// relKey -> [{ x, y }, ...]
    this.edgeAnchors = new Map();  // relKey -> { fromAnchor: { side, offset }, toAnchor: { side, offset } }
    this.vertexDrag = null;        // active waypoint drag
    this.segmentDrag = null;       // active orthogonal segment drag (dbdiagram.io style)
    this.anchorDrag = null;        // active anchor drag along table perimeter
    this.selectedEdgeKey = null;   // selected connection for waypoint editing
    this.hoverEdge = null;         // edge under cursor {key, ...}
    this.hoverVertex = null;       // vertex/anchor handle under cursor {key, index, isWaypoint, isAnchor}
    this.hoverConn = null;         // {t, colIndex} — column row showing connector dots
    this.linking = null;           // in-progress link drag {fromKey, fromCol, side, wx, wy, cx, cy}
    this.pan = null;               // active background pan
    this.hover = null;             // table under cursor (transient highlight)
    this.pinned = null;            // clicked table (sticky focus)
    this.pinnedKeys = null;        // Set of focused table + neighbour keys
    this.onZoom = null;
    this.onLayoutChange = null;    // fired after a drag / pan / zoom so positions persist
    this.onEdit = null;            // callback({kind, tableKey, colName?, value})
    this.onAddColumn = null;       // callback(tableKey)
    this.editing = null;           // active inline editor
    this.editable = true;          // false for parse-only formats (Prisma/ORM) — no edit-back
    this.typeSuggestions = [];     // dialect type list for the type editor
    this.annotations = [];         // group boxes + sticky notes
    this.annoDrag = null;          // annotation move
    this.annoResize = null;        // annotation resize
    this.onHistorySnapshot = null; // callback(snapshot) for Undo/Redo
    this._preDragSnapshot = null;  // snapshot taken before drag starts

    this._bindInput();
    this._loop = this._loop.bind(this);
  }

  setModel(model, { keepCamera = false } = {}) {
    // preserve positions of tables that still exist (so live edits don't jump)
    const prev = new Map((this.model.tables || []).map(t => [t.key, t]));
    for (const t of model.tables) {
      // always size every table — layout() may be skipped on live edits, but
      // the renderer & fit need w/h regardless.
      const dims = measureTable(t, this.diagramLevel);
      t.w = dims.w; t.h = dims.h; t.rowH = dims.rowH; t.headerH = dims.headerH;
      const old = prev.get(t.key);
      if (old && Number.isFinite(old.x)) { t.x = old.x; t.y = old.y; }
    }
    this.model = model;
    this.fitAllGroups();
    this.bitmaps.clear();
    this._tmapDirty = true;
    this.pinned = null;
    this.pinnedKeys = null;
    this.selected = new Set();
    this.dragGroup = null;
    this.linking = null;
    this.hoverConn = null;
    this.markDirty();
    if (!keepCamera) {/* caller may fit */ }
  }

  setDiagramLevel(level) {
    if (!['physical', 'logical', 'conceptual'].includes(level)) return;
    if (this.diagramLevel === level) return;
    this.diagramLevel = level;
    for (const t of (this.model.tables || [])) {
      const oldH = t.h;
      const dims = measureTable(t, this.diagramLevel);
      t.w = dims.w;
      t.h = dims.h;
      t.rowH = dims.rowH;
      t.headerH = dims.headerH;
      if (Number.isFinite(t.y) && Number.isFinite(oldH)) {
        t.y = Math.round(t.y + (oldH - t.h) / 2);
      }
    }
    this.fitAllGroups();
    this.bitmaps.clear();
    this._tmapDirty = true;
    this.markDirty();
    this.onDiagramLevelChange?.(this.diagramLevel);
    this.onLayoutChange?.();
  }

  getSnapshot() {
    const tables = {};
    for (const t of this.model.tables) {
      if (Number.isFinite(t.x)) tables[t.key] = { x: Math.round(t.x), y: Math.round(t.y) };
    }
    return {
      tables,
      diagramLevel: this.diagramLevel,
      annotations: this.annotations.map(a => ({ ...a, tables: a.tables ? [...a.tables] : [] })),
      edgeColorMode: this.edgeColorMode,
      edgeColors: Array.from(this.edgeColors.entries()),
      edgeRouting: this.edgeRouting,
      orientation: this.orientation,
      edgeRoutings: Array.from(this.edgeRoutings.entries()),
      edgeWaypoints: Array.from(this.edgeWaypoints.entries()).map(([k, pts]) => [k, pts.map(p => ({ x: p.x, y: p.y }))]),
      edgeAnchors: Array.from(this.edgeAnchors.entries()).map(([k, a]) => [k, { ...a }]),
      manualLinks: this.manualLinks.map(l => ({ from: { ...l.from }, to: { ...l.to } })),
      hidden: Array.from(this.hidden),
    };
  }

  applySnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.diagramLevel && snapshot.diagramLevel !== this.diagramLevel) {
      this.setDiagramLevel(snapshot.diagramLevel);
    }
    if (snapshot.tables) {
      for (const t of this.model.tables) {
        const p = snapshot.tables[t.key] || snapshot.tables[t.name];
        if (p && Number.isFinite(p.x)) { t.x = p.x; t.y = p.y; }
      }
    }
    if (snapshot.annotations) {
      this.annotations = snapshot.annotations.map(a => ({ ...a, tables: a.tables ? [...a.tables] : [] }));
    }
    if (snapshot.edgeColorMode) {
      this.edgeColorMode = snapshot.edgeColorMode;
    }
    if (snapshot.edgeColors) {
      this.edgeColors = new Map(snapshot.edgeColors);
    }
    if (snapshot.edgeRouting) {
      this.edgeRouting = snapshot.edgeRouting;
    }
    // Undoing a turn has to un-turn the orientation too, or the Direction menu
    // would claim "Vertical" over a diagram that is horizontal again.
    if (snapshot.orientation) {
      this.orientation = snapshot.orientation;
    }
    if (snapshot.edgeRoutings) {
      this.edgeRoutings = new Map(snapshot.edgeRoutings);
    }
    if (snapshot.edgeWaypoints) {
      this.edgeWaypoints = new Map(snapshot.edgeWaypoints.map(([k, pts]) => [k, pts.map(p => ({ x: p.x, y: p.y }))]));
    } else {
      this.edgeWaypoints.clear();
    }
    if (snapshot.edgeAnchors) {
      this.edgeAnchors = new Map(snapshot.edgeAnchors.map(([k, a]) => [k, { ...a }]));
    } else {
      this.edgeAnchors.clear();
    }
    if (snapshot.manualLinks) {
      this.manualLinks = snapshot.manualLinks.map(l => ({ from: { ...l.from }, to: { ...l.to } }));
    }
    if (snapshot.hidden) {
      this.hidden = new Set(snapshot.hidden);
    }
    this.selectedEdgeKey = null;
    this.hoverEdge = null;
    this.hoverVertex = null;
    this.fitAllGroups();
    this.markDirty();
    this.onHiddenChange?.();
  }

  // The table whose relationships should be emphasised: a click-pinned table
  // wins over a transient hover.
  get focus() { return this.pinned || this.hover; }

  _pin(t) {
    if (this.pinned === t) { this.pinned = null; this.pinnedKeys = null; }
    else this._setPin(t);
    this.markDirty();
  }

  _setPin(t) {
    this.pinned = t;
    const keys = new Set([t.key]);
    for (const r of this.model.relations) {
      if (r.fromTable.toLowerCase() === t.key) keys.add(r.toTable.toLowerCase());
      if (r.toTable.toLowerCase() === t.key) keys.add(r.fromTable.toLowerCase());
    }
    this.pinnedKeys = keys;
  }

  // pin a table by key (used after add-column so the affordance stays visible)
  pinByKey(key) {
    const t = this.model.tables.find(x => x.key === key);
    if (t) { this._setPin(t); this.markDirty(); }
  }

  // open the inline editor on a specific column's name (used right after adding)
  editColumn(tableKey, colName) {
    const t = this.model.tables.find(x => x.key === tableKey);
    if (!t) return;
    const visibleCols = getVisibleColumns(t, this.diagramLevel);
    const idx = visibleCols.findIndex(c => c.name === colName);
    if (idx < 0) return;
    const rowY = t.y + HEADER_H + idx * ROW_H;
    const split = t.x + t.w * 0.58;
    const w = this.diagramLevel === 'conceptual' ? t.w - 42 : split - (t.x + 30);
    this._beginEdit({
      table: t, kind: 'column-name', colName, value: colName,
      rect: { x: t.x + 30, y: rowY, w, h: ROW_H },
      align: 'left', weight: 400,
    });
  }

  setTheme(name) {
    this.themeName = name;
    this.theme = THEMES[name] || THEMES.dark;
    this.bitmaps.clear();
    document.documentElement.dataset.theme = name;
    this.markDirty();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.viewW = rect.width;
    this.viewH = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.markDirty();
  }

  start() {
    this.resize();
    requestAnimationFrame(this._loop);
  }

  markDirty() {
    this.dirty = true;
    if (!this.frameQueued) {
      this.frameQueued = true;
      requestAnimationFrame(this._loop);
    }
  }

  _loop() {
    this.frameQueued = false;
    if (this.dirty) {
      this.dirty = false;
      this._render();
    }
  }

  // ---- coordinate transforms ----
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.cam.x) / this.cam.scale,
      y: (sy - this.cam.y) / this.cam.scale,
    };
  }

  // ---- bitmaps ----
  _bitmap(t) {
    let bm = this.bitmaps.get(t.key);
    if (!bm) {
      bm = rasterizeTable(t, this.theme, this.dpr, this.diagramLevel);
      this.bitmaps.set(t.key, bm);
    }
    return bm;
  }

  // ---- rendering ----
  _render() {
    const { ctx, cam, theme, dpr } = this;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    this._drawGrid();

    ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, cam.x * dpr, cam.y * dpr);

    // viewport in world coords (for culling)
    const vx0 = -cam.x / cam.scale, vy0 = -cam.y / cam.scale;
    const vx1 = (this.viewW - cam.x) / cam.scale, vy1 = (this.viewH - cam.y) / cam.scale;
    const margin = 50;
    const cull = { x0: vx0 - margin, y0: vy0 - margin, x1: vx1 + margin, y1: vy1 + margin };

    // group boxes sit behind everything
    for (const a of this.annotations) if (a.type === 'group') this._drawGroup(a, cull);

    // edges
    this._drawEdges(cull.x0, cull.y0, cull.x1, cull.y1);

    // tables
    const pinned = this.pinned;
    for (const t of this.model.tables) {
      if (!Number.isFinite(t.x) || this.hidden.has(t.key)) continue;
      if (t.x > vx1 + margin || t.x + t.w < vx0 - margin ||
        t.y > vy1 + margin || t.y + t.h < vy0 - margin) continue;
      const bm = this._bitmap(t);
      const dim = pinned && !this.pinnedKeys.has(t.key);
      ctx.save();
      ctx.globalAlpha = dim ? 0.22 : 1;
      // soft shadow (skip for dimmed tables to keep them recessive)
      if (!dim) {
        ctx.shadowColor = theme.shadow;
        ctx.shadowBlur = 16;
        ctx.shadowOffsetY = 6;
      }
      ctx.drawImage(bm, t.x, t.y, t.w, t.h);
      ctx.restore();

      const isSelected = this.selected.has(t);
      const emphasised = this.hover === t || this.drag?.t === t || pinned === t || isSelected;
      if (emphasised) {
        ctx.strokeStyle = theme.edgeHi;
        ctx.lineWidth = (pinned === t || isSelected ? 2.5 : 2) / cam.scale;
        roundRectPath(ctx, t.x, t.y, t.w, t.h, 10);
        ctx.stroke();

        // If multiple tables are selected, draw an outer accent glow
        if (isSelected && (this.selected.size > 1 || this.selectedAnnos.size > 0)) {
          ctx.strokeStyle = hexA(theme.edgeHi, 0.35);
          ctx.lineWidth = 4.5 / cam.scale;
          roundRectPath(ctx, t.x - 2 / cam.scale, t.y - 2 / cam.scale, t.w + 4 / cam.scale, t.h + 4 / cam.scale, 12);
          ctx.stroke();
        }
      }
    }

    // "+ add column" affordance under the pinned table (SQL only)
    if (pinned && Number.isFinite(pinned.x) && this.editable) this._drawAddButton(pinned);

    // sticky notes on top of tables
    for (const a of this.annotations) if (a.type === 'note') this._drawNote(a, cull);

    // selection chrome (handles, colour dots, delete) for the selected annotation
    if (this.selectedAnno) this._drawAnnoChrome(this.selectedAnno);

    // rubber-band marquee
    if (this.marquee) {
      const m = this.marquee;
      const x = Math.min(m.ax, m.x), y = Math.min(m.ay, m.y);
      const w = Math.abs(m.x - m.ax), h = Math.abs(m.y - m.ay);
      ctx.save();
      ctx.fillStyle = hexA(theme.edgeHi, 0.10);
      ctx.strokeStyle = theme.edgeHi;
      ctx.lineWidth = 1 / cam.scale;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }

    // connector dots on the hovered column row (drag one to link)
    if (this.hoverConn && !this.linking && !this.drag && !this.dragGroup && !this.pan) {
      const d = this._connDots(this.hoverConn.t, this.hoverConn.colIndex);
      const rr = 4.5 / cam.scale;
      for (const p of d) {
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.fillStyle = theme.edgeHi; ctx.fill();
        ctx.lineWidth = 2 / cam.scale; ctx.strokeStyle = theme.tableBg; ctx.stroke();
      }
    }

    // in-progress link drag (preview)
    if (this.linking) {
      const k = this.linking;
      const dx = Math.max(28, Math.abs(k.cx - k.wx) * 0.4);
      ctx.save();
      ctx.setLineDash([6 / cam.scale, 5 / cam.scale]);
      ctx.strokeStyle = theme.edgeHi; ctx.lineWidth = 2 / cam.scale;
      ctx.beginPath();
      ctx.moveTo(k.wx, k.wy);
      ctx.bezierCurveTo(k.wx + (k.side === 'right' ? dx : -dx), k.wy, k.cx, k.cy, k.cx, k.cy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = theme.edgeHi;
      dot(ctx, k.wx, k.wy, 4 / cam.scale);
      ctx.restore();
    }

    // in-progress anchor reconnect drag (preview highlight)
    if (this.anchorDrag && this.anchorDrag.candidateTarget) {
      const tgt = this.anchorDrag.candidateTarget.table;
      ctx.save();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5 / cam.scale;
      ctx.setLineDash([6 / cam.scale, 4 / cam.scale]);
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(tgt.x - 3, tgt.y - 3, tgt.w + 6, tgt.h + 6, 12);
        ctx.stroke();
      } else {
        ctx.strokeRect(tgt.x - 3, tgt.y - 3, tgt.w + 6, tgt.h + 6);
      }
      ctx.restore();
    }
  }

  // left/right connector dot positions for a column row (world coords)
  _connDots(t, idx) {
    const y = t.y + HEADER_H + idx * ROW_H + ROW_H / 2;
    return [{ x: t.x, y, side: 'left' }, { x: t.x + t.w, y, side: 'right' }];
  }

  // ---- annotation rendering ----
  _annoVisible(a, c) {
    return !(a.x > c.x1 || a.x + a.w < c.x0 || a.y > c.y1 || a.y + a.h < c.y0);
  }

  _drawGroup(a, cull) {
    if (!this._annoVisible(a, cull)) return;
    const { ctx, cam, theme } = this;
    const color = resolveGroupColor(a.color);
    ctx.save();
    roundRectPath(ctx, a.x, a.y, a.w, a.h, 12);
    ctx.fillStyle = hexA(color, 0.08);
    ctx.fill();
    ctx.strokeStyle = (this.selectedAnnos.has(a) || this.selectedAnno === a) ? theme.edgeHi : hexA(color, 0.7);
    ctx.lineWidth = ((this.selectedAnnos.has(a) || this.selectedAnno === a) ? 2.5 : 1.5) / cam.scale;
    ctx.stroke();
    // label in the header strip
    if (a.text) {
      ctx.fillStyle = (this.selectedAnnos.has(a) || this.selectedAnno === a) ? theme.edgeHi : color;
      ctx.font = `600 ${13 / cam.scale}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const pad = 10 / cam.scale;
      ctx.fillText(clip(ctx, a.text, a.w - pad * 2), a.x + pad, a.y + 16 / cam.scale);
    }
    ctx.restore();
  }

  _drawNote(a, cull) {
    if (!this._annoVisible(a, cull)) return;
    const { ctx, cam, theme } = this;
    const c = NOTE_COLORS[a.color] || NOTE_COLORS.yellow;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    roundRectPath(ctx, a.x, a.y, a.w, a.h, 8);
    ctx.fillStyle = c.fill;
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, a.x, a.y, a.w, a.h, 8);
    ctx.clip();
    ctx.fillStyle = c.text;
    ctx.font = `${13 / cam.scale}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const pad = 10 / cam.scale;
    const lh = 17 / cam.scale;
    const text = a.text || 'Double-click to edit';
    if (!a.text) ctx.globalAlpha = 0.5;
    let y = a.y + pad;
    for (const line of wrapText(ctx, text, a.w - pad * 2)) {
      ctx.fillText(line, a.x + pad, y);
      y += lh;
      if (y > a.y + a.h - pad) break;
    }
    ctx.restore();
  }

  _drawAnnoChrome(a) {
    const { ctx, cam } = this;
    const s = cam.scale;
    // selection outline
    ctx.strokeStyle = this.theme.edgeHi;
    ctx.lineWidth = 2 / s;
    roundRectPath(ctx, a.x, a.y, a.w, a.h, a.type === 'group' ? 12 : 8);
    ctx.stroke();

    // resize handle (bottom-right)
    const hs = 9 / s;
    ctx.fillStyle = this.theme.edgeHi;
    ctx.fillRect(a.x + a.w - hs, a.y + a.h - hs, hs, hs);

    // toolbar above: colour dots + delete
    const dots = this._annoChromeRects(a);
    for (const d of dots.colors) {
      ctx.beginPath();
      ctx.arc(d.cx, d.cy, d.r, 0, Math.PI * 2);
      ctx.fillStyle = d.fill;
      ctx.fill();
      if (d.active) { ctx.strokeStyle = this.theme.edgeHi; ctx.lineWidth = 2 / s; ctx.stroke(); }
    }
    const del = dots.delete;
    ctx.beginPath();
    ctx.arc(del.cx, del.cy, del.r, 0, Math.PI * 2);
    ctx.fillStyle = '#e06c6c';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / s;
    const k = del.r * 0.45;
    ctx.beginPath();
    ctx.moveTo(del.cx - k, del.cy - k); ctx.lineTo(del.cx + k, del.cy + k);
    ctx.moveTo(del.cx + k, del.cy - k); ctx.lineTo(del.cx - k, del.cy + k);
    ctx.stroke();
  }

  // geometry of the colour dots + delete button + resize handle (world coords)
  _annoChromeRects(a) {
    const s = this.cam.scale;
    const r = 8 / s;
    const gap = 22 / s;
    const y = a.y - 18 / s;
    const order = a.type === 'group' ? GROUP_ORDER : NOTE_ORDER;
    const colors = order.map((key, i) => ({
      key, cx: a.x + r + i * gap, cy: y, r,
      fill: a.type === 'group' ? GROUP_COLORS[key] : NOTE_COLORS[key].fill,
      active: a.color === key,
    }));
    const del = { cx: a.x + a.w - r, cy: y, r };
    const hs = 9 / s;
    const resize = { x: a.x + a.w - hs, y: a.y + a.h - hs, w: hs, h: hs };
    return { colors, delete: del, resize };
  }

  // ---- annotation API ----
  setAnnotations(arr) {
    this.annotations = Array.isArray(arr) ? arr : [];
    this.selectedAnno = null;
    this.fitAllGroups();
    this.markDirty();
  }

  fitAllGroups() {
    if (!this.annotations?.length || !this.model?.tables?.length) return false;
    let changed = false;
    for (const a of this.annotations) {
      if (a.type === 'group' && Array.isArray(a.tables) && a.tables.length > 0) {
        const bounds = computeGroupBounds(a, this.model.tables);
        if (bounds) {
          if (a.x !== bounds.x || a.y !== bounds.y || a.w !== bounds.w || a.h !== bounds.h) {
            a.x = bounds.x;
            a.y = bounds.y;
            a.w = bounds.w;
            a.h = bounds.h;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      this.markDirty();
      this.onLayoutChange?.();
    }
    return changed;
  }

  addAnnotation(type) {
    this.onHistorySnapshot?.(this.getSnapshot());
    const center = this.screenToWorld(this.viewW / 2, this.viewH / 2);
    const a = makeAnnotation(type, center.x, center.y);
    this.annotations.push(a);
    this.selectedAnno = a;
    this.pinned = null; this.pinnedKeys = null;
    this.markDirty();
    this.onLayoutChange?.();
    this._beginEditAnnotation(a);
    return a;
  }

  deleteSelectedAnnotation() {
    if (!this.selectedAnno) return;
    this.onHistorySnapshot?.(this.getSnapshot());
    const i = this.annotations.indexOf(this.selectedAnno);
    if (i >= 0) this.annotations.splice(i, 1);
    this.selectedAnno = null;
    this.markDirty();
    this.onLayoutChange?.();
  }

  _fitGroupsForTable(tableKey) {
    if (!this.annotations?.length || !tableKey) return;
    const tk = String(tableKey).toLowerCase();
    for (const a of this.annotations) {
      if (a.type === 'group' && Array.isArray(a.tables) && a.tables.includes(tk)) {
        const bounds = computeGroupBounds(a, this.model.tables);
        if (bounds) {
          a.x = bounds.x;
          a.y = bounds.y;
          a.w = bounds.w;
          a.h = bounds.h;
        }
      }
    }
  }

  // topmost note, then group (notes render above groups)
  _annoAt(sx, sy) {
    return this._noteAt(sx, sy) || this._groupAt(sx, sy);
  }

  _noteAt(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    for (let i = this.annotations.length - 1; i >= 0; i--) {
      const a = this.annotations[i];
      if (a.type === 'note' && inside(w, a)) return a;
    }
    return null;
  }

  _groupAt(sx, sy, headerOrBorderOnly = false) {
    const w = this.screenToWorld(sx, sy);
    const tol = Math.max(8, 10 / this.cam.scale);
    for (let i = this.annotations.length - 1; i >= 0; i--) {
      const a = this.annotations[i];
      if (a.type !== 'group') continue;
      if (!inside(w, a)) continue;

      if (!headerOrBorderOnly) return a;

      const headerH = Math.max(28, 30 / this.cam.scale);
      const isHeader = w.y <= a.y + headerH;
      const isNearLeft = Math.abs(w.x - a.x) <= tol;
      const isNearRight = Math.abs(w.x - (a.x + a.w)) <= tol;
      const isNearBottom = Math.abs(w.y - (a.y + a.h)) <= tol;
      const isNearTop = Math.abs(w.y - a.y) <= tol;

      if (isHeader || isNearLeft || isNearRight || isNearBottom || isNearTop) {
        return a;
      }
    }
    return null;
  }

  // select an annotation, bring it to front and start dragging it
  _grabAnno(a, sx, sy) {
    const w = this.screenToWorld(sx, sy);
    this.selectedAnno = a;
    this.pinned = null; this.pinnedKeys = null;
    const ai = this.annotations.indexOf(a);
    this.annotations.splice(ai, 1); this.annotations.push(a);

    const tableOffsets = [];
    if (a.type === 'group' && a.tables && a.tables.length) {
      const keys = new Set(a.tables.map(k => String(k).toLowerCase()));
      for (const t of this.model.tables) {
        if (keys.has(t.key) && Number.isFinite(t.x)) {
          tableOffsets.push({ t, ox: t.x - a.x, oy: t.y - a.y });
        }
      }
    }
    this.annoDrag = { a, dx: w.x - a.x, dy: w.y - a.y, moved: false, tableOffsets };
    this.markDirty();
  }

  // hit-test the selected annotation's chrome; returns an action or null
  _annoChromeAt(sx, sy) {
    const a = this.selectedAnno;
    if (!a) return null;
    const w = this.screenToWorld(sx, sy);
    const rects = this._annoChromeRects(a);
    for (const d of rects.colors) {
      if ((w.x - d.cx) ** 2 + (w.y - d.cy) ** 2 <= (d.r * 1.4) ** 2) return { kind: 'color', value: d.key };
    }
    const del = rects.delete;
    if ((w.x - del.cx) ** 2 + (w.y - del.cy) ** 2 <= (del.r * 1.4) ** 2) return { kind: 'delete' };
    const rz = rects.resize;
    if (w.x >= rz.x - 4 / this.cam.scale && w.x <= rz.x + rz.w + 4 / this.cam.scale &&
      w.y >= rz.y - 4 / this.cam.scale && w.y <= rz.y + rz.h + 4 / this.cam.scale) return { kind: 'resize' };
    return null;
  }

  _beginEditAnnotation(a) {
    this._cancelEdit();
    const { cam } = this;
    const multiline = a.type === 'note';
    const el = document.createElement(multiline ? 'textarea' : 'input');
    el.className = 'inline-edit anno-edit';
    el.value = a.text || '';
    el.style.left = (a.x * cam.scale + cam.x) + 'px';
    el.style.top = (a.y * cam.scale + cam.y) + 'px';
    el.style.width = Math.max(60, a.w * cam.scale) + 'px';
    el.style.height = (multiline ? a.h : 28) * cam.scale + 'px';
    el.style.fontSize = Math.max(9, 13 * cam.scale) + 'px';
    if (a.type === 'note') {
      // edit on the note's own colour so text stays readable in dark mode
      const c = NOTE_COLORS[a.color] || NOTE_COLORS.yellow;
      el.style.background = c.fill;
      el.style.color = c.text;
      el.style.caretColor = c.text;
    }

    this.canvas.parentElement.appendChild(el);
    el.focus();
    el.select();

    const commit = () => {
      if (!this.editing || this.editing.anno !== a) return;
      a.text = el.value;
      this.editing = null;
      el.remove();
      this.markDirty();
      this.onLayoutChange?.();
    };
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this._cancelEdit(); }
      else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      e.stopPropagation();
    });
    el.addEventListener('blur', commit);
    this.editing = { anno: a, input: el };
  }

  _addRect(t) {
    return { x: t.x, y: t.y + t.h + 8, w: t.w, h: 24 };
  }

  _drawAddButton(t) {
    const { ctx, cam, theme } = this;
    const r = this._addRect(t);
    ctx.save();
    ctx.setLineDash([6 / cam.scale, 4 / cam.scale]);
    ctx.strokeStyle = theme.edgeHi;
    ctx.lineWidth = 1.5 / cam.scale;
    ctx.fillStyle = theme.tableBg;
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 7);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = theme.edgeHi;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${13 / cam.scale}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText('+ add column', r.x + r.w / 2, r.y + r.h / 2);
    ctx.restore();
  }

  _addButtonAt(sx, sy) {
    if (!this.editable || !this.pinned || !Number.isFinite(this.pinned.x)) return false;
    const w = this.screenToWorld(sx, sy);
    const r = this._addRect(this.pinned);
    return w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h;
  }

  _drawGrid() {
    const { ctx, cam, theme, dpr } = this;
    const step = 32 * cam.scale * dpr;
    if (step < 8) return;
    const W = this.canvas.width, H = this.canvas.height;
    const ox = (cam.x * dpr) % step;
    const oy = (cam.y * dpr) % step;
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = oy; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  // Compute connection endpoint anchors and route data for an edge
  _edgeSeg(fromKey, fromCol, toKey, toCol, cull, key = '', fromLaneOffset = 0, toLaneOffset = null, corridorLaneOffset = null) {
    const effectiveToOffset = toLaneOffset !== null ? toLaneOffset : fromLaneOffset;
    const effectiveCorridorOffset = corridorLaneOffset !== null ? corridorLaneOffset : fromLaneOffset;

    const byKey = this._tableMap();
    const from = byKey.get(fromKey), to = byKey.get(toKey);
    if (!from || !to || !Number.isFinite(from.x) || !Number.isFinite(to.x)) return null;
    if (this.hidden.has(from.key) || this.hidden.has(to.key)) return null;

    const lk = key ? key.toLowerCase() : '';
    const waypoints = (lk ? this.edgeWaypoints.get(lk) : null) || this.edgeWaypoints.get(key) || [];
    const anchorCfg = (lk ? this.edgeAnchors.get(lk) : null) || this.edgeAnchors.get(key);

    const targetForFrom = waypoints.length
      ? waypoints[0]
      : (to ? { x: to.x + to.w / 2, y: to.y + to.h / 2 } : null);
    const targetForTo = waypoints.length
      ? waypoints[waypoints.length - 1]
      : (from ? { x: from.x + from.w / 2, y: from.y + from.h / 2 } : null);

    const p1 = getTableAnchor(from, fromCol, targetForFrom, anchorCfg?.fromAnchor, fromLaneOffset, this.diagramLevel);
    const p2 = getTableAnchor(to, toCol, targetForTo, anchorCfg?.toAnchor, effectiveToOffset, this.diagramLevel);

    const routingStyle = (lk ? this.edgeRoutings.get(lk) : null) || this.edgeRoutings.get(key) || this.edgeRouting || 'curved';
    const isOrthogonal = routingStyle === 'ortho-sharp' || routingStyle === 'ortho-rounded';

    const obstacles = [];
    for (const t of this.model.tables) {
      if (t.key !== fromKey && t.key !== toKey && Number.isFinite(t.x) && !this.hidden.has(t.key)) {
        obstacles.push(t);
      }
    }

    return {
      key,
      p1, p2,
      fx: p1.x, fy: p1.y, tx: p2.x, ty: p2.y,
      c1x: p1.x + (p1.nx || 1) * 30, c2x: p2.x + (p2.nx || -1) * 30,
      fromKey, toKey,
      fromTable: from, toTable: to,
      waypoints,
      obstacles,
      routingStyle,
      isOrthogonal,
      laneOffset: effectiveCorridorOffset,
    };
  }

  _edgeSegForDrag(key) {
    if (!key) return null;
    const lk = key.toLowerCase();
    for (const r of this.model.relations) {
      const k = `${r.fromTable.toLowerCase()}.${(r.fromCols[0] || '').toLowerCase()}->${r.toTable.toLowerCase()}.${(r.toCols[0] || '').toLowerCase()}`;
      if (k === lk) {
        return this._edgeSeg(r.fromTable.toLowerCase(), r.fromCols[0], r.toTable.toLowerCase(), r.toCols[0], null, key);
      }
    }
    for (const l of this.manualLinks) {
      const k = `${l.from.table.toLowerCase()}.${(l.from.col || '').toLowerCase()}->${l.to.table.toLowerCase()}.${(l.to.col || '').toLowerCase()}`;
      if (k === lk) {
        return this._edgeSeg(l.from.table.toLowerCase(), l.from.col, l.to.table.toLowerCase(), l.to.col, null, key);
      }
    }
    const parts = key.split('->');
    if (parts.length !== 2) return null;
    const [fPart, tPart] = parts;
    const lastDotF = fPart.lastIndexOf('.');
    const lastDotT = tPart.lastIndexOf('.');
    const fTable = lastDotF !== -1 ? fPart.slice(0, lastDotF) : fPart;
    const fCol = lastDotF !== -1 ? fPart.slice(lastDotF + 1) : '';
    const tTable = lastDotT !== -1 ? tPart.slice(0, lastDotT) : tPart;
    const tCol = lastDotT !== -1 ? tPart.slice(lastDotT + 1) : '';
    return this._edgeSeg(fTable, fCol, tTable, tCol, null, key);
  }

  _drawEdges(vx0, vy0, vx1, vy1) {
    const { theme } = this;
    const cull = { x0: vx0, y0: vy0, x1: vx1, y1: vy1 };
    const focus = this.focus;
    const focusKey = focus ? focus.key : null;
    const fadeAlpha = this.pinned ? 0.05 : 0.16;   // pinned fades harder than transient hover
    const highlighted = [];

    // FK relations + user-defined manual links (latter drawn dashed).
    // FK relations carry crow's-foot cardinality; manual links stay neutral.
    const byKey = this._tableMap();
    const edges = [];
    for (const r of this.model.relations) {
      const fk = r.fromTable.toLowerCase();
      const tk = r.toTable.toLowerCase();
      const fc = r.fromCols[0];
      const tc = r.toCols[0];
      const key = `${fk}.${(fc || '').toLowerCase()}->${tk}.${(tc || '').toLowerCase()}`;
      edges.push({ fk, tk, fc, tc, manual: false, card: relationCardinality(r, byKey), key });
    }
    for (const l of this.manualLinks) {
      const fk = l.from.table.toLowerCase();
      const tk = l.to.table.toLowerCase();
      const fc = l.from.col;
      const tc = l.to.col;
      const key = `${fk}.${(fc || '').toLowerCase()}->${tk}.${(tc || '').toLowerCase()}`;
      edges.push({ fk, tk, fc, tc, manual: true, card: null, key });
    }

    // Calculate lane offsets for parallel edges
    const pairCounts = new Map();
    const pairIndices = new Map();
    for (const e of edges) {
      const pairKey = `${e.fk}->${e.tk}`;
      pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
    }
    const fromCounts = new Map();
    const fromIndices = new Map();
    for (const e of edges) {
      fromCounts.set(e.fk, (fromCounts.get(e.fk) || 0) + 1);
    }
    const toCounts = new Map();
    const toIndices = new Map();
    for (const e of edges) {
      toCounts.set(e.tk, (toCounts.get(e.tk) || 0) + 1);
    }

    // Map each source table to a consistent distinct color from EDGE_COLORS
    const srcTableColors = new Map();
    let srcColorIdx = 0;
    for (const e of edges) {
      if (!srcTableColors.has(e.fk)) {
        srcTableColors.set(e.fk, EDGE_COLORS[srcColorIdx % EDGE_COLORS.length]);
        srcColorIdx++;
      }
    }

    let idx = 0;
    for (const e of edges) {
      const pairKey = `${e.fk}->${e.tk}`;
      const pIdx = pairIndices.get(pairKey) || 0;
      pairIndices.set(pairKey, pIdx + 1);
      const pCount = pairCounts.get(pairKey) || 1;

      const fIdx = fromIndices.get(e.fk) || 0;
      fromIndices.set(e.fk, fIdx + 1);
      const fCount = fromCounts.get(e.fk) || 1;

      const tIdx = toIndices.get(e.tk) || 0;
      toIndices.set(e.tk, tIdx + 1);
      const tCount = toCounts.get(e.tk) || 1;

      let fromLaneOffset = 0;
      let toLaneOffset = 0;
      let corridorLaneOffset = 0;

      if (pCount > 1) {
        const offset = (pIdx - (pCount - 1) / 2) * 14;
        fromLaneOffset = offset;
        toLaneOffset = offset;
        corridorLaneOffset = offset;
      } else {
        if (fCount > 1) {
          fromLaneOffset = (fIdx - (fCount - 1) / 2) * 12;
        }
        if (tCount > 1) {
          toLaneOffset = (tIdx - (tCount - 1) / 2) * 12;
        }
        if (tCount > 1 && tCount >= fCount) {
          corridorLaneOffset = (tIdx - (tCount - 1) / 2) * 14;
        } else if (fCount > 1) {
          corridorLaneOffset = (fIdx - (fCount - 1) / 2) * 14;
        }
      }

      const seg = this._edgeSeg(e.fk, e.fc, e.tk, e.tc, cull, e.key, fromLaneOffset, toLaneOffset, corridorLaneOffset);
      if (!seg) { idx++; continue; }
      seg.manual = e.manual;
      seg.card = e.card;
      seg.key = e.key;

      const customColor = this.edgeColors.get(e.key);
      let edgeColor;
      if (customColor) {
        edgeColor = customColor;
      } else if (this.edgeColorMode === 'single') {
        edgeColor = theme.edge;
      } else {
        // Color by source table so all lines originating from a table share a consistent, unique hue
        edgeColor = srcTableColors.get(e.fk) || EDGE_COLORS[idx % EDGE_COLORS.length];
      }
      seg.color = edgeColor;
      idx++;

      const isSelectedEdge = this.selectedEdgeKey === e.key;
      const isHoveredEdge = this.hoverEdge?.key === e.key;
      const connected = (focusKey && (seg.fromKey === focusKey || seg.toKey === focusKey)) || isSelectedEdge || isHoveredEdge;

      if (focusKey || this.selectedEdgeKey || this.hoverEdge) {
        if (connected) { highlighted.push(seg); continue; }
        this._strokeRoute(seg, edgeColor, 1.2, fadeAlpha, e.manual, false, false);
      } else {
        const baseAlpha = this.edgeColorMode === 'single' ? 0.6 : 0.85;
        this._strokeRoute(seg, edgeColor, 1.6, baseAlpha, e.manual, false, false);
      }
    }
    for (const seg of highlighted) {
      const isSelectedEdge = this.selectedEdgeKey === seg.key;
      const isHoveredEdge = this.hoverEdge?.key === seg.key;
      const hiColor = (this.edgeColorMode === 'single' && !this.edgeColors.get(seg.key)) ? theme.edgeHi : seg.color;
      const width = isSelectedEdge ? 3.0 : 2.5;
      this._strokeRoute(seg, hiColor, width, 1.0, seg.manual, isSelectedEdge, isHoveredEdge);
    }
    for (const seg of highlighted) this._drawEdgeLabel(seg);   // words, on top of the lines
  }

  _strokeRoute(seg, color, width, alpha, dashed, isSelectedEdge = false, isHoveredEdge = false) {
    const { ctx, cam } = this;
    const { p1, p2, waypoints, routingStyle, card, isOrthogonal } = seg;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width / cam.scale;
    if (dashed) ctx.setLineDash([6 / cam.scale, 5 / cam.scale]);
    ctx.beginPath();
    drawRoutePath(ctx, routingStyle, p1, p2, waypoints, 8, seg.obstacles, seg.laneOffset || 0);
    ctx.stroke();
    if (dashed) ctx.setLineDash([]);

    if (card) {
      // markers sit just outside each table, pointing along the line
      const s = 1 / cam.scale;
      const mw = Math.max(width, 1.4) / cam.scale;
      let nx1 = p1.nx, ny1 = p1.ny;
      if ((nx1 === undefined || nx1 === null || (nx1 === 0 && ny1 === 0)) && (waypoints?.length || p2)) {
        const nextPt = waypoints?.length ? waypoints[0] : p2;
        const dx = nextPt.x - p1.x, dy = nextPt.y - p1.y;
        const d = Math.hypot(dx, dy) || 1;
        nx1 = dx / d; ny1 = dy / d;
      }
      let nx2 = p2.nx, ny2 = p2.ny;
      if ((nx2 === undefined || nx2 === null || (nx2 === 0 && ny2 === 0)) && (waypoints?.length || p1)) {
        const prevPt = waypoints?.length ? waypoints[waypoints.length - 1] : p1;
        const dx = prevPt.x - p2.x, dy = prevPt.y - p2.y;
        const d = Math.hypot(dx, dy) || 1;
        nx2 = dx / d; ny2 = dy / d;
      }
      drawMarker(ctx, p1.x, p1.y, nx1 ?? 1, ny1 ?? 0, card.from, s, mw);
      drawMarker(ctx, p2.x, p2.y, nx2 ?? -1, ny2 ?? 0, card.to, s, mw);
    } else {
      dot(ctx, p1.x, p1.y, 3 / cam.scale);
      dot(ctx, p2.x, p2.y, 3 / cam.scale);
    }

    // If edge is selected or hovered, draw handles
    if (isSelectedEdge || isHoveredEdge) {
      const s = 1 / cam.scale;

      if (isOrthogonal) {
        // Orthogonal mode (dbdiagram.io style): segment midpoint handles + corner dots
        const { segments, points } = getOrthogonalSegments(p1, p2, waypoints);

        // 1) Segment midpoint handles (interactive sliding bars)
        for (const segment of segments) {
          const isHoveredSeg = (this.hoverEdge?.key === seg.key && this.hoverEdge?.segmentIndex === segment.index) ||
            (this.segmentDrag?.key === seg.key && this.segmentDrag?.segIndex === segment.index);
          const barW = segment.isVertical ? 6 * s : (isHoveredSeg ? 18 * s : 14 * s);
          const barH = segment.isVertical ? (isHoveredSeg ? 18 * s : 14 * s) : 6 * s;
          const rx = barW / 2, ry = barH / 2;

          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(segment.mid.x - rx, segment.mid.y - ry, barW, barH, 3 * s);
          } else {
            ctx.rect(segment.mid.x - rx, segment.mid.y - ry, barW, barH);
          }
          ctx.fillStyle = isHoveredSeg ? '#ffe600' : (isSelectedEdge ? '#ffffff' : 'rgba(255,255,255,0.85)');
          ctx.fill();
          ctx.strokeStyle = isHoveredSeg ? '#000000' : color;
          ctx.lineWidth = 1.5 * s;
          ctx.stroke();
        }

        // 2) Corner dots (intermediate corners)
        if (points.length > 2) {
          for (let i = 1; i < points.length - 1; i++) {
            const pt = points[i];
            const isDraggedVertex = (this.vertexDrag?.key?.toLowerCase() === seg.key?.toLowerCase()) && this.vertexDrag?.index === (i - 1);
            const isHoveredVertex = (!this.vertexDrag && this.hoverVertex?.key?.toLowerCase() === seg.key?.toLowerCase() && this.hoverVertex?.index === (i - 1) && this.hoverVertex?.isWaypoint) || isDraggedVertex;
            const r = (isHoveredVertex ? 5.5 : 4) * s;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
            ctx.fillStyle = isHoveredVertex ? '#ffe600' : '#ffffff';
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.8 * s;
            ctx.stroke();
          }
        }
      } else {
        // Curved / Straight mode: circular waypoint handles
        const r = (isSelectedEdge ? 5.5 : 4.5) * s;
        if (waypoints && waypoints.length) {
          for (let i = 0; i < waypoints.length; i++) {
            const pt = waypoints[i];
            const isDraggedVertex = (this.vertexDrag?.key?.toLowerCase() === seg.key?.toLowerCase()) && this.vertexDrag?.index === i;
            const isHoveredVertex = (!this.vertexDrag && this.hoverVertex?.key?.toLowerCase() === seg.key?.toLowerCase() && this.hoverVertex?.index === i && this.hoverVertex?.isWaypoint) || isDraggedVertex;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, isHoveredVertex ? r * 1.3 : r, 0, Math.PI * 2);
            ctx.fillStyle = isHoveredVertex ? '#ffe600' : (isSelectedEdge ? '#ffffff' : 'rgba(255,255,255,0.85)');
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = (isHoveredVertex ? 2.5 : 2) * s;
            ctx.stroke();
          }
        }
      }

      // Anchor handles on table edge
      const isHoveredFrom = this.hoverVertex?.key === seg.key && this.hoverVertex?.isAnchor && this.hoverVertex?.isFrom;
      const isHoveredTo = this.hoverVertex?.key === seg.key && this.hoverVertex?.isAnchor && !this.hoverVertex?.isFrom;

      ctx.beginPath();
      ctx.arc(p1.x, p1.y, (isHoveredFrom ? 5.5 : 4) * s, 0, Math.PI * 2);
      ctx.arc(p2.x, p2.y, (isHoveredTo ? 5.5 : 4) * s, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4 * s;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  // A small "one-to-many" pill at a highlighted edge's midpoint.
  _drawEdgeLabel(seg) {
    if (!seg.card || !seg.card.label) return;
    const { ctx, cam } = this;
    const s = 1 / cam.scale;
    const mx = (seg.fx + 3 * seg.c1x + 3 * seg.c2x + seg.tx) / 8;
    const my = (seg.fy + seg.ty) / 2;
    const edgeColor = seg.color || this.theme.edgeHi;
    ctx.save();
    ctx.font = `${11 * s}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = seg.card.label;
    const w = ctx.measureText(text).width + 10 * s;
    const h = 16 * s;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = this.theme.tableBg;
    roundRectPath(ctx, mx - w / 2, my - h / 2, w, h, 5 * s);
    ctx.fill();
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1.2 * s;
    ctx.stroke();
    ctx.fillStyle = edgeColor;
    ctx.fillText(text, mx, my);
    ctx.restore();
  }

  _tableMap() {
    if (!this._tmapDirty && this._tmap && this._tmap.size === this.model.tables.length) {
      return this._tmap;
    }
    this._tmap = new Map(this.model.tables.map(t => [t.key, t]));
    this._tmapDirty = false;
    return this._tmap;
  }

  // ---- hit testing ----
  tableAt(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    const tables = this.model.tables;
    for (let i = tables.length - 1; i >= 0; i--) {
      const t = tables[i];
      if (!Number.isFinite(t.x) || this.hidden.has(t.key)) continue;
      if (w.x >= t.x && w.x <= t.x + t.w && w.y >= t.y && w.y <= t.y + t.h) return t;
    }
    return null;
  }

  // ---- input ----
  _bindInput() {
    const c = this.canvas;

    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;   // ignore right/middle click (right-click = context menu)
      const r = c.getBoundingClientRect();
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      this._pointerDown(e.clientX - r.left, e.clientY - r.top, additive);
      c.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (this._pointerMove(sx, sy)) return;   // active drag/pan handled it

      if (this.toolMode === 'pan') {
        if (this.hover || this.hoverEdge || this.hoverVertex || this.hoverConn) {
          this.hover = null;
          this.hoverEdge = null;
          this.hoverVertex = null;
          this.hoverConn = null;
          this.markDirty();
        }
        c.style.cursor = 'grab';
        return;
      }

      // 1) vertex or anchor handle under cursor
      const vHit = this.vertexAt(sx, sy);

      // 2) edge line under cursor
      const eHit = !vHit ? this.edgeAt(sx, sy) : null;

      // 3) table under cursor
      const t = !vHit && !eHit ? this.tableAt(sx, sy) : null;

      let changed = false;
      if (this.hoverVertex?.key !== vHit?.key || this.hoverVertex?.index !== vHit?.index || this.hoverVertex?.isAnchor !== vHit?.isAnchor || this.hoverVertex?.isFrom !== vHit?.isFrom) {
        this.hoverVertex = vHit;
        changed = true;
      }
      if (this.hoverEdge?.key !== eHit?.key) {
        this.hoverEdge = eHit;
        changed = true;
      }
      if (this.hover !== t) {
        this.hover = t;
        changed = true;
      }

      // connector dots on the hovered column row
      let conn = null;
      if (t) {
        const w = this.screenToWorld(sx, sy);
        const visibleCols = getVisibleColumns(t, this.diagramLevel);
        const idx = Math.floor((w.y - t.y - HEADER_H) / ROW_H);
        if (idx >= 0 && idx < visibleCols.length) conn = { t, colIndex: idx };
      }
      const connChanged = (conn?.t !== this.hoverConn?.t) || (conn?.colIndex !== this.hoverConn?.colIndex);
      if (connChanged) { this.hoverConn = conn; changed = true; }

      if (changed) this.markDirty();

      if (vHit) {
        c.style.cursor = 'move';
      } else if (eHit) {
        if (eHit.isOrthogonal) {
          c.style.cursor = eHit.isVertical ? 'ew-resize' : 'ns-resize';
        } else {
          c.style.cursor = 'pointer';
        }
      } else if (this._connectorAt(sx, sy)) {
        c.style.cursor = 'crosshair';
      } else if (this._annoChromeAt(sx, sy) || this._addButtonAt(sx, sy)) {
        c.style.cursor = 'pointer';
      } else if (t) {
        c.style.cursor = 'grab';
      } else if (this._noteAt(sx, sy) || this._groupAt(sx, sy, true)) {
        c.style.cursor = 'grab';
      } else {
        c.style.cursor = this.toolMode === 'select' ? 'crosshair' : 'default';
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      this._pointerUp();
      c.style.cursor = this.toolMode === 'pan'
        ? 'grab'
        : (this.hoverVertex ? 'move' : (this.hoverEdge ? (this.hoverEdge.isOrthogonal ? (this.hoverEdge.isVertical ? 'ew-resize' : 'ns-resize') : 'pointer') : (this.hover ? 'grab' : (this.toolMode === 'select' ? 'crosshair' : 'default'))));
    });

    // ---- touch (mobile): 1 finger = drag/pan, 2 fingers = pinch-zoom + pan ----
    let pinch = null;
    let tap = null;
    let lastTapAt = 0, lastTapX = 0, lastTapY = 0;
    const tpos = (t) => { const r = c.getBoundingClientRect(); return { sx: t.clientX - r.left, sy: t.clientY - r.top }; };

    c.addEventListener('touchstart', (e) => {
      this._cancelEdit();
      if (e.touches.length === 1) {
        pinch = null;
        const p = tpos(e.touches[0]);
        tap = { sx: p.sx, sy: p.sy, moved: false };
        this._pointerDown(p.sx, p.sy, false, false);
      } else if (e.touches.length === 2) {
        this.drag = this.pan = this.annoDrag = this.annoResize = null;   // cancel single-finger
        tap = null;
        const a = tpos(e.touches[0]), b = tpos(e.touches[1]);
        pinch = { dist: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
      }
      e.preventDefault();
    }, { passive: false });

    c.addEventListener('touchmove', (e) => {
      if (pinch && e.touches.length >= 2) {
        const a = tpos(e.touches[0]), b = tpos(e.touches[1]);
        const dist = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1;
        const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
        const newScale = clamp(this.cam.scale * (dist / pinch.dist), 0.08, 4);
        const k = newScale / this.cam.scale;
        this.cam.x = mx - (mx - this.cam.x) * k;          // zoom around the pinch midpoint
        this.cam.y = my - (my - this.cam.y) * k;
        this.cam.x += mx - pinch.mx;                       // + two-finger pan
        this.cam.y += my - pinch.my;
        this.cam.scale = newScale;
        pinch.dist = dist; pinch.mx = mx; pinch.my = my;
        this.markDirty();
        this.onZoom?.(newScale);
      } else if (tap && e.touches.length === 1) {
        const p = tpos(e.touches[0]);
        if (Math.abs(p.sx - tap.sx) + Math.abs(p.sy - tap.sy) > 8) tap.moved = true;
        this._pointerMove(p.sx, p.sy);
      }
      e.preventDefault();
    }, { passive: false });

    c.addEventListener('touchend', (e) => {
      if (pinch && e.touches.length < 2) {
        pinch = null;
        this.onLayoutChange?.();
        if (e.touches.length === 1) {                      // dropped to one finger -> resume pan
          const p = tpos(e.touches[0]);
          tap = { sx: p.sx, sy: p.sy, moved: true };
          this._pointerDown(p.sx, p.sy, false, false);
        }
        return;
      }
      if (e.touches.length > 0) return;
      // double-tap (no drag) => edit
      if (tap && !tap.moved) {
        const now = performance.now();
        if (now - lastTapAt < 320 && Math.abs(tap.sx - lastTapX) + Math.abs(tap.sy - lastTapY) < 28) {
          this.drag = this.pan = null;     // don't also pin
          this._editAt(tap.sx, tap.sy);
          lastTapAt = 0; tap = null;
          return;
        }
        lastTapAt = now; lastTapX = tap.sx; lastTapY = tap.sy;
      }
      this._pointerUp();
      tap = null;
    }, { passive: false });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._cancelEdit();
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      // ctrl/cmd or pinch => zoom; otherwise treat as zoom too (diagram tool)
      const factor = Math.exp(-e.deltaY * 0.0015);
      this._zoomAt(sx, sy, factor);
    }, { passive: false });

    // double-click: vertex deletion, or new vertex creation on edge, else inline edit
    c.addEventListener('dblclick', (e) => {
      if (this.toolMode === 'pan') return;
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const vHit = this.vertexAt(sx, sy);
      if (vHit && vHit.isWaypoint) {
        console.log('[Diagram dblclick Remove] ' + JSON.stringify({
          key: vHit.key,
          index: vHit.index,
          coord: { x: vHit.x, y: vHit.y }
        }));
        this.removeWaypoint(vHit.key, vHit.index);
        this.markDirty();
        this.onLayoutChange?.();
        return;
      }
      const eHit = this.edgeAt(sx, sy);
      if (eHit) {
        const w = this.screenToWorld(sx, sy);
        const lk = eHit.key.toLowerCase();
        const currentWps = this.edgeWaypoints.get(lk) || [];
        console.log('[Diagram dblclick Add] ' + JSON.stringify({
          key: eHit.key,
          routingStyle: eHit.routingStyle,
          clickWorld: { x: Math.round(w.x), y: Math.round(w.y) },
          insertIndex: eHit.insertIndex,
          currentWaypointsCount: currentWps.length,
          currentWaypoints: currentWps.map(p => ({ x: p.x, y: p.y })),
          p1: { x: eHit.p1.x, y: eHit.p1.y },
          p2: { x: eHit.p2.x, y: eHit.p2.y }
        }));
        this.addWaypoint(eHit.key, Math.round(w.x), Math.round(w.y), eHit.insertIndex);
        this.selectedEdgeKey = eHit.key;
        this.markDirty();
        this.onLayoutChange?.();
        return;
      }
      this._editAt(sx, sy);
    });
  }

  // ---- shared pointer logic (used by both mouse and touch) ----
  // `additive` (Shift/Ctrl) drives multi-select: Shift+click toggles a table,
  // Shift+drag on empty draws a marquee box.
  _pointerDown(sx, sy, additive = false, allowConnect = true) {
    if (this.toolMode === 'pan') {
      // In Hand / Pan mode: strictly pan the canvas, cannot select or move elements
      this.pan = { sx, sy, camx: this.cam.x, camy: this.cam.y, moved: false };
      return;
    }

    this._preDragSnapshot = this.getSnapshot();

    // 0) Vertex handle (waypoint / anchor)
    const vHit = this.vertexAt(sx, sy);
    if (vHit) {
      if (vHit.isWaypoint) {
        const seg = this._edgeSegForDrag(vHit.key);
        let originalPoints = null;
        if (vHit.isOrthogonal && seg) {
          const orthoData = getOrthogonalSegments(seg.p1, seg.p2, seg.waypoints, seg.obstacles);
          originalPoints = orthoData.points.map(p => ({ ...p }));
        }
        this.vertexDrag = {
          key: vHit.key,
          index: vHit.index,
          isOrthogonal: vHit.isOrthogonal,
          originalPoints,
          currentPoints: originalPoints ? originalPoints.map(p => ({ ...p })) : null,
          p1: seg ? { ...seg.p1 } : null,
          p2: seg ? { ...seg.p2 } : null,
          fromTable: seg?.fromTable,
          toTable: seg?.toTable,
          moved: false
        };
        console.log('[Diagram pointerDown vertexHit] ' + JSON.stringify({
          key: vHit.key,
          index: vHit.index,
          isOrthogonal: vHit.isOrthogonal,
          vHitCoord: { x: vHit.x, y: vHit.y },
          storedWaypoints: (this.edgeWaypoints.get(vHit.key.toLowerCase()) || []).map(p => ({ x: p.x, y: p.y })),
          originalPoints: originalPoints ? originalPoints.map(p => ({ x: p.x, y: p.y })) : null
        }));
        this.selectedEdgeKey = vHit.key;
        this.selected = new Set();
        this.pinned = null;
        this.pinnedKeys = null;
        this.markDirty();
        return;
      } else if (vHit.isAnchor) {
        this.anchorDrag = {
          key: vHit.key,
          isFrom: vHit.isFrom,
          table: vHit.table,
          moved: false,
          candidateTarget: null
        };
        console.log('[Diagram pointerDown anchorHit] ' + JSON.stringify({
          key: vHit.key,
          isFrom: vHit.isFrom,
          table: vHit.table ? vHit.table.key : null
        }));
        this.selectedEdgeKey = vHit.key;
        this.selected = new Set();
        this.pinned = null;
        this.pinnedKeys = null;
        this.markDirty();
        return;
      }
    }

    // 0b) Edge line click (or orthogonal segment drag)
    const edge = this.edgeAt(sx, sy);
    if (edge) {
      if (edge.isOrthogonal) {
        const seg = this._edgeSegForDrag(edge.key);
        if (seg) {
          const orthoData = getOrthogonalSegments(seg.p1, seg.p2, seg.waypoints, seg.obstacles);
          const w = this.screenToWorld(sx, sy);
          this.segmentDrag = {
            key: edge.key,
            segIndex: edge.segmentIndex,
            isVertical: edge.isVertical,
            originalPoints: orthoData.points.map(p => ({ ...p })),
            startMouse: { x: w.x, y: w.y },
            fromTable: seg.fromTable,
            toTable: seg.toTable,
            p1: { ...seg.p1 },
            p2: { ...seg.p2 },
            moved: false
          };
          console.log('[Diagram pointerDown edgeHit] ' + JSON.stringify({
            key: edge.key,
            segIndex: edge.segmentIndex,
            isVertical: edge.isVertical,
            isOrthogonal: edge.isOrthogonal,
            storedWaypoints: (this.edgeWaypoints.get(edge.key.toLowerCase()) || []).map(p => ({ x: p.x, y: p.y })),
            originalPoints: orthoData.points.map(p => ({ x: p.x, y: p.y }))
          }));
        }
      }
      this.selectedEdgeKey = edge.key;
      this.selected = new Set();
      this.pinned = null;
      this.pinnedKeys = null;
      this.markDirty();
      return;
    }

    // 1) chrome of the selected annotation (colour dots / delete / resize)
    const chrome = this._annoChromeAt(sx, sy);
    if (chrome) {
      const a = this.selectedAnno;
      if (chrome.kind === 'color') {
        this.onHistorySnapshot?.(this.getSnapshot());
        a.color = chrome.value;
        this.markDirty();
        this.onLayoutChange?.();
      }
      else if (chrome.kind === 'delete') { this.deleteSelectedAnnotation(); }
      else if (chrome.kind === 'resize') {
        const w = this.screenToWorld(sx, sy);
        this.annoResize = { a, ox: w.x - (a.x + a.w), oy: w.y - (a.y + a.h), moved: false };
      }
      return;
    }
    // 1b) a column connector dot -> start drawing a manual link
    if (allowConnect) {
      const conn = this._connectorAt(sx, sy);
      if (conn) {
        this.linking = { fromKey: conn.tableKey, fromCol: conn.col, side: conn.side, wx: conn.wx, wy: conn.wy, cx: conn.wx, cy: conn.wy };
        this.markDirty();
        return;
      }
    }
    // 2) "+ add column" button under the pinned table
    if (this._addButtonAt(sx, sy)) { this.onAddColumn?.(this.pinned.key); return; }
    // 3) a sticky note (notes sit on top, grabbable anywhere)
    const note = this._noteAt(sx, sy);
    if (note) { this._grabAnno(note, sx, sy); return; }
    // 4) a table (before groups, so tables inside a group stay grabbable)
    const t = this.tableAt(sx, sy);
    if (t) {
      if (this.selectedAnno) this.selectedAnno = null;
      if (this.selectedEdgeKey) { this.selectedEdgeKey = null; }
      if (additive) {                                   // Shift/Ctrl+click toggles selection
        if (this.selected.has(t)) this.selected.delete(t);
        else this.selected.add(t);
        this.pinned = null; this.pinnedKeys = null;
        this.markDirty();
        this.onSelectionChange?.();
        return;
      }
      const idx = this.model.tables.indexOf(t);
      this.model.tables.splice(idx, 1);
      this.model.tables.push(t);
      const w = this.screenToWorld(sx, sy);
      if (this.selected.has(t) && (this.selected.size > 1 || this.selectedAnnos.size > 0)) {
        // drag the whole current selection together
        const tables = [...this.selected].filter(x => Number.isFinite(x.x))
          .map(x => ({ t: x, sx0: x.x, sy0: x.y }));
        const annos = [...this.selectedAnnos].map(a => ({ a, sx0: a.x, sy0: a.y }));
        const groupOrigins = {};
        for (const a of this.annotations) {
          if (a.type === 'group') groupOrigins[a.id] = { x: a.x, y: a.y };
        }
        this.dragGroup = { tables, annos, groupOrigins, ax: w.x, ay: w.y, moved: false };
        this._potentialSingleSelect = t;
      } else {
        this.selected = new Set([t]);
        this.selectedAnnos.clear();
        this.drag = { t, dx: w.x - t.x, dy: w.y - t.y, moved: false };
        this.onSelectionChange?.();
      }
      this.markDirty();
      return;
    }
    // 5) a group box (header or border directly targeted)
    const group = this._groupAt(sx, sy, true);
    if (group) {
      if (this.selectedEdgeKey) { this.selectedEdgeKey = null; }
      if (additive) {
        if (this.selectedAnnos.has(group)) this.selectedAnnos.delete(group);
        else this.selectedAnnos.add(group);
        this.markDirty();
        this.onSelectionChange?.();
        return;
      }
      const w = this.screenToWorld(sx, sy);
      if (this.selectedAnnos.has(group) && (this.selected.size > 0 || this.selectedAnnos.size > 1)) {
        const tables = [...this.selected].filter(x => Number.isFinite(x.x))
          .map(x => ({ t: x, sx0: x.x, sy0: x.y }));
        const annos = [...this.selectedAnnos].map(a => ({ a, sx0: a.x, sy0: a.y }));
        const groupOrigins = {};
        for (const a of this.annotations) {
          if (a.type === 'group') groupOrigins[a.id] = { x: a.x, y: a.y };
        }
        this.dragGroup = { tables, annos, groupOrigins, ax: w.x, ay: w.y, moved: false };
        this._potentialSingleAnno = group;
        this.markDirty();
        return;
      }
      this.selected.clear();
      this.selectedAnnos = new Set([group]);
      this._grabAnno(group, sx, sy);
      return;
    }

    // 6) empty space -> clear edge selection, Shift/Ctrl drag or Marquee mode selects; otherwise pan
    if (this.selectedEdgeKey) { this.selectedEdgeKey = null; this.markDirty(); }
    if (this.selectedAnno) { this.selectedAnno = null; this.markDirty(); }
    const w = this.screenToWorld(sx, sy);
    if (additive || this.toolMode === 'select') {
      if (!additive) {
        this.selected.clear();
        this.selectedAnnos.clear();
      }
      this.marquee = { ax: w.x, ay: w.y, x: w.x, y: w.y, additive };
    } else {
      this.pan = { sx, sy, camx: this.cam.x, camy: this.cam.y, moved: false };
    }
  }

  _columnAtWorld(wx, wy) {
    for (let i = this.model.tables.length - 1; i >= 0; i--) {
      const t = this.model.tables[i];
      if (!Number.isFinite(t.x) || this.hidden.has(t.key)) continue;
      if (wx >= t.x && wx <= t.x + t.w && wy >= t.y && wy <= t.y + t.h) {
        const visibleCols = getVisibleColumns(t, this.diagramLevel);
        const idx = Math.floor((wy - t.y - HEADER_H) / ROW_H);
        if (idx >= 0 && idx < visibleCols.length) return { tableKey: t.key, col: visibleCols[idx].name };
        return null;
      }
    }
    return null;
  }

  // returns true if an active drag/pan/resize consumed the move
  _pointerMove(sx, sy) {
    if (this.segmentDrag) {
      const w = this.screenToWorld(sx, sy);
      const drag = this.segmentDrag;
      const dx = w.x - drag.startMouse.x;
      const dy = w.y - drag.startMouse.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        drag.moved = true;
      }
      const res = moveOrthogonalSegment(
        drag.p1,
        drag.p2,
        drag.originalPoints,
        drag.segIndex,
        dx,
        dy,
        drag.fromTable,
        drag.toTable
      );
        if (res) {
        this.setEdgeWaypoints(drag.key, res.waypoints);
        if (res.fromAnchor) {
          this.setEdgeAnchor(drag.key, res.fromAnchor.side, res.fromAnchor.offset, true);
        }
        if (res.toAnchor) {
          this.setEdgeAnchor(drag.key, res.toAnchor.side, res.toAnchor.offset, false);
        }
        console.log('[Diagram segmentDrag Move] ' + JSON.stringify({
          key: drag.key,
          segIndex: drag.segIndex,
          dx: Math.round(dx),
          dy: Math.round(dy),
          waypointCount: res.waypoints ? res.waypoints.length : 0,
          waypoints: res.waypoints ? res.waypoints.map(p => ({ x: p.x, y: p.y })) : [],
          fromAnchor: res.fromAnchor,
          toAnchor: res.toAnchor
        }));
        this.markDirty();
      }
      return true;
    }
    if (this.vertexDrag) {
      const w = this.screenToWorld(sx, sy);
      const drag = this.vertexDrag;
      drag.moved = true;
      if (drag.isOrthogonal && (drag.currentPoints || drag.originalPoints)) {
        const basePts = drag.currentPoints || drag.originalPoints;
        const res = moveOrthogonalCorner(
          drag.p1,
          drag.p2,
          basePts,
          drag.index,
          w.x,
          w.y,
          drag.fromTable,
          drag.toTable
        );
        this.setEdgeWaypoints(drag.key, res.waypoints);
        if (res.fromAnchor) {
          this.setEdgeAnchor(drag.key, res.fromAnchor.side, res.fromAnchor.offset, true);
        }
        if (res.toAnchor) {
          this.setEdgeAnchor(drag.key, res.toAnchor.side, res.toAnchor.offset, false);
        }
        if (Number.isFinite(res.activeCornerIndex) && res.activeCornerIndex >= 0) {
          drag.index = res.activeCornerIndex;
        }
        if (res.points && res.points.length >= 2) {
          drag.currentPoints = res.points.map(p => ({ ...p }));
          drag.p1 = { ...res.points[0] };
          drag.p2 = { ...res.points[res.points.length - 1] };
        }
        this.hoverVertex = {
          key: drag.key,
          index: drag.index,
          isWaypoint: true,
          isOrthogonal: true
        };
        console.log('[Diagram vertexDrag Move] ' + JSON.stringify({
          key: drag.key,
          dragIndex: drag.index,
          mouse: { x: Math.round(w.x), y: Math.round(w.y) },
          waypointCount: res.waypoints ? res.waypoints.length : 0,
          waypoints: res.waypoints ? res.waypoints.map(p => ({ x: p.x, y: p.y })) : [],
          fromAnchor: res.fromAnchor,
          toAnchor: res.toAnchor,
          activeCornerIndex: res.activeCornerIndex
        }));
      } else {
        this.moveWaypoint(drag.key, drag.index, Math.round(w.x), Math.round(w.y));
      }
      this.markDirty();
      return true;
    }
    if (this.anchorDrag) {
      const w = this.screenToWorld(sx, sy);
      this.anchorDrag.moved = true;

      // Check if hovering over another table (reconnect candidate)
      const hoverTable = this.tableAt(sx, sy);
      const hoverCol = this._columnAtWorld(w.x, w.y);
      if (hoverTable && hoverTable.key.toLowerCase() !== this.anchorDrag.table.key.toLowerCase()) {
        this.anchorDrag.candidateTarget = {
          table: hoverTable,
          col: hoverCol ? hoverCol.col : (hoverTable.columns[0]?.name || '')
        };
      } else {
        this.anchorDrag.candidateTarget = null;
        // Smooth continuous perimeter docking
        const proj = projectPointToPerimeter(this.anchorDrag.table, w);
        if (proj) {
          this.setEdgeAnchor(this.anchorDrag.key, proj.side, proj.offset, this.anchorDrag.isFrom);
        }
      }
      this.markDirty();
      return true;
    }
    if (this.linking) {
      const w = this.screenToWorld(sx, sy);
      this.linking.cx = w.x; this.linking.cy = w.y;
      this.markDirty();
      return true;
    }
    if (this.dragGroup) {
      const w = this.screenToWorld(sx, sy);
      const dx = w.x - this.dragGroup.ax, dy = w.y - this.dragGroup.ay;

      // Move tables
      for (const it of this.dragGroup.tables) {
        it.t.x = it.sx0 + dx;
        it.t.y = it.sy0 + dy;
      }

      // Move explicitly selected annotations
      for (const it of this.dragGroup.annos) {
        it.a.x = it.sx0 + dx;
        it.a.y = it.sy0 + dy;
      }

      // Coordination with TableGroups:
      // If all tables in a TableGroup are moving, move the group box intact with them.
      // If only some tables in a TableGroup are moving, refit the group dynamically.
      const selectedTableKeys = new Set(this.dragGroup.tables.map(it => it.t.key.toLowerCase()));
      const explicitlyMovedGroupIds = new Set(this.dragGroup.annos.map(it => it.a.id));

      for (const a of this.annotations) {
        if (a.type === 'group') {
          if (explicitlyMovedGroupIds.has(a.id)) continue;
          const memberKeys = (a.tables || []).map(k => String(k).toLowerCase());
          if (!memberKeys.length) continue;

          const allMembersSelected = memberKeys.every(k => selectedTableKeys.has(k));
          const someMembersSelected = memberKeys.some(k => selectedTableKeys.has(k));

          if (allMembersSelected) {
            const origin = this.dragGroup.groupOrigins[a.id];
            if (origin) {
              a.x = origin.x + dx;
              a.y = origin.y + dy;
            }
          } else if (someMembersSelected) {
            const bounds = computeGroupBounds(a, this.model.tables);
            if (bounds) {
              a.x = bounds.x;
              a.y = bounds.y;
              a.w = bounds.w;
              a.h = bounds.h;
            }
          }
        }
      }

      this.dragGroup.moved = true;
      this.markDirty();
      return true;
    }
    if (this.marquee) {
      const w = this.screenToWorld(sx, sy);
      this.marquee.x = w.x; this.marquee.y = w.y;
      this.markDirty();
      return true;
    }
    if (this.annoResize) {
      const w = this.screenToWorld(sx, sy);
      const a = this.annoResize.a;
      a.w = Math.max(a.type === 'group' ? 120 : 80, w.x - this.annoResize.ox - a.x);
      a.h = Math.max(a.type === 'group' ? 90 : 50, w.y - this.annoResize.oy - a.y);
      this.annoResize.moved = true;
      this.markDirty();
      return true;
    }
    if (this.annoDrag) {
      const w = this.screenToWorld(sx, sy);
      const newX = w.x - this.annoDrag.dx;
      const newY = w.y - this.annoDrag.dy;
      this.annoDrag.a.x = newX;
      this.annoDrag.a.y = newY;
      if (this.annoDrag.tableOffsets && this.annoDrag.tableOffsets.length) {
        for (const { t, ox, oy } of this.annoDrag.tableOffsets) {
          t.x = newX + ox;
          t.y = newY + oy;
        }
      }
      this.annoDrag.moved = true;
      this.markDirty();
      return true;
    }
    if (this.drag) {
      const w = this.screenToWorld(sx, sy);
      this.drag.t.x = w.x - this.drag.dx;
      this.drag.t.y = w.y - this.drag.dy;
      this._fitGroupsForTable(this.drag.t.key);
      this.drag.moved = true;
      this.markDirty();
      return true;
    }
    if (this.pan) {
      this.cam.x = this.pan.camx + (sx - this.pan.sx);
      this.cam.y = this.pan.camy + (sy - this.pan.sy);
      if (Math.abs(sx - this.pan.sx) + Math.abs(sy - this.pan.sy) > 3) this.pan.moved = true;
      this.markDirty();
      return true;
    }
    return false;
  }

  _pointerUp() {
    const didMove = (this.segmentDrag && this.segmentDrag.moved) ||
      (this.vertexDrag && this.vertexDrag.moved) ||
      (this.anchorDrag && this.anchorDrag.moved) ||
      (this.dragGroup && this.dragGroup.moved) ||
      (this.annoResize && this.annoResize.moved) ||
      (this.annoDrag && this.annoDrag.moved) ||
      (this.drag && this.drag.moved);

    if (didMove && this._preDragSnapshot) {
      this.onHistorySnapshot?.(this._preDragSnapshot);
    }
    this._preDragSnapshot = null;

    if (this.segmentDrag) {
      if (this.segmentDrag.moved) {
        const key = this.segmentDrag.key;
        const lk = key.toLowerCase();
        const wps = this.edgeWaypoints.get(lk) || this.edgeWaypoints.get(key);
        if (wps) {
          const cleaned = filterRedundantWaypoints(wps, 4);
          this.setEdgeWaypoints(key, cleaned);
          console.log('[Diagram segmentDrag Up] ' + JSON.stringify({
            key: lk,
            count: cleaned.length,
            waypoints: cleaned.map(p => ({ x: p.x, y: p.y })),
            fromAnchor: this.edgeAnchors.get(lk)?.fromAnchor,
            toAnchor: this.edgeAnchors.get(lk)?.toAnchor
          }));
        }
        this.onLayoutChange?.();
      }
      this.segmentDrag = null;
      return;
    }
    if (this.vertexDrag) {
      if (this.vertexDrag.moved) {
        const key = this.vertexDrag.key;
        const lk = key.toLowerCase();
        const wps = this.edgeWaypoints.get(lk) || this.edgeWaypoints.get(key);
        if (wps) {
          const cleaned = filterRedundantWaypoints(wps, 2);
          this.setEdgeWaypoints(key, cleaned);
          console.log('[Diagram vertexDrag Up] ' + JSON.stringify({
            key: lk,
            count: cleaned.length,
            waypoints: cleaned.map(p => ({ x: p.x, y: p.y })),
            fromAnchor: this.edgeAnchors.get(lk)?.fromAnchor,
            toAnchor: this.edgeAnchors.get(lk)?.toAnchor
          }));
        }
        this.onLayoutChange?.();
      }
      this.vertexDrag = null;
      this.hoverVertex = null;
      return;
    }
    if (this.anchorDrag) {
      if (this.anchorDrag.moved) {
        if (this.anchorDrag.candidateTarget) {
          this.reconnectEdge(
            this.anchorDrag.key,
            this.anchorDrag.isFrom,
            this.anchorDrag.candidateTarget.table.key,
            this.anchorDrag.candidateTarget.col
          );
        } else {
          this.onLayoutChange?.();
        }
      }
      this.anchorDrag = null;
      this.markDirty();
      return;
    }
    // finishing a link drag -> create the link if dropped on a column
    if (this.linking) {
      const k = this.linking;
      this.linking = null;
      const tgt = this._columnAtWorld(k.cx, k.cy);
      if (tgt) this.addManualLink(k.fromKey, k.fromCol, tgt.tableKey, tgt.col);
      this.markDirty();
      return;
    }
    // marquee end -> select tables and groups fully enclosed by the box
    if (this.marquee) {
      const m = this.marquee;
      const x0 = Math.min(m.ax, m.x), x1 = Math.max(m.ax, m.x);
      const y0 = Math.min(m.ay, m.y), y1 = Math.max(m.ay, m.y);
      if (x1 - x0 > 4 || y1 - y0 > 4) {
        if (!m.additive) {
          this.selected.clear();
          this.selectedAnnos.clear();
        }
        // Tables: MUST BE FULLY ENCLOSED by the marquee box
        for (const t of this.model.tables) {
          if (Number.isFinite(t.x) && !this.hidden.has(t.key)) {
            const fullyEnclosed = t.x >= x0 && (t.x + t.w) <= x1 && t.y >= y0 && (t.y + t.h) <= y1;
            if (fullyEnclosed) {
              this.selected.add(t);
            }
          }
        }
        // Annotations / Groups: MUST ALSO BE FULLY ENCLOSED by the marquee box
        for (const a of this.annotations) {
          const fullyEnclosed = a.x >= x0 && (a.x + a.w) <= x1 && a.y >= y0 && (a.y + a.h) <= y1;
          if (fullyEnclosed) {
            this.selectedAnnos.add(a);
          }
        }
        this.pinned = null; this.pinnedKeys = null;
      }
      this.marquee = null;
      this.markDirty();
      this.onSelectionChange?.();
      return;
    }
    if (this.dragGroup) {
      if (!this.dragGroup.moved) {
        // User clicked an already selected item without dragging: collapse selection
        if (this._potentialSingleSelect) {
          this.selected = new Set([this._potentialSingleSelect]);
          this.selectedAnnos.clear();
          this._pin(this._potentialSingleSelect);
        } else if (this._potentialSingleAnno) {
          this.selected.clear();
          this.selectedAnnos = new Set([this._potentialSingleAnno]);
          this.selectedAnno = this._potentialSingleAnno;
        }
        this.markDirty();
        this.onSelectionChange?.();
      } else {
        this.onLayoutChange?.();
      }
      this.dragGroup = null;
      this._potentialSingleSelect = null;
      this._potentialSingleAnno = null;
      return;
    }
    // a click (no drag) on a table pins focus; a click on empty space clears it
    if (this.drag && !this.drag.moved) this._pin(this.drag.t);
    else if (this.pan && !this.pan.moved) {
      if (this.toolMode !== 'pan') {
        if (this.selected.size || this.selectedAnnos.size) {
          this.selected = new Set();
          this.selectedAnnos = new Set();
          this.markDirty();
          this.onSelectionChange?.();
        }
        if (this.pinned) this._pin(this.pinned);
      }
    }
    const changed = (this.drag && this.drag.moved) || (this.pan && this.pan.moved) ||
      (this.annoDrag && this.annoDrag.moved) || (this.annoResize && this.annoResize.moved);
    this.drag = null;
    this.pan = null;
    this.annoDrag = null;
    this.annoResize = null;
    if (changed) this.onLayoutChange?.();
  }

  clearSelection() {
    if (this.selected.size || this.selectedAnnos.size) {
      this.selected = new Set();
      this.selectedAnnos = new Set();
      this.markDirty();
      this.onSelectionChange?.();
    }
  }

  selectAll() {
    this.selected = new Set(this.model.tables.filter(t => Number.isFinite(t.x) && !this.hidden.has(t.key)));
    this.selectedAnnos = new Set(this.annotations);
    this.pinned = null;
    this.pinnedKeys = null;
    this.selectedEdgeKey = null;
    this.selectedAnno = null;
    this.markDirty();
    this.onSelectionChange?.();
  }

  setToolMode(mode) {
    this.toolMode = mode === 'select' ? 'select' : 'pan';
    if (this.toolMode === 'pan') {
      this.hover = null;
      this.hoverEdge = null;
      this.hoverVertex = null;
      this.hoverConn = null;
      this.canvas.style.cursor = 'grab';
    } else {
      this.canvas.style.cursor = 'default';
    }
    this.markDirty();
    this.onToolModeChange?.(this.toolMode);
  }

  // ---- hide / show tables ----
  // Hide a table; if it's part of a multi-selection, hide the whole selection.
  hideTable(t) {
    let keys;
    if (t && this.selected.has(t) && this.selected.size > 1) keys = [...this.selected].map(x => x.key);
    else if (t) keys = [t.key];
    else keys = [...this.selected].map(x => x.key);
    if (!keys.length) return;
    this.onHistorySnapshot?.(this.getSnapshot());
    for (const k of keys) this.hidden.add(k);
    this.selected = new Set();
    this.pinned = null; this.pinnedKeys = null;
    this.markDirty();
    this.onHiddenChange?.();
    this.onSelectionChange?.();
    this.onLayoutChange?.();
  }

  showAllHidden() {
    if (!this.hidden.size) return;
    this.onHistorySnapshot?.(this.getSnapshot());
    this.hidden.clear();
    this.markDirty();
    this.onHiddenChange?.();
    this.onLayoutChange?.();
  }

  setHidden(keys) {
    this.hidden = new Set(Array.isArray(keys) ? keys : []);
    this.markDirty();
    this.onHiddenChange?.();
  }

  hiddenCount() { return this.hidden.size; }

  // bulk hide/show a list of keys (used by the Tables panel "Hide all"/"Show all")
  setTablesHidden(keys, hidden) {
    let changed = false;
    for (const k of keys) {
      if (hidden) { if (!this.hidden.has(k)) { this.hidden.add(k); changed = true; } }
      else if (this.hidden.delete(k)) changed = true;
    }
    if (!changed) return;
    this.markDirty();
    this.onHiddenChange?.();
    this.onLayoutChange?.();
  }

  // ---- driven by the Tables panel ----
  setTableHidden(key, hidden) {
    if (hidden) this.hidden.add(key); else this.hidden.delete(key);
    this.markDirty();
    this.onHiddenChange?.();
    this.onLayoutChange?.();
  }

  selectByKey(key, on) {
    const t = this.model.tables.find(x => x.key === key);
    if (!t) return;
    if (on) this.selected.add(t); else this.selected.delete(t);
    this.markDirty();
    this.onSelectionChange?.();
  }

  isSelected(key) {
    for (const t of this.selected) if (t.key === key) return true;
    return false;
  }

  // centre the camera on a table (and pin it for focus)
  centerOn(key) {
    const t = this.model.tables.find(x => x.key === key);
    if (!t || !Number.isFinite(t.x)) return;
    if (this.hidden.has(key)) this.setTableHidden(key, false);
    const s = this.cam.scale;
    this.cam.x = this.viewW / 2 - (t.x + t.w / 2) * s;
    this.cam.y = this.viewH / 2 - (t.y + t.h / 2) * s;
    this._setPin(t);
    this.markDirty();
  }

  // ---- manual links ----
  // a connector dot under the cursor (to start a link), or null
  _connectorAt(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    const r = 7 / this.cam.scale;
    for (let i = this.model.tables.length - 1; i >= 0; i--) {
      const t = this.model.tables[i];
      if (!Number.isFinite(t.x) || this.hidden.has(t.key)) continue;
      const ly = w.y - t.y;
      if (ly < HEADER_H) continue;
      const idx = Math.floor((ly - HEADER_H) / ROW_H);
      const visibleCols = getVisibleColumns(t, this.diagramLevel);
      if (idx < 0 || idx >= visibleCols.length) continue;
      for (const p of this._connDots(t, idx)) {
        if (Math.hypot(w.x - p.x, w.y - p.y) <= r * 1.5) {
          return { tableKey: t.key, col: visibleCols[idx].name, side: p.side, wx: p.x, wy: p.y };
        }
      }
    }
    return null;
  }

  // the table + column under the cursor (link target), or null
  _columnAt(sx, sy) {
    const t = this.tableAt(sx, sy);
    if (!t) return null;
    const w = this.screenToWorld(sx, sy);
    const visibleCols = getVisibleColumns(t, this.diagramLevel);
    const idx = Math.floor((w.y - t.y - HEADER_H) / ROW_H);
    if (idx < 0 || idx >= visibleCols.length) return null;
    return { tableKey: t.key, col: visibleCols[idx].name };
  }

  _linkExists(fk, fc, tk, tc) {
    const eq = (a, b) => a.toLowerCase() === b.toLowerCase();
    const has = (l) => (eq(l.from.table, fk) && eq(l.from.col, fc) && eq(l.to.table, tk) && eq(l.to.col, tc)) ||
      (eq(l.from.table, tk) && eq(l.from.col, tc) && eq(l.to.table, fk) && eq(l.to.col, fc));
    return this.manualLinks.some(has);
  }

  addManualLink(fk, fc, tk, tc) {
    if (fk === tk && fc.toLowerCase() === tc.toLowerCase()) return false;
    if (this._linkExists(fk, fc, tk, tc)) return false;
    this.onHistorySnapshot?.(this.getSnapshot());
    this.manualLinks.push({ from: { table: fk, col: fc }, to: { table: tk, col: tc } });
    this.markDirty();
    this.onLayoutChange?.();
    return true;
  }

  setManualLinks(arr) {
    this.manualLinks = Array.isArray(arr) ? arr.filter(l => l && l.from && l.to) : [];
    this.markDirty();
  }

  setEdgeColorMode(mode) {
    this.onHistorySnapshot?.(this.getSnapshot());
    this.edgeColorMode = mode === 'single' ? 'single' : 'multi';
    this.markDirty();
    this.onLayoutChange?.();
  }

  setEdgeColor(key, color) {
    if (!key) return;
    this.onHistorySnapshot?.(this.getSnapshot());
    if (color) {
      this.edgeColors.set(key.toLowerCase(), color);
    } else {
      this.edgeColors.delete(key.toLowerCase());
    }
    this.markDirty();
    this.onLayoutChange?.();
  }

  setEdgeColors(obj) {
    this.edgeColors.clear();
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const color = typeof v === 'string' ? v : v?.color;
      if (color) this.edgeColors.set(k.toLowerCase(), color);
    }
    this.markDirty();
  }

  setEdgeRouting(style) {
    this.onHistorySnapshot?.(this.getSnapshot());
    this.edgeRouting = style || 'curved';
    this.markDirty();
    this.onLayoutChange?.();
  }

  setIndividualEdgeRouting(key, style) {
    if (!key) return;
    this.onHistorySnapshot?.(this.getSnapshot());
    if (style) this.edgeRoutings.set(key.toLowerCase(), style);
    else this.edgeRoutings.delete(key.toLowerCase());
    this.markDirty();
    this.onLayoutChange?.();
  }

  setEdgeWaypoints(key, pts) {
    if (!key) return;
    if (Array.isArray(pts) && pts.length) {
      this.edgeWaypoints.set(key.toLowerCase(), pts.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })));
    } else {
      this.edgeWaypoints.delete(key.toLowerCase());
    }
    this.markDirty();
  }

  addWaypoint(key, x, y, insertIndex = -1) {
    if (!key) return;
    this.onHistorySnapshot?.(this.getSnapshot());
    const lk = key.toLowerCase();
    const pts = this.edgeWaypoints.get(lk) ? [...this.edgeWaypoints.get(lk)] : [];
    const pt = { x: Math.round(x), y: Math.round(y) };
    const beforeList = pts.map(p => ({ x: p.x, y: p.y }));

    if (insertIndex >= 0 && insertIndex <= pts.length) {
      pts.splice(insertIndex, 0, pt);
    } else {
      pts.push(pt);
    }

    console.log('[Diagram addWaypoint] ' + JSON.stringify({
      key: lk,
      insertedAt: (insertIndex >= 0 && insertIndex <= beforeList.length) ? insertIndex : beforeList.length,
      requestedInsertIndex: insertIndex,
      newPoint: pt,
      before: beforeList,
      after: pts.map(p => ({ x: p.x, y: p.y }))
    }));

    this.edgeWaypoints.set(lk, pts);
    this.markDirty();
  }

  moveWaypoint(key, index, x, y) {
    if (!key) return;
    const lk = key.toLowerCase();
    const pts = this.edgeWaypoints.get(lk);
    if (pts && pts[index]) {
      pts[index].x = Math.round(x);
      pts[index].y = Math.round(y);
      this.markDirty();
    }
  }

  removeWaypoint(key, index) {
    if (!key) return;
    this.onHistorySnapshot?.(this.getSnapshot());
    const lk = key.toLowerCase();
    const pts = this.edgeWaypoints.get(lk);
    if (pts && index >= 0 && index < pts.length) {
      const removed = pts[index];
      pts.splice(index, 1);
      const cleaned = filterRedundantWaypoints(pts, 3);
      console.log('[Diagram removeWaypoint] ' + JSON.stringify({
        key: lk,
        removedIndex: index,
        removedPoint: removed,
        remainingCount: cleaned.length,
        remaining: cleaned.map(p => ({ x: p.x, y: p.y }))
      }));
      if (cleaned.length) {
        this.edgeWaypoints.set(lk, cleaned);
      } else {
        this.edgeWaypoints.delete(lk);
      }
      this.markDirty();
    }
  }

  reconnectEdge(key, isFrom, newTableKey, newColName) {
    if (!key || !newTableKey) return false;
    this.onHistorySnapshot?.(this.getSnapshot());

    const lk = key.toLowerCase();
    let reconnected = false;

    // Check manual links
    for (let i = 0; i < this.manualLinks.length; i++) {
      const l = this.manualLinks[i];
      const k = `${l.from.table.toLowerCase()}.${(l.from.col || '').toLowerCase()}->${l.to.table.toLowerCase()}.${(l.to.col || '').toLowerCase()}`;
      if (k === lk) {
        if (isFrom) {
          l.from.table = newTableKey;
          l.from.col = newColName || '';
        } else {
          l.to.table = newTableKey;
          l.to.col = newColName || '';
        }
        reconnected = true;
        break;
      }
    }

    // Check model relations
    if (!reconnected) {
      for (let i = 0; i < this.model.relations.length; i++) {
        const r = this.model.relations[i];
        const k = `${r.fromTable.toLowerCase()}.${(r.fromCols[0] || '').toLowerCase()}->${r.toTable.toLowerCase()}.${(r.toCols[0] || '').toLowerCase()}`;
        if (k === lk) {
          if (isFrom) {
            r.fromTable = newTableKey;
            r.fromCols = [newColName || ''];
          } else {
            r.toTable = newTableKey;
            r.toCols = [newColName || ''];
          }
          reconnected = true;
          break;
        }
      }
    }

    if (reconnected) {
      this.edgeWaypoints.delete(lk);
      this.edgeAnchors.delete(lk);
      this.selectedEdgeKey = null;
      this.markDirty();
      this.onLayoutChange?.();
      return true;
    }
    return false;
  }

  setEdgeAnchor(key, side, offset, isFrom = true) {
    if (!key) return;
    const lk = key.toLowerCase();
    const cur = this.edgeAnchors.get(lk) || {};
    if (isFrom) cur.fromAnchor = { side, offset };
    else cur.toAnchor = { side, offset };
    this.edgeAnchors.set(lk, cur);
    this.markDirty();
  }

  // Hit-test waypoint handle or anchor handle near cursor
  vertexAt(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    const tol = Math.max(10, 14 / this.cam.scale);

    // 1) Test anchors and corners of active (selected or hovered) edge FIRST
    const activeKey = this.selectedEdgeKey || this.hoverEdge?.key;
    if (activeKey) {
      const seg = this._edgeSegForDrag(activeKey);
      if (seg) {
        if (Math.hypot(w.x - seg.p1.x, w.y - seg.p1.y) <= tol) {
          return { key: activeKey, isAnchor: true, isFrom: true, table: seg.fromTable, x: seg.p1.x, y: seg.p1.y };
        }
        if (Math.hypot(w.x - seg.p2.x, w.y - seg.p2.y) <= tol) {
          return { key: activeKey, isAnchor: true, isFrom: false, table: seg.toTable, x: seg.p2.x, y: seg.p2.y };
        }
        if (seg.isOrthogonal) {
          const orthoData = getOrthogonalSegments(seg.p1, seg.p2, seg.waypoints, seg.obstacles);
          for (let i = 1; i < orthoData.points.length - 1; i++) {
            const pt = orthoData.points[i];
            if (Math.hypot(w.x - pt.x, w.y - pt.y) <= tol) {
              return { key: activeKey, index: i - 1, x: pt.x, y: pt.y, isWaypoint: true, isOrthogonal: true };
            }
          }
        } else if (seg.waypoints && seg.waypoints.length) {
          for (let i = 0; i < seg.waypoints.length; i++) {
            const pt = seg.waypoints[i];
            if (Math.hypot(w.x - pt.x, w.y - pt.y) <= tol) {
              return { key: activeKey, index: i, x: pt.x, y: pt.y, isWaypoint: true, isOrthogonal: false };
            }
          }
        }
      }
    }

    // 2) Test waypoints / corners of other edges
    for (const [key, pts] of this.edgeWaypoints.entries()) {
      if (activeKey && key.toLowerCase() === activeKey.toLowerCase()) continue;
      const seg = this._edgeSegForDrag(key);
      const isOrthogonal = seg?.isOrthogonal;
      if (isOrthogonal && seg) {
        const orthoData = getOrthogonalSegments(seg.p1, seg.p2, seg.waypoints, seg.obstacles);
        for (let i = 1; i < orthoData.points.length - 1; i++) {
          const pt = orthoData.points[i];
          if (Math.hypot(w.x - pt.x, w.y - pt.y) <= tol) {
            return { key, index: i - 1, x: pt.x, y: pt.y, isWaypoint: true, isOrthogonal: true };
          }
        }
      } else {
        for (let i = 0; i < pts.length; i++) {
          const pt = pts[i];
          if (Math.hypot(w.x - pt.x, w.y - pt.y) <= tol) {
            return { key, index: i, x: pt.x, y: pt.y, isWaypoint: true, isOrthogonal };
          }
        }
      }
    }

    return null;
  }

  // Hit-test any edge (model relation or manual link) near the cursor
  edgeAt(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    const tol = Math.max(9, 14 / this.cam.scale);
    const byKey = this._tableMap();
    const edges = [];
    for (const r of this.model.relations) {
      edges.push({
        fk: r.fromTable.toLowerCase(),
        tk: r.toTable.toLowerCase(),
        fc: r.fromCols[0],
        tc: r.toCols[0],
        manual: false,
        fromTable: r.fromTable,
        toTable: r.toTable,
        fromCol: r.fromCols[0],
        toCol: r.toCols[0],
        key: `${r.fromTable.toLowerCase()}.${(r.fromCols[0] || '').toLowerCase()}->${r.toTable.toLowerCase()}.${(r.toCols[0] || '').toLowerCase()}`,
      });
    }
    for (const l of this.manualLinks) {
      edges.push({
        fk: l.from.table.toLowerCase(),
        tk: l.to.table.toLowerCase(),
        fc: l.from.col,
        tc: l.to.col,
        manual: true,
        link: l,
        fromTable: l.from.table,
        toTable: l.to.table,
        fromCol: l.from.col,
        toCol: l.to.col,
        key: `${l.from.table.toLowerCase()}.${(l.from.col || '').toLowerCase()}->${l.to.table.toLowerCase()}.${(l.to.col || '').toLowerCase()}`,
      });
    }

    let idx = 0;
    for (const e of edges) {
      const seg = this._edgeSeg(e.fk, e.fc, e.tk, e.tc, null, e.key);
      if (!seg) { idx++; continue; }
      const customColor = this.edgeColors.get(e.key);
      const autoColor = this.edgeColorMode === 'single' ? this.theme.edge : EDGE_COLORS[idx % EDGE_COLORS.length];
      const color = customColor || autoColor;
      const waypoints = seg.waypoints || [];
      idx++;

      const res = distanceToRoute(w.x, w.y, seg.routingStyle, seg.p1, seg.p2, waypoints);
      if (res.minDist <= tol) {
        return {
          ...e,
          color,
          customColor,
          isManual: e.manual,
          manualLink: e.link,
          p1: seg.p1,
          p2: seg.p2,
          waypoints,
          routingStyle: seg.routingStyle,
          isOrthogonal: seg.isOrthogonal,
          segmentIndex: res.segmentIndex,
          isVertical: res.isVertical,
          segMid: res.segMid,
          nearestPoint: res.nearestPoint,
          insertIndex: res.insertIndex,
        };
      }
    }
    return null;
  }

  // manual link whose curve passes near the point (for right-click delete)
  linkAt(sx, sy) {
    const hit = this.edgeAt(sx, sy);
    return (hit && hit.isManual) ? hit.manualLink : null;
  }

  removeManualLink(link) {
    const i = this.manualLinks.indexOf(link);
    if (i < 0) return;
    this.onHistorySnapshot?.(this.getSnapshot());
    this.manualLinks.splice(i, 1);
    this.markDirty();
    this.onLayoutChange?.();
  }

  clearManualLinks() {
    if (!this.manualLinks.length) return;
    this.onHistorySnapshot?.(this.getSnapshot());
    this.manualLinks = [];
    this.markDirty();
    this.onLayoutChange?.();
  }

  manualLinkCount() { return this.manualLinks.length; }

  // heuristic auto-linking by column name; returns count added
  inferLinks() {
    // Shared heuristic (see infer-links.js). It dedupes against model.relations
    // and our manual links, and returns new links in relation shape; adapt them
    // to the manual-link shape this diagram stores.
    const added = inferLinksCore(this.model, this.manualLinks).map(r => ({
      from: { table: r.fromTable, col: r.fromCols[0] },
      to: { table: r.toTable, col: r.toCols[0] },
    }));
    this.manualLinks.push(...added);
    if (added.length) { this.markDirty(); this.onLayoutChange?.(); }
    return added.length;
  }

  // edit whatever is under the point: annotation text, a table/column, else zoom in
  _editAt(sx, sy) {
    const t = this.tableAt(sx, sy);
    if (!t) {
      const anno = this._annoAt(sx, sy);
      if (anno) { this.selectedAnno = anno; this._beginEditAnnotation(anno); this.markDirty(); return; }
    }
    const target = this._editTargetAt(sx, sy);
    if (target) { this._beginEdit(target); return; }
    this._zoomAt(sx, sy, 1.6);
  }

  // What's under the cursor for editing: the table name (header), a column
  // name (left of a row) or a column type (right of a row).
  _editTargetAt(sx, sy) {
    if (!this.editable) return null;   // parse-only formats: no edit-back
    const t = this.tableAt(sx, sy);
    if (!t) return null;
    const w = this.screenToWorld(sx, sy);
    const ly = w.y - t.y;
    if (ly < HEADER_H) {
      return { table: t, kind: 'table', rect: { x: t.x, y: t.y, w: t.w, h: HEADER_H }, align: 'left', weight: 600 };
    }
    const visibleCols = getVisibleColumns(t, this.diagramLevel);
    const idx = Math.floor((ly - HEADER_H) / ROW_H);
    if (idx < 0 || idx >= visibleCols.length) return null;
    const col = visibleCols[idx];
    const rowY = t.y + HEADER_H + idx * ROW_H;
    const split = t.x + t.w * 0.58;
    if (this.diagramLevel !== 'conceptual' && w.x >= split && col.type) {
      return {
        table: t, kind: 'column-type', colName: col.name, value: col.typeRaw || col.type,
        rect: { x: split, y: rowY, w: t.x + t.w - split, h: ROW_H }, align: 'right', weight: 400
      };
    }
    return {
      table: t, kind: 'column-name', colName: col.name, value: col.name,
      rect: { x: t.x + 30, y: rowY, w: (this.diagramLevel === 'conceptual' ? t.w - 42 : split - (t.x + 30)), h: ROW_H }, align: 'left', weight: 400
    };
  }

  _beginEdit(target) {
    this._cancelEdit();
    const { rect } = target;
    const { cam } = this;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-edit';
    input.value = target.kind === 'table' ? target.table.name : (target.value ?? '');
    // position over the cell in screen pixels
    const sx = rect.x * cam.scale + cam.x;
    const sy = rect.y * cam.scale + cam.y;
    input.style.left = sx + 'px';
    input.style.top = sy + 'px';
    input.style.width = Math.max(40, rect.w * cam.scale) + 'px';
    input.style.height = rect.h * cam.scale + 'px';
    input.style.fontSize = Math.max(9, 13 * cam.scale) + 'px';
    input.style.textAlign = target.align;
    input.style.fontWeight = target.weight;

    const parent = this.canvas.parentElement;
    // dialect-aware type suggestions
    let datalist = null;
    if (target.kind === 'column-type' && this.typeSuggestions.length) {
      datalist = document.createElement('datalist');
      datalist.id = 'type-suggestions';
      for (const ty of this.typeSuggestions) {
        const opt = document.createElement('option');
        opt.value = ty;
        datalist.appendChild(opt);
      }
      parent.appendChild(datalist);
      input.setAttribute('list', 'type-suggestions');
    }
    parent.appendChild(input);
    input.focus();
    input.select();

    const commit = () => this._commitEdit();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); this._cancelEdit(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', commit);
    this.editing = { target, input, datalist };
  }

  _commitEdit() {
    if (!this.editing) return;
    const { target, input, datalist } = this.editing;
    const value = input.value.trim();
    this.editing = null;
    input.remove();
    datalist?.remove();
    const old = target.kind === 'table' ? target.table.name : target.value;
    if (value && value !== old && this.onEdit) {
      this.onEdit({ kind: target.kind, tableKey: target.table.key, colName: target.colName, value });
    }
  }

  _cancelEdit() {
    if (!this.editing) return;
    const { input, datalist } = this.editing;
    this.editing = null;
    input.remove();
    datalist?.remove();
  }

  _zoomAt(sx, sy, factor) {
    const newScale = clamp(this.cam.scale * factor, 0.08, 4);
    const k = newScale / this.cam.scale;
    this.cam.x = sx - (sx - this.cam.x) * k;
    this.cam.y = sy - (sy - this.cam.y) * k;
    this.cam.scale = newScale;
    this.markDirty();
    this.onZoom?.(newScale);
    this.onLayoutChange?.();
  }

  // restore a saved camera ({x, y, scale})
  setCamera(cam) {
    if (!cam) return;
    this.cam = { x: cam.x, y: cam.y, scale: cam.scale };
    this.markDirty();
    this.onZoom?.(cam.scale);
  }

  zoomBy(factor) {
    this._zoomAt(this.viewW / 2, this.viewH / 2, factor);
  }

  resetZoom() {
    this._zoomAt(this.viewW / 2, this.viewH / 2, 1 / this.cam.scale);
  }

  // fit all tables into view
  fit(padding = 60) {
    const ts = this.model.tables.filter(t => Number.isFinite(t.x));
    if (!ts.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of ts) {
      x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h);
    }
    const bw = x1 - x0, bh = y1 - y0;
    const scale = clamp(Math.min(
      (this.viewW - padding * 2) / bw,
      (this.viewH - padding * 2) / bh,
    ), 0.08, 1.5);
    this.cam.scale = scale;
    this.cam.x = (this.viewW - bw * scale) / 2 - x0 * scale;
    this.cam.y = (this.viewH - bh * scale) / 2 - y0 * scale;
    this.markDirty();
    this.onZoom?.(scale);
  }

  // ---- export ----
  bounds(padding = 40) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of this.model.tables) {
      if (!Number.isFinite(t.x) || this.hidden.has(t.key)) continue;
      x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h);
    }
    for (const a of this.annotations) {
      x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y);
      x1 = Math.max(x1, a.x + a.w); y1 = Math.max(y1, a.y + a.h);
    }
    if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
    return {
      x0: x0 - padding, y0: y0 - padding,
      x1: x1 + padding, y1: y1 + padding,
      w: x1 - x0 + padding * 2, h: y1 - y0 + padding * 2,
    };
  }

  exportPNG(scale = 2) {
    const b = this.bounds();
    if (b.w === 0) return null;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(b.w * scale);
    cv.height = Math.ceil(b.h * scale);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale, 0, 0, scale, -b.x0 * scale, -b.y0 * scale);

    // edges
    const saved = this.ctx;
    this.ctx = ctx;
    const savedCam = this.cam;
    this.cam = { x: 0, y: 0, scale: 1 };
    const all = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
    for (const a of this.annotations) if (a.type === 'group') this._drawGroup(a, all);
    this._drawEdges(-1e9, -1e9, 1e9, 1e9);
    for (const t of this.model.tables) {
      if (!Number.isFinite(t.x) || this.hidden.has(t.key)) continue;
      ctx.drawImage(this._bitmap(t), t.x, t.y, t.w, t.h);
    }
    for (const a of this.annotations) if (a.type === 'note') this._drawNote(a, all);
    this.ctx = saved;
    this.cam = savedCam;
    return cv.toDataURL('image/png');
  }
}

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Crow's-foot cardinality marker at a line endpoint on a table edge.
//   (x, y) = the point on the table edge
//   (nx, ny) = outward normal vector from the table edge (pointing along the line)
//   kind ∈ 'one' | 'many' | 'zero-or-one' | 'zero-or-many'. lw = line width.
//   `s` = world-units-per-screen-pixel (1/scale).
function drawMarker(ctx, x, y, nx, ny, kind, s, lw) {
  // Backward compatibility if called as (ctx, x, y, dir, kind, s, lw)
  if (typeof ny === 'string') {
    lw = s;
    s = kind;
    kind = ny;
    ny = 0;
    nx = nx < 0 ? -1 : 1;
  }

  const len = Math.hypot(nx, ny);
  const unx = len > 0.001 ? nx / len : 1;
  const uny = len > 0.001 ? ny / len : 0;

  // Perpendicular unit vector (-uny, unx) along table edge
  const px = -uny;
  const py = unx;

  const foot = 11 * s;     // distance from edge to crow's-foot apex / bar tick
  const spread = 5.5 * s;  // half-width of the foot / bar along the edge
  const r = 3.2 * s;       // optionality ("zero") ring radius
  const many = kind === 'many' || kind === 'zero-or-many';
  const optional = kind === 'zero-or-one' || kind === 'zero-or-many';

  ctx.lineWidth = lw;
  ctx.beginPath();
  if (many) {
    const ax = x + unx * foot;
    const ay = y + uny * foot;
    // three prongs connecting apex back to edge
    ctx.moveTo(ax, ay); ctx.lineTo(x + px * spread, y + py * spread);
    ctx.moveTo(ax, ay); ctx.lineTo(x - px * spread, y - py * spread);
    ctx.moveTo(ax, ay); ctx.lineTo(x, y);
  } else {
    // single bar ("one") perpendicular to line
    const bx = x + unx * foot;
    const by = y + uny * foot;
    ctx.moveTo(bx + px * spread, by + py * spread);
    ctx.lineTo(bx - px * spread, by - py * spread);
  }
  ctx.stroke();

  if (optional) {
    const cx = x + unx * (foot + r + 2 * s);
    const cy = y + uny * (foot + r + 2 * s);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// point-in-rect test for annotations ({x,y,w,h})
function inside(w, a) { return w.x >= a.x && w.x <= a.x + a.w && w.y >= a.y && w.y <= a.y + a.h; }

// #rrggbb -> rgba() with alpha
function hexA(hex, a) {
  if (!hex || typeof hex !== 'string') return `rgba(90,167,255,${a})`;
  if (hex.startsWith('rgba') || hex.startsWith('hsla')) return hex;
  if (hex.startsWith('rgb(')) return hex.replace('rgb(', 'rgba(').replace(')', `,${a})`);
  let s = hex.replace('#', '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  if (s.length === 6) {
    const n = parseInt(s, 16);
    if (!Number.isNaN(n)) return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return `rgba(90,167,255,${a})`;
}
// single-line truncate to width
function clip(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
// word-wrap (honours explicit newlines)
function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (para === '') { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (ctx.measureText(test).width > maxW && line) { out.push(line.trimEnd()); line = word.trimStart(); }
      else line = test;
    }
    if (line) out.push(line.trimEnd());
  }
  return out;
}
