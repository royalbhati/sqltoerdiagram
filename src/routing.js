// Connection routing and perimeter geometry helpers:
// - Perimeter anchoring on table bounding boxes
// - Routing styles: 'curved' (bezier), 'straight' (polyline), 'ortho-sharp' (90°), 'ortho-rounded' (90° with rounded corners)
// - Waypoints management and path construction for Canvas 2D and SVG

// Sizing metrics from renderer
import { columnY } from './renderer.js';

export const ROUTING_STYLES = {
  curved: { id: 'curved', label: 'Curved (Bézier)', icon: 'curved' },
  straight: { id: 'straight', label: 'Straight (Direct)', icon: 'straight' },
  'ortho-sharp': { id: 'ortho-sharp', label: 'Orthogonal 90° (Sharp)', icon: 'ortho-sharp' },
  'ortho-rounded': { id: 'ortho-rounded', label: 'Orthogonal 90° (Rounded)', icon: 'ortho-rounded' },
};

/**
 * Calculate the anchor point on the perimeter of a table.
 * If anchor is specified ({ side: 'left'|'right'|'top'|'bottom', offset: 0..1 }), uses that.
 * Otherwise, calculates optimal perimeter point facing the target point.
 */
export function getTableAnchor(table, colName, targetPoint = null, anchorConfig = null, laneOffset = 0, diagramLevel = 'physical', relIdx = 0, totalRels = 1) {
  if (!table || !Number.isFinite(table.x) || !Number.isFinite(table.y)) {
    return { x: 0, y: 0, nx: 1, ny: 0, side: 'right' };
  }

  const { x, y, w, h } = table;

  if (anchorConfig && anchorConfig.side) {
    const side = anchorConfig.side;
    const offset = Number.isFinite(anchorConfig.offset) ? Math.max(0, Math.min(1, anchorConfig.offset)) : 0.5;
    if (side === 'left') return { x, y: Math.max(y + 20, Math.min(y + h - 10, y + offset * h)), nx: -1, ny: 0, side: 'left' };
    if (side === 'right') return { x: x + w, y: Math.max(y + 20, Math.min(y + h - 10, y + offset * h)), nx: 1, ny: 0, side: 'right' };
    if (side === 'top') return { x: Math.max(x + 16, Math.min(x + w - 16, x + offset * w)), y, nx: 0, ny: -1, side: 'top' };
    if (side === 'bottom') return { x: Math.max(x + 16, Math.min(x + w - 16, x + offset * w)), y: y + h, nx: 0, ny: 1, side: 'bottom' };
  }

  // If column is provided and target is horizontal, default to column row height on left/right
  const colY = (colName || diagramLevel === 'conceptual')
    ? y + columnY(table, colName, diagramLevel, relIdx, totalRels)
    : y + h / 2;

  if (!targetPoint) {
    const finalY = Math.max(y + 22, Math.min(y + h - 8, colY + laneOffset));
    return { x: x + w, y: finalY, nx: 1, ny: 0, side: 'right' };
  }

  const targetX = Number.isFinite(targetPoint.w) ? targetPoint.x + targetPoint.w / 2 : targetPoint.x;
  const targetY = Number.isFinite(targetPoint.h) ? targetPoint.y + targetPoint.h / 2 : targetPoint.y;

  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  // If mostly horizontal, attach to left or right at column height (with lane offset)
  if (Math.abs(dx) * h >= Math.abs(dy) * w) {
    const finalY = Math.max(y + 22, Math.min(y + h - 8, colY + laneOffset));
    if (dx >= 0) {
      return { x: x + w, y: finalY, nx: 1, ny: 0, side: 'right' };
    } else {
      return { x, y: finalY, nx: -1, ny: 0, side: 'left' };
    }
  } else {
    // Mostly vertical (with lane offset along top/bottom edge)
    const clampX = Math.max(x + 16, Math.min(x + w - 16, targetPoint.x + laneOffset));
    if (dy >= 0) {
      return { x: clampX, y: y + h, nx: 0, ny: 1, side: 'bottom' };
    } else {
      return { x: clampX, y, nx: 0, ny: -1, side: 'top' };
    }
  }
}

/**
 * Distance between two points.
 */
export function pointDistance(a, b) {
  if (!a || !b) return -1;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Check if point r lies on line segment between p and q (diagram-js / bpmn-js algorithm).
 */
export function pointsOnLine(p, q, r, accuracy = 3) {
  if (!p || !q || !r) return false;
  const dist = pointDistance(p, q);
  if (dist < 1e-4) return true;
  // Perpendicular distance from r to line pq
  const val = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (Math.abs(val / dist) > accuracy) return false;
  // Check bounds
  const minX = Math.min(p.x, q.x) - accuracy;
  const maxX = Math.max(p.x, q.x) + accuracy;
  const minY = Math.min(p.y, q.y) - accuracy;
  const maxY = Math.max(p.y, q.y) + accuracy;
  return r.x >= minX && r.x <= maxX && r.y >= minY && r.y <= maxY;
}

/**
 * Filter redundant waypoints (merges collinear points and zero-length segments, as in diagram-js).
 */
export function filterRedundantWaypoints(waypoints, accuracy = 0.5) {
  if (!waypoints || waypoints.length <= 2) return waypoints ? [...waypoints] : [];

  // Step 1: Remove adjacent duplicate or nearly duplicate points
  const noDups = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const prev = noDups[noDups.length - 1];
    const cur = waypoints[i];
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 0.8) {
      noDups.push({ ...cur });
    }
  }

  if (noDups.length <= 2) return noDups;

  // Step 2: Filter points that lie collinear horizontally or vertically between prev and next
  let idx = 1;
  while (idx < noDups.length - 1) {
    const prev = noDups[idx - 1];
    const cur = noDups[idx];
    const next = noDups[idx + 1];

    const isHorizCollinear = Math.abs(prev.y - cur.y) <= accuracy && Math.abs(cur.y - next.y) <= accuracy;
    const isVertCollinear = Math.abs(prev.x - cur.x) <= accuracy && Math.abs(cur.x - next.x) <= accuracy;

    if (isHorizCollinear || isVertCollinear) {
      noDups.splice(idx, 1);
    } else {
      idx++;
    }
  }

  return noDups;
}

/**
 * Simplify and deduplicate orthogonal points sequence (merges collinear points and removes zero-length zigzags).
 */
export function cleanOrthogonalPoints(points) {
  if (!points || points.length <= 2) return points ? [...points] : [];
  return filterRedundantWaypoints(points, 0.5);
}

/**
 * Project a world coordinate to the nearest edge on a table perimeter (smooth continuous docking).
 */
