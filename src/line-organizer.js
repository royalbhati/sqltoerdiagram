// Advanced Line Organization Engines for ER Diagrams
// Reorganizes orthogonal connection routes without moving tables:
// 1. Smart Faces & Avoid (Changes anchor faces to top/bottom to bypass intermediate tables cleanly)
// 2. Perimeter Bus (Routes cross-table connections through outer boundary channels)
// 3. A* Grid Router (Computes shortest collision-free orthogonal path on a grid)
// 4. Reset Lines (Reverts to direct automatic S-bends / L-bends)

import { getTableAnchor, segmentIntersectsBox, cleanOrthogonalPoints, filterRedundantWaypoints, buildOrthogonalPoints } from './routing.js';

/**
 * Extract active edges from diagram model.
 */
export function getDiagramEdges(diagram, targetKeys = null) {
  if (!diagram || !diagram.model) return [];
  const byKey = new Map((diagram.model.tables || []).map(t => [t.key.toLowerCase(), t]));
  const edges = [];
  const filterSet = targetKeys && targetKeys.length ? new Set(targetKeys.map(k => k.toLowerCase())) : null;

  for (const r of (diagram.model.relations || [])) {
    const fk = (r.fromTable || '').toLowerCase();
    const tk = (r.toTable || '').toLowerCase();
    const fc = r.fromCols?.[0] || '';
    const tc = r.toCols?.[0] || '';
    const key = `${fk}.${fc.toLowerCase()}->${tk}.${tc.toLowerCase()}`;
    if (filterSet && !filterSet.has(key)) continue;

    const from = byKey.get(fk);
    const to = byKey.get(tk);
    if (!from || !to || !Number.isFinite(from.x) || !Number.isFinite(to.x)) continue;
    if (diagram.hidden?.has(fk) || diagram.hidden?.has(tk)) continue;

    edges.push({ key, fk, tk, fc, tc, from, to, manual: false });
  }

  for (const l of (diagram.manualLinks || [])) {
    const fk = (l.from?.table || '').toLowerCase();
    const tk = (l.to?.table || '').toLowerCase();
    const fc = l.from?.col || '';
    const tc = l.to?.col || '';
    const key = `${fk}.${fc.toLowerCase()}->${tk}.${tc.toLowerCase()}`;
    if (filterSet && !filterSet.has(key)) continue;

    const from = byKey.get(fk);
    const to = byKey.get(tk);
    if (!from || !to || !Number.isFinite(from.x) || !Number.isFinite(to.x)) continue;
    if (diagram.hidden?.has(fk) || diagram.hidden?.has(tk)) continue;

    edges.push({ key, fk, tk, fc, tc, from, to, manual: true });
  }

  return edges;
}

/**
 * Get obstacle tables for a specific relation.
 */
export function getObstacles(diagram, fromKey, toKey) {
  const obstacles = [];
  const fk = (fromKey || '').toLowerCase();
  const tk = (toKey || '').toLowerCase();
  for (const t of (diagram.model?.tables || [])) {
    const k = (t.key || '').toLowerCase();
    if (k !== fk && k !== tk && Number.isFinite(t.x) && !diagram.hidden?.has(k)) {
      obstacles.push(t);
    }
  }
  return obstacles;
}

/**
 * Test whether any segment in a sequence of points intersects an obstacle.
 */
function pathIntersectsObstacles(pts, obstacles, margin = 8) {
  if (!pts || pts.length < 2 || !obstacles.length) return false;
  for (let i = 0; i < pts.length - 1; i++) {
    for (const obs of obstacles) {
      if (segmentIntersectsBox(pts[i], pts[i + 1], obs, margin).hit) {
        return true;
      }
    }
  }
  return false;
}

/**
 * ALGORITHM 3: A* Grid Collision-Free Router
 * Builds a visibility grid and executes A* with turn penalties to find the shortest collision-free orthogonal path.
 */
