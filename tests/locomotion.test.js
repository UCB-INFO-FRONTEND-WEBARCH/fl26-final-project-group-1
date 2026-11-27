import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { command_from_keys, camera_motion_from_keys, command_from_camera_motion,
  heading_from_quaternion, NUM_ACTIONS, JOINT_NAMES } from '../src/locomotion.js';
import { FluctlightPolicy, Motors, projected_gravity } from '../src/fluctlight_policy.js';
import { POLICY } from '../src/policy_constants.js';

const base = new URL('../public/assets/lite_pro/', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, base), 'utf8'));

test('keyboard commands stay within the walking range', () => {
  assert.deepEqual(command_from_keys(new Set(['KeyW'])), [0.8, 0, 0]);
  assert.deepEqual(command_from_keys(new Set(['KeyW']), undefined, true), [1.6, 0, 0]);
  assert.deepEqual(command_from_keys(new Set(['KeyS', 'KeyA'])), [-0.4, 0, 0.7]);
  assert.deepEqual(command_from_keys(new Set(['KeyD', 'KeyE'])), [0, 0, -0.7]);
  assert.deepEqual(command_from_keys(new Set(['KeyQ', 'KeyE'])), [0, 0, 0]);
  assert.deepEqual(command_from_keys(new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD'])), [0, 0, 0]);
  assert.deepEqual(command_from_keys(new Set()), [0, 0, 0]);
  assert.deepEqual(command_from_keys(new Set(['ArrowUp', 'ArrowLeft']), 0.8), [0.8, 0, 0.7]);
});

test('Shift doubles manual commands after normal caps and restores them on release', () => {
  for (const speed of [0.2, 0.6, 0.8]) {
    for (const codes of [['KeyW'], ['KeyS', 'KeyA'], ['KeyD', 'KeyE'], ['ArrowUp', 'ArrowLeft'], []]) {
      const keys = new Set(codes);
      const normal = command_from_keys(keys, speed);
      assert.deepEqual(command_from_keys(keys, speed, true), normal.map(value => value * 2));
      assert.deepEqual(command_from_keys(keys, speed, false), normal);
    }
  }
  assert.deepEqual(command_from_keys(new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD']), 0.6, true), [0, 0, 0]);
});

test('the bundled policies match the manifest and share one robot', async () => {
  const manifest = await json('manifest.json');
  for (const item of manifest.files) {
    const bytes = await readFile(new URL(item.file, base));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, item.file);
  }
  assert.deepEqual(Object.keys(POLICY.policies).sort(), Object.keys(manifest.policies).sort());
  for (const name of ['walk', 'getup_supine', 'getup_prone']) assert.ok(POLICY.policies[name], `${name} is missing`);
  for (const [name, path] of Object.entries(POLICY.policies)) {
    const contract = await json(path);
    assert.equal(contract.onnx_sha256, manifest.policies[name].onnx_sha256);
    assert.deepEqual(contract.joint_names, POLICY.joint_names);
    assert.deepEqual(contract.action_joint_names, POLICY.joint_names);
    assert.equal(contract.physics_dt * POLICY.decimation, contract.policy_dt);
  }
  assert.equal(NUM_ACTIONS, 34);
  assert.equal(JOINT_NAMES[0], 'robot/left_hip_pitch');
  assert.equal(POLICY.timestep * POLICY.decimation, 0.02);
});

test('shoulder keys follow camera axes, normalize diagonals, and preserve Shift and aliases', () => {
  const keys = codes => new Set(codes);
  const motion = camera_motion_from_keys(keys(['KeyW']), Math.PI / 2);
  assert.ok(Math.abs(motion[0]) < 1e-9);
  assert.ok(Math.abs(motion[1] - 0.8) < 1e-9);
  for (const code of ['KeyQ', 'KeyE']) {
    assert.deepEqual(camera_motion_from_keys(keys([code]), 0), [0, 0, 0.7]);
    assert.deepEqual(camera_motion_from_keys(keys(['KeyW', code]), 0), [0.8, 0, 0.7]);
  }
  const diagonal = camera_motion_from_keys(keys(['KeyW', 'KeyD']), 0.7);
  assert.ok(Math.abs(Math.hypot(...diagonal.slice(0, 2)) - 0.8) < 1e-9);
  assert.deepEqual(camera_motion_from_keys(keys(['KeyW', 'KeyD']), 0.7, 0.8, true), diagonal.map(v => v * 2));
  assert.deepEqual(camera_motion_from_keys(keys(['KeyW', 'KeyS', 'KeyA', 'KeyD']), 0), [0, 0, 0.7]);
});

test('a fixed camera goal keeps steering toward world travel direction as the body turns', () => {
  const motion = camera_motion_from_keys(new Set(['KeyW']), Math.PI / 2);
  const initial = command_from_camera_motion(motion, 0);
  assert.ok(initial[0] < 1e-9 && initial[1] > 0 && initial[2] > 0);
  const aligned = command_from_camera_motion(motion, Math.PI / 2);
  assert.ok(Math.abs(aligned[0] - 0.8) < 1e-9);
  assert.ok(Math.abs(aligned[1]) < 1e-9 && Math.abs(aligned[2]) < 1e-9);
  assert.deepEqual(command_from_camera_motion([0, 0, 0.7], 1.5), [0, 0, 0]);
  const wrapped = command_from_camera_motion([Math.cos(-Math.PI + 0.01), Math.sin(-Math.PI + 0.01), 0.7], Math.PI - 0.01);
  assert.ok(wrapped[0] > 0.99 && wrapped[2] > 0 && wrapped[2] < 0.1);
});

/** A policy over a stub robot whose joint i sits at qpos[7 + i] and qvel[6 + i], with a gyro at sensordata[0..2]. */
async function stub_policy(name) {
  const contract = await json(POLICY.policies[name]);
  const n = contract.joint_names.length;
  const body = {
    joint_names: contract.joint_names, root_qpos: 0, root_qvel: 0, gyro: 0,
    joint_qpos: Array.from({ length: n }, (_, i) => 7 + i), joint_qvel: Array.from({ length: n }, (_, i) => 6 + i),
  };
  const state = { qpos: new Float64Array(7 + n), qvel: new Float64Array(6 + n), sensordata: new Float64Array(3) };
  state.qpos.set([0, 0, 0.76, 1, 0, 0, 0]);
  state.qpos.set(contract.default_joint_pos, 7);
  const contract_without_map = { ...contract, elevation_map: contract.elevation_map && { ...contract.elevation_map, enabled: false } };
  const policy = new FluctlightPolicy(null, null, body, null, contract_without_map, { deterministic: true });
  return { contract, policy, state, n };
}

test('observation history is term-major, oldest first, and backfilled after a reset', async () => {
  const { contract, policy, state, n } = await stub_policy('walk');
  assert.equal(contract.observations[0].name, 'velocity_command');
  policy.reset();
  state.sensordata.set([1, 0, 0]);
  policy.observe(state, [0.5, 0, 0.2, 0.75]);
  state.sensordata.set([2, 0, 0]);
  const obs = policy.observe(state, [0.6, 0, 0.3, 0.75]);
  let offset = 0;
  const slices = {};
  for (const term of contract.observations) {
    slices[term.name] = Array.from(obs.slice(offset, offset + term.size * term.history));
    offset += term.size * term.history;
  }
  assert.equal(offset, obs.length);
  assert.deepEqual(slices.velocity_command.map(v => Math.round(v * 100) / 100), [0.6, 0, 0.3, 0.75]);
  const gyro_x = slices.base_ang_vel.filter((_, i) => i % 3 === 0);
  assert.deepEqual(gyro_x, [1, 1, 1, 1, 2]);
  assert.deepEqual(slices.projected_gravity.slice(-3), [-0, -0, -1]);
  assert.ok(slices.joint_pos.every(v => Math.abs(v) < 1e-6));
  assert.equal(slices.joint_vel.length, 5 * n);
});

test('a get-up policy sees the gyro first and no command', async () => {
  const { contract, policy, state } = await stub_policy('getup_supine');
  assert.deepEqual(contract.observations.map(t => t.name), ['base_ang_vel', 'projected_gravity', 'joint_pos', 'joint_vel', 'actions']);
  assert.equal(contract.command, null);
  state.sensordata.set([0.1, 0.2, 0.3]);
  const obs = policy.observe(state);
  assert.deepEqual(Array.from(obs.slice(12, 15)).map(v => Math.round(v * 10) / 10), [0.1, 0.2, 0.3]);
});

test('motor torque limits follow the DC-motor curve and brake above the no-load speed', async () => {
  const contract = await json(POLICY.policies.walk);
  const n = contract.joint_names.length;
  const body = { joint_names: contract.joint_names, joint_qpos: Array.from({ length: n }, (_, i) => 7 + i),
    joint_qvel: Array.from({ length: n }, (_, i) => 6 + i), actuators: Array.from({ length: n }, (_, i) => i) };
  const motors = new Motors(body, () => 0.5);
  motors.configure(contract);
  const state = { qpos: Float64Array.from([0, 0, 0.76, 1, 0, 0, 0, ...contract.default_joint_pos]), qvel: new Float64Array(6 + n), ctrl: new Float64Array(n) };
  motors.set_target(contract.default_joint_pos.map(value => value + 100));
  motors.apply(state);
  assert.deepEqual(Array.from(state.ctrl), contract.effort_limit);
  state.qvel.set(contract.velocity_limit.map(value => value * 2), 6);
  motors.apply(state);
  assert.deepEqual(Array.from(state.ctrl), contract.effort_limit.map(value => -value));
});

test('gravity in the body frame tells a face-up fall from a face-down one', () => {
  const s = Math.SQRT1_2;
  assert.ok(projected_gravity([s, 0, -s, 0])[0] < -0.99, 'face up: gravity along -x of the pelvis');
  assert.ok(projected_gravity([s, 0, s, 0])[0] > 0.99, 'face down: gravity along +x of the pelvis');
  assert.ok(projected_gravity([1, 0, 0, 0]).every((v, i) => Math.abs(v - [0, 0, -1][i]) < 1e-12), 'upright');
});

test('heading retains MuJoCo wxyz quaternion ordering', () => {
  assert.ok(Math.abs(heading_from_quaternion([0, 0, 0.73, Math.SQRT1_2, 0, 0, Math.SQRT1_2]) - Math.PI / 2) < 1e-6);
});

test('the sit policy carries its chair clips, and each clip its seat', async () => {
  const contract = await json(POLICY.policies.sit);
  const { MotionClips } = await import('../src/fluctlight_policy.js');
  const bytes = await readFile(new URL(`policies/${contract.motion.file}`, base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), contract.motion.sha256);
  const clips = new MotionClips(contract.motion, new Uint8Array(bytes));
  assert.equal(clips.names('sit_down').length, 1);
  assert.equal(clips.names('stand_up').length, 1);
  assert.deepEqual(contract.observations.map((term) => term.name),
    ['command', 'motion_anchor_ori_b', 'base_ang_vel', 'joint_pos', 'joint_vel', 'actions', 'seat_estimate', 'motion_anchor_pos_estimate']);
  assert.equal(contract.observations[0].size, 9 * (contract.motion.body_names.length - 1));
  for (const name of Object.keys(clips.clips)) {
    const clip = clips.clips[name];
    assert.ok(clip.frames > 50 && clip.seated_from !== null, name);
    // Quaternions are unit, and the clip is on its floor.
    const q = clips.field(name, 0, 'root_quat');
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-4, name);
    assert.ok(clips.field(name, 0, 'root_pos')[2] > 0.3, name);
  }
});

test('the explainer training fixture matches the clips and runtime footprint includes the catalog leg frame', async () => {
  const contract = await json(POLICY.policies.sit);
  const { SEAT, SEAT_SIZE, seat_boxes, seat_footprint, to_seat } = await import('../src/seat.js');
  const { seat: trained, clips } = contract.motion;
  assert.equal(SEAT_SIZE.width, trained.width);
  assert.equal(SEAT_SIZE.backrest_thickness, trained.backrest_thickness);
  assert.equal(SEAT_SIZE.backrest_height, trained.backrest_height);
  for (const [name, clip] of Object.entries(clips)) {
    const offset = SEAT_SIZE.height - clip.seat.height;
    assert.ok(offset >= trained.offset_range.height[0] && offset <= trained.offset_range.height[1], `${name} seat height`);
    const back = SEAT_SIZE.depth - clip.seat.depth;
    assert.ok(back >= trained.backrest_gap[0] - 0.01 && back <= trained.backrest_gap[1], `${name} backrest gap`);
  }
  const [block, back] = seat_boxes();
  assert.ok(Math.abs(block.center[2] - SEAT_SIZE.height / 2) < 1e-9);
  assert.ok(Math.abs(back.center[2] + back.size[2] / 2 - SEAT_SIZE.height - SEAT_SIZE.backrest_height) < 1e-9);
  // The physical footprint comes from the real catalog mesh, including its leg frame.
  const local = seat_footprint().map((p) => to_seat(SEAT, p));
  assert.ok(Math.max(...local.map((p) => p[0])) > 0);
  assert.ok(Math.min(...local.map((p) => p[0])) < -0.5);
});

test('a placed clip keeps the sit terms unchanged when the robot and the seat move with it', async () => {
  const contract = await json(POLICY.policies.sit);
  const { MotionClips, Reference, heading_of } = await import('../src/fluctlight_policy.js');
  const clips = new MotionClips(contract.motion, new Uint8Array(await readFile(new URL(`policies/${contract.motion.file}`, base))));
  const name = clips.names('sit_down')[0];
  const seat = [2, -1, 0.35, 0.7];
  const on_seat = Reference.on_seat(clips, name, seat, 0);
  const placed = on_seat.clip_seat();
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(placed[i] - [2, -1, clips.clips[name].seat.height, 0.7][i]) < 1e-6);
  const on_root = Reference.on_root(clips, name, [1, 3, -2], 0, seat);
  const root = on_root.root_pos(0);
  assert.ok(Math.hypot(root[0] - 1, root[1] - 3) < 1e-6);
  assert.ok(Math.abs(heading_of(on_root.root_quat(0)) + 2) < 1e-6);

  // Turn the clip, a robot standing at its root and the seat by the same yaw: the four sit terms stay the same.
  const n = contract.joint_names.length;
  const body = { joint_names: contract.joint_names, root_qpos: 0, root_qvel: 0, gyro: 0,
    joint_qpos: Array.from({ length: n }, (_, i) => 7 + i), joint_qvel: Array.from({ length: n }, (_, i) => 6 + i) };
  const values = (yaw) => {
    const reference = Reference.on_root(clips, name, [0.3, -0.2, yaw], 0, null);
    const q = reference.root_quat(5), p = reference.root_pos(5);
    const anchor_q = reference.anchor_quat(9), anchor_p = reference.anchor_pos(9);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    reference.seat = [0.3 + c * -0.4, -0.2 + s * -0.4, 0.35, yaw + 0.1];
    const state = { qpos: new Float64Array(7 + n), qvel: new Float64Array(6 + n), sensordata: new Float64Array(3),
      xpos: new Float64Array(3), xquat: new Float64Array(4) };
    state.qpos.set([...p, ...q]);
    state.xpos.set(anchor_p);
    state.xquat.set(anchor_q);
    const policy = Object.create(FluctlightPolicy.prototype);
    Object.assign(policy, { body, contract, anchor: 0, last_action: new Float32Array(n) });
    reference.frame = 7;
    return ['motion_anchor_ori_b', 'motion_anchor_pos_estimate', 'seat_estimate'].map((term) => policy.term_value(term, state, reference));
  };
  const a = values(0.2), b = values(2.4);
  for (let t = 0; t < a.length; t++) for (let i = 0; i < a[t].length; i++) assert.ok(Math.abs(a[t][i] - b[t][i]) < 1e-5, `term ${t} ${i}`);
});

test('the seat approach turns, backs up to the stand-off, and sits on arrival', async () => {
  const { SEAT, SeatApproach, APPROACH, from_seat, to_seat } = await import('../src/seat.js');
  const start = [...from_seat(SEAT, -0.01, 0), SEAT.yaw];
  const navigation = { state: { status: 'idle' }, set_goal() { this.state = { status: 'walking' }; }, cancel() {}, update: () => [0.5, 0, 0] };
  const approach = new SeatApproach(SEAT, start, navigation);
  assert.ok(Math.abs(to_seat(SEAT, approach.target)[0] - (APPROACH.stand_off - 0.01)) < 1e-9);
  // From across the room: the route first.
  approach.begin([...from_seat(SEAT, 3, 2), 0], 0);
  assert.equal(approach.phase, 'route');
  navigation.state.status = 'arrived';
  approach.update([...from_seat(SEAT, APPROACH.staging, 0)], SEAT.yaw + Math.PI, 0, 0.02, 0);
  assert.equal(approach.phase, 'align');
  // Facing the seat: only turn.
  const turn = approach.update([...from_seat(SEAT, APPROACH.staging, 0)], SEAT.yaw + Math.PI, 0, 0.02, 0);
  assert.equal(turn[0], 0);
  assert.notEqual(turn[2], 0);
  // Back to the seat, in front of the target: back up.
  const back = approach.update([...from_seat(SEAT, 0.5, 0)], SEAT.yaw, 0, 0.02, 0);
  assert.ok(back[0] < 0 && Math.abs(back[1]) < 1e-9);
  // On the target but still moving fast: keep holding; slow: sit.
  approach.update(approach.target, SEAT.yaw, 0, 0.02, 0.5);
  assert.equal(approach.phase, 'align');
  approach.update(approach.target, SEAT.yaw, 0, 0.02, 0.05);
  assert.equal(approach.phase, 'ready');
});
