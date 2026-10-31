import { SCENE_WALLS, SCENE_FURNITURE, FURNITURE_ASSETS } from './scene_layout.js';
import { BUILDING_BOUNDS, FLOOR_HEIGHT, STAIRS, SHAFT_BOXES } from './building.js';

export function convex_hull(points) {
  const sorted = [...new Map(points.map(point => [point.join(','), point])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  function half(vertices) {
    const result = [];
    for (const point of vertices) {
      while (result.length > 1 && cross(result.at(-2), result.at(-1), point) <= 0) result.pop();
      result.push(point);
    }
    return result.slice(0, -1);
  }
  return [...half(sorted), ...half([...sorted].reverse())];
}

function near_polygon(x, y, polygon, radius) {
  let inside = true;
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const dx = bx - ax;
    const dy = by - ay;
    if (dx * (y - ay) - dy * (x - ax) < -1e-10) inside = false;
    const fraction = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(x - ax - fraction * dx, y - ay - fraction * dy) <= radius) return true;
  }
  return inside;
}

export function rectangle(bounds) {
  const [left, right, bottom, top] = bounds;
  return [[left, bottom], [right, bottom], [right, top], [left, top]];
}

class MinHeap {
  constructor() { this.entries = []; }
  push(entry) {
    const entries = this.entries;
    entries.push(entry);
    let index = entries.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (entries[parent][1] <= entry[1]) break;
      entries[index] = entries[parent];
      index = parent;
    }
    entries[index] = entry;
  }
  pop() {
    const entries = this.entries;
    const first = entries[0];
    const last = entries.pop();
    if (entries.length) {
      let index = 0;
      while (index * 2 + 1 < entries.length) {
        let child = index * 2 + 1;
        if (child + 1 < entries.length && entries[child + 1][1] < entries[child][1]) child++;
        if (last[1] <= entries[child][1]) break;
        entries[index] = entries[child];
        index = child;
      }
      entries[index] = last;
    }
    return first;
  }
}

export class NavigationMap {
  constructor(polygons, bounds = BUILDING_BOUNDS, resolution = 0.1, radius = 0.42) {
    this.bounds = bounds;
    this.resolution = resolution;
    this.width = Math.ceil((bounds[1] - bounds[0]) / resolution);
    this.height = Math.ceil((bounds[3] - bounds[2]) / resolution);
    this.blocked = new Uint8Array(this.width * this.height);
    this.tracking_blocked = new Uint8Array(this.blocked.length);
    const margin = radius + resolution * Math.SQRT1_2;
    const tracking_margin = Math.max(0, radius - 0.12) + resolution * Math.SQRT1_2;
    for (let index = 0; index < this.blocked.length; index++) {
      const [x, y] = this.point(index);
      if (Math.min(x - bounds[0], bounds[1] - x, y - bounds[2], bounds[3] - y) < margin) this.blocked[index] = 1;
      if (Math.min(x - bounds[0], bounds[1] - x, y - bounds[2], bounds[3] - y) < tracking_margin) this.tracking_blocked[index] = 1;
    }
    for (const polygon of polygons) {
      if (polygon.length < 3) continue;
      const left = Math.max(0, Math.floor((Math.min(...polygon.map(p => p[0])) - margin - bounds[0]) / resolution));
      const right = Math.min(this.width - 1, Math.floor((Math.max(...polygon.map(p => p[0])) + margin - bounds[0]) / resolution));
      const bottom = Math.max(0, Math.floor((Math.min(...polygon.map(p => p[1])) - margin - bounds[2]) / resolution));
      const top = Math.min(this.height - 1, Math.floor((Math.max(...polygon.map(p => p[1])) + margin - bounds[2]) / resolution));
      for (let row = bottom; row <= top; row++) for (let column = left; column <= right; column++) {
        const index = row * this.width + column;
        if (this.blocked[index] && this.tracking_blocked[index]) continue;
        const [x, y] = this.point(index);
        if (near_polygon(x, y, polygon, margin)) this.blocked[index] = 1;
        if (near_polygon(x, y, polygon, tracking_margin)) this.tracking_blocked[index] = 1;
      }
    }
  }

