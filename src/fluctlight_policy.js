// Runs a Fluctlight tracker policy from its exported contract (public/assets/lite_pro/policies/*.json).
// The contract comes from `export-browser` in Fluctlight (tracker/ppo); see docs/POLICY.md.
import * as ort from 'onnxruntime-web/wasm';
import { WALKABLE_GROUP } from './geom_groups.js';

// mjtObj values.
const OBJ_BODY = 1;
const OBJ_JOINT = 3;
const OBJ_GEOM = 5;
const OBJ_SITE = 6;
const OBJ_ACTUATOR = 19;
const OBJ_SENSOR = 20;

export { WALKABLE_GROUP };

/** Rotation matrix (row-major) of a unit quaternion (w, x, y, z) stored at q[o..o+3]. */
export function rotation(q, o = 0) {
  const w = q[o], x = q[o + 1], y = q[o + 2], z = q[o + 3];
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/** Gravity's direction in the frame of the quaternion at q[o..o+3]: R^T (0, 0, -1). */
export function projected_gravity(q, o = 0) {
  const r = rotation(q, o);
  return [-r[6], -r[7], -r[8]];
}

/** A lag of whole steps drawn from [min, max], redrawn each step unless it holds (mjlab's delay buffers). */
class Lag {
  constructor({ min = 0, max = 0, hold_prob = 0 } = {}, random) {
    Object.assign(this, { min, max, hold_prob, random });
    this.lag = max;
  }

  next() {
    if (this.max > this.min && this.random() >= this.hold_prob) {
      this.lag = this.min + Math.floor(this.random() * (this.max - this.min + 1));
    } else if (this.max === this.min) {
      this.lag = this.min;
    }
    return this.lag;
  }
}

/**
 * One observation term with its delay and history. The history is oldest first, and the first value after a reset
 * fills every slot, as mjlab's CircularBuffer backfills.
 */
class Term {
  constructor({ name, size, history, delay }, random, deterministic) {
    Object.assign(this, { name, size, history });
    this.lag = new Lag(deterministic ? {} : delay, random);
    this.recent = []; // undelayed values, newest last, enough for the largest lag
    this.slots = [];
  }

  reset() {
    this.recent = [];
    this.slots = [];
  }

  push(value) {
    this.recent.push(value);
    if (this.recent.length > this.lag.max + 1) this.recent.shift();
    const lag = Math.min(this.lag.next(), this.recent.length - 1);
    const delayed = this.recent[this.recent.length - 1 - lag];
    if (this.slots.length === 0) this.slots = Array(this.history).fill(delayed);
    else this.slots = [...this.slots.slice(1), delayed];
  }

  write(out, offset) {
    for (const slot of this.slots) {
      out.set(slot, offset);
      offset += this.size;
    }
    return offset;
  }
}

/** The joint addresses, motors and sensors that every policy of one robot shares. */
export class LiteProBody {
  constructor(mujoco, model, contract) {
    this.mujoco = mujoco;
    this.model = model;
    const id = (type, name) => {
      const index = mujoco.mj_name2id(model, type, name);
      if (index < 0) throw new Error(`The robot model has no ${name}.`);
      return index;
    };
    this.joint_names = contract.joint_names;
    this.joint_qpos = this.joint_names.map((name) => model.jnt_qposadr[id(OBJ_JOINT, `robot/${name}`)]);
    this.joint_qvel = this.joint_names.map((name) => model.jnt_dofadr[id(OBJ_JOINT, `robot/${name}`)]);
    this.actuators = this.joint_names.map((name) => id(OBJ_ACTUATOR, `robot/${name}`));
    const root = id(OBJ_JOINT, 'robot/floating_base_joint');
    this.root_qpos = model.jnt_qposadr[root];
    this.root_qvel = model.jnt_dofadr[root];
    this.pelvis = id(OBJ_BODY, 'robot/pelvis');
    this.gyro = model.sensor_adr[id(OBJ_SENSOR, 'robot/imu_ang_vel')];
    this.geoms = new Map();
    for (let g = 0; g < model.ngeom; g++) {
      const name = mujoco.mj_id2name(model, OBJ_GEOM, g);
      if (name?.startsWith('robot/') && name.includes('_collision_')) this.geoms.set(name, g);
    }
  }

  /** Apply a policy's contact settings: which robot geoms collide, their contact dimension and friction. */
  set_collision(table) {
    const { model } = this;
    for (const [name, [contype, conaffinity, condim, priority, friction]] of Object.entries(table)) {
      const g = this.geoms.get(name);
      if (g === undefined) throw new Error(`The robot model has no ${name}.`);
      model.geom_contype[g] = contype;
      model.geom_conaffinity[g] = conaffinity;
      model.geom_condim[g] = condim;
      model.geom_priority[g] = priority;
      model.geom_friction[3 * g] = friction;
    }
  }

  joint_positions(state) { return this.joint_qpos.map((a) => state.qpos[a]); }
}

/**
 * The PD loop of each motor behind mjlab's DC-motor torque-speed clip, with the policy-to-motor command delay of
 * training (whole physics steps, redrawn unless held).
 */
export class Motors {
  constructor(body, random = Math.random) {
    this.body = body;
    this.random = random;
    this.torques = new Float64Array(body.joint_names.length);
    this.configure(null);
  }

  /** Take the gains, limits and delay of a contract. */
  configure(contract) {
    this.contract = contract;
    this.lag = new Lag(contract ? {
      min: contract.actuator_delay.min_steps, max: contract.actuator_delay.max_steps,
      hold_prob: contract.actuator_delay.hold_prob ?? 0,
    } : {}, this.random);
    this.targets = [];
  }

  /** Hold every target from now on, as from a reset (no delayed older target remains). */
  set_target(target) {
    this.targets = [Float64Array.from(target)];
  }

  push_target(target) {
    this.targets.push(Float64Array.from(target));
    if (this.targets.length > this.lag.max + 1) this.targets.shift();
  }

  /** Write the motor torques for one physics step into ctrl. */
  apply(state) {
    const { body, contract } = this;
    const lag = Math.min(this.lag.next(), this.targets.length - 1);
    const target = this.targets[this.targets.length - 1 - lag];
    const { stiffness, damping, effort_limit, velocity_limit } = contract;
    for (let i = 0; i < this.torques.length; i++) {
      const q = state.qpos[body.joint_qpos[i]];
      const qd = state.qvel[body.joint_qvel[i]];
      const tau = stiffness[i] * (target[i] - q) - damping[i] * qd;
      const effort = effort_limit[i];
      const speed = velocity_limit[i];
      // Stall torque at the peak: the clip is linear from +-effort at standstill to 0 at the no-load speed.
      const v = Math.max(-2 * speed, Math.min(2 * speed, qd));
      const top = Math.min(effort * (1 - v / speed), effort);
      const bottom = Math.max(effort * (-1 - v / speed), -effort);
      this.torques[i] = Math.max(bottom, Math.min(top, tau));
      state.ctrl[body.actuators[i]] = this.torques[i];
    }
  }
}

/** The 21 x 21 terrain map of the velocity policies: heights of walkable surfaces relative to the ground underfoot. */
class ElevationMap {
  constructor(mujoco, model, spec) {
    Object.assign(this, { mujoco, model, spec });
    this.site = mujoco.mj_name2id(model, OBJ_SITE, spec.site);
    this.exclude = spec.exclude_parent_body ? mujoco.mj_name2id(model, OBJ_BODY, spec.site_body) : -1;
    const [rows, cols] = spec.shape.slice(1);
    const [size_x, size_y] = spec.size;
    // Offsets as mjlab's GridPatternCfg makes them (float32): x varies fastest, then y.
    const xs = Array.from({ length: cols }, (_, i) => Math.fround(-size_x / 2 + i * spec.resolution));
    const ys = Array.from({ length: rows }, (_, j) => Math.fround(-size_y / 2 + j * spec.resolution));
    this.count = rows * cols;
    this.offsets = new Float64Array(2 * this.count);
    this.near = new Uint8Array(this.count);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        this.offsets[2 * k] = xs[i];
        this.offsets[2 * k + 1] = ys[j];
        this.near[k] = Math.hypot(xs[i], ys[j]) <= spec.ground_radius + 1e-6 ? 1 : 0;
      }
    }
    this.origin = new Float64Array(3);
    this.vector = Float64Array.from(spec.direction);
    this.geom_id = new Int32Array(1);
    this.distances = new Float64Array(this.count);
    this.group = [0, 1, 2, 3, 4, 5].map((g) => (g === WALKABLE_GROUP ? 1 : 0));
    this.heights = new Float32Array(this.count);
  }

  /** Cast the grid from the site, turned with its yaw, and write heights minus the ground height, clipped. */
  sense(state) {
    const { mujoco, model, spec } = this;
    const p = state.site_xpos.subarray(3 * this.site, 3 * this.site + 3);
    const m = state.site_xmat.subarray(9 * this.site, 9 * this.site + 9);
    // Yaw of the site frame: its x axis projected on the ground (y axis if x points up or down).
    let cx = m[0], sx = m[3];
    let n = Math.hypot(cx, sx);
    if (n < 1e-6) { cx = m[4]; sx = -m[1]; n = Math.hypot(cx, sx); }
    const c = cx / n, s = sx / n;
    // Parallel rays, one origin each (mj_multiRay shares one origin). Each is cut off at max_distance.
    const dist = this.distances;
    this.origin[2] = p[2];
    for (let k = 0; k < this.count; k++) {
      const ox = this.offsets[2 * k], oy = this.offsets[2 * k + 1];
      this.origin[0] = p[0] + c * ox - s * oy;
      this.origin[1] = p[1] + s * ox + c * oy;
      dist[k] = mujoco.mj_ray(model, state, this.origin, this.vector, this.group, true, this.exclude, this.geom_id, null);
    }
    let ground = 0, valid = 0;
    for (let k = 0; k < this.count; k++) {
      if (this.near[k] && dist[k] >= 0 && dist[k] <= spec.max_distance) {
        ground += p[2] - dist[k];
        valid++;
      }
    }
    ground = valid ? ground / valid : 0;
    for (let k = 0; k < this.count; k++) {
      const hit = dist[k] >= 0 && dist[k] <= spec.max_distance;
      const h = hit ? p[2] - dist[k] - ground : -spec.clip;
      this.heights[k] = Math.max(-spec.clip, Math.min(spec.clip, h));
    }
    return this.heights;
  }

  dispose() {}
}