export function projectPointToPerimeter(table, point) {
  if (!table || !Number.isFinite(table.x) || !Number.isFinite(table.y)) return null;
  const { x, y, w, h } = table;
  const px = point.x;
  const py = point.y;

  let side;
  let offset;

  if (px < x) {
    if (py < y) {
      side = (x - px) > (y - py) ? 'left' : 'top';
    } else if (py > y + h) {
      side = (x - px) > (py - (y + h)) ? 'left' : 'bottom';
    } else {
      side = 'left';
    }
  } else if (px > x + w) {
    if (py < y) {
      side = (px - (x + w)) > (y - py) ? 'right' : 'top';
    } else if (py > y + h) {
      side = (px - (x + w)) > (py - (y + h)) ? 'right' : 'bottom';
    } else {
      side = 'right';
    }
  } else {
    if (py < y) {
      side = 'top';
    } else if (py > y + h) {
      side = 'bottom';
    } else {
      const dLeft = px - x;
      const dRight = (x + w) - px;
      const dTop = py - y;
      const dBottom = (y + h) - py;
      const minD = Math.min(dLeft, dRight, dTop, dBottom);
      if (minD === dLeft) side = 'left';
      else if (minD === dRight) side = 'right';
      else if (minD === dTop) side = 'top';
      else side = 'bottom';
    }
  }

  if (side === 'left' || side === 'right') {
    offset = (py - y) / h;
  } else {
    offset = (px - x) / w;
  }
  offset = Math.max(0.04, Math.min(0.96, offset));

  let ptX, ptY, nx, ny;
  if (side === 'left') {
    ptX = x;
    ptY = Math.round(y + offset * h);
    nx = -1;
    ny = 0;
  } else if (side === 'right') {
    ptX = x + w;
    ptY = Math.round(y + offset * h);
    nx = 1;
    ny = 0;
  } else if (side === 'top') {
    ptX = Math.round(x + offset * w);
    ptY = y;
    nx = 0;
    ny = -1;
  } else {
    ptX = Math.round(x + offset * w);
    ptY = y + h;
    nx = 0;
    ny = 1;
  }

  return { side, offset, x: ptX, y: ptY, nx, ny };
}

/**
 * Project an orthogonal connection point to a table perimeter, enforcing
 * strict orthogonal approach rules so that segments never parallel an edge.
 *
 * @param {Object} table - Table bounding box { x, y, w, h }
 * @param {Object} refPt - Reference point { x, y }
 * @param {boolean} isHorizSegment - True if the approaching segment is horizontal
 * @param {boolean} isFromTable - True if this is fromTable, false if toTable
 * @returns {Object} { side, offset, x, y, nx, ny }
 */
export function dockOrthogonalAnchor(table, refPt, isHorizSegment, isFromTable = false) {
  if (!table || !Number.isFinite(table.x) || !Number.isFinite(table.y)) return null;
  const { x, y } = table;
  const w = Math.max(1, table.w || 1);
  const h = Math.max(1, table.h || 1);
  const px = refPt.x;
  const py = refPt.y;

  let side;
  let offset;

  if (isHorizSegment) {
    // Approaching segment is HORIZONTAL.
    // It can only enter/exit lateral faces (left/right) if py is within the table's vertical span [y, y + h].
    if (py < y) {
      // Strictly ABOVE the table -> must dock to 'top'
      side = 'top';
      if (px < x) {
        offset = 0.2;
      } else if (px > x + w) {
        offset = 0.8;
      } else {
        offset = (px - x) / w;
      }
    } else if (py > y + h) {
      // Strictly BELOW the table -> must dock to 'bottom'
      side = 'bottom';
      if (px < x) {
        offset = 0.2;
      } else if (px > x + w) {
        offset = 0.8;
      } else {
        offset = (px - x) / w;
      }
    } else {
      // Within vertical span -> docks to left or right lateral face
      side = px <= x + w / 2 ? 'left' : 'right';
      offset = (py - y) / h;
    }
  } else {
    // Approaching segment is VERTICAL.
    // It can only enter/exit top/bottom faces if px is within the table's horizontal span [x, x + w].
    if (px < x) {
      // Strictly to the LEFT of the table -> must dock to 'left'
      side = 'left';
      if (py < y) {
        offset = 0.2;
      } else if (py > y + h) {
        offset = 0.8;
      } else {
        offset = (py - y) / h;
      }
    } else if (px > x + w) {
      // Strictly to the RIGHT of the table -> must dock to 'right'
      side = 'right';
      if (py < y) {
        offset = 0.2;
      } else if (py > y + h) {
        offset = 0.8;
      } else {
        offset = (py - y) / h;
      }
    } else {
      // Within horizontal span -> docks to top or bottom face
      side = py <= y + h / 2 ? 'top' : 'bottom';
      offset = (px - x) / w;
    }
  }

  offset = Math.max(0.04, Math.min(0.96, offset));

  let ptX, ptY, nx, ny;
  if (side === 'left') {
    ptX = x;
    ptY = Math.round(y + offset * h);
    nx = -1;
    ny = 0;
  } else if (side === 'right') {
    ptX = x + w;
    ptY = Math.round(y + offset * h);
    nx = 1;
    ny = 0;
  } else if (side === 'top') {
    ptX = Math.round(x + offset * w);
    ptY = y;
    nx = 0;
    ny = -1;
  } else {
    ptX = Math.round(x + offset * w);
    ptY = y + h;
    nx = 0;
    ny = 1;
  }

  return { side, offset, x: ptX, y: ptY, nx, ny };
}

/**
 * Check whether a segment between p1 and p2 intersects an obstacle box.
 */
export function segmentIntersectsBox(p1, p2, box, margin = 12) {
  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) return { hit: false };
  const minX = box.x - margin;
  const maxX = box.x + box.w + margin;
  const minY = box.y - margin;
  const maxY = box.y + box.h + margin;

  const isHoriz = Math.abs(p1.y - p2.y) < 1;
  const isVert = Math.abs(p1.x - p2.x) < 1;

  if (isHoriz) {
    const y = p1.y;
    if (y >= minY && y <= maxY) {
      const segMinX = Math.min(p1.x, p2.x);
      const segMaxX = Math.max(p1.x, p2.x);
      if (segMaxX > minX && segMinX < maxX) {
        return { hit: true, axis: 'h', minX, maxX, minY, maxY, box };
      }
    }
  } else if (isVert) {
    const x = p1.x;
    if (x >= minX && x <= maxX) {
      const segMinY = Math.min(p1.y, p2.y);
      const segMaxY = Math.max(p1.y, p2.y);
      if (segMaxY > minY && segMinY < maxY) {
        return { hit: true, axis: 'v', minX, maxX, minY, maxY, box };
      }
    }
  } else {
    // Slanted or diagonal segment: exact Liang-Barsky line-box clipping
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const p = [-dx, dx, -dy, dy];
    const q = [p1.x - minX, maxX - p1.x, p1.y - minY, maxY - p1.y];
    let u1 = 0, u2 = 1;
    let hit = true;
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) { hit = false; break; }
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > u2) { hit = false; break; }
          if (t > u1) u1 = t;
        } else {
          if (t < u1) { hit = false; break; }
          if (t < u2) u2 = t;
        }
      }
    }
    if (hit && u1 <= u2) {
      return { hit: true, axis: 'diagonal', minX, maxX, minY, maxY, box };
    }
  }
  return { hit: false };
}