export function organizeLinesAStar(diagram, targetKeys = null) {
  const edges = getDiagramEdges(diagram, targetKeys);
  if (!edges.length) return 0;

  diagram.onHistorySnapshot?.(diagram.getSnapshot());
  let modifiedCount = 0;

  for (const e of edges) {
    const obstacles = getObstacles(diagram, e.fk, e.tk);
    const from = e.from;
    const to = e.to;

    const p1 = getTableAnchor(from, e.fc, to, null, 0, diagram.diagramLevel);
    const p2 = getTableAnchor(to, e.tc, from, null, 0, diagram.diagramLevel);

    // If direct route does NOT hit obstacles, leave it direct
    const midX = (p1.x + p2.x) / 2;
    const testPath = [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
    if (!pathIntersectsObstacles(testPath, obstacles, 10)) {
      continue;
    }

    // Build grid coordinates
    const MARGIN = 20;
    const xs = new Set([Math.round(p1.x), Math.round(p2.x)]);
    const ys = new Set([Math.round(p1.y), Math.round(p2.y)]);

    for (const t of [from, to, ...obstacles]) {
      xs.add(Math.round(t.x - MARGIN));
      xs.add(Math.round(t.x + t.w + MARGIN));
      ys.add(Math.round(t.y - MARGIN));
      ys.add(Math.round(t.y + t.h + MARGIN));
    }

    const gridX = Array.from(xs).sort((a, b) => a - b);
    const gridY = Array.from(ys).sort((a, b) => a - b);

    // A* search on gridX x gridY
    const startNode = { x: Math.round(p1.x), y: Math.round(p1.y) };
    const goalNode = { x: Math.round(p2.x), y: Math.round(p2.y) };

    const keyOf = (x, y, dir) => `${x},${y},${dir || ''}`;
    const openSet = [{ x: startNode.x, y: startNode.y, dir: null, g: 0, f: Math.hypot(startNode.x - goalNode.x, startNode.y - goalNode.y), path: [] }];
    const visited = new Map();
    let bestPath = null;
    let iterations = 0;
    const MAX_ITER = 600;

    while (openSet.length > 0 && iterations++ < MAX_ITER) {
      // Pop lowest f
      openSet.sort((a, b) => a.f - b.f);
      const cur = openSet.shift();

      if (Math.hypot(cur.x - goalNode.x, cur.y - goalNode.y) < 2) {
        bestPath = [...cur.path, { x: goalNode.x, y: goalNode.y }];
        break;
      }

      const stateKey = keyOf(cur.x, cur.y, cur.dir);
      if (visited.has(stateKey) && visited.get(stateKey) <= cur.g) continue;
      visited.set(stateKey, cur.g);

      // Find index in gridX, gridY
      const xi = gridX.indexOf(cur.x);
      const yi = gridY.indexOf(cur.y);

      // 4 orthogonal neighbors along adjacent grid lines
      const neighbors = [];
      if (xi > 0) neighbors.push({ x: gridX[xi - 1], y: cur.y, dir: 'h' });
      if (xi < gridX.length - 1) neighbors.push({ x: gridX[xi + 1], y: cur.y, dir: 'h' });
      if (yi > 0) neighbors.push({ x: cur.x, y: gridY[yi - 1], dir: 'v' });
      if (yi < gridY.length - 1) neighbors.push({ x: cur.x, y: gridY[yi + 1], dir: 'v' });

      for (const n of neighbors) {
        // Check if segment from cur to n intersects any obstacle table
        let blocked = false;
        for (const obs of obstacles) {
          if (segmentIntersectsBox(cur, n, obs, 8).hit) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        const dist = Math.hypot(n.x - cur.x, n.y - cur.y);
        // Turn penalty of 40px to prefer straight paths and prevent staircase zig-zags
        const turnPenalty = (cur.dir && cur.dir !== n.dir) ? 40 : 0;
        const g = cur.g + dist + turnPenalty;
        const h = Math.abs(n.x - goalNode.x) + Math.abs(n.y - goalNode.y);

        openSet.push({
          x: n.x,
          y: n.y,
          dir: n.dir,
          g,
          f: g + h,
          path: [...cur.path, { x: cur.x, y: cur.y }],
        });
      }
    }

    if (bestPath && bestPath.length > 2) {
      // Clean and remove redundant collinear waypoints
      const cleaned = filterRedundantWaypoints(bestPath, 3);
      // Remove start and end anchors from waypoints list
      const waypoints = cleaned.slice(1, cleaned.length - 1);
      if (waypoints.length) {
        diagram.edgeWaypoints.set(e.key, waypoints);
        modifiedCount++;
      }
    }
  }

  diagram.markDirty();
  diagram.onLayoutChange?.();
  return modifiedCount;
}

/**
 * ALGORITHM 4: ELK Layered Port Allocation & Manhattan Channel Router
 * Industry-standard approach from Eclipse ELK / yFiles:
 * 1. Categorizes natural approach faces between source and target boxes.
 * 2. Port Sorter Heuristic: Sorts all edge endpoints on each face (N, S, E, W)
 *    by the physical coordinate (X for top/bottom, Y for left/right) of their target node.
 *    This completely eliminates crossings at node boundaries!
 * 3. Channel Router: Routes inter-group / blocked connections through obstacle-free
 *    corridors with indexed tracks (laneOffsets) to prevent collisions and overlap.
 */
export function organizeLinesElkPorts(diagram, targetKeys = null) {
  const edges = getDiagramEdges(diagram, targetKeys);
  if (!edges.length) return 0;

  diagram.onHistorySnapshot?.(diagram.getSnapshot());

  // Step 1: Determine natural faces for each edge endpoint
  const tablePorts = new Map();
  const getTablePortList = (tableKey, side) => {
    const k = (tableKey || '').toLowerCase();
    if (!tablePorts.has(k)) {
      tablePorts.set(k, { top: [], bottom: [], left: [], right: [] });
    }
    return tablePorts.get(k)[side];
  };

  const edgeAssignments = new Map();

  for (const e of edges) {
    const from = e.from;
    const to = e.to;
    const obstacles = getObstacles(diagram, e.fk, e.tk);

    const fromCenter = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
    const toCenter = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
    const dx = toCenter.x - fromCenter.x;
    const dy = toCenter.y - fromCenter.y;

    let fromSide, toSide;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) {
        fromSide = 'right';
        toSide = 'left';
      } else {
        fromSide = 'left';
        toSide = 'right';
      }
    } else {
      if (dy >= 0) {
        fromSide = 'bottom';
        toSide = 'top';
      } else {
        fromSide = 'top';
        toSide = 'bottom';
      }
    }

    // Test whether the natural orthogonal path intersects intermediate obstacles
    const p1Test = getTableAnchor(from, e.fc, null, { side: fromSide, offset: 0.5 }, 0, diagram.diagramLevel);
    const p2Test = getTableAnchor(to, e.tc, null, { side: toSide, offset: 0.5 }, 0, diagram.diagramLevel);
    const midX = (p1Test.x + p2Test.x) / 2;
    const testPath = [p1Test, { x: midX, y: p1Test.y }, { x: midX, y: p2Test.y }, p2Test];
    const directHits = obstacles.filter(obs => pathIntersectsObstacles(testPath, [obs], 8));

    if (directHits.length > 0) {
      // Direct orthogonal path is blocked by intermediate tables (e.g. rol -> [permiso] -> rol_permiso)
      if (Math.abs(dx) >= Math.abs(dy)) {
        const useTop = Math.min(from.y, to.y, ...directHits.map(o => o.y)) >= 40;
        fromSide = useTop ? 'top' : 'bottom';
        toSide = useTop ? 'top' : 'bottom';
      } else {
        const useLeft = Math.min(from.x, to.x, ...directHits.map(o => o.x)) >= 40;
        fromSide = useLeft ? 'left' : 'right';
        toSide = useLeft ? 'left' : 'right';
      }
    }

    edgeAssignments.set(e.key, { edge: e, fromSide, toSide, directHits });
  }

  // Register all endpoints into tablePorts for port sorting
  for (const [key, assign] of edgeAssignments.entries()) {
    const { edge, fromSide, toSide } = assign;
    getTablePortList(edge.fk, fromSide).push({
      key,
      isFrom: true,
      partnerTable: edge.to,
      edge,
    });
    getTablePortList(edge.tk, toSide).push({
      key,
      isFrom: false,
      partnerTable: edge.from,
      edge,
    });
  }

  // Step 2: Port Sorter Heuristic (ELK / yFiles)
  // For each table and each side, sort ports so lines never cross at the perimeter
  const computedAnchors = new Map();

  for (const [tableKey, sides] of tablePorts.entries()) {
    for (const [side, ports] of Object.entries(sides)) {
      if (!ports.length) continue;

      if (side === 'top' || side === 'bottom') {
        // Horizontal side: sort by partner center X
        ports.sort((a, b) => {
          const ax = a.partnerTable.x + a.partnerTable.w / 2;
          const bx = b.partnerTable.x + b.partnerTable.w / 2;
          return ax - bx;
        });
      } else {
        // Vertical side: sort by partner center Y
        ports.sort((a, b) => {
          const ay = a.partnerTable.y + a.partnerTable.h / 2;
          const by = b.partnerTable.y + b.partnerTable.h / 2;
          return ay - by;
        });
      }

      // Distribute offsets evenly
      const N = ports.length;
      for (let i = 0; i < N; i++) {
        const item = ports[i];
        const offset = N === 1 ? 0.5 : 0.15 + (i / (N - 1)) * 0.7;

        if (!computedAnchors.has(item.key)) {
          computedAnchors.set(item.key, {});
        }
        const obj = computedAnchors.get(item.key);
        if (item.isFrom) {
          obj.fromAnchor = { side, offset };
        } else {
          obj.toAnchor = { side, offset };
        }
      }
    }
  }

  // Step 3: Channel Router & Waypoint generation
  let modifiedCount = 0;
  const channelCounter = new Map();

  for (const e of edges) {
    const assign = edgeAssignments.get(e.key);
    const anchors = computedAnchors.get(e.key);
    if (!assign || !anchors?.fromAnchor || !anchors?.toAnchor) continue;

    const fromAnchor = anchors.fromAnchor;
    const toAnchor = anchors.toAnchor;
    diagram.edgeAnchors.set(e.key, { fromAnchor, toAnchor });

    const p1 = getTableAnchor(e.from, e.fc, null, fromAnchor, 0, diagram.diagramLevel);
    const p2 = getTableAnchor(e.to, e.tc, null, toAnchor, 0, diagram.diagramLevel);

    const obstacles = getObstacles(diagram, e.fk, e.tk);

    // If both anchors are on top/bottom, route via corridor channel
    if (fromAnchor.side === toAnchor.side && (fromAnchor.side === 'top' || fromAnchor.side === 'bottom')) {
      const useTop = fromAnchor.side === 'top';
      const hits = assign.directHits.length ? assign.directHits : obstacles;
      const relevant = [e.from, e.to, ...hits];
      const minY = Math.min(...relevant.map(t => t.y));
      const maxY = Math.max(...relevant.map(t => t.y + t.h));

      const chanKey = useTop ? `top_chan_${Math.round(minY / 150)}` : `bot_chan_${Math.round(maxY / 150)}`;
      const trackIdx = channelCounter.get(chanKey) || 0;
      channelCounter.set(chanKey, trackIdx + 1);

      const trackOffset = (trackIdx % 6) * 14;
      const detourY = useTop ? (minY - 26 - trackOffset) : (maxY + 26 + trackOffset);

      diagram.edgeWaypoints.set(e.key, [
        { x: p1.x, y: detourY },
        { x: p2.x, y: detourY },
      ]);
      modifiedCount++;
    } else if (fromAnchor.side === toAnchor.side && (fromAnchor.side === 'left' || fromAnchor.side === 'right')) {
      const useLeft = fromAnchor.side === 'left';
      const hits = assign.directHits.length ? assign.directHits : obstacles;
      const relevant = [e.from, e.to, ...hits];
      const minX = Math.min(...relevant.map(t => t.x));
      const maxX = Math.max(...relevant.map(t => t.x + t.w));

      const chanKey = useLeft ? `left_chan_${Math.round(minX / 150)}` : `right_chan_${Math.round(maxX / 150)}`;
      const trackIdx = channelCounter.get(chanKey) || 0;
      channelCounter.set(chanKey, trackIdx + 1);

      const trackOffset = (trackIdx % 6) * 14;
      const detourX = useLeft ? (minX - 26 - trackOffset) : (maxX + 26 + trackOffset);

      diagram.edgeWaypoints.set(e.key, [
        { x: detourX, y: p1.y },
        { x: detourX, y: p2.y },
      ]);
      modifiedCount++;
    } else {
      // Check if natural S-bend or L-bend intersects any obstacle
      const midX = (p1.x + p2.x) / 2;
      const testPath = [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2];
      const blocked = pathIntersectsObstacles(testPath, obstacles, 8);

      if (blocked) {
        // Route via corridor channel
        const allRelevant = [e.from, e.to, ...obstacles.filter(o => segmentIntersectsBox(p1, p2, o, 10).hit)];
        const minY = Math.min(...allRelevant.map(t => t.y));
        const chanKey = `obs_detour_${Math.round(minY / 150)}`;
        const trackIdx = channelCounter.get(chanKey) || 0;
        channelCounter.set(chanKey, trackIdx + 1);

        const detourY = minY - 26 - (trackIdx % 5) * 14;
        diagram.edgeWaypoints.set(e.key, [
          { x: p1.x, y: detourY },
          { x: p2.x, y: detourY },
        ]);
        modifiedCount++;
      } else {
        // Clean direct route with sorted ports: clear any old waypoints
        if (diagram.edgeWaypoints.has(e.key)) {
          diagram.edgeWaypoints.delete(e.key);
        }
        modifiedCount++;
      }
    }
  }

  diagram.markDirty();
  diagram.onLayoutChange?.();
  return modifiedCount;
}

