// "Take a rest": the qual demo of a three-level stack on Lite Pro. S2 (task planner) splits the request into
// sub-tasks, and S1 (trajectory generator) turns each into pose targets. Both are scripted here. S0 is the real
// Fluctlight walk and sit policies in MuJoCo, driven by the playground's own sit flow (seat.js), with no pose
// corrections. The worker and scripts/demo_rest_takes.js share this file, so a seed screened in Node replays in
// the browser.
import { PHYSICS_DT, CONTROL_DECIMATION, DEFAULT_ANGLES } from './locomotion.js';
import { SPAWN } from './scene_layout.js';
import { SEATS, seat_pose } from './seat.js';
import { MODE } from './robot_controller.js';
import { Reference } from './fluctlight_policy.js';

export const REST_DEMO = Object.freeze({
  seat: 'sofa_north',
  // On the lounge rug (|x| < 4.1 m) at the spawn's height, 5 m from the sofa's front edge: the walking policy is
  // blind and trips on the rug's 3 cm edge.
  start: [3.7, -1.2, SPAWN[2]],
  yaw: 0, // facing away from the sofa
  ask_s: 4, // S2 hands its first sub-task down
  walk_speed: 0.4, // m/s along the route (the app's speed slider spans 0.2 to 0.8)
  hold_s: 3, // seated, before the end
  lead_s: 0.5, // the sit ghost leads the robot along the clip
});

/** The scripted S2 plan; S1 runs the sub-task of the playground's sit flow stage that follows each label. */
export const SUBTASKS = [
  { label: 'Walk to the sofa', stage: 'route' },
  { label: 'Turn around', stage: 'align' },
  { label: 'Sit down', stage: 'sit_down' },
];

export function seeded_random(seed = 1) {
  return () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
}

const yaw_quaternion = yaw => [Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)];

export class RestDemo {
  constructor(simulation) {
    this.simulation = simulation;
    this.seat = SEATS.find(seat => seat.id === REST_DEMO.seat);
    this.ask_step = Math.round(REST_DEMO.ask_s / PHYSICS_DT);
    simulation.reset(REST_DEMO.start, REST_DEMO.yaw);
    simulation.navigation.speed = REST_DEMO.walk_speed;
    this.stand_z = simulation.state.qpos[2];
    const { clips } = simulation.controller;
    // The sit-down clip as the sit policy will track it, placed on the seat (Simulation.start_sitting).
    this.reference = Reference.on_seat(clips, clips.names('sit_down')[0], seat_pose(this.seat), this.seat.floor_z ?? 0);
    this.lead_frames = Math.round(REST_DEMO.lead_s * clips.spec.fps);
    this.stage = 'ask';
    this.done = 0;
    this.seated_at = null;
    this.path = null;
  }

  get time() { return this.simulation.step_count * PHYSICS_DT; }
  get ended() {
    return this.stage === 'failed' || (this.seated_at !== null && this.time >= this.seated_at + REST_DEMO.hold_s);
  }

  /** Advance `steps` physics steps; S2 asks for the seat at exactly ask_s. */
  async advance(steps) {
    let completed = 0;
    while (completed < steps) {
      if (this.stage === 'ask' && this.simulation.step_count >= this.ask_step) {
        this.stage = this.simulation.request_sit(this.seat.id) ? 'route' : 'failed';
      }
      const until_ask = this.stage === 'ask' ? this.ask_step - this.simulation.step_count : Infinity;
      const advanced = await this.simulation.advance(Math.min(CONTROL_DECIMATION, steps - completed, until_ask));
      completed += advanced;
      this.observe();
      if (!advanced) break;
    }
    return completed;
  }

  /** Follow the sit flow: the approach's route and align phases, then the sit policy's modes. */
  observe() {
    if (this.stage === 'ask' || this.stage === 'failed') return;
    const { approach, mode, navigation } = this.simulation;
    const stage = this.simulation.fallen || mode === MODE.FALLING || mode === MODE.GETUP ? 'failed'
      : approach ? approach.phase
      : mode === MODE.SIT_DOWN || mode === MODE.SEATED ? mode : 'failed';
    if (stage === 'route' && navigation.state.path.length > 1) this.path = navigation.state.path.map(point => [...point]);
    if (stage === this.stage) return;
    const order = ['route', 'align', 'sit_down', 'seated'];
    if (order.indexOf(stage) > order.indexOf(this.stage)) this.done = order.indexOf(stage);
    if (stage === 'seated') this.seated_at = this.time;
    this.stage = stage;
  }

  /** What each scripted level hands down this step, for the overlay. */
  report() {
    const { simulation, stage } = this;
    const report = { stage, done: this.done, ended: this.ended, time: this.time };
    if (stage === 'route') {
      report.route = { path: this.path, remaining: simulation.navigation.state.remaining };
    } else if (stage === 'align') {
      const { target } = simulation.approach;
      const [x, y] = simulation.state.qpos;
      report.target = { distance: Math.hypot(target[0] - x, target[1] - y), heading: target[2] };
    } else if (stage === 'sit_down' || stage === 'seated') {
      const { frame, last_frame } = simulation.controller.reference;
      report.clip = { frame, last_frame, lead: Math.min(frame + this.lead_frames, last_frame) };
    }
    return report;
  }

  /** The pose S1 plans for the current sub-task: root (x, y, z, w, x, y, z) and the 34 joint angles, or null. */
  ghost() {
    const { simulation, stage } = this;
    if (stage === 'route' && this.path) {
      const [from, to] = this.path.slice(-2);
      const heading = Math.atan2(to[1] - from[1], to[0] - from[0]);
      return { root: [to[0], to[1], this.stand_z, ...yaw_quaternion(heading)], joints: DEFAULT_ANGLES };
    }
    if (stage === 'align') {
      // The clip's first pose, moved to the stand-off the approach lines up to.
      const { target, start } = simulation.approach;
      const [x, y, z] = this.reference.root_pos(0);
      return { root: [x + target[0] - start[0], y + target[1] - start[1], z, ...this.reference.root_quat(0)],
        joints: this.reference.field('joint_pos', 0) };
    }
    if (stage === 'sit_down' || stage === 'seated') {
      const reference = simulation.controller.reference;
      const frame = Math.min(reference.frame + this.lead_frames, reference.last_frame);
      return { root: [...reference.root_pos(frame), ...reference.root_quat(frame)], joints: reference.field('joint_pos', frame) };
    }
    return null;
  }
}