/**
 * Reroute orthogonal points sequence around obstacles via outer boundary channels.
 */
export function routeAroundObstacles(pts, obstacles = [], margin = 12) {
  if (!obstacles || !obstacles.length || !pts || pts.length < 2) return pts;

  let current = cleanOrthogonalPoints(pts);
  const MAX_PASSES = 4;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let modified = false;
    const next = [];

    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i];
      const b = current[i + 1];
      if (i === 0) next.push(a);

      let firstHit = null;
      for (const obs of obstacles) {
        const hit = segmentIntersectsBox(a, b, obs, margin);
        if (hit.hit) {
          firstHit = hit;
          break;
        }
      }

      if (!firstHit) {
        next.push(b);
        continue;
      }

      modified = true;
      if (firstHit.axis === 'h') {
        // Horizontal segment intersects obstacle: route above or below
        const detourY = Math.abs(a.y - firstHit.minY) < Math.abs(a.y - firstHit.maxY)
          ? firstHit.minY - 6
          : firstHit.maxY + 6;
        const detourX1 = a.x < b.x ? firstHit.minX - 6 : firstHit.maxX + 6;
        const detourX2 = a.x < b.x ? firstHit.maxX + 6 : firstHit.minX - 6;

        next.push({ x: detourX1, y: a.y });
        next.push({ x: detourX1, y: detourY });
        next.push({ x: detourX2, y: detourY });
        next.push({ x: detourX2, y: b.y });
        next.push(b);
      } else if (firstHit.axis === 'v') {
        // Vertical segment intersects obstacle: route left or right
        const detourX = Math.abs(a.x - firstHit.minX) < Math.abs(a.x - firstHit.maxX)
          ? firstHit.minX - 6
          : firstHit.maxX + 6;
        const detourY1 = a.y < b.y ? firstHit.minY - 6 : firstHit.maxY + 6;
        const detourY2 = a.y < b.y ? firstHit.maxY + 6 : firstHit.minY - 6;

        next.push({ x: a.x, y: detourY1 });
        next.push({ x: detourX, y: detourY1 });
        next.push({ x: detourX, y: detourY2 });
        next.push({ x: b.x, y: detourY2 });
        next.push(b);
      } else {
        next.push(b);
      }
    }

    current = cleanOrthogonalPoints(next);
    if (!modified) break;
  }

  return current;
}

/**
 * Generate orthogonal 90-degree step points between two endpoints with optional waypoints and obstacle avoidance.
 */
export function buildOrthogonalPoints(p1, p2, waypoints = [], obstacles = [], laneOffset = 0) {
  if (waypoints && waypoints.length) {
    // Connect p1 -> w1 -> w2 ... -> p2, ensuring each transition is 90°
    const raw = [p1, ...waypoints, p2];
    const ortho = [];

    for (let i = 0; i < raw.length - 1; i++) {
      const a = raw[i];
      const b = raw[i + 1];
      if (i === 0) ortho.push({ x: a.x, y: a.y, nx: a.nx, ny: a.ny });

      const dx = b.x - a.x;
      const dy = b.y - a.y;

      if (Math.abs(dx) < 4 || Math.abs(dy) < 4) {
        if (Math.abs(dx) < 4) b.x = a.x;
        if (Math.abs(dy) < 4) b.y = a.y;
        ortho.push({ x: b.x, y: b.y, nx: b.nx, ny: b.ny });
        continue;
      }

      // If transition between two waypoints is not aligned, insert intermediate 90° corner
      const isStart = i === 0;
      const isEnd = i === raw.length - 2;

      if (isStart && Math.abs(a.nx || 0) === 1) {
        ortho.push({ x: b.x, y: a.y });
      } else if (isStart && Math.abs(a.ny || 0) === 1) {
        ortho.push({ x: a.x, y: b.y });
      } else if (isEnd && Math.abs(b.nx || 0) === 1) {
        ortho.push({ x: a.x, y: b.y });
      } else if (isEnd && Math.abs(b.ny || 0) === 1) {
        ortho.push({ x: b.x, y: a.y });
      } else {
        ortho.push({ x: a.x, y: b.y });
      }
      ortho.push({ x: b.x, y: b.y, nx: b.nx, ny: b.ny });
    }
    const cleaned = cleanOrthogonalPoints(ortho);
    return cleaned;
  }

  // Default automatic S-bend or L-bend
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  const nxa = p1.nx ?? (dx >= 0 ? 1 : -1);
  const nya = p1.ny ?? 0;
  const nxb = p2.nx ?? (dx >= 0 ? -1 : 1);
  const nyb = p2.ny ?? 0;

  const ortho = [{ x: p1.x, y: p1.y, nx: nxa, ny: nya }];

  if (Math.abs(nxa) === 1 && Math.abs(nxb) === 1) {
    // Both exit/enter horizontally: S-bend or U-bend
    let midX;
    if (nxa === 1 && nxb === -1 && dx > 40) {
      // Natural forward S-bend: offset corridor while respecting table borders
      const rawMid = p1.x + dx / 2;
      const safeMin = p1.x + 20;
      const safeMax = p2.x - 20;
      midX = Math.max(safeMin, Math.min(safeMax, rawMid + laneOffset));
    } else if (nxa === -1 && nxb === 1 && dx < -40) {
      // Natural backward S-bend
      const rawMid = p1.x + dx / 2;
      const safeMin = p2.x + 20;
      const safeMax = p1.x - 20;
      midX = Math.max(safeMin, Math.min(safeMax, rawMid + laneOffset));
    } else {
      midX = p1.x + nxa * Math.max(30, Math.abs(dx) * 0.4) + laneOffset;
    }

    ortho.push({ x: midX, y: p1.y });
    ortho.push({ x: midX, y: p2.y });
  } else if (Math.abs(nya) === 1 && Math.abs(nyb) === 1) {
    // Both exit/enter vertically
    let midY;
    if (nya === 1 && nyb === -1 && dy > 40) {
      const rawMid = p1.y + dy / 2;
      const safeMin = p1.y + 20;
      const safeMax = p2.y - 20;
      midY = Math.max(safeMin, Math.min(safeMax, rawMid + laneOffset));
    } else if (nya === -1 && nyb === 1 && dy < -40) {
      const rawMid = p1.y + dy / 2;
      const safeMin = p2.y + 20;
      const safeMax = p1.y - 20;
      midY = Math.max(safeMin, Math.min(safeMax, rawMid + laneOffset));
    } else {
      midY = p1.y + nya * Math.max(30, Math.abs(dy) * 0.4) + laneOffset;
    }
    ortho.push({ x: p1.x, y: midY });
    ortho.push({ x: p2.x, y: midY });
  } else if (Math.abs(nxa) === 1) {
    ortho.push({ x: p2.x, y: p1.y });
  } else {
    ortho.push({ x: p1.x, y: p2.y });
  }

  ortho.push({ x: p2.x, y: p2.y, nx: nxb, ny: nyb });
  return cleanOrthogonalPoints(ortho);
}

