// Switches Lite Pro between its Fluctlight policies: walking on flat ground, walking on stairs, and getting up.
//
//                 steps in the map
//   walk (flat) ◀────────────────▶ walk (stairs)
//        │       flat ground 1 s        │
//        └─────────────┬────────────────┘
//                    fall
//                      ▼
//                   falling ──at rest──▶ getup (supine or prone) ──stood 1 s──▶ walk
//                      ▲                         │
//                      └─────timeout or fall─────┘
//
// Walking: the flat-ground policy follows speed and turn commands closely but is blind; the stairs policy reads its
// elevation map and walks down stairs, but barely follows turn commands. Both see the same command and observation
// terms, and both observe every control step, so either can take over mid-stride: the walk on stairs starts when the
// stairs policy's map shows a step of 6 cm or more ahead while the robot walks forward, and hands back after 1 s of
// flat ground (under 3 cm) in the whole map, or underfoot while standing. Each walking policy's action history holds
// the actions that were applied.
//
// A fall is what ended a walking episode in training: the pelvis tilts more than 1 rad, or sinks 0.25 m below the
// commanded root height. While falling, the motors hold the joints where they are, as a damped freeze. Once the body
// is at rest, the get-up policy for the side it lies on takes over; the get-up tasks start from settled lying poses.
// Standing is the get-up task's own test (pelvis above 90% of 0.77 m and upright above 0.9). After 1 s of standing at
// rest, or 3 s of standing, the walking policies start from fresh histories with a zero command. A get-up that is not
// standing after 6 s (wedged against furniture, say) goes back to falling, and starts again from rest.
import { LiteProBody, Motors, FluctlightPolicy, projected_gravity, WALKABLE_GROUP } from './fluctlight_policy.js';

export const MODE = Object.freeze({ WALK: 'walk', FALLING: 'falling', GETUP: 'getup' });

const FALL_TILT = 1.0; // rad, velocity task FALL_TILT
const FALL_DROP = 0.25; // m below the commanded root height, velocity task FALL_DROP
const STANDING_HEIGHT = 0.77; // m, get-up task STANDING_HEIGHT
const STAND = { height: 0.9 * STANDING_HEIGHT, upright: 0.9, still_s: 1.0, max_s: 3.0, speed: 0.25, spin: 0.6 };
const REST = { speed: 0.3, spin: 1.0, hold_s: 0.4, max_s: 3.0 };
// A get-up takes about 1 s in the open. Beside furniture it can wedge; then the robot goes limp and tries again.
const GETUP_TIMEOUT_S = 6;
// The stairs walker takes over when a step lies ahead (x 0.1 to 1.0 m, |y| up to 0.4 m in its map) while the command
// walks forward, and hands back after 1 s with the whole map flat, or standing still on flat ground underfoot.
const STAIRS = { enter: 0.06, leave: 0.03, leave_s: 1.0, ahead: { x: [0.1, 1.0], y: 0.4 }, under: 0.3, moving: 0.1 };
// Command ramp (m/s^2, rad/s^2). The training commands are stride averages of clips, which never jump.
const COMMAND_RATE = [1.0, 1.0, 2.0];
const WALKERS = ['walk', 'walk_stairs'];

export class RobotController {
  /**
   * @param policies {walk, getup_supine, getup_prone, walk_stairs?}: each {session, contract}.
   */
  constructor(mujoco, model, state, policies, random = Math.random) {
    Object.assign(this, { mujoco, model, state, random });
    for (const name of ['walk', 'getup_supine', 'getup_prone']) {
      if (!policies[name]) throw new Error(`The ${name} policy is missing.`);
    }
    this.body = new LiteProBody(mujoco, model, policies.walk.contract);
    this.motors = new Motors(this.body, random);
    this.policies = Object.fromEntries(Object.entries(policies).map(([name, { session, contract }]) =>
      [name, new FluctlightPolicy(mujoco, model, this.body, session, contract, { random })]));
    this.walkers = WALKERS.filter((name) => this.policies[name]);
    if (this.policies.walk_stairs && !this.policies.walk_stairs.map) {
      throw new Error('The stairs policy needs an elevation map.');
    }
    this.root_height = policies.walk.contract.command.root_height_walk;
    this.ray = { origin: new Float64Array(3), down: Float64Array.from([0, 0, -1]), geom: new Int32Array(1),
      group: [0, 1, 2, 3, 4, 5].map((g) => (g === WALKABLE_GROUP ? 1 : 0)) };
    this.falls = 0;
    this.getups = 0;
    this.reset();
  }

  get active() { return this.policies[this.policy_name] ?? null; }
  get last_action() { return this.active?.last_action ?? this.policies.walk.last_action; }
  get inference_ms() { return this.active?.inference_ms ?? 0; }

  /** Start walking from the standing pose, with fresh histories. */
  reset() {
    this.time = 0;
    this.enter(MODE.WALK, 'walk');
    this.motors.set_target(this.policies.walk.contract.default_joint_pos);
  }

  enter(mode, policy_name) {
    this.mode = mode;
    this.mode_time = 0;
    this.rest_time = 0;
    this.stand_time = 0;
    this.still_time = 0;
    this.flat_time = 0;
    this.policy_name = policy_name;
    // While falling the motors keep the get-up gains and contacts, so the whole body meets the floor as it will
    // when the get-up starts.
    const policy = this.policies[policy_name] ?? this.policies.getup_supine;
    this.motors.configure(policy.contract);
    this.body.set_collision(policy.contract.collision);
    const fresh = mode === MODE.WALK ? this.walkers : policy_name ? [policy_name] : [];
    for (const name of fresh) this.policies[name].reset();
    this.command = [0, 0, 0];
  }

