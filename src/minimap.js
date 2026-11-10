// Minimap: a small overview of the whole diagram with the current viewport
// outlined. Click or drag on it to move the camera. It redraws from the
// diagram's own render hook, so it costs one extra pass of plain rects.
import { THEMES } from './renderer.js';

const W = 188, H = 124, PAD = 8;

export function createMinimap(diagram, mount) {
  const el = document.createElement('canvas');
  el.className = 'minimap';
  el.setAttribute('aria-label', 'Diagram overview — click or drag to move around');
  el.setAttribute('role', 'img');
  el.hidden = true;
  mount.appendChild(el);
  const ctx = el.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  el.width = W * dpr; el.height = H * dpr;

  let enabled = true;
  let dragging = false;
  let map = null;   // { x0, y0, k, ox, oy } world -> minimap transform of the last draw

  function draw() {
    const tables = diagram.model.tables.filter(t => Number.isFinite(t.x) && !diagram.hidden.has(t.key));
    // world bounds of the content
    const cam = diagram.cam;
    const vx0 = -cam.x / cam.scale, vy0 = -cam.y / cam.scale;
    const vw = diagram.viewW / cam.scale, vh = diagram.viewH / cam.scale;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tables) {
      x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h);
    }
    for (const a of diagram.annotations) {
      x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y);
      x1 = Math.max(x1, a.x + a.w); y1 = Math.max(y1, a.y + a.h);
    }
    // An overview only helps when part of the diagram is off-screen; when it
    // all fits, the map would just repeat the canvas, so it steps aside.
    const allVisible = x0 >= vx0 && y0 >= vy0 && x1 <= vx0 + vw && y1 <= vy0 + vh;
    const show = enabled && tables.length > 0 && (!allVisible || dragging);
    if (el.hidden === show) el.hidden = !show;
    if (!show) return;
    // include the viewport, so the view box is always on the map
    x0 = Math.min(x0, vx0); y0 = Math.min(y0, vy0);
    x1 = Math.max(x1, vx0 + vw); y1 = Math.max(y1, vy0 + vh);
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    const k = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);
    const ox = (W - bw * k) / 2, oy = (H - bh * k) / 2;
    map = { x0, y0, k, ox, oy };
    const X = (wx) => ox + (wx - x0) * k, Y = (wy) => oy + (wy - y0) * k;

    const theme = diagram.theme || THEMES.dark;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const focusKeys = diagram.pinnedKeys;
    for (const t of tables) {
      const w = Math.max(2, t.w * k), h = Math.max(2, t.h * k);
      const hot = diagram.pinned === t || diagram.selected.has(t);
      ctx.globalAlpha = focusKeys && !focusKeys.has(t.key) ? 0.35 : 1;
      ctx.fillStyle = hot ? theme.edgeHi : theme.edge;
      ctx.fillRect(X(t.x), Y(t.y), w, h);
    }
    ctx.globalAlpha = 1;

    // viewport box
    const rx = X(vx0), ry = Y(vy0), rw = vw * k, rh = vh * k;
    ctx.fillStyle = hexA(theme.edgeHi, 0.12);
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = theme.edgeHi;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx + 0.75, ry + 0.75, Math.max(0, rw - 1.5), Math.max(0, rh - 1.5));
  }

  // pointer -> move the camera so the pressed point is at the view centre
  function moveTo(e) {
    if (!map) return;
    const r = el.getBoundingClientRect();
    const mx = (e.clientX - r.left) * (W / r.width), my = (e.clientY - r.top) * (H / r.height);
    diagram.panTo(map.x0 + (mx - map.ox) / map.k, map.y0 + (my - map.oy) / map.k);
  }
  let frozen = null;   // keep the map's transform fixed while dragging so it doesn't slide under the pointer
  el.addEventListener('pointerdown', (e) => {
    dragging = true; frozen = map;
    el.setPointerCapture(e.pointerId);
    moveTo(e);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    map = frozen;
    moveTo(e);
  });
  const end = () => { dragging = false; frozen = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  return {
    draw,
    get enabled() { return enabled; },
    setEnabled(on) { enabled = !!on; draw(); },
  };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
