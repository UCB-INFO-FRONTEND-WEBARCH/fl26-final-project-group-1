// Adapted from InstinctMJ web/lite_pro_drive/core.js at 07396764422e.
// CC-BY-NC-4.0; see THIRD_PARTY.md and public/assets/lite_pro/LICENSE.
import * as ort from 'onnxruntime-web/wasm';
import { POLICY } from './policy_constants.js';
import { STANDING_HEIGHT } from './building.js';

const GOAL_FRAMES = 10; // goal frames, 0.1 s apart
const GOAL_FRAME_SIZE = 58; // keypoint goal per frame: 6 points x 9, then vx, vy, yaw rate, height
const HISTORY_LENGTH = 8;
const ROBOT_PREFIX = 'robot/';
const CONTOUR = [[0.5, -1, -1], [0.1, -1, 0], [0.5, -1, 1], [1.2, 0, -1], [1.2, 0, 1], [0.5, 1, -1], [0.1, 1, 0], [0.5, 1, 1]];
export const HEIGHT = 0.73; // commanded pelvis height above the ground (the mean of the flat test clips)
const ACCEL = { v: 1.0, w: 2.0 }; // command ramp, m/s^2 and rad/s^2

function quat_matrix(q, o = 0) {
  const [w, x, y, z] = [q[o], q[o + 1], q[o + 2], q[o + 3]];
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
          2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
          2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}

function quat_multiply(a, b) {
  return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
          a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
}