/** One exported policy: its observation, inference and targets. */
export class FluctlightPolicy {
  constructor(mujoco, model, body, session, contract, { random = Math.random, deterministic = false } = {}) {
    Object.assign(this, { mujoco, model, body, session, contract });
    if (contract.joint_names.join() !== body.joint_names.join()) throw new Error(`${contract.name}: joint order differs.`);
    if (contract.action_joint_names.join() !== contract.joint_names.join()) {
      throw new Error(`${contract.name}: the actions must cover the observed joints in order.`);
    }
    this.name = contract.name;
    this.terms = contract.observations.map((spec) => new Term(spec, random, deterministic));
    const input = contract.inputs.find((item) => item.name === 'obs');
    this.obs = new Float32Array(input.shape[1]);
    const size = this.terms.reduce((sum, term) => sum + term.size * term.history, 0);
    if (size !== this.obs.length) throw new Error(`${contract.name}: observation terms add up to ${size}, not ${this.obs.length}.`);
    this.feeds = { obs: new ort.Tensor('float32', this.obs, input.shape) };
    // A policy trained without terrain (the flat stage) still takes the map input, which it saw as zeros.
    const map = contract.elevation_map;
    this.map = map?.enabled ? new ElevationMap(mujoco, model, map) : null;
    if (map) {
      const heights = this.map?.heights ?? new Float32Array(map.shape.reduce((a, b) => a * b, 1));
      this.feeds[map.input] = new ort.Tensor('float32', heights, [1, ...map.shape]);
    }
    this.num_joints = contract.joint_names.length;
    this.last_action = new Float32Array(this.num_joints);
    this.target = Float64Array.from(contract.default_joint_pos);
    this.inference_ms = 0;
  }