/**
 * Extract all horizontal and vertical segments from an orthogonal route.
 */
export function getOrthogonalSegments(p1, p2, waypoints = [], obstacles = []) {
  const pts = buildOrthogonalPoints(p1, p2, waypoints, obstacles);
  const segments = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const isVertical = Math.abs(a.x - b.x) <= Math.abs(a.y - b.y);
    const mid = {
      x: Math.round((a.x + b.x) / 2),
      y: Math.round((a.y + b.y) / 2),
    };
    segments.push({
      index: i,
      isVertical,
      p1: a,
      p2: b,
      mid,
      length: Math.hypot(b.x - a.x, b.y - a.y),
    });
  }
  return { points: pts, segments };
}

/**
 * Move a whole orthogonal segment along its perpendicular axis (bpmn-js / diagram-js style).
 * Takes an immutable base sequence of points (p1, corners..., p2) and mouse delta,
 * moving the target segment and adjusting neighbor segments orthogonally without duplicating vertices.
 * If moving the first or last segment connected to a table, slides the anchor along the table perimeter.
 * Returns { waypoints, fromAnchor, toAnchor }.
 */
export function moveOrthogonalSegment(
  p1,
  p2,
  basePointsOrWaypoints,
  segIndex,
  deltaXOrMouseX,
  deltaYOrMouseY,
  fromTable = null,
  toTable = null
) {
  let pts;
  let isDelta = false;
  let dx = 0;
  let dy = 0;

  if (Array.isArray(basePointsOrWaypoints) && basePointsOrWaypoints.length >= 2 &&
      basePointsOrWaypoints[0].x !== undefined &&
      (basePointsOrWaypoints.length > 2 || basePointsOrWaypoints[0] === p1 || (basePointsOrWaypoints[0].x === p1.x && basePointsOrWaypoints[0].y === p1.y))) {
    pts = basePointsOrWaypoints.map(p => ({ ...p }));
    isDelta = true;
    dx = Math.round(deltaXOrMouseX || 0);
    dy = Math.round(deltaYOrMouseY || 0);
  } else {
    pts = buildOrthogonalPoints(p1, p2, basePointsOrWaypoints);
    isDelta = false;
  }

  if (segIndex < 0 || segIndex >= pts.length - 1) {
    const res = pts.slice(1, -1);
    res.waypoints = res;
    res.fromAnchor = null;
    res.toAnchor = null;
    return res;
  }

  const a = pts[segIndex];
  const b = pts[segIndex + 1];
  const isVertical = Math.abs(a.x - b.x) <= Math.abs(a.y - b.y);

  let fromAnchor = null;
  let toAnchor = null;

  if (isDelta) {
    if (pts.length === 2 && fromTable && toTable) {
      if (!isVertical) {
        const targetY = Math.round(a.y + dy);
        const projFrom = dockOrthogonalAnchor(fromTable, { x: a.x, y: targetY }, true, true);
        const projTo = dockOrthogonalAnchor(toTable, { x: b.x, y: targetY }, true, false);
        if (projFrom && projTo) {
          fromAnchor = { side: projFrom.side, offset: projFrom.offset };
          toAnchor = { side: projTo.side, offset: projTo.offset };

          const fromIsLat = projFrom.side === 'left' || projFrom.side === 'right';
          const toIsLat = projTo.side === 'left' || projTo.side === 'right';

          let waypoints = [];
          if (fromIsLat && toIsLat) {
            waypoints = [];
          } else if (!fromIsLat && toIsLat) {
            waypoints = [{ x: projFrom.x, y: projTo.y }];
          } else if (fromIsLat && !toIsLat) {
            waypoints = [{ x: projTo.x, y: projFrom.y }];
          } else {
            waypoints = [
              { x: projFrom.x, y: targetY },
              { x: projTo.x, y: targetY }
            ];
          }

          const cleanedWps = filterRedundantWaypoints(waypoints, 4);
          cleanedWps.waypoints = cleanedWps;
          cleanedWps.fromAnchor = fromAnchor;
          cleanedWps.toAnchor = toAnchor;
          console.log('[moveOrthogonalSegment single-seg horizontal] ' + JSON.stringify({
            dy,
            fromAnchor,
            toAnchor,
            waypointCount: cleanedWps.length,
            waypoints: cleanedWps.map(p => ({ x: p.x, y: p.y }))
          }));
          return cleanedWps;
        }
      } else {
        const targetX = Math.round(a.x + dx);
        const projFrom = dockOrthogonalAnchor(fromTable, { x: targetX, y: a.y }, false, true);
        const projTo = dockOrthogonalAnchor(toTable, { x: targetX, y: b.y }, false, false);
        if (projFrom && projTo) {
          fromAnchor = { side: projFrom.side, offset: projFrom.offset };
          toAnchor = { side: projTo.side, offset: projTo.offset };

          const fromIsTopBot = projFrom.side === 'top' || projFrom.side === 'bottom';
          const toIsTopBot = projTo.side === 'top' || projTo.side === 'bottom';

          let waypoints = [];
          if (fromIsTopBot && toIsTopBot) {
            waypoints = [];
          } else if (!fromIsTopBot && toIsTopBot) {
            waypoints = [{ x: projTo.x, y: projFrom.y }];
          } else if (fromIsTopBot && !toIsTopBot) {
            waypoints = [{ x: projFrom.x, y: projTo.y }];
          } else {
            waypoints = [
              { x: targetX, y: projFrom.y },
              { x: targetX, y: projTo.y }
            ];
          }

          const cleanedWps = filterRedundantWaypoints(waypoints, 4);
          cleanedWps.waypoints = cleanedWps;
          cleanedWps.fromAnchor = fromAnchor;
          cleanedWps.toAnchor = toAnchor;
          console.log('[moveOrthogonalSegment single-seg vertical] ' + JSON.stringify({
            dx,
            fromAnchor,
            toAnchor,
            waypointCount: cleanedWps.length,
            waypoints: cleanedWps.map(p => ({ x: p.x, y: p.y }))
          }));
          return cleanedWps;
        }
      }
    }

    if (isVertical) {
      if (segIndex === 0 && fromTable) {
        const targetX = a.x + dx;
        const proj = dockOrthogonalAnchor(fromTable, { x: targetX, y: a.y }, false, true);
        if (proj) {
          fromAnchor = { side: proj.side, offset: proj.offset };
          if (proj.side === 'top' || proj.side === 'bottom') {
            a.x = proj.x;
            a.y = proj.y;
            b.x = a.x;
          } else {
            // Anchor turns to lateral face (left or right)
            a.x = proj.x;
            a.y = proj.y;
            b.x = Math.round(targetX);
            pts.splice(1, 0, { x: b.x, y: a.y });
          }
        } else {
          a.x += dx;
          b.x += dx;
        }
      } else if (segIndex === pts.length - 2 && toTable) {
        const targetX = b.x + dx;
        const proj = dockOrthogonalAnchor(toTable, { x: targetX, y: b.y }, false, false);
        if (proj) {
          toAnchor = { side: proj.side, offset: proj.offset };
          if (proj.side === 'top' || proj.side === 'bottom') {
            b.x = proj.x;
            b.y = proj.y;
            a.x = b.x;
          } else {
            // Anchor turns to lateral face (left or right)
            b.x = proj.x;
            b.y = proj.y;
            a.x = Math.round(targetX);
            pts.splice(segIndex + 1, 0, { x: a.x, y: b.y });
          }
        } else {
          a.x += dx;
          b.x += dx;
        }
      } else {
        a.x += dx;
        b.x += dx;
      }
    } else {
      // Horizontal segment: shifts in Y
      if (segIndex === 0 && fromTable) {
        const targetY = a.y + dy;
        const proj = dockOrthogonalAnchor(fromTable, { x: a.x, y: targetY }, true, true);
        if (proj) {
          fromAnchor = { side: proj.side, offset: proj.offset };
          if (proj.side === 'left' || proj.side === 'right') {
            a.x = proj.x;
            a.y = proj.y;
            b.y = a.y;
          } else {
            // Anchor turns to top or bottom face
            a.x = proj.x;
            a.y = proj.y;
            b.y = Math.round(targetY);
            pts.splice(1, 0, { x: a.x, y: b.y });
          }
        } else {
          a.y += dy;
          b.y += dy;
        }
      } else if (segIndex === pts.length - 2 && toTable) {
        const targetY = b.y + dy;
        const proj = dockOrthogonalAnchor(toTable, { x: b.x, y: targetY }, true, false);
        if (proj) {
          toAnchor = { side: proj.side, offset: proj.offset };
          if (proj.side === 'left' || proj.side === 'right') {
            b.x = proj.x;
            b.y = proj.y;
            a.y = b.y;
          } else {
            // Anchor turns to top or bottom face
            b.x = proj.x;
            b.y = proj.y;
            a.y = Math.round(targetY);
            pts.splice(segIndex + 1, 0, { x: b.x, y: a.y });
          }
        } else {
          a.y += dy;
          b.y += dy;
        }
      } else {
        a.y += dy;
        b.y += dy;
      }
    }
  } else {
    const targetX = Math.round(deltaXOrMouseX);
    const targetY = Math.round(deltaYOrMouseY);
    if (isVertical) {
      a.x = targetX;
      b.x = targetX;
    } else {
      a.y = targetY;
      b.y = targetY;
    }
  }

  // 1) From table anchoring: always maintain and project pts[0] to fromTable based on adjacent point pts[1]
  if (fromTable && pts.length >= 2) {
    if (!fromAnchor) {
      let refPt = { x: pts[1].x, y: pts[1].y };
      if (pts.length > 2) {
        // If pts[1] is inside fromTable, project towards segment continuation
        if (refPt.x >= fromTable.x && refPt.x <= fromTable.x + fromTable.w &&
            refPt.y >= fromTable.y && refPt.y <= fromTable.y + fromTable.h) {
          const nextPt = pts[2] || pts[1];
          if (nextPt.x > fromTable.x + fromTable.w) {
            refPt = { x: fromTable.x + fromTable.w + 10, y: refPt.y };
          } else if (nextPt.x < fromTable.x) {
            refPt = { x: fromTable.x - 10, y: refPt.y };
          }
        }
      }
      const proj = projectPointToPerimeter(fromTable, refPt);
      if (proj) {
        pts[0].x = proj.x;
        pts[0].y = proj.y;
        pts[0].nx = proj.side === 'left' ? -1 : (proj.side === 'right' ? 1 : 0);
        pts[0].ny = proj.side === 'top' ? -1 : (proj.side === 'bottom' ? 1 : 0);
        fromAnchor = { side: proj.side, offset: proj.offset };
      }
    }
  }

  // 2) To table anchoring: always maintain and project pts[last] to toTable based on adjacent point pts[last - 1]
  if (toTable && pts.length >= 2) {
    const lastIdx = pts.length - 1;
    if (!toAnchor) {
      let refPt = { x: pts[lastIdx - 1].x, y: pts[lastIdx - 1].y };
      if (pts.length > 2) {
        // If pts[last - 1] is inside toTable, project towards segment continuation
        if (refPt.x >= toTable.x && refPt.x <= toTable.x + toTable.w &&
            refPt.y >= toTable.y && refPt.y <= toTable.y + toTable.h) {
          const prevPt = pts[lastIdx - 2] || pts[lastIdx - 1];
          if (prevPt.x > toTable.x + toTable.w) {
            refPt = { x: toTable.x + toTable.w + 10, y: refPt.y };
          } else if (prevPt.x < toTable.x) {
            refPt = { x: toTable.x - 10, y: refPt.y };
          }
        }
      }
      const proj = projectPointToPerimeter(toTable, refPt);
      if (proj) {
        pts[lastIdx].x = proj.x;
        pts[lastIdx].y = proj.y;
        pts[lastIdx].nx = proj.side === 'left' ? -1 : (proj.side === 'right' ? 1 : 0);
        pts[lastIdx].ny = proj.side === 'top' ? -1 : (proj.side === 'bottom' ? 1 : 0);
        toAnchor = { side: proj.side, offset: proj.offset };
      }
    }
  }

  // 3) Ensure intermediate transitions between anchors and segments are strictly orthogonal
  const fullRebuilt = [];
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    if (i === 0) {
      fullRebuilt.push(pt);
      continue;
    }
    const last = fullRebuilt[fullRebuilt.length - 1];
    const segDx = pt.x - last.x;
    const segDy = pt.y - last.y;

    if (Math.abs(segDx) > 4 && Math.abs(segDy) > 4) {
      // Needs a 90° turn between last and pt
      if (i === 1 && Math.abs(last.nx || 0) === 1) {
        fullRebuilt.push({ x: pt.x, y: last.y });
      } else if (i === 1 && Math.abs(last.ny || 0) === 1) {
        fullRebuilt.push({ x: last.x, y: pt.y });
      } else if (i === pts.length - 1 && Math.abs(pt.nx || 0) === 1) {
        fullRebuilt.push({ x: last.x, y: pt.y });
      } else if (i === pts.length - 1 && Math.abs(pt.ny || 0) === 1) {
        fullRebuilt.push({ x: pt.x, y: last.y });
      } else {
        fullRebuilt.push({ x: pt.x, y: last.y });
      }
    }
    fullRebuilt.push(pt);
  }

  const cleaned = filterRedundantWaypoints(fullRebuilt, 0.5);
  const result = cleaned.slice(1, -1);
  result.waypoints = result;
  result.fromAnchor = fromAnchor;
  result.toAnchor = toAnchor;
  console.log('[moveOrthogonalSegment] ' + JSON.stringify({
    segIndex,
    dx,
    dy,
    isVertical,
    fromAnchor,
    toAnchor,
    waypointCount: result.length,
    waypoints: result.map(p => ({ x: p.x, y: p.y }))
  }));
  return result;
}