/**
 * Reset lines back to clean automatic direct S-bends / L-bends.
 */
export function resetLines(diagram, targetKeys = null) {
  const edges = getDiagramEdges(diagram, targetKeys);
  if (!edges.length) return 0;

  diagram.onHistorySnapshot?.(diagram.getSnapshot());
  let resetCount = 0;

  for (const e of edges) {
    let had = false;
    if (diagram.edgeAnchors.has(e.key)) {
      diagram.edgeAnchors.delete(e.key);
      had = true;
    }
    if (diagram.edgeWaypoints.has(e.key)) {
      diagram.edgeWaypoints.delete(e.key);
      had = true;
    }
    if (had) resetCount++;
  }

  diagram.markDirty();
  diagram.onLayoutChange?.();
  return resetCount;
}
/* ------------------------------------------------------------------------ *
 * ALGORITHM 6: Crossing-Aware Shortest Orthogonal Router
 * ------------------------------------------------------------------------
 * Wipes every existing vertex and anchor position, then recomputes every line
 * from scratch. A line may dock on ANY point of either perimeter and must stay
 * at least SP_CLEARANCE away from every table that is not one of its two
 * endpoints. Tables are never moved.
 *
 * Unlike a per-edge shortest path, the router is aware of the other lines:
 *
 * 1. Global lane grid. One grid shared by every edge. Besides the clearance
 *    ring around each table it carries corridor lanes fanning outwards from
 *    each ring and docking lanes across each face, so parallel lines have real
 *    coordinates to spread onto instead of being nudged apart afterwards.
 * 2. Corridor reservations. A routed line reserves the intervals it occupies.
 *    Travelling ALONG a reserved interval is forbidden outright, so two lines
 *    can never be drawn on top of each other; they either share a table face,
 *    take different lanes, or cross in an X.
 * 3. Crossing cost. Passing through a node covered by a perpendicular
 *    reservation costs SP_CROSS_COST (less between lines that share a table,
 *    where crossings are often unavoidable).
 * 4. Rip-up and reroute. Edges are routed shortest-first, then repeatedly
 *    ripped up and rerouted against everything else until no edge can improve.
 *
 * Cost of a route = length + SP_TURN_COST per vertex + crossing costs, capped
 * by a detour budget derived from the same edge routed with no other line in
 * the way. Corners render 90 degrees and rounded.
 */

const SP_CLEARANCE = 16;          // minimum gap kept from every foreign table
const SP_STUB = 16;               // perpendicular stub leaving each anchor (== clearance, lands on the grid)
const SP_TURN_COST = 20;          // px charged per vertex
const SP_CROSS_COST = 150;        // px charged per crossing with another line
// Crossings between lines that share a table get NO discount: they look like the
// unavoidable ones but are in fact the easiest to undo, because both ends land on
// the same face and only their lane order has to swap. The pairwise pass below is
// what actually resolves them, so they are priced like any other crossing.
const SP_CROSS_COST_SHARED = SP_CROSS_COST;
const SP_MIN_SEPARATION = 12;     // two parallel lines must never run closer than this
const SP_NEAR_MIN_SPAN = 8;       // ... unless they only brush past each other near a corner
const SP_NEAR_SAME = 3;           // a track this close is the same line to the eye: no brushing at all
const SP_OVERLAP_COST = 6;        // px charged per px run on top of another line, once
                                  // the corridors are so full that nothing else fits
const SP_LANE_GAP = 12;           // spacing of the corridor lanes
const SP_LANE_DEPTH = 4;          // corridor lanes on each side of a clearance ring
const SP_PORT_STEP = 14;          // spacing of the docking lanes across a table face
const SP_MAX_AXIS = 700;          // hard cap of grid lines per axis
const SP_DETOUR_FACTOR = 1.7;     // a line may not exceed this multiple of its unobstructed length
const SP_DETOUR_SLACK = 250;      // ... plus this many px, so short lines still have room
const SP_MAX_PASSES = 12;         // rip-up and reroute rounds before giving up on further gains
// Pairwise lane-swap rounds. Measured on a 30-table / 58-relation layout, round
// one takes crossings 205 -> 175 and round two 175 -> 174; a third buys nothing
// and costs seconds, so two is where the curve flattens.
const SP_SWAP_ROUNDS = 2;
const SP_SPREAD_ROUNDS = 3;       // rounds of the final even-distribution pass
const SP_SPREAD_RANGE = 72;       // how far a run may slide sideways looking for air
const SP_SPREAD_CAP = 56;         // beyond this a neighbour is far enough to stop caring
const SP_SPREAD_SLACK = 24;       // px of extra length a nicer spacing may cost
const SP_MAX_POPS = 300000;       // A* expansion guard

/** Binary min-heap on `.f`, so A* does not pay a sort per pop. */
class SpHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t;
        i = m;
      }
    }
    return top;
  }
}

/** Dockable span of a table face, matching the clamps applied by getTableAnchor. */
function spSpan(t, vertical) {
  return vertical
    ? { lo: Math.ceil(t.y + 20), hi: Math.floor(t.y + t.h - 10) }
    : { lo: Math.ceil(t.x + 16), hi: Math.floor(t.x + t.w - 16) };
}

/** Does the bounding box of a segment come within `pad` of a table? */
function spNearBox(a, b, t, pad) {
  return !(Math.max(a.x, b.x) + pad < t.x || Math.min(a.x, b.x) - pad > t.x + t.w
        || Math.max(a.y, b.y) + pad < t.y || Math.min(a.y, b.y) - pad > t.y + t.h);
}

/**
 * The grid every edge routes on. Base coordinates (clearance rings, face
 * limits, centres and the outer ring highways) are never dropped; docking
 * lanes come next, and corridor lanes are the first to go if the axis cap bites.
 */