  /** Clear the histories and the last action, as an episode reset does. */
  reset() {
    for (const term of this.terms) term.reset();
    this.last_action.fill(0);
  }

  /** The current value of each term, from a state whose derived quantities are up to date (after mj_forward). */
  term_value(name, state, command) {
    const { body, contract } = this;
    switch (name) {
      case 'velocity_command': return command;
      case 'projected_gravity': return projected_gravity(state.qpos, body.root_qpos + 3);
      case 'base_ang_vel': return Array.from(state.sensordata.subarray(body.gyro, body.gyro + 3));
      case 'joint_pos': return body.joint_qpos.map((a, i) => state.qpos[a] - contract.default_joint_pos[i]);
      case 'joint_vel': return body.joint_qvel.map((a) => state.qvel[a]);
      case 'actions': return Array.from(this.last_action);
      default: throw new Error(`${contract.name}: unknown observation term ${name}.`);
    }
  }

  /** Push this control step's terms into the histories and write the policy inputs. */
  observe(state, command = null) {
    let offset = 0;
    for (const term of this.terms) {
      term.push(this.term_value(term.name, state, command));
      offset = term.write(this.obs, offset);
    }
    if (this.map) this.map.sense(state);
    return this.obs;
  }

  /** Run the network on the current inputs, and return the joint targets. */
  async act() {
    const { contract } = this;
    const started = performance.now();
    const output = await this.session.run(this.feeds);
    this.inference_ms = performance.now() - started;
    const action = output[contract.output]?.data;
    if (action?.length !== this.num_joints || !action.every(Number.isFinite)) {
      throw new Error(`The ${contract.name} policy returned invalid joint targets.`);
    }
    this.last_action.set(action);
    for (let i = 0; i < this.num_joints; i++) this.target[i] = contract.action_offset[i] + contract.action_scale[i] * action[i];
    output[contract.output].dispose?.();
    return this.target;
  }

  dispose() {
    this.map?.dispose();
  }
}

/** Load a policy's ONNX session from its contract. */
export async function create_session(bytes) {
  return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}
