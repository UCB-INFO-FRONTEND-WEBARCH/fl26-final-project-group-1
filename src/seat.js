// Catalog seating anchors and the physical walk-up that aligns the robot with a sit clip.
import { SEAT, SEATS } from './seating_layout.js';
import { SEATING_ASSETS } from './seating_assets.js';
import { FLOOR_HEIGHT } from './building.js';
export { SEAT, SEATS } from './seating_layout.js';

export const SEAT_SIZE = Object.freeze({
  height: 0.35, // m, seat surface above the floor (the shipped clips' seats are 34.8 and 36.0 cm)
  width: 0.55,
  depth: 0.52, // front edge to the backrest's front face
  backrest_height: 0.45, // above the seat surface
  backrest_thickness: 0.05,
});

/** The seat pose the sit policy observes: front edge x, y, the seat surface's z, and yaw. */
export function seat_pose(seat = SEAT, floor_height = seat.floor_z ?? seat.floor * FLOOR_HEIGHT) {
  return [seat.front[0], seat.front[1], floor_height + seat.height, seat.yaw];
}

/** A point given in the seat frame (x toward the sitter's front, from the middle of the front edge), in the world. */
export function from_seat(seat, x, y) {
  const c = Math.cos(seat.yaw), s = Math.sin(seat.yaw);
  return [seat.front[0] + c * x - s * y, seat.front[1] + s * x + c * y];
}

/** A world point in the seat frame. */
export function to_seat(seat, point) {
  const c = Math.cos(seat.yaw), s = Math.sin(seat.yaw);
  const dx = point[0] - seat.front[0], dy = point[1] - seat.front[1];
  return [c * dx + s * dy, -s * dx + c * dy];
}

/** The training fixture used by the offline explainer; runtime furniture uses its catalog mesh colliders. */
export function seat_boxes(seat = SEAT, floor_height = 0) {
  const { height, width, depth, backrest_height, backrest_thickness } = SEAT_SIZE;
  const block = from_seat(seat, -depth / 2, 0);
  const back = from_seat(seat, -depth - backrest_thickness / 2, 0);
  return [
    { name: `${seat.name}_block`, center: [...block, floor_height + height / 2], size: [depth, width, height], yaw: seat.yaw },
    { name: `${seat.name}_back`, center: [...back, floor_height + (height + backrest_height) / 2],
      size: [backrest_thickness, width, height + backrest_height], yaw: seat.yaw },
  ];
}

/** The seat's footprint on its floor, for the route planner. */
export function seat_footprint(seat = SEAT) {
  if (seat.bounds) {
    const [lo, hi] = seat.bounds;
    return [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]];
  }
  const [width, depth] = SEATING_ASSETS[seat.article].size;
  const c = Math.cos(seat.model_yaw), s = Math.sin(seat.model_yaw);
  return [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]]
    .map(([x, y]) => [seat.position[0] + c * x - s * y, seat.position[1] + s * x + c * y]);
}

/** A nearby seat on this floor, approached from its front with no wall between the robot and staging point. */
export function nearby_seat(position, floor, maps, seats = SEATS) {
  let nearest = null, distance = 1.7;
  for (const seat of seats) {
    if (seat.floor !== floor) continue;
    const [x, y] = to_seat(seat, position);
    const reach = Math.hypot(x, y);
    if (x < 0.05 || x > 1.6 || Math.abs(y) > (seat.lateral_reach ?? .8) ||
      reach >= Math.min(distance, seat.interaction_range ?? 1.7)) continue;
    const staging = from_seat(seat, seat.staging ?? APPROACH.staging, 0);
    if (maps && !maps[floor]?.line_clear(position, staging, true)) continue;
    nearest = seat;
    distance = reach;
  }
  return nearest;
}

const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

// The route ends this far in front of the seat (the planner keeps 0.59 m from obstacles). From there the robot turns
// its back to the seat and backs up, steering on the pose error, to a stand-off in front of the clip's first pose:
// the clip starts with the pelvis over the seat's front edge, where the robot's heels already meet the seat. The
// sit-down clip is then placed on the seat, and the policy closes the stand-off as it sits (in the demo apartment it
// sat 22 cm deep, as the clip does, from stand-offs of 8 to 9 cm, and shallower from farther out).
export const APPROACH = Object.freeze({
  staging: 0.85, // m in front of the front edge, clear of the chair's forward leg frame
  stand_off: 0.09, // m in front of the clip's first pose
  turn_first: 0.5, // rad of heading error above which the robot only turns
  gain: [1.2, 1.2, 1.8], // command per m (x, y) and per rad (yaw)
  limit: [0.25, 0.2, 0.8], // m/s, m/s, rad/s
  floor: [0.08, 0.1], // m/s: the walking policy ignores smaller commands, so a correction is at least this
  // m along and across the seat, and rad, to sit. Standing still, the walking policy drifts 3 to 5 cm in half a
  // second, so the sit-down starts on arrival, moving slowly (training starts carried up to 0.2 m/s).
  tolerance: [0.03, 0.06, 0.1],
  arrive_speed: 0.2, // m/s
  timeout_s: 20, // to line up after the route
});

