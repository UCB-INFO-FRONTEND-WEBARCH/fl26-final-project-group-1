// Lite Pro velocity-mode policy in MuJoCo WASM: actuators, policy observation and head depth camera, as in training.
// The same code runs in the page and in the Node test. A port of demo_ref.py.

const FRAMES = 10; // goal frames, 0.1 s apart
const KP_FRAME = 58; // keypoint goal per frame: 6 points x 9, then vx, vy, yaw rate, height
const HISTORY = 8;
const PREFIX = "robot/";
const CONTOUR = [[0.5, -1, -1], [0.1, -1, 0], [0.5, -1, 1], [1.2, 0, -1], [1.2, 0, 1], [0.5, 1, -1], [0.1, 1, 0], [0.5, 1, 1]];
export const HEIGHT = 0.73; // commanded pelvis height above the ground (the mean of the flat test clips)
export const LIMITS = { vx: [-0.4, 1.0], vy: 0.3, wz: 0.8 }; // command range of the keys
const ACCEL = { v: 1.0, w: 2.0 }; // command ramp, m/s^2 and rad/s^2

function quatMat(q, o = 0) {
  const [w, x, y, z] = [q[o], q[o + 1], q[o + 2], q[o + 3]];
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
          2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
          2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}

function quatMul(a, b) {
  return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
          a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
}

function gauss() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

function toward(x, target, step) {
  return x + Math.max(-step, Math.min(step, target - x));
}

export class Demo {
  constructor(mj, model, data, c, session, ort) {
    Object.assign(this, { mj, model, data, c, session, ort });
    const id = (type, name) => mj.mj_name2id(model, type, PREFIX + name);
    const J = mj.mjtObj.mjOBJ_JOINT.value;
    this.qadr = c.joint_names.map((n) => model.jnt_qposadr[id(J, n)]);
    this.vadr = c.joint_names.map((n) => model.jnt_dofadr[id(J, n)]);
    this.act = c.joint_names.map((n) => id(mj.mjtObj.mjOBJ_ACTUATOR.value, n));
    this.nj = c.joint_names.length;
    this.headBody = id(mj.mjtObj.mjOBJ_BODY.value, c.camera.body);
    this.pelvisBody = id(mj.mjtObj.mjOBJ_BODY.value, "pelvis");
    this.feet = [];
    for (let g = 0; g < model.ngeom; g++) {
      const name = mj.mj_id2name(model, mj.mjtObj.mjOBJ_GEOM.value, g) || "";
      if (model.geom_contype[g] && name.includes("foot")) this.feet.push(g);
    }
    // camera rays in the camera frame (x forward, y left, z up), ray k = v * W + u
    const cam = c.camera;
    this.W = cam.width;
    this.H = cam.height;
    const f = (0.5 * this.H) / Math.tan(((cam.fovy * Math.PI) / 180) / 2);
    this.rays = new Float64Array(3 * this.W * this.H);
    for (let v = 0; v < this.H; v++) {
      for (let u = 0; u < this.W; u++) {
        const d = [1, -(u + 0.5 - this.W / 2) / f, -(v + 0.5 - this.H / 2) / f];
        const n = Math.hypot(...d);
        this.rays.set(d.map((x) => x / n), 3 * (v * this.W + u));
      }
    }
    this.nray = this.W * this.H;
    this.rayVec = new Float64Array(3 * this.nray);
    this.geomid = new mj.IntBuffer(this.nray);
    this.dist = new mj.DoubleBuffer(this.nray);
    this.group = [0, 1, 2, 3, 4, 5].map((g) => (cam.include_geom_groups.includes(g) ? 1 : 0));
    this.raw = new Float64Array(this.nray);
    this.obs = new Float32Array(Math.max(...Object.values(c.obs_slices).map((s) => s[1])));
    this.image = new Float32Array(c.camera.resize_shape[0] * c.camera.resize_shape[1]);
    this.command = [0, 0, 0];
    this.noise = true; // the stereo range noise of training (std 0.02 m)
    this.reset();
  }