  /** Height of the walkable surface under the pelvis, or the pelvis height itself if nothing is below. */
  ground_height() {
    const { mujoco, model, state, body, ray } = this;
    ray.origin.set(state.xpos.subarray(3 * body.pelvis, 3 * body.pelvis + 3));
    const distance = mujoco.mj_ray(model, state, ray.origin, ray.down, ray.group, true, body.pelvis, ray.geom, null);
    return distance >= 0 ? ray.origin[2] - distance : ray.origin[2];
  }

  /** Pelvis height above the ground, its upright cosine, and gravity in its frame. */
  posture() {
    const { state, body } = this;
    const gravity = projected_gravity(state.qpos, body.root_qpos + 3);
    return { height: state.qpos[body.root_qpos + 2] - this.ground_height(), upright: -gravity[2], gravity };
  }

  at_rest({ speed, spin } = REST) {
    const v = this.state.qvel.subarray(this.body.root_qvel, this.body.root_qvel + 6);
    return Math.hypot(v[0], v[1], v[2]) < speed && Math.hypot(v[3], v[4], v[5]) < spin;
  }

  /** Pick the mode for this control step. */
  update_mode(posture, dt) {
    this.mode_time += dt;
    const fallen = posture.upright < Math.cos(FALL_TILT) || posture.height < this.root_height - FALL_DROP;
    switch (this.mode) {
      case MODE.WALK:
        if (fallen) {
          this.falls++;
          this.enter(MODE.FALLING, null);
        }
        break;
      case MODE.FALLING:
        this.rest_time = this.at_rest() ? this.rest_time + dt : 0;
        if (this.rest_time >= REST.hold_s || this.mode_time >= REST.max_s) {
          // Face up, gravity points along the pelvis -x; face down, along +x (the get-up pose banks).
          this.enter(MODE.GETUP, posture.gravity[0] < 0 ? 'getup_supine' : 'getup_prone');
        }
        break;
      case MODE.GETUP: {
        // Walking takes over from a still stance, since the walking clips never start mid-stumble: after 1 s standing
        // at rest, or 3 s standing at all. Only a robot that is not standing times out.
        const standing = posture.height > STAND.height && posture.upright > STAND.upright;
        this.stand_time = standing ? this.stand_time + dt : 0;
        this.still_time = standing && this.at_rest(STAND) ? this.still_time + dt : 0;
        if (this.still_time >= STAND.still_s || this.stand_time >= STAND.max_s) {
          this.getups++;
          this.enter(MODE.WALK, 'walk');
        } else if (!standing && this.mode_time >= GETUP_TIMEOUT_S) {
          this.enter(MODE.FALLING, null);
        }
        break;
      }
    }
  }

  /** The walking policy for the terrain the stairs policy's map shows, with hysteresis. */
  choose_walker(dt) {
    const stairs = this.policies.walk_stairs;
    if (!stairs) return 'walk';
    const { heights, offsets } = stairs.map;
    let all = 0, ahead = 0, under = 0;
    for (let k = 0; k < heights.length; k++) {
      const h = Math.abs(heights[k]), x = offsets[2 * k], y = offsets[2 * k + 1];
      all = Math.max(all, h);
      if (x >= STAIRS.ahead.x[0] && x <= STAIRS.ahead.x[1] && Math.abs(y) <= STAIRS.ahead.y) ahead = Math.max(ahead, h);
      if (Math.abs(x) <= STAIRS.under && Math.abs(y) <= STAIRS.under) under = Math.max(under, h);
    }
    const moving = this.command[0] > STAIRS.moving;
    if (this.policy_name !== 'walk_stairs') return moving && ahead >= STAIRS.enter ? 'walk_stairs' : 'walk';
    const flat = all < STAIRS.leave || (!moving && under < STAIRS.leave);
    this.flat_time = flat ? this.flat_time + dt : 0;
    return this.flat_time >= STAIRS.leave_s ? 'walk' : 'walk_stairs';
  }

  /**
   * One control step, on a state whose derived quantities are current (after mj_forward). `command` is the walking
   * command (vx, vy, yaw rate) in the heading frame; the other modes ignore it.
   */
  async control(command, dt) {
    this.time += dt;
    const posture = this.posture();
    this.update_mode(posture, dt);
    if (this.mode === MODE.FALLING) {
      this.motors.push_target(this.body.joint_positions(this.state));
      return;
    }
    if (this.mode === MODE.GETUP) {
      this.active.observe(this.state);
      this.motors.push_target(await this.active.act());
      return;
    }
    this.command = this.command.map((value, i) =>
      value + Math.max(-COMMAND_RATE[i] * dt, Math.min(COMMAND_RATE[i] * dt, command[i] - value)));
    const input = [...this.command, this.root_height];
    for (const name of this.walkers) this.policies[name].observe(this.state, input);
    const walker = this.choose_walker(dt);
    if (walker !== this.policy_name) {
      this.policy_name = walker;
      this.flat_time = 0;
      this.motors.configure(this.active.contract);
      this.body.set_collision(this.active.contract.collision);
    }
    const target = await this.active.act();
    for (const name of this.walkers) {
      if (name !== walker) this.policies[name].last_action.set(this.active.last_action);
    }
    this.motors.push_target(target);
  }

  /** Motor torques for one physics step. */
  apply_control() {
    this.motors.apply(this.state);
  }

  telemetry() {
    return { mode: this.mode, policy: this.policy_name, falls: this.falls, getups: this.getups, command: [...this.command] };
  }

  dispose() {
    for (const policy of Object.values(this.policies)) policy.dispose();
  }
}