/**
 * Check if a point can connect directly to a table with a single straight orthogonal segment.
 */
export function canConnectDirectly(table, pt) {
  if (!table || !Number.isFinite(table.x) || !Number.isFinite(table.y)) return null;
  const { x, y } = table;
  const w = Math.max(1, table.w || 1);
  const h = Math.max(1, table.h || 1);
  const px = pt.x;
  const py = pt.y;

  // Can connect horizontally to left face:
  if (px < x && py >= y && py <= y + h) {
    return { side: 'left', isHoriz: true, offset: (py - y) / h };
  }
  // Can connect horizontally to right face:
  if (px > x + w && py >= y && py <= y + h) {
    return { side: 'right', isHoriz: true, offset: (py - y) / h };
  }
  // Can connect vertically to top face:
  if (py < y && px >= x && px <= x + w) {
    return { side: 'top', isHoriz: false, offset: (px - x) / w };
  }
  // Can connect vertically to bottom face:
  if (py > y + h && px >= x && px <= x + w) {
    return { side: 'bottom', isHoriz: false, offset: (px - x) / w };
  }
  return null;
}

/**
 * Move a corner vertex in orthogonal mode while keeping connected segments horizontal/vertical (bpmn-js style).
 * If moved to become collinear with its neighbors, it automatically collapses/merges.
 */