  index(point) {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return -1;
    const x = Math.floor((point[0] - this.bounds[0]) / this.resolution);
    const y = Math.floor((point[1] - this.bounds[2]) / this.resolution);
    return x >= 0 && x < this.width && y >= 0 && y < this.height ? y * this.width + x : -1;
  }
  point(index) {
    return [this.bounds[0] + (index % this.width + 0.5) * this.resolution,
      this.bounds[2] + (Math.floor(index / this.width) + 0.5) * this.resolution];
  }
  free(point, tracking = false) {
    const index = this.index(point);
    return index >= 0 && !(tracking ? this.tracking_blocked : this.blocked)[index];
  }
  line_clear(start, end, tracking = false) {
    if (!this.free(start, tracking) || !this.free(end, tracking)) return false;
    const blocked = tracking ? this.tracking_blocked : this.blocked;
    let x = Math.floor((start[0] - this.bounds[0]) / this.resolution);
    let y = Math.floor((start[1] - this.bounds[2]) / this.resolution);
    const end_x = Math.floor((end[0] - this.bounds[0]) / this.resolution);
    const end_y = Math.floor((end[1] - this.bounds[2]) / this.resolution);
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const delta_x = sx ? this.resolution / Math.abs(dx) : Infinity;
    const delta_y = sy ? this.resolution / Math.abs(dy) : Infinity;
    let next_x = sx ? (this.bounds[0] + (x + (sx > 0 ? 1 : 0)) * this.resolution - start[0]) / dx : Infinity;
    let next_y = sy ? (this.bounds[2] + (y + (sy > 0 ? 1 : 0)) * this.resolution - start[1]) / dy : Infinity;
    const clear = (cx, cy) => cx >= 0 && cx < this.width && cy >= 0 && cy < this.height && !blocked[cy * this.width + cx];
    for (let count = 0; count < this.width + this.height + 2; count++) {
      if (!clear(x, y)) return false;
      if (x === end_x && y === end_y) return true;
      // Do not step past a goal on a floating-point grid boundary.
      if (Math.min(next_x, next_y) >= 1 - 1e-10) return true;
      if (Math.abs(next_x - next_y) < 1e-10) {
        // Supercover: a diagonal may not squeeze through two touching blocked cells.
        if (!clear(x + sx, y) || !clear(x, y + sy)) return false;
        x += sx; y += sy; next_x += delta_x; next_y += delta_y;
      } else if (next_x < next_y) { x += sx; next_x += delta_x; }
      else { y += sy; next_y += delta_y; }
    }
    return false;
  }

  plan(start, goal) {
    start = start.slice(0, 2);
    goal = goal.slice(0, 2);
    if (!this.free(start) || !this.free(goal)) return null;
    if (this.line_clear(start, goal)) return [start, goal];
    const first = this.index(start);
    const last = this.index(goal);
    const costs = new Float64Array(this.blocked.length).fill(Infinity);
    const parents = new Int32Array(this.blocked.length).fill(-1);
    const closed = new Uint8Array(this.blocked.length);
    const open = new MinHeap();
    const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const finish = this.point(last);
    costs[first] = 0;
    parents[first] = first;
    open.push([first, distance(start, goal), 0]);
    while (open.entries.length) {
      const [current, , cost] = open.pop();
      if (closed[current] || cost !== costs[current]) continue;
      if (current === last) {
        const points = [goal];
        let index = last;
        while (index !== first) { points.push(this.point(index)); index = parents[index]; }
        points.push(this.point(first), start);
        points.reverse();
        const path = [points[0]];
        for (let i = 0; i < points.length - 1;) {
          let next = points.length - 1;
          while (next > i + 1 && !this.line_clear(points[i], points[next])) next--;
          path.push(points[next]);
          i = next;
        }
        return path;
      }
      closed[current] = 1;
      const point = this.point(current);
      const column = current % this.width;
      const row = Math.floor(current / this.width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || column + dx < 0 || column + dx >= this.width || row + dy < 0 || row + dy >= this.height) continue;
        const next = current + dy * this.width + dx;
        if (this.blocked[next] || closed[next]) continue;
        if (dx && dy && (this.blocked[current + dx] || this.blocked[current + dy * this.width])) continue;
        const target = this.point(next);
        const parent = parents[current];
        const ancestor = this.point(parent);
        const through = this.line_clear(ancestor, target) ? parent : current;
        const candidate = costs[through] + distance(through === parent ? ancestor : point, target);
        if (candidate >= costs[next]) continue;
        costs[next] = candidate;
        parents[next] = through;
        open.push([next, candidate + distance(target, finish), candidate]);
      }
    }
    return null;
  }
}

export function make_navigation_maps() {
  const boxes = [...SCENE_WALLS, ...SHAFT_BOXES];
  const common = boxes.map(box => rectangle([box.center[0] - box.size[0] / 2, box.center[0] + box.size[0] / 2,
    box.center[1] - box.size[1] / 2, box.center[1] + box.size[1] / 2]));
  // This pretrained policy cannot climb stairs. The well is a forbidden region on both floors.
  common.push(rectangle(STAIRS.opening));
  return [0, 1].map(floor => {
    const polygons = [...common];
    for (const item of SCENE_FURNITURE) {
      if (Math.floor((item.position[2] + 0.01) / FLOOR_HEIGHT) !== floor) continue;
      const cosine = Math.cos(item.yaw);
      const sine = Math.sin(item.yaw);
      for (const hull of FURNITURE_ASSETS[item.article].hulls) {
        if (Math.min(...hull.map(point => point[2])) + item.position[2] - floor * FLOOR_HEIGHT > 1.5) continue;
        polygons.push(convex_hull(hull.map(point => [item.position[0] + cosine * point[0] - sine * point[1],
          item.position[1] + sine * point[0] + cosine * point[1]])));
      }
    }
    return new NavigationMap(polygons);
  });
}
