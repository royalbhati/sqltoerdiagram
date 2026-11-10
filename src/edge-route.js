// Angled ("elbow") relation lines that go AROUND tables instead of behind them.
// Each line leaves and enters horizontally, runs in straight segments with
// rounded corners, and picks the candidate route that crosses the fewest
// other tables. Pure geometry — shared by the canvas and the SVG export.

const STUB = 20;        // straight run out of a table (room for the crow's foot)
const PAD = 8;          // clearance kept around other tables
const GAP = 2 * STUB;   // room a facing connection needs between two tables

// Which side of each table a relation uses. Facing sides when there is room
// between the tables; otherwise both leave from the same side and loop.
//   -> { fx, tx, fdir, tdir }  (dir: +1 = leaves to the right, -1 = to the left)
export function edgeSides(from, to) {
  const fl = from.x, fr = from.x + from.w, tl = to.x, tr = to.x + to.w;
  if (tl - fr >= GAP) return { fx: fr, tx: tl, fdir: 1, tdir: -1 };
  if (fl - tr >= GAP) return { fx: fl, tx: tr, fdir: -1, tdir: 1 };
  if (Math.abs(fr - tr) <= Math.abs(fl - tl)) return { fx: fr, tx: tr, fdir: 1, tdir: 1 };
  return { fx: fl, tx: tl, fdir: -1, tdir: -1 };
}

// does the axis-aligned segment a-b pass through rect r (grown by PAD)?
function hits(ax, ay, bx, by, r) {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  return x1 > r.x - PAD && x0 < r.x + r.w + PAD && y1 > r.y - PAD && y0 < r.y + r.h + PAD;
}

function cost(pts, obstacles) {
  let c = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    c += Math.abs(bx - ax) + Math.abs(by - ay);
    for (const o of obstacles) if (hits(ax, ay, bx, by, o)) c += 10000;
  }
  return c + pts.length * 24;          // fewer bends wins ties
}

// drop repeated points and the middle of any straight run
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const a = out[out.length - 1];
    if (a && a[0] === p[0] && a[1] === p[1]) continue;
    const b = out[out.length - 2];
    if (b && ((b[0] === a[0] && a[0] === p[0]) || (b[1] === a[1] && a[1] === p[1]))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

// Route one relation. `from`/`to`: tables {x, y, w, h}; fy/ty: the y of the two
// column rows; `obstacles`: the other tables nearby. Returns [[x, y], …].
export function routeEdge(from, to, fy, ty, obstacles = []) {
  const { fx, tx, fdir, tdir } = edgeSides(from, to);
  const a = [fx, fy], b = [tx, ty];
  const ax = fx + fdir * STUB, bx = tx + tdir * STUB;       // ends of the two stubs
  const cands = [];

  if (fdir !== tdir) {
    // facing sides: one vertical run somewhere in the gap between the tables
    const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
    const xs = new Set([(ax + bx) / 2, ax, bx]);
    for (const o of obstacles) {                             // squeeze past things in the gap
      for (const x of [o.x - PAD - 6, o.x + o.w + PAD + 6]) if (x > lo && x < hi) xs.add(x);
    }
    for (const x of xs) cands.push([a, [x, fy], [x, ty], b]);
  } else {
    // same side: loop out past whichever table sticks out further
    const x = fdir > 0 ? Math.max(ax, bx) : Math.min(ax, bx);
    cands.push([a, [x, fy], [x, ty], b]);
    for (const o of obstacles) {
      const ox = fdir > 0 ? o.x + o.w + PAD + 6 : o.x - PAD - 6;
      if (fdir > 0 ? ox > x : ox < x) cands.push([a, [ox, fy], [ox, ty], b]);
    }
  }

  let best = null, bestCost = Infinity;
  const consider = (pts) => { const c = cost(pts, obstacles); if (c < bestCost) { best = pts; bestCost = c; } };
  cands.forEach(consider);

  if (bestCost >= 10000 && obstacles.length) {
    // still crossing a table: detour over or under, along a clear horizontal lane
    const ys = new Set();
    for (const o of [...obstacles, from, to]) { ys.add(o.y - PAD - 8); ys.add(o.y + o.h + PAD + 8); }
    for (const y of ys) consider([a, [ax, fy], [ax, y], [bx, y], [bx, ty], b]);
  }
  return simplify(best);
}

// The route as drawing commands with corners rounded to radius r:
//   [['M', x, y], ['L', x, y], ['Q', cx, cy, x, y], …]
export function roundedPath(pts, r = 8) {
  const cmds = [['M', pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
    const inLen = Math.abs(cx - px) + Math.abs(cy - py), outLen = Math.abs(nx - cx) + Math.abs(ny - cy);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const sx = cx - Math.sign(cx - px) * rr, sy = cy - Math.sign(cy - py) * rr;     // where the corner starts
    const ex = cx + Math.sign(nx - cx) * rr, ey = cy + Math.sign(ny - cy) * rr;     // …and ends
    cmds.push(['L', sx, sy], ['Q', cx, cy, ex, ey]);
  }
  const last = pts[pts.length - 1];
  cmds.push(['L', last[0], last[1]]);
  return cmds;
}

export function pathToSVG(cmds) {
  return cmds.map((c) => c[0] + ' ' + c.slice(1).map((n) => +n.toFixed(1)).join(' ')).join(' ');
}

// the point halfway along the route (for the cardinality label)
export function routeMidpoint(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
    if (left <= len && len > 0) {
      const u = left / len;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
    }
    left -= len;
  }
  return pts[pts.length - 1];
}

// distance from a point to the route (for hit-testing a line)
export function routeDistance(pts, x, y) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const cx = Math.max(Math.min(ax, bx), Math.min(x, Math.max(ax, bx)));
    const cy = Math.max(Math.min(ay, by), Math.min(y, Math.max(ay, by)));
    d = Math.min(d, Math.hypot(x - cx, y - cy));
  }
  return d;
}

// The other tables a route between `from` and `to` could run into: anything
// overlapping the box around both (with some margin for detours).
export function nearbyObstacles(from, to, tables, isHidden = null) {
  const M = 60;
  const x0 = Math.min(from.x, to.x) - M, y0 = Math.min(from.y, to.y) - M;
  const x1 = Math.max(from.x + from.w, to.x + to.w) + M, y1 = Math.max(from.y + from.h, to.y + to.h) + M;
  const out = [];
  for (const t of tables) {
    if (t === from || t === to || !Number.isFinite(t.x) || (isHidden && isHidden(t.key))) continue;
    if (t.x < x1 && t.x + t.w > x0 && t.y < y1 && t.y + t.h > y0) out.push(t);
  }
  return out;
}
