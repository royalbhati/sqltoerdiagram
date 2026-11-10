// Diagram controller: owns the camera, input handling (pan / zoom / drag),
// the render loop, edge routing and export. Renders only when dirty and only
// what is on screen.
import { THEMES, rasterizeTable, columnY, measureTable, edgeGeometry, ROW_H, HEADER_H, SANS } from './renderer.js';
import { NOTE_COLORS, GROUP_COLORS, NOTE_ORDER, GROUP_ORDER, makeAnnotation } from './annotations.js';
import { relationCardinality } from './cardinality.js';
import { inferLinks as inferLinksCore } from './infer-links.js';
import { routeEdge, roundedPath, routeMidpoint, routeDistance, nearbyObstacles } from './edge-route.js';

export class Diagram {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cam = { x: 0, y: 0, scale: 1 };
    this.model = { tables: [], relations: [] };
    this.themeName = 'dark';
    this.theme = THEMES.dark;
    this.bitmaps = new Map();      // table.key -> offscreen canvas
    this.dirty = true;
    this.frameQueued = false;
    this.drag = null;              // active single-table drag
    this.dragGroup = null;         // active multi-table drag
    this.marquee = null;           // active rubber-band selection (world coords)
    this.selected = new Set();     // multi-selected tables (for group drag)
    this.hidden = new Set();       // keys of hidden tables (node + edges suppressed)
    this.onHiddenChange = null;    // fired when the hidden set changes
    this.onSelectionChange = null; // fired when the selected set changes
    this.manualLinks = [];         // user-drawn / inferred links {from:{table,col},to:{table,col}}
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
    this.selectedAnno = null;      // currently selected annotation
    this.annoDrag = null;          // annotation move
    this.annoResize = null;        // annotation resize
    this.tableColors = {};         // table.key -> colour name (header accent)
    this.onHoverInfo = null;       // callback({table, column|null, sx, sy} | null) for tooltips
    this._hiRows = [];             // column rows to tint: the ends of highlighted relations
    this.edgeStyle = 'angled';     // 'angled' (elbow lines that avoid tables) | 'curved'
    this._routes = new Map();      // cached angled routes, valid for one arrangement of tables
    this._routeSig = '';
    this.anim = null;              // active camera / table-position tween
    this.onFrame = null;           // fired after every render (minimap)
    this.reducedMotion = typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