function spBuildGlobalGrid(tables, fixed = []) {
  const baseX = new Set(), baseY = new Set();
  const portX = new Set(), portY = new Set();
  const laneX = new Set(), laneY = new Set();

  let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
  for (const t of tables) {
    const vs = spSpan(t, true), hs = spSpan(t, false);
    const oL = Math.round(t.x - SP_CLEARANCE), oR = Math.round(t.x + t.w + SP_CLEARANCE);
    const oT = Math.round(t.y - SP_CLEARANCE), oB = Math.round(t.y + t.h + SP_CLEARANCE);

    baseX.add(oL); baseX.add(oR); baseX.add(hs.lo); baseX.add(hs.hi);
    baseX.add(Math.round(t.x + t.w / 2));
    baseY.add(oT); baseY.add(oB); baseY.add(vs.lo); baseY.add(vs.hi);
    baseY.add(Math.round(t.y + t.h / 2));

    // Docking lanes across each face, so many lines can share a table cleanly.
    for (let v = vs.lo; v <= vs.hi; v += SP_PORT_STEP) portY.add(v);
    for (let v = hs.lo; v <= hs.hi; v += SP_PORT_STEP) portX.add(v);

    // Corridor lanes fanning outwards from the clearance ring.
    for (let k = 1; k <= SP_LANE_DEPTH; k++) {
      laneX.add(oL - k * SP_LANE_GAP); laneX.add(oR + k * SP_LANE_GAP);
      laneY.add(oT - k * SP_LANE_GAP); laneY.add(oB + k * SP_LANE_GAP);
    }

    gx0 = Math.min(gx0, t.x); gx1 = Math.max(gx1, t.x + t.w);
    gy0 = Math.min(gy0, t.y); gy1 = Math.max(gy1, t.y + t.h);
  }

  // Outer ring highways, so a line can always get around the whole diagram.
  if (Number.isFinite(gx0)) {
    for (let k = 0; k <= SP_LANE_DEPTH; k++) {
      const d = 48 + k * SP_LANE_GAP;
      baseX.add(Math.round(gx0 - d)); baseX.add(Math.round(gx1 + d));
      baseY.add(Math.round(gy0 - d)); baseY.add(Math.round(gy1 + d));
    }
  }

  // Lines held fixed must sit on grid lines, or their reservations cannot be
  // indexed and the new routes would never see them.
  for (const f of fixed) {
    for (let i = 0; i < f.pts.length - 1; i++) {
      const a = f.pts[i], b = f.pts[i + 1];
      if (Math.abs(a.y - b.y) < 0.6) baseY.add(Math.round(a.y));
      else baseX.add(Math.round(a.x));
    }
  }

  const merge = (base, port, lane) => {
    const out = new Set(base);
    for (const v of port) { if (out.size >= SP_MAX_AXIS) break; out.add(v); }
    for (const v of lane) { if (out.size >= SP_MAX_AXIS) break; out.add(v); }
    return Array.from(out).sort((a, b) => a - b);
  };

  return { xs: merge(baseX, portX, laneX), ys: merge(baseY, portY, laneY) };
}

/**
 * Intervals already occupied by routed lines, indexed by grid line. Travelling
 * along an occupied interval is forbidden; crossing one costs.
 */
class SpReservations {
  constructor() {
    this.h = new Map();       // horizontal line index -> [{ lo, hi, owner }]
    this.v = new Map();       // vertical line index   -> [{ lo, hi, owner }]
    this.byOwner = new Map();
  }

  add(horiz, line, a, b, owner) {
    const map = horiz ? this.h : this.v;
    let arr = map.get(line);
    if (!arr) { arr = []; map.set(line, arr); }
    const entry = { lo: Math.min(a, b), hi: Math.max(a, b), owner };
    arr.push(entry);
    let own = this.byOwner.get(owner);
    if (!own) { own = []; this.byOwner.set(owner, own); }
    own.push({ arr, entry });
  }

  clearOwner(owner) {
    const own = this.byOwner.get(owner);
    if (!own) return;
    for (const ref of own) {
      const i = ref.arr.indexOf(ref.entry);
      if (i >= 0) ref.arr.splice(i, 1);
    }
    this.byOwner.delete(owner);
  }

  /** Hard constraint: would travelling this interval run on top of another line? */
  blocks(horiz, line, a, b) {
    const arr = (horiz ? this.h : this.v).get(line);
    if (!arr || !arr.length) return false;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (const e of arr) {
      if (Math.min(e.hi, hi) - Math.max(e.lo, lo) > 1) return true;
    }
    return false;
  }

  /** How many px of this interval already carry another line. */
  overlapAmount(horiz, line, a, b, minOv = 1) {
    const arr = (horiz ? this.h : this.v).get(line);
    if (!arr || !arr.length) return 0;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    let sum = 0;
    for (const e of arr) {
      const ov = Math.min(e.hi, hi) - Math.max(e.lo, lo);
      if (ov > minOv) sum += ov;
    }
    return sum;
  }

  /** Owners of the reservations covering one point of a grid line. */
  coverers(horiz, line, coord, out) {
    const arr = (horiz ? this.h : this.v).get(line);
    if (!arr || !arr.length) return 0;
    let n = 0;
    for (const e of arr) {
      if (coord >= e.lo - 0.5 && coord <= e.hi + 0.5) {
        out[n++] = e.owner;
        if (n >= out.length) break;
      }
    }
    return n;
  }
}

/** Grid, clearance memos, scratch arrays and reservations shared by every edge. */
class SpRouter {
  constructor(tables, xs, ys) {
    this.tables = tables;
    this.xs = xs;
    this.ys = ys;
    this.NX = xs.length;
    this.NY = ys.length;
    this.N = this.NX * this.NY;
    this.xIdx = new Map(); xs.forEach((v, i) => this.xIdx.set(v, i));
    this.yIdx = new Map(); ys.forEach((v, i) => this.yIdx.set(v, i));

    // Clearance against ALL tables, computed once and reused by every edge.
    this.blockH = new Uint8Array(this.N);   // 0 unknown, 1 free, 2 blocked
    this.blockV = new Uint8Array(this.N);

    // A* scratch, reset by generation stamp rather than refilled per edge.
    this.g = new Float64Array(this.N * 2);
    this.parent = new Int32Array(this.N * 2);
    this.stamp = new Int32Array(this.N * 2);
    this.gen = 0;

    // Reservations are frozen for the duration of one route(), so the crossing
    // cost of a node and the occupancy of a grid edge can be memoised against
    // the same generation counter instead of rescanned on every relaxation.
    this.crossVal = new Float64Array(this.N * 2);
    this.crossStamp = new Int32Array(this.N * 2);
    this.occVal = new Float64Array(this.N * 2);
    this.occStamp = new Int32Array(this.N * 2);

    // Grid lines closer than SP_MIN_SEPARATION to each other. Two lines may not
    // run in parallel across any of these, so a crowded corridor cannot produce
    // routes 4px apart just because two tables happened to seed adjacent tracks.
    const buildNear = (arr) => arr.map((v, i) => {
      const list = [];
      for (let j = i - 1; j >= 0 && v - arr[j] < SP_MIN_SEPARATION; j--) list.push(j);
      for (let j = i + 1; j < arr.length && arr[j] - v < SP_MIN_SEPARATION; j++) list.push(j);
      return list;
    });
    this.nearX = buildNear(xs);
    this.nearY = buildNear(ys);

    this.res = new SpReservations();
    this._owners = new Int32Array(8);
  }

  _clearAll(a, b) {
    for (const t of this.tables) {
      if (segmentIntersectsBox(a, b, t, SP_CLEARANCE - 0.5).hit) return false;
    }
    return true;
  }

  _clearFor(a, b, from, to) {
    for (const t of this.tables) {
      const margin = (t === from || t === to) ? -1 : SP_CLEARANCE - 0.5;
      if (segmentIntersectsBox(a, b, t, margin).hit) return false;
    }
    return true;
  }