export function moveOrthogonalCorner(p1, p2, basePointsOrWaypoints, cornerIndex, mouseX, mouseY, fromTable = null, toTable = null) {
  let pts;
  if (Array.isArray(basePointsOrWaypoints) && basePointsOrWaypoints.length > 2 &&
      basePointsOrWaypoints[0].x !== undefined) {
    pts = basePointsOrWaypoints.map(p => ({ ...p }));
  } else {
    pts = buildOrthogonalPoints(p1, p2, basePointsOrWaypoints);
  }

  const targetX = Math.round(mouseX);
  const targetY = Math.round(mouseY);

  // If pts has 2 or fewer points, construct intermediate corner at mouse position so it never locks up
  if (pts.length <= 2) {
    pts = [pts[0], { x: targetX, y: targetY }, pts[pts.length - 1]];
  }

  let k = Math.max(1, Math.min(pts.length - 2, cornerIndex + 1));
  if (k < 1 || k >= pts.length - 1) {
    const res = pts.slice(1, -1);
    res.waypoints = res;
    res.fromAnchor = null;
    res.toAnchor = null;
    res.activeCornerIndex = -1;
    res.points = pts;
    return res;
  }

  const cur = pts[k];
  const prev = pts[k - 1];
  const next = pts[k + 1];

  const prevIsHoriz = Math.abs(prev.y - cur.y) <= Math.abs(prev.x - cur.x);
  if (prevIsHoriz) {
    prev.y = targetY;
    next.x = targetX;
  } else {
    prev.x = targetX;
    next.y = targetY;
  }

  cur.x = targetX;
  cur.y = targetY;

  // Check if intermediate corners should collapse when cur can connect directly to tables
  if (fromTable && k > 1) {
    const direct = canConnectDirectly(fromTable, cur);
    if (direct) {
      pts.splice(1, k - 1);
      k = 1;
    }
  }
  if (toTable && k < pts.length - 2) {
    const direct = canConnectDirectly(toTable, cur);
    if (direct) {
      pts.splice(k + 1, pts.length - 2 - k);
    }
  }

  let fromAnchor = null;
  let toAnchor = null;

  // 1) From table anchoring: always maintain and project pts[0] to fromTable based on its adjacent point pts[1]
  if (fromTable) {
    const refPt = { x: pts[1].x, y: pts[1].y };
    const direct = k === 1 ? canConnectDirectly(fromTable, cur) : null;
    const isHorizFrom = direct ? direct.isHoriz : (k === 1 ? prevIsHoriz : (Math.abs(pts[0].y - pts[1].y) < Math.abs(pts[0].x - pts[1].x)));
    const proj = dockOrthogonalAnchor(fromTable, refPt, isHorizFrom, true);
    if (proj) {
      pts[0].x = proj.x;
      pts[0].y = proj.y;
      pts[0].nx = proj.nx;
      pts[0].ny = proj.ny;
      fromAnchor = { side: proj.side, offset: proj.offset };
    }
  }

  // 2) To table anchoring: always maintain and project pts[last] to toTable based on its adjacent point pts[last - 1]
  if (toTable) {
    const lastIdx = pts.length - 1;
    const refPt = { x: pts[lastIdx - 1].x, y: pts[lastIdx - 1].y };
    const direct = k === lastIdx - 1 ? canConnectDirectly(toTable, cur) : null;
    const isHorizTo = direct ? direct.isHoriz : (k === lastIdx - 1 ? !prevIsHoriz : (Math.abs(pts[lastIdx - 1].y - pts[lastIdx].y) < Math.abs(pts[lastIdx - 1].x - pts[lastIdx].x)));
    const proj = dockOrthogonalAnchor(toTable, refPt, isHorizTo, false);
    if (proj) {
      pts[lastIdx].x = proj.x;
      pts[lastIdx].y = proj.y;
      pts[lastIdx].nx = proj.nx;
      pts[lastIdx].ny = proj.ny;
      toAnchor = { side: proj.side, offset: proj.offset };
    }
  }

  // 3) Ensure intermediate transitions between anchors and corner are strictly orthogonal
  const fullRebuilt = [];
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    if (i === 0) {
      fullRebuilt.push(pt);
      continue;
    }
    const last = fullRebuilt[fullRebuilt.length - 1];
    const dx = pt.x - last.x;
    const dy = pt.y - last.y;

    if (Math.abs(dx) > 4 && Math.abs(dy) > 4) {
      // Needs a 90° turn between last and pt
      if (i === 1 && Math.abs(last.nx || 0) === 1) {
        fullRebuilt.push({ x: pt.x, y: last.y });
      } else if (i === 1 && Math.abs(last.ny || 0) === 1) {
        fullRebuilt.push({ x: last.x, y: pt.y });
      } else if (i === pts.length - 1 && Math.abs(pt.nx || 0) === 1) {
        fullRebuilt.push({ x: last.x, y: pt.y });
      } else if (i === pts.length - 1 && Math.abs(pt.ny || 0) === 1) {
        fullRebuilt.push({ x: pt.x, y: last.y });
      } else {
        fullRebuilt.push({ x: pt.x, y: last.y });
      }
    }
    fullRebuilt.push(pt);
  }

  const cleaned = filterRedundantWaypoints(fullRebuilt, 0.5);
  const waypoints = cleaned.slice(1, -1);

  // Find which waypoint in the cleaned array corresponds to the corner being dragged
  let activeCornerIndex = 0;
  let minDist = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const d = Math.hypot(waypoints[i].x - targetX, waypoints[i].y - targetY);
    if (d < minDist) {
      minDist = d;
      activeCornerIndex = i;
    }
  }
  if (!waypoints.length) {
    // Preserve the corner under user's mouse so the drag gesture never locks up
    waypoints.push({ x: targetX, y: targetY });
    activeCornerIndex = 0;
    cleaned.splice(1, 0, { x: targetX, y: targetY });
  }

  const result = waypoints;
  result.waypoints = waypoints;
  result.fromAnchor = fromAnchor;
  result.toAnchor = toAnchor;
  result.activeCornerIndex = activeCornerIndex;
  result.points = cleaned;

  console.log('[moveOrthogonalCorner] ' + JSON.stringify({
    cornerIndex,
    target: { x: targetX, y: targetY },
    fromAnchor,
    toAnchor,
    activeCornerIndex,
    waypointCount: result.length,
    waypoints: result.map(p => ({ x: p.x, y: p.y }))
  }));
  return result;
}

