import { ELEVATOR, FLOOR_HEIGHT, FLOOR_NAMES, floor_of } from './building.js';

export const IDLE_NAVIGATION = { version: 0, status: 'idle', message: 'Click an open spot on either floor.',
  path: [], goal: null, remaining: 0, planning_ms: 0 };
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const path_length = path => path.slice(1).reduce((sum, point, index) => sum + distance(path[index], point), 0);
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
function hold_position(position, target, heading) {
  if (distance(position, target) < 0.08) return [0, 0, 0];
  const dx = clamp((target[0] - position[0]) * 0.8, 0.12);
  const dy = clamp((target[1] - position[1]) * 0.8, 0.12);
  return [dx * Math.cos(heading) + dy * Math.sin(heading), -dx * Math.sin(heading) + dy * Math.cos(heading), 0];
}

export class Navigation {
  constructor(maps, elevator) {
    this.maps = maps;
    this.elevator = elevator;
    this.speed = 0.5;
    this.state = { ...IDLE_NAVIGATION };
    this.segments = [];
  }
  cancel() {
    if (this.state.status === 'idle') return;
    this.segments = [];
    this.state = { ...IDLE_NAVIGATION, version: this.state.version + 1 };
  }
  fail(message, goal = this.state.goal) {
    this.segments = [];
    this.state = { ...this.state, version: this.state.version + 1, status: 'blocked', message,
      goal, path: [], remaining: 0 };
  }
  set_goal(position, goal, time) {
    const started = performance.now();
    if (!Array.isArray(goal) || goal.length !== 3 || !goal.every(Number.isFinite) || ![0, 1].includes(goal[2])) {
      this.fail('Choose a destination on a floor.', null); return;
    }
    if (this.elevator.moving && this.elevator.occupied(position)) {
      this.fail('Wait for the elevator to arrive before choosing another destination.', goal); return;
    }
    const floor = floor_of(position);
    const destination_floor = goal[2];
    if (!this.maps[destination_floor].free(goal)) {
      this.fail('Choose open floor with enough room around the robot.', goal); return;
    }
    if (Math.abs(goal[0] - ELEVATOR.center[0]) < 1 && Math.abs(goal[1] - ELEVATOR.center[1]) < 1) {
      this.fail('Choose a room destination; the elevator is called automatically.', goal); return;
    }
    const walk = (from, to, level, boarding = false) => ({ type: 'walk', floor: level,
      path: this.maps[level].plan(from, to), boarding });
    if (floor === destination_floor) this.segments = [walk(position, goal, floor)];
    else {
      this.segments = [walk(position, ELEVATOR.landing, floor), { type: 'call', floor },
        walk(ELEVATOR.landing, ELEVATOR.center, floor, true), { type: 'ride', floor: destination_floor },
        walk(ELEVATOR.center, ELEVATOR.landing, destination_floor), walk(ELEVATOR.landing, goal, destination_floor)];
    }
    if (this.segments.some(segment => segment.type === 'walk' && !segment.path)) {
      this.fail('No safe route from here. Move into open space and try again.', goal); return;
    }
    const route = this.segments.flatMap(segment => segment.type === 'walk'
      ? segment.path.map(point => [...point, segment.floor * FLOOR_HEIGHT])
      : segment.type === 'ride' ? [[...ELEVATOR.center, segment.floor * FLOOR_HEIGHT]] : []);
    this.index = 0;
    this.waypoint = 1;
    this.last_progress = time;
    this.best_remaining = Infinity;
    this.state = { version: this.state.version + 1, status: 'walking', message: 'Walking to your destination.',
      goal: [...goal], path: route, remaining: this.segments.reduce((sum, segment) => sum + (segment.path ? path_length(segment.path) : 0), 0),
      planning_ms: performance.now() - started };
  }
  next(time) {
    this.index++;
    this.waypoint = 1;
    this.last_progress = time;
    this.best_remaining = Infinity;
    this.state.version++;
    if (this.index === this.segments.length) {
      this.state.status = 'arrived';
      this.state.message = `Arrived · ${FLOOR_NAMES[this.state.goal[2]].toLowerCase()}.`;
      this.state.remaining = 0;
    }
  }
  update(position, heading, time) {
    if (this.state.status === 'arrived') return hold_position(position, this.state.goal, heading);
    if (!['walking', 'waiting', 'riding'].includes(this.state.status)) return [0, 0, 0];
    const segment = this.segments[this.index];
    if (segment.type !== 'walk') {
      if (!segment.started) { this.elevator.request(segment.floor); segment.started = true; }
      this.state.status = segment.type === 'call' ? 'waiting' : 'riding';
      this.state.message = segment.type === 'call' ? 'Waiting for the elevator.' : `Riding to the ${FLOOR_NAMES[segment.floor].toLowerCase()}.`;
      if (this.elevator.open_floor === segment.floor && !this.elevator.moving) this.next(time);
      if (segment.type === 'call') {
        return hold_position(position, ELEVATOR.landing, heading);
      }
      return [0, 0, 0];
    }
    this.state.status = 'walking';
    this.state.message = segment.boarding ? 'Boarding the elevator.' : `Walking on the ${FLOOR_NAMES[segment.floor].toLowerCase()}.`;
    const path = segment.path;
    if (distance(position, path.at(-1)) < (segment.boarding ? 0.15 : 0.22)) { this.next(time); return [0, 0, 0]; }
    const map = this.maps[segment.floor];
    for (let index = path.length - 1; index >= this.waypoint; index--) {
      if (map.line_clear(position, path[index])) { this.waypoint = index; break; }
    }
    if (this.waypoint < path.length - 1 && distance(position, path[this.waypoint]) < 0.25 &&
        map.line_clear(position, path[this.waypoint + 1], true)) this.waypoint++;
    const target = path[this.waypoint];
    if (!map.line_clear(position, target, true)) {
      this.fail('The robot left its safe route. Choose a new destination.'); return [0, 0, 0];
    }
    const remaining = distance(position, target) + path_length(path.slice(this.waypoint));
    this.state.remaining = remaining + this.segments.slice(this.index + 1).reduce((sum, next) => sum + (next.path ? path_length(next.path) : 0), 0);
    if (remaining < this.best_remaining - 0.08) { this.best_remaining = remaining; this.last_progress = time; }
    if (time - this.last_progress > 12) { this.fail('The robot could not make progress. Choose a new destination.'); return [0, 0, 0]; }
    const angle = Math.atan2(target[1] - position[1], target[0] - position[0]);
    const error = Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading));
    const pace = Math.min(this.speed, 0.6, distance(position, target) * 0.9);
    const alignment = Math.max(0, Math.cos(error));
    return [pace * alignment * alignment, clamp(pace * Math.sin(error) * 0.6, 0.2), clamp(error * 1.6, 0.7)];
  }
}