  /** Is the grid segment usable by an edge whose endpoints are `from` and `to`? */
  _segFree(horiz, i, j, from, to, memo) {
    const k = j * this.NX + i;
    const cache = horiz ? this.blockH : this.blockV;
    const a = { x: this.xs[i], y: this.ys[j] };
    const b = horiz ? { x: this.xs[i + 1], y: this.ys[j] } : { x: this.xs[i], y: this.ys[j + 1] };
    let state = cache[k];
    if (!state) {
      state = this._clearAll(a, b) ? 1 : 2;
      cache[k] = state;
    }
    if (state === 1) return true;
    // Blocked against all tables, but the endpoints are allowed to be touched.
    if (!spNearBox(a, b, from, SP_CLEARANCE) && !spNearBox(a, b, to, SP_CLEARANCE)) return false;
    const mk = horiz ? k * 2 : k * 2 + 1;
    const hit = memo.get(mk);
    if (hit !== undefined) return hit;
    const ok = this._clearFor(a, b, from, to);
    memo.set(mk, ok);
    return ok;
  }

  /** Docking ports across all four faces of a table, aligned to the grid. */
  portsFor(table) {
    const ports = [];
    const vs = spSpan(table, true), hs = spSpan(table, false);
    const li = this.xIdx.get(Math.round(table.x - SP_CLEARANCE));
    const ri = this.xIdx.get(Math.round(table.x + table.w + SP_CLEARANCE));
    const ti = this.yIdx.get(Math.round(table.y - SP_CLEARANCE));
    const bi = this.yIdx.get(Math.round(table.y + table.h + SP_CLEARANCE));

    for (let j = 0; j < this.NY; j++) {
      const y = this.ys[j];
      if (y < vs.lo) continue;
      if (y > vs.hi) break;
      if (li !== undefined) ports.push({ side: 'left', x: table.x, y, dir: 0, si: li, sj: j, sx: this.xs[li], sy: y });
      if (ri !== undefined) ports.push({ side: 'right', x: table.x + table.w, y, dir: 0, si: ri, sj: j, sx: this.xs[ri], sy: y });
    }
    for (let i = 0; i < this.NX; i++) {
      const x = this.xs[i];
      if (x < hs.lo) continue;
      if (x > hs.hi) break;
      if (ti !== undefined) ports.push({ side: 'top', x, y: table.y, dir: 1, si: i, sj: ti, sx: x, sy: this.ys[ti] });
      if (bi !== undefined) ports.push({ side: 'bottom', x, y: table.y + table.h, dir: 1, si: i, sj: bi, sx: x, sy: this.ys[bi] });
    }
    return ports;
  }

  /** Crossing cost of passing through node (i, j) travelling in direction `dir`. */
  _crossCost(i, j, dir, shares) {
    const key = (((j * this.NX + i) << 1) | dir);
    if (this.crossStamp[key] === this.gen) return this.crossVal[key];
    // Vertical travel crosses horizontal reservations, and vice versa.
    const horiz = dir === 1;
    const line = dir === 1 ? j : i;
    const coord = dir === 1 ? this.xs[i] : this.ys[j];
    const n = this.res.coverers(horiz, line, coord, this._owners);
    let cost = 0;
    for (let k = 0; k < n; k++) {
      cost += shares(this._owners[k]) ? SP_CROSS_COST_SHARED : SP_CROSS_COST;
    }
    this.crossStamp[key] = this.gen;
    this.crossVal[key] = cost;
    return cost;
  }

  /**
   * Px of a grid edge already carrying another line, memoised per route().
   * Returns Infinity when overlap is banned and the edge is occupied.
   */
  _occupancy(horiz, i, j, ni, nj, banned) {
    // Key on the lower endpoint, so both directions of travel share the entry.
    const key = ((Math.min(j, nj) * this.NX + Math.min(i, ni)) << 1) | (horiz ? 0 : 1);
    if (this.occStamp[key] === this.gen) {
      const v = this.occVal[key];
      return banned && v > 0 ? Infinity : v;
    }
    const line = horiz ? j : i;
    const a = horiz ? this.xs[i] : this.ys[j];
    const b = horiz ? this.xs[ni] : this.ys[nj];
    // Running on top of another line, plus running too close beside one.
    let v = this.res.overlapAmount(horiz, line, a, b);
    for (const other of (horiz ? this.nearY : this.nearX)[line]) {
      // Brushing past a neighbour is fine 10px away, not 1px away: that reads
      // as one line drawn on top of another.
      const axis = horiz ? this.ys : this.xs;
      const floor = Math.abs(axis[other] - axis[line]) <= SP_NEAR_SAME ? 1 : SP_NEAR_MIN_SPAN;
      v += this.res.overlapAmount(horiz, other, a, b, floor);
    }
    this.occStamp[key] = this.gen;
    this.occVal[key] = v;
    return banned && v > 0 ? Infinity : v;
  }

  /** Px of the anchor stub that would run on top of, or too close beside, another line. */
  _stubConflict(p) {
    const horiz = p.dir === 0;
    const line = horiz ? p.sj : p.si;
    const a = horiz ? p.x : p.y;
    const b = horiz ? p.sx : p.sy;
    let v = this.res.overlapAmount(horiz, line, a, b);
    for (const other of (horiz ? this.nearY : this.nearX)[line]) {
      // Brushing past a neighbour is fine 10px away, not 1px away: that reads
      // as one line drawn on top of another.
      const axis = horiz ? this.ys : this.xs;
      const floor = Math.abs(axis[other] - axis[line]) <= SP_NEAR_SAME ? 1 : SP_NEAR_MIN_SPAN;
      v += this.res.overlapAmount(horiz, other, a, b, floor);
    }
    return v;
  }