function normal_sample(random) {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

function toward(x, target, step) {
  return x + Math.max(-step, Math.min(step, target - x));
}

export class LiteProPolicy {
  constructor(mujoco, model, state, session, random = Math.random) {
    const config = POLICY;
    this.random = random;
    this.mujoco = mujoco;
    this.model = model;
    this.state = state;
    this.config = config;
    this.session = session;
    const id = (type, name) => mujoco.mj_name2id(model, type, ROBOT_PREFIX + name);
    const J = mujoco.mjtObj.mjOBJ_JOINT.value;
    this.joint_qpos = config.joint_names.map((n) => model.jnt_qposadr[id(J, n)]);
    this.joint_qvel = config.joint_names.map((n) => model.jnt_dofadr[id(J, n)]);
    this.actuator_ids = config.joint_names.map((n) => id(mujoco.mjtObj.mjOBJ_ACTUATOR.value, n));
    this.num_joints = config.joint_names.length;
    this.head_body = id(mujoco.mjtObj.mjOBJ_BODY.value, config.camera.body);
    this.feet = [];
    for (let g = 0; g < model.ngeom; g++) {
      const name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM.value, g) || "";
      if (model.geom_contype[g] && name.includes('foot')) this.feet.push(g);
    }
    // camera rays in the camera frame (x forward, y left, z up), ray k = v * width + u
    const cam = config.camera;
    this.width = cam.width;
    this.height = cam.height;
    const f = (0.5 * this.height) / Math.tan(((cam.fovy * Math.PI) / 180) / 2);
    this.rays = new Float64Array(3 * this.width * this.height);
    for (let v = 0; v < this.height; v++) {
      for (let u = 0; u < this.width; u++) {
        const d = [1, -(u + 0.5 - this.width / 2) / f, -(v + 0.5 - this.height / 2) / f];
        const n = Math.hypot(...d);
        this.rays.set(d.map((x) => x / n), 3 * (v * this.width + u));
      }
    }
    this.ray_count = this.width * this.height;
    this.ray_vectors = new Float64Array(3 * this.ray_count);
    this.ray_geom_ids = new mujoco.IntBuffer(this.ray_count);
    this.ray_distances = new mujoco.DoubleBuffer(this.ray_count);
    this.group = [0, 1, 2, 3, 4, 5].map((g) => (cam.include_geom_groups.includes(g) ? 1 : 0));
    this.raw = new Float64Array(this.ray_count);
    this.obs = new Float32Array(Math.max(...Object.values(config.obs_slices).map((s) => s[1])));
    this.observation_tensor = new ort.Tensor('float32', this.obs, [1, this.obs.length]);
    this.torques = new Float64Array(this.num_joints);
    this.image = new Float32Array(config.camera.resize_shape[0] * config.camera.resize_shape[1]);
    this.command = [0, 0, 0];
    this.noise = true; // the stereo range noise of training (std 0.02 m)
  }

  /** Stand the robot in its default pose at (x, y) facing yaw, and clear the histories. */
  reset(position = [0, 0, STANDING_HEIGHT], yaw = 0) {
    const [x, y, z] = position;
    const { mujoco, model, state, config } = this;
    mujoco.mj_resetData(model, state);
    state.qpos.set([x, y, 1.0, Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)], 0);
    this.joint_qpos.forEach((a, i) => (state.qpos[a] = config.default_joint_pos[i]));
    mujoco.mj_forward(model, state);
    let low = Infinity;
    for (const g of this.feet) low = Math.min(low, state.geom_xpos[3 * g + 2] - model.geom_size[3 * g]);
    state.qpos[2] += z - STANDING_HEIGHT - low;
    mujoco.mj_forward(model, state);
    this.last_action = new Float32Array(this.num_joints);
    this.target = [...config.default_joint_pos];
    this.targets = [];
    this.lag = 1;
    this.hist = null;
    this.command = [0, 0, 0];
    this.inference_ms = 0;
  }

  /** Depth to the image plane (m) of every ray of the head camera; a miss is max_distance. */
  cast_depth() {
    const { mujoco, model, state, config } = this;
    const q = Array.from(state.xquat.subarray(4 * this.head_body, 4 * this.head_body + 4));
    const head_rotation = quat_matrix(q);
    const p = state.xpos.subarray(3 * this.head_body, 3 * this.head_body + 3);
    const o = config.camera.offset_pos;
    const pos = [0, 1, 2].map((i) => p[i] + head_rotation[3 * i] * o[0] + head_rotation[3 * i + 1] * o[1] + head_rotation[3 * i + 2] * o[2]);
    const R = quat_matrix(quat_multiply(q, config.camera.offset_rot));
    for (let k = 0; k < this.ray_count; k++) {
      const [dx, dy, dz] = [this.rays[3 * k], this.rays[3 * k + 1], this.rays[3 * k + 2]];
      for (let i = 0; i < 3; i++) this.ray_vectors[3 * k + i] = R[3 * i] * dx + R[3 * i + 1] * dy + R[3 * i + 2] * dz;
    }
    mujoco.mj_multiRay(model, state, pos, this.ray_vectors, this.group, true, -1, this.ray_geom_ids, this.ray_distances, null, this.ray_count, config.camera.max_distance);
    const dist = this.ray_distances.GetView();
    for (let k = 0; k < this.ray_count; k++) this.raw[k] = dist[k] >= 0 ? dist[k] * this.rays[3 * k] : config.camera.max_distance;
    return this.raw;
  }

  /** The policy's depth image (18 x 32, 0-1) of a raw image: contour mask, range noise, blur, normalize, crop, resize. */
  policy_image(raw) {
    const { width, height, config } = this;
    const at = (a, v, u) => (v < 0 || v >= height || u < 0 || u >= width ? 0 : a[v * width + u]);
    const d = new Float64Array(raw.length);
    for (let v = 0; v < height; v++) {
      for (let u = 0; u < width; u++) {
        const x = raw[v * width + u];
        let m = 0;
        for (const [coef, dy, dx] of CONTOUR) m = Math.max(m, Math.abs(coef * (x - at(raw, v + dy, u + dx))));
        let y = m > 1.8 ? 0 : x;
        if (this.noise && y >= 0.12 && y <= 1.2) y += 0.02 * normal_sample(this.random);
        d[v * width + u] = y;
      }
    }
    const k0 = Math.exp(-0.5 * 4), k1 = 1, ks = 2 * k0 + k1; // 3-tap Gaussian, sigma 0.5
    const w = [k0 / ks, k1 / ks, k0 / ks];
    const refl = (i, n) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);
    const tmp = new Float64Array(d.length), b = new Float64Array(d.length);
    for (let v = 0; v < height; v++) for (let u = 0; u < width; u++) tmp[v * width + u] = w[0] * d[v * width + refl(u - 1, width)] + w[1] * d[v * width + u] + w[2] * d[v * width + refl(u + 1, width)];
    for (let v = 0; v < height; v++) for (let u = 0; u < width; u++) b[v * width + u] = w[0] * tmp[refl(v - 1, height) * width + u] + w[1] * tmp[v * width + u] + w[2] * tmp[refl(v + 1, height) * width + u];
    const [lo, hi] = config.camera.depth_range;
    const [top, bottom, left, right] = config.camera.crop_region;
    const ch = height - top - bottom, cw = width - left - right;
    const crop = (v, u) => (Math.min(Math.max(b[(v + top) * width + u + left], lo), hi) - lo) / (hi - lo);
    const [oh, ow] = config.camera.resize_shape;
    const axis = (i, output_length, input_length) => {
      const x = Math.max(((i + 0.5) * input_length) / output_length - 0.5, 0);
      const i0 = Math.min(Math.floor(x), input_length - 1);
      return [i0, Math.min(i0 + 1, input_length - 1), x - i0];
    };
    for (let i = 0; i < oh; i++) {
      const [y0, y1, wy] = axis(i, oh, ch);
      for (let j = 0; j < ow; j++) {
        const [x0, x1, wx] = axis(j, ow, cw);
        const t = crop(y0, x0) * (1 - wx) + crop(y0, x1) * wx;
        const s = crop(y1, x0) * (1 - wx) + crop(y1, x1) * wx;
        this.image[i * ow + j] = t * (1 - wy) + s * wy;
      }
    }
    return this.image;
  }

  /** projected gravity, base angular velocity (body frame), joint positions (relative), joint velocities, last action. */
  proprio() {
    const { state, config } = this;
    const R = quat_matrix(state.qpos, 3);
    return [
      [-R[6], -R[7], -R[8]],
      Array.from(state.qvel.subarray(3, 6)),
      this.joint_qpos.map((a, i) => state.qpos[a] - config.default_joint_pos[i]),
      this.joint_qvel.map((a) => state.qvel[a]),
      Array.from(this.last_action),
    ];
  }

  /** Command frames 0.1 s apart: the current command ramped toward the key target, as a reference that speeds up would be. */
  command_frames(target) {
    const frames = [];
    let [vx, vy, wz] = this.command;
    for (let k = 0; k < GOAL_FRAMES; k++) {
      frames.push([vx, vy, wz, HEIGHT]);
      vx = toward(vx, target[0], ACCEL.v * 0.1);
      vy = toward(vy, target[1], ACCEL.v * 0.1);
      wz = toward(wz, target[2], ACCEL.w * 0.1);
    }
    return frames;
  }

  build_observation(frames, image) {
    const { obs, config } = this;
    const s = config.obs_slices;
    obs.fill(0);
    const kp0 = s.keypoint_ref[0];
    frames.forEach((f, k) => obs.set(f, kp0 + k * GOAL_FRAME_SIZE + 54));
    obs.set(config.goal_mask, s.goal_mask[0]);
    obs.set(image, s.depth_image[0]);
    const terms = this.proprio();
    if (!this.hist) this.hist = terms.map((t) => Array(HISTORY_LENGTH).fill(t));
    this.hist = this.hist.map((h, i) => [...h.slice(1), terms[i]]);
    ['projected_gravity', 'base_ang_vel', 'joint_pos', 'joint_vel', 'last_action'].forEach((name, i) => {
      obs.set(this.hist[i].flat(), s[name][0]);
    });
    return obs;
  }

  torque(target, out) {
    const { state, config } = this;
    for (let i = 0; i < this.num_joints; i++) {
      const q = state.qpos[this.joint_qpos[i]], qd = state.qvel[this.joint_qvel[i]];
      const tau = config.kp[i] * (target[i] - q) - config.kd[i] * qd;
      const sat = config.saturation_effort[i], vl = config.velocity_limit[i], lim = config.effort_limit[i];
      const vmax = vl * (1 + lim / sat);
      const v = Math.max(-vmax, Math.min(vmax, qd));
      out[i] = Math.max(Math.max(sat * (-1 - v / vl), -lim), Math.min(tau, Math.min(sat * (1 - v / vl), lim)));
    }
  }

  /** Infer one 50 Hz action before the next four 5 ms physics steps. */
  async infer(target) {
    const { config } = this;
    const image = this.policy_image(this.cast_depth());
    this.build_observation(this.command_frames(target), image);
    const started = performance.now();
    const output = await this.session.run({ obs: this.observation_tensor });
    this.inference_ms = performance.now() - started;
    const action = output.action?.data;
    if (action?.length !== this.num_joints || !action.every(Number.isFinite)) {
      throw new Error('The S3 policy returned invalid joint targets.');
    }
    this.last_action.set(action);
    this.target = config.action_offset.map((offset, index) => offset + config.action_scale[index] * action[index]);
    output.action.dispose?.();
    this.command = this.command.map((value, index) => toward(value, target[index], (index < 2 ? ACCEL.v : ACCEL.w) * config.step_dt));
  }

  /** Apply the trained motor envelope and 5-10 ms command delay at 200 Hz. */
  apply_control() {
    const [lo, hi, hold] = this.config.actuator_delay;
    this.targets.push(this.target);
    if (this.targets.length > hi + 1) this.targets.shift();
    if (this.random() >= hold) this.lag = lo + Math.floor(this.random() * (hi - lo + 1));
    const delayed = this.targets[Math.max(0, this.targets.length - 1 - this.lag)];
    this.torque(delayed, this.torques);
    this.actuator_ids.forEach((actuator, index) => { this.state.ctrl[actuator] = this.torques[index]; });
  }

  dispose() {
    this.ray_geom_ids.delete();
    this.ray_distances.delete();
  }
}