  /** Stand the robot in its default pose at (x, y) facing yaw, and clear the histories. */
  reset(x = 0, y = 0, yaw = 0) {
    const { mj, model, data, c } = this;
    mj.mj_resetData(model, data);
    data.qpos.set([x, y, 1.0, Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)], 0);
    this.qadr.forEach((a, i) => (data.qpos[a] = c.default_joint_pos[i]));
    mj.mj_forward(model, data);
    let low = Infinity;
    for (const g of this.feet) low = Math.min(low, data.geom_xpos[3 * g + 2] - model.geom_size[3 * g]);
    data.qpos[2] -= low;
    mj.mj_forward(model, data);
    this.lastAction = new Float32Array(this.nj);
    this.targets = [];
    this.lag = 1;
    this.hist = null;
    this.command = [0, 0, 0];
    this.time = 0;
  }

  /** Depth to the image plane (m) of every ray of the head camera; a miss is max_distance. */
  castDepth() {
    const { mj, model, data, c } = this;
    const q = Array.from(data.xquat.subarray(4 * this.headBody, 4 * this.headBody + 4));
    const Rh = quatMat(q);
    const p = data.xpos.subarray(3 * this.headBody, 3 * this.headBody + 3);
    const o = c.camera.offset_pos;
    const pos = [0, 1, 2].map((i) => p[i] + Rh[3 * i] * o[0] + Rh[3 * i + 1] * o[1] + Rh[3 * i + 2] * o[2]);
    const R = quatMat(quatMul(q, c.camera.offset_rot));
    for (let k = 0; k < this.nray; k++) {
      const [dx, dy, dz] = [this.rays[3 * k], this.rays[3 * k + 1], this.rays[3 * k + 2]];
      for (let i = 0; i < 3; i++) this.rayVec[3 * k + i] = R[3 * i] * dx + R[3 * i + 1] * dy + R[3 * i + 2] * dz;
    }
    mj.mj_multiRay(model, data, pos, this.rayVec, this.group, true, -1, this.geomid, this.dist, null, this.nray, c.camera.max_distance);
    const dist = this.dist.GetView();
    for (let k = 0; k < this.nray; k++) this.raw[k] = dist[k] >= 0 ? dist[k] * this.rays[3 * k] : c.camera.max_distance;
    this.cameraPose = { pos, R };
    return this.raw;
  }

  /** The policy's depth image (18 x 32, 0-1) of a raw image: contour mask, range noise, blur, normalize, crop, resize. */
  policyImage(raw) {
    const { W, H, c } = this;
    const at = (a, v, u) => (v < 0 || v >= H || u < 0 || u >= W ? 0 : a[v * W + u]);
    const d = new Float64Array(raw.length);
    for (let v = 0; v < H; v++) {
      for (let u = 0; u < W; u++) {
        const x = raw[v * W + u];
        let m = 0;
        for (const [coef, dy, dx] of CONTOUR) m = Math.max(m, Math.abs(coef * (x - at(raw, v + dy, u + dx))));
        let y = m > 1.8 ? 0 : x;
        if (this.noise && y >= 0.12 && y <= 1.2) y += 0.02 * gauss();
        d[v * W + u] = y;
      }
    }
    const k0 = Math.exp(-0.5 * 4), k1 = 1, ks = 2 * k0 + k1; // 3-tap Gaussian, sigma 0.5
    const w = [k0 / ks, k1 / ks, k0 / ks];
    const refl = (i, n) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);
    const tmp = new Float64Array(d.length), b = new Float64Array(d.length);
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) tmp[v * W + u] = w[0] * d[v * W + refl(u - 1, W)] + w[1] * d[v * W + u] + w[2] * d[v * W + refl(u + 1, W)];
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) b[v * W + u] = w[0] * tmp[refl(v - 1, H) * W + u] + w[1] * tmp[v * W + u] + w[2] * tmp[refl(v + 1, H) * W + u];
    const [lo, hi] = c.camera.depth_range;
    const [top, bottom, left, right] = c.camera.crop_region;
    const ch = H - top - bottom, cw = W - left - right;
    const crop = (v, u) => (Math.min(Math.max(b[(v + top) * W + u + left], lo), hi) - lo) / (hi - lo);
    const [oh, ow] = c.camera.resize_shape;
    const axis = (i, nOut, nIn) => {
      const x = Math.max(((i + 0.5) * nIn) / nOut - 0.5, 0);
      const i0 = Math.min(Math.floor(x), nIn - 1);
      return [i0, Math.min(i0 + 1, nIn - 1), x - i0];
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
    const { data, c } = this;
    const R = quatMat(data.qpos, 3);
    return [
      [-R[6], -R[7], -R[8]],
      Array.from(data.qvel.subarray(3, 6)),
      this.qadr.map((a, i) => data.qpos[a] - c.default_joint_pos[i]),
      this.vadr.map((a) => data.qvel[a]),
      Array.from(this.lastAction),
    ];
  }

  /** Command frames 0.1 s apart: the current command ramped toward the key target, as a reference that speeds up would be. */
  commandFrames(target) {
    const frames = [];
    let [vx, vy, wz] = this.command;
    for (let k = 0; k < FRAMES; k++) {
      frames.push([vx, vy, wz, HEIGHT]);
      vx = toward(vx, target[0], ACCEL.v * 0.1);
      vy = toward(vy, target[1], ACCEL.v * 0.1);
      wz = toward(wz, target[2], ACCEL.w * 0.1);
    }
    return frames;
  }

  buildObs(frames, image) {
    const { obs, c } = this;
    const s = c.obs_slices;
    obs.fill(0);
    const kp0 = s.keypoint_ref[0];
    frames.forEach((f, k) => obs.set(f, kp0 + k * KP_FRAME + 54));
    obs.set(c.goal_mask, s.goal_mask[0]);
    obs.set(image, s.depth_image[0]);
    const terms = this.proprio();
    if (!this.hist) this.hist = terms.map((t) => Array(HISTORY).fill(t));
    this.hist = this.hist.map((h, i) => [...h.slice(1), terms[i]]);
    ["projected_gravity", "base_ang_vel", "joint_pos", "joint_vel", "last_action"].forEach((name, i) => {
      obs.set(this.hist[i].flat(), s[name][0]);
    });
    return obs;
  }

  torque(target, out) {
    const { data, c } = this;
    for (let i = 0; i < this.nj; i++) {
      const q = data.qpos[this.qadr[i]], qd = data.qvel[this.vadr[i]];
      const tau = c.kp[i] * (target[i] - q) - c.kd[i] * qd;
      const sat = c.saturation_effort[i], vl = c.velocity_limit[i], lim = c.effort_limit[i];
      const vmax = vl * (1 + lim / sat);
      const v = Math.max(-vmax, Math.min(vmax, qd));
      out[i] = Math.max(Math.max(sat * (-1 - v / vl), -lim), Math.min(tau, Math.min(sat * (1 - v / vl), lim)));
    }
  }

  /** One policy step (20 ms): camera, observation, policy, then the physics steps with the delayed joint targets. */
  async step(target) {
    const { mj, model, data, c, ort } = this;
    const raw = this.castDepth();
    const image = this.policyImage(raw);
    const frames = this.commandFrames(target);
    const x = this.buildObs(frames, image);
    const out = await this.session.run({ obs: new ort.Tensor("float32", x, [1, x.length]) });
    const a = out.action.data;
    this.lastAction = Float32Array.from(a);
    const tgt = c.action_offset.map((o, i) => o + c.action_scale[i] * a[i]);
    const [lo, hi, hold] = c.actuator_delay;
    const tau = new Float64Array(this.nj);
    for (let s = 0; s < c.decimation; s++) {
      this.targets = [...this.targets, tgt].slice(-(hi + 1));
      if (Math.random() >= hold) this.lag = lo + Math.floor(Math.random() * (hi - lo + 1));
      const delayed = this.targets[Math.max(0, this.targets.length - 1 - this.lag)];
      this.torque(delayed, tau);
      this.act.forEach((a_, i) => (data.ctrl[a_] = tau[i]));
      mj.mj_step(model, data);
    }
    this.command = this.command.map((x, i) => toward(x, target[i], (i < 2 ? ACCEL.v : ACCEL.w) * c.step_dt));
    this.time += c.step_dt;
    return image;
  }

  /** Base velocity in the heading frame (vx, vy), yaw rate, and the up component of the body z axis. */
  state() {
    const { data } = this;
    const R = quatMat(data.qpos, 3);
    const yaw = Math.atan2(R[3], R[0]);
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    const v = data.qvel;
    return { vx: c * v[0] + s * v[1], vy: -s * v[0] + c * v[1], wz: R[6] * v[3] + R[7] * v[4] + R[8] * v[5], up: R[8], yaw,
             x: data.qpos[0], y: data.qpos[1], z: data.qpos[2] };
  }

  fallen() {
    const s = this.state();
    return s.up < 0.4 || s.z < 0.35;
  }
}