  /**
   * Shortest route for one edge. With `useRes` the search may not run along
   * another line and pays for every crossing; without it, it is the plain
   * obstacle-avoiding shortest path used for the detour budget and as fallback.
   */
  route(from, to, fromPorts, toPorts, useRes, lenBudget, shares, overlapCost = 0) {
    const { NX, NY, xs, ys, g, parent, stamp } = this;
    const gen = ++this.gen;
    const memo = new Map();
    const heap = new SpHeap();
    const startAt = new Map();

    const gOf = (s) => (stamp[s] === gen ? g[s] : Infinity);
    const setG = (s, v) => { stamp[s] = gen; g[s] = v; };

    const hx0 = to.x - SP_CLEARANCE, hx1 = to.x + to.w + SP_CLEARANCE;
    const hy0 = to.y - SP_CLEARANCE, hy1 = to.y + to.h + SP_CLEARANCE;
    const heur = (x, y) => {
      const dx = x < hx0 ? hx0 - x : (x > hx1 ? x - hx1 : 0);
      const dy = y < hy0 ? hy0 - y : (y > hy1 ? y - hy1 : 0);
      return dx + dy;
    };

    const stubUsable = (p, partner) => {
      const a = { x: p.x, y: p.y }, b = { x: p.sx, y: p.sy };
      for (const t of this.tables) {
        const margin = (t === from || t === to) ? -1 : SP_CLEARANCE - 0.5;
        if (segmentIntersectsBox(a, b, t, margin).hit) return false;
      }
      if (segmentIntersectsBox(a, b, partner, -1).hit) return false;
      if (useRes && overlapCost === 0 && this._stubConflict(p) > 0) return false;
      return true;
    };

    // Extra cost of the stub when overlap is merely expensive rather than banned.
    const stubPenalty = (p) => (
      !useRes || overlapCost === 0 ? 0 : this._stubConflict(p) * overlapCost
    );

    for (const p of fromPorts) {
      if (!stubUsable(p, to)) continue;
      const s = ((p.sj * NX + p.si) << 1) | p.dir;
      const cost = SP_STUB + (useRes ? this._crossCost(p.si, p.sj, p.dir, shares) + stubPenalty(p) : 0);
      if (cost >= gOf(s)) continue;
      setG(s, cost);
      parent[s] = -1;
      startAt.set(s, p);
      heap.push({ s, g: cost, len: SP_STUB, f: cost + heur(p.sx, p.sy) });
    }
    if (!startAt.size) return null;

    const goalAt = new Map();
    for (const p of toPorts) {
      if (!stubUsable(p, from)) continue;
      const node = p.sj * NX + p.si;
      let list = goalAt.get(node);
      if (!list) { list = []; goalAt.set(node, list); }
      list.push(p);
    }
    if (!goalAt.size) return null;

    let best = Infinity, bestState = -1, bestPort = null;
    let pops = 0;

    while (heap.size && pops++ < SP_MAX_POPS) {
      const cur = heap.pop();
      if (cur.g > gOf(cur.s)) continue;
      if (cur.f >= best) break;

      const s = cur.s;
      const dir = s & 1;
      const node = s >> 1;
      const i = node % NX;
      const j = (node / NX) | 0;

      const goals = goalAt.get(node);
      if (goals) {
        for (const p of goals) {
          if (cur.len + SP_STUB > lenBudget) continue;
          const total = cur.g + SP_STUB + (p.dir === dir ? 0 : SP_TURN_COST);
          if (total < best) { best = total; bestState = s; bestPort = p; }
        }
      }

      const relax = (ni, nj, ndir) => {
        const ns = ((nj * NX + ni) << 1) | ndir;
        if (startAt.has(ns)) return;
        const segLen = ndir === 0 ? Math.abs(xs[ni] - xs[i]) : Math.abs(ys[nj] - ys[j]);
        const nlen = cur.len + segLen;
        if (nlen > lenBudget) return;
        let ng = cur.g + segLen + (ndir === dir ? 0 : SP_TURN_COST);
        if (useRes) {
          // Never run along a corridor another line occupies. That is a hard
          // constraint until the corridors are so full that no route exists at
          // all, at which point the caller retries with overlap merely priced.
          const occ = this._occupancy(ndir === 0, i, j, ni, nj, overlapCost === 0);
          if (occ === Infinity) return;
          ng += occ * overlapCost + this._crossCost(ni, nj, ndir, shares);
        }
        if (ng >= gOf(ns)) return;
        setG(ns, ng);
        parent[ns] = s;
        heap.push({ s: ns, g: ng, len: nlen, f: ng + heur(xs[ni], ys[nj]) });
      };

      if (i > 0 && this._segFree(true, i - 1, j, from, to, memo)) relax(i - 1, j, 0);
      if (i < NX - 1 && this._segFree(true, i, j, from, to, memo)) relax(i + 1, j, 0);
      if (j > 0 && this._segFree(false, i, j - 1, from, to, memo)) relax(i, j - 1, 1);
      if (j < NY - 1 && this._segFree(false, i, j, from, to, memo)) relax(i, j + 1, 1);
    }

    if (bestState < 0) return null;

    const nodes = [];
    let s = bestState;
    let guard = 0;
    while (s >= 0 && guard++ < 100000) {
      const node = s >> 1;
      nodes.push({ x: xs[node % NX], y: ys[(node / NX) | 0] });
      if (startAt.has(s)) break;
      s = parent[s];
    }
    const src = s >= 0 ? startAt.get(s) : null;
    if (!src) return null;
    nodes.reverse();

    const pts = filterRedundantWaypoints(
      [{ x: src.x, y: src.y }, ...nodes, { x: bestPort.x, y: bestPort.y }], 0.5
    );
    return { pts, fromPort: src, toPort: bestPort };
  }

  /** Distance from `coord` to the nearest parallel line running alongside [lo, hi]. */
  _spacing(horiz, coord, lo, hi, owner) {
    const map = horiz ? this.res.h : this.res.v;
    const axis = horiz ? this.ys : this.xs;
    let best = SP_SPREAD_CAP;
    for (const [line, arr] of map.entries()) {
      const d = Math.abs(axis[line] - coord);
      if (d >= best) continue;
      for (const e of arr) {
        if (e.owner === owner) continue;
        if (Math.min(e.hi, hi) - Math.max(e.lo, lo) > SP_NEAR_MIN_SPAN) { best = d; break; }
      }
    }
    return best;
  }

  /** Obstacle clearance of a whole route, stubs included. */
  _routeClears(pts, from, to) {
    const last = pts.length - 2;
    for (let i = 0; i <= last; i++) {
      const a = pts[i], b = pts[i + 1];
      if ((i === 0 || i === last) && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 8) return false;
      if (!this._clearFor(a, b, from, to)) return false;
    }
    return true;
  }

  /**
   * Final pass. The routes are settled and legal, but a line can still hug its
   * neighbour at the bare minimum while the rest of the channel sits empty.
   * Slide each straight run sideways to the track that leaves the most air,
   * refusing any move that costs clearance, a crossing, or real length.
   */
  spreadLines(items, sharesWith) {
    let moves = 0;
    for (let round = 0; round < SP_SPREAD_ROUNDS; round++) {
      let moved = false;

      for (const it of items) {
        const shares = sharesWith(it.idx);
        this.res.clearOwner(it.idx);

        for (let i = 0; i <= it.route.pts.length - 2; i++) {
          const pts = it.route.pts;
          const last = pts.length - 2;
          const a = pts[i], b = pts[i + 1];
          const horiz = Math.abs(a.y - b.y) < 0.6;
          if (horiz === (Math.abs(a.x - b.x) < 0.6)) continue;   // zero length

          // A run touching a table may only slide within that docking face.
          let lo = -Infinity, hi = Infinity;
          if (i === 0) {
            const s = spSpan(it.e.from, horiz);
            lo = Math.max(lo, s.lo); hi = Math.min(hi, s.hi);
          }
          if (i === last) {
            const s = spSpan(it.e.to, horiz);
            lo = Math.max(lo, s.lo); hi = Math.min(hi, s.hi);
          }

          const axis = horiz ? this.ys : this.xs;
          const cur = horiz ? a.y : a.x;
          const span = horiz
            ? [Math.min(a.x, b.x), Math.max(a.x, b.x)]
            : [Math.min(a.y, b.y), Math.max(a.y, b.y)];

          const before = this.evaluate(it.route, it.idx, shares);
          let bestC = cur;
          let bestGap = this._spacing(horiz, cur, span[0], span[1], it.idx);

          for (const c of axis) {
            if (c === cur || c < lo || c > hi) continue;
            if (Math.abs(c - cur) > SP_SPREAD_RANGE) continue;

            const gap = this._spacing(horiz, c, span[0], span[1], it.idx);
            // Only move for a real gain, and never for a smaller one.
            if (gap <= bestGap + 0.5) continue;

            const cand = pts.map(p => ({ x: p.x, y: p.y }));
            if (horiz) { cand[i].y = c; cand[i + 1].y = c; } else { cand[i].x = c; cand[i + 1].x = c; }
            if (!this._routeClears(cand, it.e.from, it.e.to)) continue;

            const after = this.evaluate({ pts: cand }, it.idx, shares);
            if (after.overlap > 0) continue;
            if (after.cross > before.cross) continue;
            if (after.len > before.len + SP_SPREAD_SLACK) continue;

            bestGap = gap;
            bestC = c;
          }

          if (bestC !== cur) {
            if (horiz) { a.y = bestC; b.y = bestC; } else { a.x = bestC; b.x = bestC; }
            moved = true;
            moves++;
          }
        }

        this.reserve(it.route, it.idx);
      }

      if (!moved) break;
    }
    return moves;
  }

  /** Grid line a finished segment sits on, or -1 when it is off-grid. */
  _lineOf(horiz, pt) {
    const idx = horiz ? this.yIdx.get(Math.round(pt.y)) : this.xIdx.get(Math.round(pt.x));
    return idx === undefined ? -1 : idx;
  }