/**
 * Walks the robot to a seat and lines it up in front of the sit-down clip's first pose. `start` is that pose in the
 * world (x, y, heading). The route to the staging point is the navigation's; the last stretch is a pose controller,
 * since the planner keeps the robot farther from the seat than a sitter stands.
 */
export class SeatApproach {
  constructor(seat, start, navigation) {
    Object.assign(this, { seat, start, navigation });
    const [x, y] = to_seat(seat, start);
    this.target = [...from_seat(seat, x + APPROACH.stand_off, y), start[2]];
    this.staging_distance = seat.staging ?? APPROACH.staging;
    this.staging = [...from_seat(seat, this.staging_distance, 0)];
    this.phase = 'route';
    this.message = 'Walking to the seat.';
    this.phase_time = 0;
  }

  /** Begin: plan the route to the staging point, or skip it when the robot already stands near the seat. */
  begin(position, time) {
    const [x, y] = to_seat(this.seat, position);
    if (x > 0.05 && x < this.staging_distance + 0.4 && Math.abs(y) < 0.6) {
      this.set_phase('align');
      return;
    }
    this.navigation.set_goal(position, [...this.staging, this.seat.floor], time, this.seat.precise_approach);
    if (this.navigation.state.status === 'blocked') this.fail(this.navigation.state.message);
  }

  set_phase(phase) {
    this.phase = phase;
    this.phase_time = 0;
    this.message = { route: 'Walking to the seat.', align: 'Lining up with the seat.', ready: 'Sitting down.' }[phase]
      ?? this.message;
  }

  fail(message) {
    this.phase = 'failed';
    this.message = message;
  }

  /** The pose error in the robot's heading frame (x, y), and in heading. */
  error(position, heading) {
    const dx = this.target[0] - position[0], dy = this.target[1] - position[1];
    const c = Math.cos(heading), s = Math.sin(heading);
    return [c * dx + s * dy, -s * dx + c * dy, wrap(this.target[2] - heading)];
  }

  /** Whether the pose error is within `limits` (along, across, heading), the first two in the seat frame. */
  within(position, heading, [along, across, turn]) {
    const [x, y] = to_seat(this.seat, position);
    const [tx, ty] = to_seat(this.seat, this.target);
    return Math.abs(x - tx) < along && Math.abs(y - ty) < across && Math.abs(wrap(this.target[2] - heading)) < turn;
  }

  /** The walking command for this control step. `speed` is the root's horizontal speed (m/s). */
  update(position, heading, time, dt, speed) {
    this.phase_time += dt;
    if (this.phase === 'route') {
      const command = this.navigation.update(position, heading, time);
      const status = this.navigation.state.status;
      if (status === 'arrived') {
        this.navigation.cancel();
        this.set_phase('align');
      } else if (status === 'blocked' || status === 'idle') {
        this.fail(status === 'blocked' ? this.navigation.state.message : 'The route to the seat was cancelled.');
      }
      return status === 'arrived' ? [0, 0, 0] : command;
    }
    if (this.phase === 'align') {
      if (this.phase_time > APPROACH.timeout_s) { this.fail('The robot could not line up with the seat.'); return [0, 0, 0]; }
      if (this.within(position, heading, APPROACH.tolerance) && speed < APPROACH.arrive_speed) {
        this.set_phase('ready');
        return [0, 0, 0];
      }
      const [ex, ey, eyaw] = this.error(position, heading);
      if (Math.abs(eyaw) > APPROACH.turn_first) return [0, 0, clamp(APPROACH.gain[2] * eyaw, APPROACH.limit[2])];
      const push = (error, gain, limit, floor, tolerance) => Math.abs(error) < tolerance / 2 ? 0
        : Math.sign(error) * Math.min(limit, Math.max(floor, gain * Math.abs(error)));
      return [push(ex, APPROACH.gain[0], APPROACH.limit[0], APPROACH.floor[0], APPROACH.tolerance[0]),
        push(ey, APPROACH.gain[1], APPROACH.limit[1], APPROACH.floor[1], APPROACH.tolerance[1]),
        clamp(APPROACH.gain[2] * eyaw, APPROACH.limit[2])];
    }
    return [0, 0, 0];
  }
}