    this._bindInput();
    this._loop = this._loop.bind(this);
  }

  setModel(model, { keepCamera = false } = {}) {
    this._finishAnim(true);        // settle any tween before the tables are replaced
    // preserve positions of tables that still exist (so live edits don't jump)
    const prev = new Map((this.model.tables || []).map(t => [t.key, t]));
    for (const t of model.tables) {
      // always size every table — layout() may be skipped on live edits, but
      // the renderer & fit need w/h regardless.
      const dims = measureTable(t);
      t.w = dims.w; t.h = dims.h; t.rowH = dims.rowH; t.headerH = dims.headerH;
      const old = prev.get(t.key);
      if (old && Number.isFinite(old.x)) { t.x = old.x; t.y = old.y; }
      t.color = this.tableColors[t.key] || null;
    }
    this.model = model;
    this.bitmaps.clear();
    this._tmapDirty = true;
    this.pinned = null;
    this.pinnedKeys = null;
    this.selected = new Set();
    this.dragGroup = null;
    this.marquee = null;
    this.linking = null;
    this.hoverConn = null;
    this.markDirty();
    if (!keepCamera) {/* caller may fit */}
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
    const idx = t.columns.findIndex(c => c.name === colName);
    if (idx < 0) return;
    const rowY = t.y + HEADER_H + idx * ROW_H;
    const split = t.x + t.w * 0.58;
    this._beginEdit({
      table: t, kind: 'column-name', colName, value: colName,
      rect: { x: t.x + 30, y: rowY, w: split - (t.x + 30), h: ROW_H },
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
    const w = Math.round(rect.width * this.dpr), h = Math.round(rect.height * this.dpr);
    if (w === this.canvas.width && h === this.canvas.height && this.viewW === rect.width) return;
    this.viewW = rect.width;
    this.viewH = rect.height;
    this.canvas.width = w;            // resizing clears the canvas…
    this.canvas.height = h;
    this.dirty = false;
    this._render();                   // …so repaint in the same frame (no blank flash)
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
      bm = rasterizeTable(t, this.theme, this.dpr);
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
        // a wide, soft shadow: the card floats instead of sitting in a dark box
        const lifted = this.drag?.t === t;
        ctx.shadowColor = theme.shadow;
        ctx.shadowBlur = (lifted ? 34 : 22) * cam.scale * dpr;
        ctx.shadowOffsetY = (lifted ? 14 : 8) * cam.scale * dpr;
      }
      ctx.drawImage(bm, t.x, t.y, t.w, t.h);
      ctx.restore();

      const strong = pinned === t || this.selected.has(t);
      const emphasised = strong || this.hover === t || this.drag?.t === t;
      if (emphasised) {
        // a crisp hairline ring, with a soft halo when the table is selected
        if (strong) {
          ctx.strokeStyle = hexA(theme.edgeHi, 0.22);
          ctx.lineWidth = 5 / cam.scale;
          roundRectPath(ctx, t.x - 1.5 / cam.scale, t.y - 1.5 / cam.scale, t.w + 3 / cam.scale, t.h + 3 / cam.scale, 10 + 1.5 / cam.scale);
          ctx.stroke();
        }
        ctx.strokeStyle = strong ? theme.edgeHi : hexA(theme.edgeHi, 0.7);
        ctx.lineWidth = 1.5 / cam.scale;
        roundRectPath(ctx, t.x, t.y, t.w, t.h, 10);
        ctx.stroke();
      }
    }

    // tint the column rows at both ends of each highlighted relation, so it is
    // obvious which columns a line actually joins
    if (this._hiRows.length && !this.drag && !this.dragGroup) {
      ctx.fillStyle = hexA(theme.edgeHi, 0.16);
      for (const r of this._hiRows) {
        if (r.y - r.t.y < HEADER_H) continue;             // unknown column -> header; skip
        ctx.fillRect(r.t.x + 1, r.y - ROW_H / 2, r.t.w - 2, ROW_H);
      }
    }

    // the column row under the cursor, so it is clear what a click / hover refers to
    if (this.hoverConn && !this.drag && !this.dragGroup && !this.pan && !this.linking) {
      const { t, colIndex } = this.hoverConn;
      if (Number.isFinite(t.x) && !this.hidden.has(t.key)) {
        ctx.fillStyle = hexA(theme.edgeHi, 0.09);
        ctx.fillRect(t.x + 1, t.y + HEADER_H + colIndex * ROW_H, t.w - 2, ROW_H);
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

    this.onFrame?.();
  }

  // ---- motion ----
  // One tween at a time drives the camera and/or table positions. Any direct
  // input (pointer, wheel, touch) settles it instantly, so motion never fights
  // the user. With prefers-reduced-motion everything snaps.
  //   cam:    target {x, y, scale} (optional)
  //   moves:  [{t, x0, y0, x1, y1}] table position changes (optional)
  _animate({ cam = null, moves = [], dur = 260, ease = easeOut } = {}) {
    this._finishAnim();
    const snap = dur <= 0 || this.reducedMotion.matches || (!cam && !moves.length);
    if (snap) {
      for (const m of moves) { m.t.x = m.x1; m.t.y = m.y1; }
      if (cam) { this.cam = { ...cam }; this.onZoom?.(cam.scale); }
      this.markDirty();
      return;
    }
    const from = { ...this.cam };
    for (const m of moves) { m.t.x = m.x0; m.t.y = m.y0; m.t._tx = m.x1; m.t._ty = m.y1; }
    const a = { cam, from, moves, dur, ease, t0: performance.now() };
    this.anim = a;
    const tick = (now) => {
      if (this.anim !== a) return;                       // superseded or settled
      const u = clamp((now - a.t0) / a.dur, 0, 1);
      if (u >= 1) { this._finishAnim(); return; }
      const e = a.ease(u);
      for (const m of a.moves) {
        m.t.x = m.x0 + (m.x1 - m.x0) * e;
        m.t.y = m.y0 + (m.y1 - m.y0) * e;
      }
      if (a.cam) {
        // interpolate the world point at the view centre + log-scale, so a
        // combined pan/zoom travels in a straight, evenly-paced line
        const cx0 = (this.viewW / 2 - a.from.x) / a.from.scale, cy0 = (this.viewH / 2 - a.from.y) / a.from.scale;
        const cx1 = (this.viewW / 2 - a.cam.x) / a.cam.scale, cy1 = (this.viewH / 2 - a.cam.y) / a.cam.scale;
        const scale = a.from.scale * Math.pow(a.cam.scale / a.from.scale, e);
        const cx = cx0 + (cx1 - cx0) * e, cy = cy0 + (cy1 - cy0) * e;
        this.cam = { x: this.viewW / 2 - cx * scale, y: this.viewH / 2 - cy * scale, scale };
        this.onZoom?.(scale);
      }
      this.markDirty();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // jump the active tween to its end state
  _finishAnim(silent = false) {
    const a = this.anim;
    if (!a) return;
    this.anim = null;
    for (const m of a.moves) { m.t.x = m.x1; m.t.y = m.y1; delete m.t._tx; delete m.t._ty; }
    if (a.cam) { this.cam = { ...a.cam }; this.onZoom?.(a.cam.scale); }
    this.markDirty();
    if (!silent) this.onLayoutChange?.();
  }

  // Where things will be once any running tween lands — what persistence and
  // undo history must record (never a mid-flight frame).
  settledPos(t) { return { x: t._tx ?? t.x, y: t._ty ?? t.y }; }
  settledCam() { return (this.anim && this.anim.cam) || this.cam; }

  // After a re-layout: glide tables from where they were (`from`: key -> {x,y})
  // to their new spots, and bring the result into view.
  transition(from, { fit = true, animate = true } = {}) {
    const moves = [];
    if (animate && from) {
      for (const t of this.model.tables) {
        const p = from.get(t.key);
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(t.x)) continue;
        if (p.x !== t.x || p.y !== t.y) moves.push({ t, x0: p.x, y0: p.y, x1: t.x, y1: t.y });
      }
    }
    const cam = fit ? this._fitCam() : null;
    this._animate({ cam, moves, dur: moves.length ? 420 : 0, ease: easeInOut });
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
    const { ctx, cam } = this;
    const color = GROUP_COLORS[a.color] || GROUP_COLORS.blue;
    ctx.save();
    roundRectPath(ctx, a.x, a.y, a.w, a.h, 12);
    ctx.fillStyle = hexA(color, 0.08);
    ctx.fill();
    ctx.strokeStyle = hexA(color, 0.7);
    ctx.lineWidth = 1.5 / cam.scale;
    ctx.stroke();
    // label in the header strip
    if (a.text) {
      ctx.fillStyle = color;
      ctx.font = `600 ${13 / cam.scale}px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const pad = 10 / cam.scale;
      ctx.fillText(clip(ctx, a.text, a.w - pad * 2), a.x + pad, a.y + 16 / cam.scale);
    }
    ctx.restore();
  }

  _drawNote(a, cull) {
    if (!this._annoVisible(a, cull)) return;
    const { ctx, cam } = this;
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
    ctx.font = `${13 / cam.scale}px ${SANS}`;
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
    this.markDirty();
  }

  addAnnotation(type) {
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
    const i = this.annotations.indexOf(this.selectedAnno);
    if (i >= 0) this.annotations.splice(i, 1);
    this.selectedAnno = null;
    this.markDirty();
    this.onLayoutChange?.();
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

  _groupAt(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    for (let i = this.annotations.length - 1; i >= 0; i--) {
      const a = this.annotations[i];
      if (a.type === 'group' && inside(w, a)) return a;
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
    this.annoDrag = { a, dx: w.x - a.x, dy: w.y - a.y, moved: false };
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
    ctx.font = `600 ${13 / cam.scale}px ${SANS}`;
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
    // A dot grid: enough texture to feel the canvas move, quiet enough to
    // stay behind the diagram. Dots thin out (every 2nd, 4th…) as you zoom
    // out so the density on screen stays roughly constant.
    let step = 24 * cam.scale * dpr;
    while (step < 16 * dpr) step *= 2;
    const W = this.canvas.width, H = this.canvas.height;
    const ox = ((cam.x * dpr) % step + step) % step;
    const oy = ((cam.y * dpr) % step + step) % step;
    const r = Math.max(1, Math.round(dpr));          // dot = r × r device pixels
    ctx.fillStyle = theme.grid;
    for (let x = ox; x < W; x += step) {
      const px = Math.round(x);
      for (let y = oy; y < H; y += step) ctx.fillRect(px, Math.round(y), r, r);
    }
  }

  // bezier segment between two table columns (or null if not drawable / off-screen)
  _edgeSeg(fromKey, fromCol, toKey, toCol, cull) {
    const byKey = this._tableMap();
    const from = byKey.get(fromKey), to = byKey.get(toKey);
    if (!from || !to || !Number.isFinite(from.x) || !Number.isFinite(to.x)) return null;
    if (this.hidden.has(from.key) || this.hidden.has(to.key)) return null;
    const fy = from.y + columnY(from, fromCol);
    const ty = to.y + columnY(to, toCol);
    const { fx, tx, c1x, c2x } = edgeGeometry(from, to, fy, ty);
    const pts = this.edgeStyle === 'angled' ? this._route(from, to, fromCol, toCol, fy, ty) : null;
    if (cull && pts) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
      if (maxX < cull.x0 || minX > cull.x1 || maxY < cull.y0 || minY > cull.y1) return null;
    } else if (cull) {
      const minX = Math.min(fx, tx, c1x, c2x), maxX = Math.max(fx, tx, c1x, c2x);
      const minY = Math.min(fy, ty), maxY = Math.max(fy, ty);
      if (maxX < cull.x0 || minX > cull.x1 || maxY < cull.y0 || minY > cull.y1) return null;
    }
    return {
      fx, fy, tx, ty, c1x, c2x, fromKey, toKey, pts,
      // the two column rows this relation joins (tinted when it is highlighted)
      rows: [{ t: from, y: fy }, { t: to, y: ty }],
    };
  }

  // An angled route for one relation, cached until any table moves. Beyond a
  // few hundred tables the lines stop steering around others (still angled),
  // which keeps every frame cheap.
  _route(from, to, fromCol, toCol, fy, ty) {
    const tables = this.model.tables;
    let sig = this.hidden.size + ':' + tables.length;
    for (const t of tables) sig += '|' + t.x + ',' + t.y + ',' + t.h;
    if (sig !== this._routeSig) { this._routeSig = sig; this._routes.clear(); }
    const key = from.key + '\u0000' + fromCol + '\u0000' + to.key + '\u0000' + toCol;
    let pts = this._routes.get(key);
    if (!pts) {
      const obstacles = tables.length <= 200 ? nearbyObstacles(from, to, tables, (k) => this.hidden.has(k)) : [];
      pts = routeEdge(from, to, fy, ty, obstacles);
      this._routes.set(key, pts);
    }
    return pts;
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
    for (const r of this.model.relations) edges.push({ fk: r.fromTable.toLowerCase(), tk: r.toTable.toLowerCase(), fc: r.fromCols[0], tc: r.toCols[0], manual: false, card: relationCardinality(r, byKey) });
    for (const l of this.manualLinks) edges.push({ fk: l.from.table, tk: l.to.table, fc: l.from.col, tc: l.to.col, manual: true, card: null });

    for (const e of edges) {
      const seg = this._edgeSeg(e.fk, e.fc, e.tk, e.tc, cull);
      if (!seg) continue;
      seg.manual = e.manual;
      seg.card = e.card;
      const connected = focusKey && (seg.fromKey === focusKey || seg.toKey === focusKey);
      if (focusKey) {
        if (connected) { highlighted.push(seg); continue; }
        this._stroke(seg, theme.edge, 1.2, fadeAlpha, e.manual);
      } else {
        this._stroke(seg, theme.edge, 1.4, 0.85, e.manual);
      }
    }
    this._hiRows = focusKey ? highlighted.map(seg => seg.rows).flat() : [];
    for (const seg of highlighted) this._stroke(seg, theme.edgeHi, 1.9, 1, seg.manual);
    for (const seg of highlighted) this._drawEdgeLabel(seg);   // words, on top of the lines
  }

  _stroke(seg, color, width, alpha, dashed) {
    const { ctx, cam } = this;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width / cam.scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dashed) ctx.setLineDash([6 / cam.scale, 5 / cam.scale]);
    ctx.beginPath();
    let fdir, tdir;                    // which way the line leaves each table
    if (seg.pts) {
      for (const c of roundedPath(seg.pts, 9)) {
        if (c[0] === 'M') ctx.moveTo(c[1], c[2]);
        else if (c[0] === 'L') ctx.lineTo(c[1], c[2]);
        else ctx.quadraticCurveTo(c[1], c[2], c[3], c[4]);
      }
      const n = seg.pts.length;
      fdir = Math.sign(seg.pts[1][0] - seg.pts[0][0]) || 1;
      tdir = Math.sign(seg.pts[n - 2][0] - seg.pts[n - 1][0]) || 1;
    } else {
      ctx.moveTo(seg.fx, seg.fy);
      ctx.bezierCurveTo(seg.c1x, seg.fy, seg.c2x, seg.ty, seg.tx, seg.ty);
      fdir = Math.sign(seg.c1x - seg.fx) || 1;
      tdir = Math.sign(seg.c2x - seg.tx) || 1;
    }
    ctx.stroke();
    if (dashed) ctx.setLineDash([]);
    if (seg.card) {
      // markers sit just outside each table, pointing along the line
      const s = 1 / cam.scale;
      const mw = Math.max(width, 1.3) / cam.scale;
      drawMarker(ctx, seg.fx, seg.fy, fdir, seg.card.from, s, mw);
      drawMarker(ctx, seg.tx, seg.ty, tdir, seg.card.to, s, mw);
    } else {
      dot(ctx, seg.fx, seg.fy, 3 / cam.scale);
      dot(ctx, seg.tx, seg.ty, 3 / cam.scale);
    }
    ctx.globalAlpha = 1;
  }

  // A small "one-to-many" pill at a highlighted edge's midpoint.
  _drawEdgeLabel(seg) {
    if (!seg.card || !seg.card.label) return;
    const { ctx, cam } = this;
    const s = 1 / cam.scale;
    let mx = (seg.fx + 3 * seg.c1x + 3 * seg.c2x + seg.tx) / 8;
    let my = (seg.fy + seg.ty) / 2;
    if (seg.pts) [mx, my] = routeMidpoint(seg.pts);
    ctx.save();
    ctx.font = `${11 * s}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = seg.card.label;
    const w = ctx.measureText(text).width + 10 * s;
    const h = 16 * s;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = this.theme.tableBg;
    roundRectPath(ctx, mx - w / 2, my - h / 2, w, h, 5 * s);
    ctx.fill();
    ctx.strokeStyle = this.theme.edgeHi;
    ctx.lineWidth = 1 * s;
    ctx.stroke();
    ctx.fillStyle = this.theme.edgeHi;
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

    c.addEventListener('mouseleave', () => { this._hoverKey = null; this.onHoverInfo?.(null); });
    c.addEventListener('mousedown', (e) => {
      this._hoverKey = null; this.onHoverInfo?.(null);
      if (e.button !== 0) return;   // ignore right/middle click (right-click = context menu)
      const r = c.getBoundingClientRect();
      this._pointerDown(e.clientX - r.left, e.clientY - r.top, e.shiftKey);
      c.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (this._pointerMove(sx, sy)) return;   // active drag/pan handled it
      // idle hover (mouse only)
      const t = this.tableAt(sx, sy);
      if (t !== this.hover) { this.hover = t; this.markDirty(); }
      // connector dots on the hovered column row
      let conn = null;
      if (t) {
        const w = this.screenToWorld(sx, sy);
        const idx = Math.floor((w.y - t.y - HEADER_H) / ROW_H);
        if (idx >= 0 && idx < t.columns.length) conn = { t, colIndex: idx };
      }
      const changed = (conn?.t !== this.hoverConn?.t) || (conn?.colIndex !== this.hoverConn?.colIndex);
      if (changed) { this.hoverConn = conn; this.markDirty(); }
      // tooltip target: a column row, or the table header
      const over = e.target === c && t ? `${t.key}:${conn ? conn.colIndex : 'h'}` : null;
      if (over !== this._hoverKey) {
        this._hoverKey = over;
        this.onHoverInfo?.(over ? { table: t, column: conn ? t.columns[conn.colIndex] : null, sx, sy } : null);
      }
      if (this._connectorAt(sx, sy)) c.style.cursor = 'crosshair';
      else if (this._annoChromeAt(sx, sy) || this._addButtonAt(sx, sy)) c.style.cursor = 'pointer';
      else if (t) c.style.cursor = 'grab';
      else if (this._noteAt(sx, sy) || this._groupAt(sx, sy)) c.style.cursor = 'grab';
      else c.style.cursor = 'default';
    });

    window.addEventListener('mouseup', () => {
      this._pointerUp();
      c.style.cursor = this.hover ? 'grab' : 'default';
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
        this._finishAnim();
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
      this._finishAnim();
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      // ctrl/cmd or pinch => zoom; otherwise treat as zoom too (diagram tool)
      const factor = Math.exp(-e.deltaY * 0.0015);
      this._zoomAt(sx, sy, factor);
    }, { passive: false });

    // double-click: edit annotation text, else a table/column, else zoom in
    c.addEventListener('dblclick', (e) => {
      const r = c.getBoundingClientRect();
      this._editAt(e.clientX - r.left, e.clientY - r.top);
    });
  }

  // ---- shared pointer logic (used by both mouse and touch) ----
  // `additive` (Shift) drives multi-select: Shift+click toggles a table,
  // Shift+drag on empty draws a marquee box.
  _pointerDown(sx, sy, additive = false, allowConnect = true) {
    this._finishAnim();
    // 1) chrome of the selected annotation (colour dots / delete / resize)
    const chrome = this._annoChromeAt(sx, sy);
    if (chrome) {
      const a = this.selectedAnno;
      if (chrome.kind === 'color') { a.color = chrome.value; this.markDirty(); this.onLayoutChange?.(); }
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
      if (additive) {                                   // Shift+click toggles selection
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
      if (this.selected.has(t) && this.selected.size > 1) {
        // drag the whole current selection together
        const items = [...this.selected].filter(x => Number.isFinite(x.x))
          .map(x => ({ t: x, sx0: x.x, sy0: x.y }));
        this.dragGroup = { items, ax: w.x, ay: w.y, moved: false };
      } else {
        this.selected = new Set([t]);
        this.drag = { t, dx: w.x - t.x, dy: w.y - t.y, moved: false };
        this.onSelectionChange?.();
      }
      this.markDirty();
      return;
    }
    // 5) a group box (grabbable anywhere that isn't a table)
    const group = this._groupAt(sx, sy);
    if (group) { this._grabAnno(group, sx, sy); return; }
    // 6) empty space -> Shift+drag marquee-selects; otherwise pan
    if (this.selectedAnno) { this.selectedAnno = null; this.markDirty(); }
    const w = this.screenToWorld(sx, sy);
    if (additive) {
      this.marquee = { ax: w.x, ay: w.y, x: w.x, y: w.y };
    } else {
      this.pan = { sx, sy, camx: this.cam.x, camy: this.cam.y, moved: false };
    }
  }

  _columnAtWorld(wx, wy) {
    for (let i = this.model.tables.length - 1; i >= 0; i--) {
      const t = this.model.tables[i];
      if (!Number.isFinite(t.x) || this.hidden.has(t.key)) continue;
      if (wx >= t.x && wx <= t.x + t.w && wy >= t.y && wy <= t.y + t.h) {
        const idx = Math.floor((wy - t.y - HEADER_H) / ROW_H);
        if (idx >= 0 && idx < t.columns.length) return { tableKey: t.key, col: t.columns[idx].name };
        return null;
      }
    }
    return null;
  }

  // returns true if an active drag/pan/resize consumed the move
  _pointerMove(sx, sy) {
    if (this.linking) {
      const w = this.screenToWorld(sx, sy);
      this.linking.cx = w.x; this.linking.cy = w.y;
      this.markDirty();
      return true;
    }
    if (this.dragGroup) {
      const w = this.screenToWorld(sx, sy);
      const dx = w.x - this.dragGroup.ax, dy = w.y - this.dragGroup.ay;
      for (const it of this.dragGroup.items) { it.t.x = it.sx0 + dx; it.t.y = it.sy0 + dy; }
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
      this.annoDrag.a.x = w.x - this.annoDrag.dx;
      this.annoDrag.a.y = w.y - this.annoDrag.dy;
      this.annoDrag.moved = true;
      this.markDirty();
      return true;
    }
    if (this.drag) {
      const w = this.screenToWorld(sx, sy);
      this.drag.t.x = w.x - this.drag.dx;
      this.drag.t.y = w.y - this.drag.dy;
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
    // finishing a link drag -> create the link if dropped on a column
    if (this.linking) {
      const k = this.linking;
      this.linking = null;
      const tgt = this._columnAtWorld(k.cx, k.cy);
      if (tgt) this.addManualLink(k.fromKey, k.fromCol, tgt.tableKey, tgt.col);
      this.markDirty();
      return;
    }
    // marquee end -> select tables intersecting the box (union with current)
    if (this.marquee) {
      const m = this.marquee;
      const x0 = Math.min(m.ax, m.x), x1 = Math.max(m.ax, m.x);
      const y0 = Math.min(m.ay, m.y), y1 = Math.max(m.ay, m.y);
      if (x1 - x0 > 2 || y1 - y0 > 2) {
        for (const t of this.model.tables) {
          if (Number.isFinite(t.x) && t.x < x1 && t.x + t.w > x0 && t.y < y1 && t.y + t.h > y0) {
            this.selected.add(t);
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
      if (this.dragGroup.moved) this.onLayoutChange?.();
      this.dragGroup = null;
      return;
    }
    // a click (no drag) on a table pins focus; a click on empty space clears it
    if (this.drag && !this.drag.moved) this._pin(this.drag.t);
    else if (this.pan && !this.pan.moved) {
      if (this.selected.size) { this.selected = new Set(); this.markDirty(); this.onSelectionChange?.(); }
      if (this.pinned) this._pin(this.pinned);
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
    if (this.selected.size) { this.selected = new Set(); this.markDirty(); this.onSelectionChange?.(); }
  }

  // ---- hide / show tables ----
  // Hide a table; if it's part of a multi-selection, hide the whole selection.
  hideTable(t) {
    let keys;
    if (t && this.selected.has(t) && this.selected.size > 1) keys = [...this.selected].map(x => x.key);
    else if (t) keys = [t.key];
    else keys = [...this.selected].map(x => x.key);
    if (!keys.length) return;
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
    this.hidden = new Set();
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
  // `minScale` zooms in when the view is too far out to read the table.
  centerOn(key, { minScale = 0 } = {}) {
    const t = this.model.tables.find(x => x.key === key);
    if (!t) return;
    this._finishAnim();
    if (!Number.isFinite(t.x)) return;
    if (this.hidden.has(key)) this.setTableHidden(key, false);
    const s = Math.max(this.cam.scale, minScale);
    this._setPin(t);
    this._animate({
      cam: { x: this.viewW / 2 - (t.x + t.w / 2) * s, y: this.viewH / 2 - (t.y + t.h / 2) * s, scale: s },
      dur: 380, ease: easeInOut,
    });
  }

  // centre the view on a world point (minimap drag) — immediate, no tween
  panTo(wx, wy) {
    this._finishAnim();
    this.cam.x = this.viewW / 2 - wx * this.cam.scale;
    this.cam.y = this.viewH / 2 - wy * this.cam.scale;
    this.markDirty();
    this.onLayoutChange?.();
  }

  setEdgeStyle(style) {
    this.edgeStyle = style === 'curved' ? 'curved' : 'angled';
    this._routes.clear(); this._routeSig = '';
    this.markDirty();
  }

  // ---- table colours ----
  setTableColors(map) {
    this.tableColors = map && typeof map === 'object' ? { ...map } : {};
    for (const t of this.model.tables) t.color = this.tableColors[t.key] || null;
    this.bitmaps.clear();
    this.markDirty();
  }

  // colour one table, or the whole selection if it is part of one; null clears
  setTableColor(t, color) {
    const targets = this.selected.has(t) && this.selected.size > 1 ? [...this.selected] : [t];
    for (const x of targets) {
      if (color) this.tableColors[x.key] = color; else delete this.tableColors[x.key];
      x.color = color || null;
      this.bitmaps.delete(x.key);
    }
    this.markDirty();
    this.onLayoutChange?.();
  }

  // re-measure and re-rasterise every table (after web fonts finish loading)
  refreshMetrics() {
    for (const t of this.model.tables) {
      const dims = measureTable(t);
      t.w = dims.w; t.h = dims.h;
    }
    this.bitmaps.clear();
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
      if (idx < 0 || idx >= t.columns.length) continue;
      for (const p of this._connDots(t, idx)) {
        if (Math.hypot(w.x - p.x, w.y - p.y) <= r * 1.5) {
          return { tableKey: t.key, col: t.columns[idx].name, side: p.side, wx: p.x, wy: p.y };
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
    const idx = Math.floor((w.y - t.y - HEADER_H) / ROW_H);
    if (idx < 0 || idx >= t.columns.length) return null;
    return { tableKey: t.key, col: t.columns[idx].name };
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
    this.manualLinks.push({ from: { table: fk, col: fc }, to: { table: tk, col: tc } });
    this.markDirty();
    this.onLayoutChange?.();
    return true;
  }

  setManualLinks(arr) {
    this.manualLinks = Array.isArray(arr) ? arr.filter(l => l && l.from && l.to) : [];
    this.markDirty();
  }

  // manual link whose curve passes near the point (for right-click delete)
  linkAt(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    const tol = 7 / this.cam.scale;
    for (const l of this.manualLinks) {
      const seg = this._edgeSeg(l.from.table, l.from.col, l.to.table, l.to.col, null);
      if (!seg) continue;
      if (seg.pts) { if (routeDistance(seg.pts, w.x, w.y) <= tol) return l; continue; }
      // sample the bezier
      for (let i = 0; i <= 16; i++) {
        const u = i / 16, iu = 1 - u;
        const bx = iu * iu * iu * seg.fx + 3 * iu * iu * u * seg.c1x + 3 * iu * u * u * seg.c2x + u * u * u * seg.tx;
        const by = iu * iu * iu * seg.fy + 3 * iu * iu * u * seg.fy + 3 * iu * u * u * seg.ty + u * u * u * seg.ty;
        if (Math.hypot(w.x - bx, w.y - by) <= tol) return l;
      }
    }
    return null;
  }

  removeManualLink(link) {
    const i = this.manualLinks.indexOf(link);
    if (i < 0) return;
    this.manualLinks.splice(i, 1);
    this.markDirty();
    this.onLayoutChange?.();
  }

  clearManualLinks() {
    if (!this.manualLinks.length) return;
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
    const idx = Math.floor((ly - HEADER_H) / ROW_H);
    if (idx < 0 || idx >= t.columns.length) return null;
    const col = t.columns[idx];
    const rowY = t.y + HEADER_H + idx * ROW_H;
    const split = t.x + t.w * 0.58;
    if (w.x >= split && col.type) {
      return { table: t, kind: 'column-type', colName: col.name, value: col.typeRaw || col.type,
               rect: { x: split, y: rowY, w: t.x + t.w - split, h: ROW_H }, align: 'right', weight: 400 };
    }
    return { table: t, kind: 'column-name', colName: col.name, value: col.name,
             rect: { x: t.x + 30, y: rowY, w: split - (t.x + 30), h: ROW_H }, align: 'left', weight: 400 };
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
    this._finishAnim(true);
    this.cam = { x: cam.x, y: cam.y, scale: cam.scale };
    this.markDirty();
    this.onZoom?.(cam.scale);
  }

  // button / keyboard zoom: a short tween around the view centre
  zoomBy(factor) {
    const base = this.settledCam();
    const scale = clamp(base.scale * factor, 0.08, 4);
    const k = scale / base.scale;
    const cx = this.viewW / 2, cy = this.viewH / 2;
    this._animate({ cam: { x: cx - (cx - base.x) * k, y: cy - (cy - base.y) * k, scale }, dur: 180 });
  }

  resetZoom() {
    this.zoomBy(1 / this.settledCam().scale);
  }

  // camera that frames every visible table (using settled positions), or null
  _fitCam(padding = 60) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of this.model.tables) {
      if (this.hidden.has(t.key)) continue;
      const p = this.settledPos(t);
      if (!Number.isFinite(p.x)) continue;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + t.w); y1 = Math.max(y1, p.y + t.h);
    }
    if (!Number.isFinite(x0)) return null;
    const bw = x1 - x0, bh = y1 - y0;
    const scale = clamp(Math.min(
      (this.viewW - padding * 2) / bw,
      (this.viewH - padding * 2) / bh,
    ), 0.08, 1.5);
    return {
      x: (this.viewW - bw * scale) / 2 - x0 * scale,
      y: (this.viewH - bh * scale) / 2 - y0 * scale,
      scale,
    };
  }

  // fit all visible tables into view
  fit(padding = 60, { animate = false } = {}) {
    const cam = this._fitCam(padding);
    if (!cam) return;
    this._animate({ cam, dur: animate ? 320 : 0, ease: easeInOut });
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

  // Render the whole diagram to an offscreen canvas (null when empty).
  // `transparent` skips the background so the image drops cleanly into docs
  // and slides. The scale is reduced if needed to stay inside browser canvas
  // limits, so huge schemas export smaller instead of failing blank.
  renderExport(scale = 2, { transparent = false } = {}) {
    this._finishAnim();
    const b = this.bounds();
    if (b.w === 0) return null;
    const MAX_SIDE = 16384, MAX_AREA = 120e6;
    scale = Math.min(scale, MAX_SIDE / b.w, MAX_SIDE / b.h, Math.sqrt(MAX_AREA / (b.w * b.h)));
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(b.w * scale);
    cv.height = Math.ceil(b.h * scale);
    const ctx = cv.getContext('2d');
    if (!transparent) {
      ctx.fillStyle = this.theme.bg;
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
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
    return cv;
  }

  // PNG as a Blob (null when the diagram is empty)
  exportPNGBlob(scale = 2, opts) {
    const cv = this.renderExport(scale, opts);
    if (!cv) return Promise.resolve(null);
    return new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
  }

  exportPNG(scale = 2, opts) {
    const cv = this.renderExport(scale, opts);
    return cv ? cv.toDataURL('image/png') : null;
  }
}

const easeOut = (u) => 1 - Math.pow(1 - u, 3);
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Crow's-foot cardinality marker at a line endpoint on a table edge.
//   (x,y) = the point on the table edge; dir = +1 if the line extends in +x
//   from here, -1 if -x. `s` = world-units-per-screen-pixel (1/scale).
//   kind ∈ 'one' | 'many' | 'zero-or-one' | 'zero-or-many'. lw = line width.
function drawMarker(ctx, x, y, dir, kind, s, lw) {
  const foot = 9 * s;      // distance from edge to crow's-foot apex / bar tick
  const spread = 4.5 * s;  // half-height of the foot / bar
  const r = 2.8 * s;       // optionality ("zero") ring radius
  const many = kind === 'many' || kind === 'zero-or-many';
  const optional = kind === 'zero-or-one' || kind === 'zero-or-many';
  ctx.lineWidth = lw;
  ctx.beginPath();
  if (many) {
    const ax = x + dir * foot;                       // apex out along the line
    ctx.moveTo(ax, y); ctx.lineTo(x, y - spread);    // three prongs back to edge
    ctx.moveTo(ax, y); ctx.lineTo(x, y + spread);
    ctx.moveTo(ax, y); ctx.lineTo(x, y);
  } else {
    const bx = x + dir * foot;                        // single bar ("one")
    ctx.moveTo(bx, y - spread); ctx.lineTo(bx, y + spread);
  }
  ctx.stroke();
  if (optional) {
    const cx = x + dir * (foot + r + 2 * s);          // hollow "zero" ring, outermost
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
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
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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