  reserve(route, owner) {
    const pts = route.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const horiz = Math.abs(a.y - b.y) < 0.6;
      const line = this._lineOf(horiz, a);
      if (line < 0) continue;
      this.res.add(horiz, line, horiz ? a.x : a.y, horiz ? b.x : b.y, owner);
    }
  }

  /**
   * Score a finished route against the reservations currently in place.
   * Geometric, so the same yardstick applies to an old route and a fresh one.
   */
  evaluate(route, owner, shares) {
    const pts = route.pts;
    let len = 0, cross = 0, overlap = 0;
    const turns = Math.max(0, pts.length - 2);

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const horiz = Math.abs(a.y - b.y) < 0.6;
      const coord = horiz ? a.y : a.x;
      const lo = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
      const hi = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
      len += hi - lo;

      // Running along another line, or too close beside one: both forbidden, so
      // score them out of contention rather than merely penalising them.
      const own = this._lineOf(horiz, a);
      if (own >= 0) {
        const map = horiz ? this.res.h : this.res.v;
        const near = (horiz ? this.nearY : this.nearX)[own];
        for (let n = -1; n < near.length; n++) {
          const arr = map.get(n < 0 ? own : near[n]);
          if (!arr) continue;
          const axisV = horiz ? this.ys : this.xs;
          const floor = n < 0 || Math.abs(axisV[near[n]] - axisV[own]) <= SP_NEAR_SAME ? 1 : SP_NEAR_MIN_SPAN;
          for (const e of arr) {
            if (e.owner === owner) continue;
            const ov = Math.min(e.hi, hi) - Math.max(e.lo, lo);
            if (ov > floor) overlap += ov;
          }
        }
      }

      // Crossings: perpendicular reservations cutting through this segment.
      const perp = horiz ? this.res.v : this.res.h;
      const axis = horiz ? this.xs : this.ys;
      for (const [line, arr] of perp.entries()) {
        const at = axis[line];
        if (at <= lo + 1 || at >= hi - 1) continue;
        for (const e of arr) {
          if (e.owner === owner) continue;
          if (coord > e.lo + 1 && coord < e.hi - 1) {
            cross += shares(e.owner) ? SP_CROSS_COST_SHARED : SP_CROSS_COST;
          }
        }
      }
    }

    return { cost: len + turns * SP_TURN_COST + cross + overlap * 5, len, turns, cross, overlap };
  }
}

function spOffset(t, pt, side) {
  if (side === 'left' || side === 'right') return t.h ? (pt.y - t.y) / t.h : 0.5;
  return t.w ? (pt.x - t.x) / t.w : 0.5;
}

/**
 * The drawn shape of every line that is NOT being re-routed, exactly as the
 * renderer builds it, so a partial re-route can treat those lines as fixed.
 */
function spFixedRoutes(diagram, skip) {
  const out = [];
  const level = diagram.diagramLevel;
  for (const e of getDiagramEdges(diagram)) {
    if (skip.has(e.key)) continue;
    const anchors = diagram.edgeAnchors.get(e.key);
    const wps = diagram.edgeWaypoints.get(e.key) || [];
    const towardsTo = wps.length ? wps[0] : { x: e.to.x + e.to.w / 2, y: e.to.y + e.to.h / 2 };
    const towardsFrom = wps.length ? wps[wps.length - 1] : { x: e.from.x + e.from.w / 2, y: e.from.y + e.from.h / 2 };
    const p1 = getTableAnchor(e.from, e.fc, towardsTo, anchors?.fromAnchor, 0, level);
    const p2 = getTableAnchor(e.to, e.tc, towardsFrom, anchors?.toAnchor, 0, level);
    out.push({ fk: e.fk, tk: e.tk, pts: buildOrthogonalPoints(p1, p2, wps.map(p => ({ ...p })), [], 0) });
  }
  return out;
}

/**
 * Public entry point: clear every vertex and anchor, then re-route each line as
 * the shortest obstacle-free 90 degree path that also avoids running along or
 * needlessly crossing the other lines.
 * Returns { routed, crossings, overlaps, passes }.
 */