/**
 * Draw route onto Canvas 2D context based on routing style.
 */
export function drawRoutePath(ctx, style, p1, p2, waypoints = [], radius = 8, obstacles = [], laneOffset = 0) {
  const pts = [p1, ...(waypoints || []), p2];

  if (style === 'straight') {
    ctx.moveTo(p1.x, p1.y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    return;
  }

  if (style === 'curved') {
    let effectivePts = pts;

    if (effectivePts.length <= 2) {
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const bend = Math.max(36, Math.min(dist * 0.45, 200));

      const nx1 = p1.nx !== undefined ? p1.nx : (p1.x <= p2.x ? 1 : -1);
      const ny1 = p1.ny !== undefined ? p1.ny : 0;
      const nx2 = p2.nx !== undefined ? p2.nx : (p2.x <= p1.x ? 1 : -1);
      const ny2 = p2.ny !== undefined ? p2.ny : 0;

      const c1x = p1.x + nx1 * bend;
      const c1y = p1.y + ny1 * bend;
      const c2x = p2.x + nx2 * bend;
      const c2y = p2.y + ny2 * bend;

      ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
    } else {
      // Smooth curve passing through detour waypoints
      ctx.moveTo(effectivePts[0].x, effectivePts[0].y);
      for (let i = 0; i < effectivePts.length - 1; i++) {
        const a = effectivePts[i];
        const b = effectivePts[i + 1];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        ctx.quadraticCurveTo(a.x, a.y, mx, my);
      }
      ctx.lineTo(effectivePts[effectivePts.length - 1].x, effectivePts[effectivePts.length - 1].y);
    }
    return;
  }

  // Orthogonal styles ('ortho-sharp' and 'ortho-rounded')
  const ortho = buildOrthogonalPoints(p1, p2, waypoints, obstacles, laneOffset);
  if (!ortho.length) return;

  ctx.moveTo(ortho[0].x, ortho[0].y);

  if (style === 'ortho-sharp' || radius <= 0) {
    for (let i = 1; i < ortho.length; i++) {
      ctx.lineTo(ortho[i].x, ortho[i].y);
    }
    return;
  }

  // 'ortho-rounded' with arcTo rounded corners
  const r = Math.max(2, Math.min(14, radius));
  for (let i = 1; i < ortho.length - 1; i++) {
    const cur = ortho[i];
    const next = ortho[i + 1];
    ctx.arcTo(cur.x, cur.y, next.x, next.y, r);
  }
  ctx.lineTo(ortho[ortho.length - 1].x, ortho[ortho.length - 1].y);
}

/**
 * Generate SVG path `d` attribute string for the given routing style.
 */
export function buildSVGPath(style, p1, p2, waypoints = [], radius = 8, obstacles = [], laneOffset = 0) {
  const pts = [p1, ...(waypoints || []), p2];

  if (style === 'straight') {
    return 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ');
  }

  if (style === 'curved') {
    let effectivePts = pts;

    if (effectivePts.length <= 2) {
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const bend = Math.max(36, Math.min(dist * 0.45, 200));

      const nx1 = p1.nx !== undefined ? p1.nx : (p1.x <= p2.x ? 1 : -1);
      const ny1 = p1.ny !== undefined ? p1.ny : 0;
      const nx2 = p2.nx !== undefined ? p2.nx : (p2.x <= p1.x ? 1 : -1);
      const ny2 = p2.ny !== undefined ? p2.ny : 0;

      const c1x = p1.x + nx1 * bend;
      const c1y = p1.y + ny1 * bend;
      const c2x = p2.x + nx2 * bend;
      const c2y = p2.y + ny2 * bend;

      return `M ${p1.x} ${p1.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    } else {
      let d = `M ${effectivePts[0].x} ${effectivePts[0].y}`;
      for (let i = 0; i < effectivePts.length - 1; i++) {
        const a = effectivePts[i];
        const b = effectivePts[i + 1];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        d += ` Q ${a.x} ${a.y}, ${mx} ${my}`;
      }
      d += ` L ${effectivePts[effectivePts.length - 1].x} ${effectivePts[effectivePts.length - 1].y}`;
      return d;
    }
  }

  // Orthogonal styles
  const ortho = buildOrthogonalPoints(p1, p2, waypoints, obstacles, laneOffset);
  if (!ortho.length) return `M ${p1.x} ${p1.y}`;

  if (style === 'ortho-sharp' || radius <= 0) {
    return 'M ' + ortho.map(p => `${p.x} ${p.y}`).join(' L ');
  }

  // Orthogonal rounded SVG
  let d = `M ${ortho[0].x} ${ortho[0].y}`;
  const r = Math.max(2, Math.min(14, radius));

  for (let i = 1; i < ortho.length - 1; i++) {
    const prev = ortho[i - 1];
    const cur = ortho[i];
    const next = ortho[i + 1];

    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const cr = Math.min(r, d1 / 2, d2 / 2);

    const v1x = (prev.x - cur.x) / (d1 || 1);
    const v1y = (prev.y - cur.y) / (d1 || 1);
    const v2x = (next.x - cur.x) / (d2 || 1);
    const v2y = (next.y - cur.y) / (d2 || 1);

    const pStart = { x: cur.x + v1x * cr, y: cur.y + v1y * cr };
    const pEnd = { x: cur.x + v2x * cr, y: cur.y + v2y * cr };

    d += ` L ${pStart.x} ${pStart.y} Q ${cur.x} ${cur.y}, ${pEnd.x} ${pEnd.y}`;
  }

  d += ` L ${ortho[ortho.length - 1].x} ${ortho[ortho.length - 1].y}`;
  return d;
}

/**
 * Find point on segment closest to mouse (for vertex insertion and hit testing)
 */
export function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return { dist: Math.hypot(px - x1, py - y1), x: x1, y: y1, t: 0 };
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * (x2 - x1);
  const projY = y1 + t * (y2 - y1);
  return { dist: Math.hypot(px - projX, py - projY), x: projX, y: projY, t };
}

/**
 * Calculate accurate distance from point (px, py) to any routed connection path.
 * Returns { minDist, nearestPoint, insertIndex }
 */
export function distanceToRoute(px, py, style, p1, p2, waypoints = []) {
  const pts = [p1, ...(waypoints || []), p2];

  if (style === 'straight') {
    let minDist = Infinity;
    let bestPt = { x: p1.x, y: p1.y };
    let bestSegment = 0;

    for (let i = 0; i < pts.length - 1; i++) {
      const res = pointToSegmentDistance(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      if (res.dist < minDist) {
        minDist = res.dist;
        bestPt = { x: res.x, y: res.y };
        bestSegment = i;
      }
    }
    return { minDist, nearestPoint: bestPt, insertIndex: bestSegment, segmentIndex: bestSegment };
  }

  if (style === 'curved') {
    let minDist = Infinity;
    let bestPt = { x: p1.x, y: p1.y };
    let bestSegment = 0;

    if (!waypoints || !waypoints.length) {
      const fromRight = (p1.nx === 1) || (p1.nx === undefined && p1.x <= p2.x);
      const dx = Math.max(28, Math.abs(p2.x - p1.x) * 0.4);
      const c1x = p1.x + (p1.nx !== undefined ? p1.nx * dx : (fromRight ? dx : -dx));
      const c1y = p1.y + (p1.ny !== undefined ? p1.ny * dx : 0);
      const c2x = p2.x + (p2.nx !== undefined ? p2.nx * dx : (fromRight ? -dx : dx));
      const c2y = p2.y + (p2.ny !== undefined ? p2.ny * dx : 0);

      // Sample cubic bezier
      let prevX = p1.x, prevY = p1.y;
      const steps = 24;
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        const iu = 1 - u;
        const curX = iu * iu * iu * p1.x + 3 * iu * iu * u * c1x + 3 * iu * u * u * c2x + u * u * u * p2.x;
        const curY = iu * iu * iu * p1.y + 3 * iu * iu * u * c1y + 3 * iu * u * u * c2y + u * u * u * p2.y;
        const res = pointToSegmentDistance(px, py, prevX, prevY, curX, curY);
        if (res.dist < minDist) {
          minDist = res.dist;
          bestPt = { x: res.x, y: res.y };
          bestSegment = 0;
        }
        prevX = curX;
        prevY = curY;
      }
      return { minDist, nearestPoint: bestPt, insertIndex: 0, segmentIndex: 0 };
    } else {
      // Smooth curve through waypoints
      for (let s = 0; s < pts.length - 1; s++) {
        const a = pts[s];
        const b = pts[s + 1];
        let prevX = a.x, prevY = a.y;
        const steps = 12;
        for (let i = 1; i <= steps; i++) {
          const u = i / steps;
          const curX = (1 - u) * a.x + u * b.x;
          const curY = (1 - u) * a.y + u * b.y;
          const res = pointToSegmentDistance(px, py, prevX, prevY, curX, curY);
          if (res.dist < minDist) {
            minDist = res.dist;
            bestPt = { x: res.x, y: res.y };
            bestSegment = s;
          }
          prevX = curX;
          prevY = curY;
        }
      }
      return { minDist, nearestPoint: bestPt, insertIndex: bestSegment, segmentIndex: bestSegment };
    }
  }

  // Orthogonal styles
  const ortho = buildOrthogonalPoints(p1, p2, waypoints);
  let minDist = Infinity;
  let bestPt = { x: p1.x, y: p1.y };
  let bestSegment = 0;
  let isVertical = false;
  let segMid = { x: p1.x, y: p1.y };

  for (let i = 0; i < ortho.length - 1; i++) {
    const a = ortho[i];
    const b = ortho[i + 1];
    const res = pointToSegmentDistance(px, py, a.x, a.y, b.x, b.y);
    if (res.dist < minDist) {
      minDist = res.dist;
      bestPt = { x: res.x, y: res.y };
      bestSegment = i;
      isVertical = Math.abs(a.x - b.x) <= Math.abs(a.y - b.y);
      segMid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
    }
  }

  // Compute waypoint insertIndex by finding which sub-section in [p1, ...waypoints, p2] the click belongs to
  let insertIndex = 0;
  if (!waypoints || !waypoints.length) {
    insertIndex = 0;
  } else {
    const raw = [p1, ...waypoints, p2];
    let minSubDist = Infinity;
    for (let k = 0; k < raw.length - 1; k++) {
      const sub = buildOrthogonalPoints(raw[k], raw[k + 1], []);
      for (let s = 0; s < sub.length - 1; s++) {
        const d = pointToSegmentDistance(px, py, sub[s].x, sub[s].y, sub[s + 1].x, sub[s + 1].y).dist;
        if (d < minSubDist) {
          minSubDist = d;
          insertIndex = k;
        }
      }
    }
  }

  return {
    minDist,
    nearestPoint: bestPt,
    insertIndex,
    segmentIndex: bestSegment,
    isVertical,
    segMid,
    totalSegments: ortho.length - 1,
  };
}