export function organizeLinesShortestPath(diagram, targetKeys = null, options = {}) {
  // keepOthers: when only some lines are re-routed, hold every other line as a
  //   fixed obstacle — never run along it, pay for crossing it. Without it a
  //   partial re-route ignores the rest of the diagram (the original behaviour).
  // recordHistory / forceStyle: a caller that is itself one undoable step and
  //   that must not change the line style can switch these off.
  // quick: skip the pairwise lane-swap rounds and cap rip-up at two passes. For
  //   repairing a handful of lines, where waiting half a minute defeats the point.
  const { keepOthers = false, recordHistory = true, forceStyle = true, quick = false } = options;
  const maxPasses = quick ? 2 : SP_MAX_PASSES;
  const swapRounds = quick ? 0 : SP_SWAP_ROUNDS;
  const edges = getDiagramEdges(diagram, targetKeys);
  if (!edges.length) return { routed: 0, crossings: 0, overlaps: 0, passes: 0 };

  if (recordHistory) diagram.onHistorySnapshot?.(diagram.getSnapshot());

  // Corners are always 90 degrees and rounded for this organizer.
  if (forceStyle) diagram.edgeRouting = 'ortho-rounded';

  const tables = (diagram.model?.tables || []).filter(
    t => Number.isFinite(t.x) && !diagram.hidden?.has((t.key || '').toLowerCase())
  );
  if (!tables.length) return { routed: 0, crossings: 0, overlaps: 0, passes: 0 };

  const fixed = keepOthers && targetKeys ? spFixedRoutes(diagram, new Set(edges.map(e => e.key))) : [];
  const grid = spBuildGlobalGrid(tables, fixed);
  const router = new SpRouter(tables, grid.xs, grid.ys);

  const portCache = new Map();
  const portsOf = (t) => {
    let p = portCache.get(t);
    if (!p) { p = router.portsFor(t); portCache.set(t, p); }
    return p;
  };

  // Lines that touch the same table cross each other more forgivingly.
  const touches = edges.map(e => [e.fk, e.tk]);
  for (const f of fixed) touches.push([f.fk, f.tk]);
  const shareFns = edges.map((_, i) => (j) => {
    if (i === j) return false;
    const a = touches[i], b = touches[j];
    return a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1];
  });
  const sharesWith = (i) => shareFns[i];

  // Fixed lines are reserved first, owned past the end of the routed ones, so
  // rip-up and reroute can never touch them.
  fixed.forEach((f, k) => router.reserve({ pts: f.pts }, edges.length + k));

  const items = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    // Drop the current vertices and anchor positions before recomputing.
    diagram.edgeWaypoints.delete(e.key);
    diagram.edgeAnchors.delete(e.key);
    diagram.edgeRoutings?.delete(e.key);

    // Unobstructed shortest route: sets the detour budget and is the fallback.
    const base = router.route(e.from, e.to, portsOf(e.from), portsOf(e.to), false, Infinity, () => false);
    if (!base) continue;
    let len = 0;
    for (let k = 0; k < base.pts.length - 1; k++) {
      len += Math.abs(base.pts[k].x - base.pts[k + 1].x) + Math.abs(base.pts[k].y - base.pts[k + 1].y);
    }
    items.push({ e, idx: i, base, baseLen: len, budget: len * SP_DETOUR_FACTOR + SP_DETOUR_SLACK, route: null });
  }

  // Four tiers, each a fallback for the one above: inside the detour budget,
  // then at any length, then with overlap priced instead of banned (only when
  // the corridors are physically full), and finally the unobstructed route.
  const attempt = (it) => {
    const shares = sharesWith(it.idx);
    const fp = portsOf(it.e.from), tp = portsOf(it.e.to);
    return router.route(it.e.from, it.e.to, fp, tp, true, it.budget, shares)
        || router.route(it.e.from, it.e.to, fp, tp, true, Infinity, shares)
        || router.route(it.e.from, it.e.to, fp, tp, true, Infinity, shares, SP_OVERLAP_COST)
        || it.base;
  };

  // Pass 1: route shortest-first, so tight lines claim the direct corridors.
  const order = items.slice().sort((a, b) => a.baseLen - b.baseLen);
  for (const it of order) {
    it.route = attempt(it);
    router.reserve(it.route, it.idx);
  }

  // Pass 2..N: rip up the worst offender first and reroute against the rest.
  let passes = 0;
  const ripUpUntilStable = () => {
    for (let n = 0; n < maxPasses; n++) {
      passes++;
      let improved = false;
      // Score once per edge, then sort — scoring inside the comparator would run
      // the (linear in reservations) evaluation O(n log n) times per pass.
      const worstFirst = items
        .map(it => ({ it, cost: router.evaluate(it.route, it.idx, sharesWith(it.idx)).cost }))
        .sort((a, b) => b.cost - a.cost)
        .map(entry => entry.it);
      for (const it of worstFirst) {
        const shares = sharesWith(it.idx);
        router.res.clearOwner(it.idx);
        const before = router.evaluate(it.route, it.idx, shares).cost;
        const fresh = attempt(it);
        if (fresh && router.evaluate(fresh, it.idx, shares).cost < before - 0.5) {
          it.route = fresh;
          improved = true;
        }
        router.reserve(it.route, it.idx);
      }
      if (!improved) return;
    }
  };
  ripUpUntilStable();

  /**
   * Joint cost of two routes, each scored with the other in place. Ripping up
   * one line at a time can never undo a crossing that only disappears when both
   * lines swap lanes, because neither move helps on its own.
   */
  const scorePair = (A, B, rA, rB) => {
    router.res.clearOwner(A.idx);
    router.res.clearOwner(B.idx);
    router.reserve(rB, B.idx);
    const cA = router.evaluate(rA, A.idx, sharesWith(A.idx)).cost;
    router.res.clearOwner(B.idx);
    router.reserve(rA, A.idx);
    const cB = router.evaluate(rB, B.idx, sharesWith(B.idx)).cost;
    router.res.clearOwner(A.idx);
    return cA + cB;
  };

  // Pass N+1: pairwise swaps. Both crossing lines come out, and both orders of
  // reinstating them are tried; whichever scores best is kept.
  let swaps = 0;
  for (let round = 0; round < swapRounds; round++) {
    const pairs = [];
    for (let a = 0; a < items.length; a++) {
      for (let b = a + 1; b < items.length; b++) {
        if (spRoutesCross(items[a].route.pts, items[b].route.pts)) pairs.push([items[a], items[b]]);
      }
    }
    if (!pairs.length) break;

    let improved = false;
    for (const [A, B] of pairs) {
      // An earlier swap in this round may already have separated them.
      if (!spRoutesCross(A.route.pts, B.route.pts)) continue;

      let bestA = A.route, bestB = B.route;
      let bestCost = scorePair(A, B, bestA, bestB);

      for (const [first, second] of [[A, B], [B, A]]) {
        router.res.clearOwner(A.idx);
        router.res.clearOwner(B.idx);
        const rFirst = attempt(first);
        router.reserve(rFirst, first.idx);
        const rSecond = attempt(second);
        router.res.clearOwner(first.idx);
        const rA = first === A ? rFirst : rSecond;
        const rB = first === A ? rSecond : rFirst;
        const cost = scorePair(A, B, rA, rB);
        if (cost < bestCost - 0.5) { bestCost = cost; bestA = rA; bestB = rB; }
      }

      if (bestA !== A.route || bestB !== B.route) { improved = true; swaps++; }
      A.route = bestA;
      B.route = bestB;
      router.reserve(A.route, A.idx);
      router.reserve(B.route, B.idx);
    }

    if (!improved) break;
    ripUpUntilStable();
  }

  // Final pass: use the width of each channel instead of hugging the minimum.
  router.spreadLines(items, sharesWith);

  for (const it of items) {
    const pts = it.route.pts;
    const fromAnchor = { side: it.route.fromPort.side, offset: spOffset(it.e.from, pts[0], it.route.fromPort.side) };
    const toAnchor = { side: it.route.toPort.side, offset: spOffset(it.e.to, pts[pts.length - 1], it.route.toPort.side) };

    const p1 = getTableAnchor(it.e.from, it.e.fc, null, fromAnchor, 0, diagram.diagramLevel);
    const p2 = getTableAnchor(it.e.to, it.e.tc, null, toAnchor, 0, diagram.diagramLevel);

    // Re-seat the endpoints on the exact points the renderer will use, keeping
    // each stub perpendicular to its docking face.
    const final = pts.map(p => ({ x: p.x, y: p.y }));
    final[0] = { x: p1.x, y: p1.y };
    final[final.length - 1] = { x: p2.x, y: p2.y };
    if (final.length > 2) {
      if (it.route.fromPort.dir === 0) final[1].y = p1.y; else final[1].x = p1.x;
      if (it.route.toPort.dir === 0) final[final.length - 2].y = p2.y; else final[final.length - 2].x = p2.x;
    }

    diagram.edgeAnchors.set(it.e.key, { fromAnchor, toAnchor });
    const interior = filterRedundantWaypoints(final, 0.5).slice(1, -1);
    if (interior.length) diagram.edgeWaypoints.set(it.e.key, interior);
  }

  // Report the real geometry rather than the search's internal cost.
  const finished = items.map(it => it.route.pts);
  diagram.markDirty();
  diagram.onLayoutChange?.();
  return {
    routed: items.length,
    crossings: spCountCrossings(finished),
    overlaps: Math.round(spCountOverlap(finished)),
    passes: passes + 1,
  };
}

/** Do these two routes cross in an X anywhere? */
export function spRoutesCross(a, b) {
  for (let i = 0; i < a.length - 1; i++) {
    const a1 = a[i], a2 = a[i + 1];
    const aH = Math.abs(a1.y - a2.y) < 0.6;
    for (let j = 0; j < b.length - 1; j++) {
      const b1 = b[j], b2 = b[j + 1];
      const bH = Math.abs(b1.y - b2.y) < 0.6;
      if (aH === bH) continue;
      const h = aH ? [a1, a2] : [b1, b2];
      const v = aH ? [b1, b2] : [a1, a2];
      const hLo = Math.min(h[0].x, h[1].x), hHi = Math.max(h[0].x, h[1].x);
      const vLo = Math.min(v[0].y, v[1].y), vHi = Math.max(v[0].y, v[1].y);
      if (v[0].x > hLo + 1 && v[0].x < hHi - 1 && h[0].y > vLo + 1 && h[0].y < vHi - 1) return true;
    }
  }
  return false;
}

/** True X crossings between the finished routes (diagnostics and tests). */
export function spCountCrossings(routes) {
  const segs = [];
  for (let r = 0; r < routes.length; r++) {
    const pts = routes[r];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const horiz = Math.abs(a.y - b.y) < 0.6;
      segs.push({
        r, horiz,
        coord: horiz ? a.y : a.x,
        lo: horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
        hi: horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
      });
    }
  }
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.r === b.r || a.horiz === b.horiz) continue;
      const h = a.horiz ? a : b, v = a.horiz ? b : a;
      if (v.coord > h.lo + 1 && v.coord < h.hi - 1 && h.coord > v.lo + 1 && h.coord < v.hi - 1) n++;
    }
  }
  return n;
}

/** Total px of line drawn on top of another line (must stay at zero). */
export function spCountOverlap(routes) {
  const segs = [];
  for (let r = 0; r < routes.length; r++) {
    const pts = routes[r];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const horiz = Math.abs(a.y - b.y) < 0.6;
      segs.push({
        r, horiz,
        coord: horiz ? a.y : a.x,
        lo: horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
        hi: horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
      });
    }
  }
  let px = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.r === b.r || a.horiz !== b.horiz || Math.abs(a.coord - b.coord) > 3) continue;
      const ov = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
      if (ov > 1) px += ov;
    }
  }
  return px;
}
