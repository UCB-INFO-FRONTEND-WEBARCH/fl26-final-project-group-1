import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { command_from_keys, heading_from_quaternion, NUM_ACTIONS, JOINT_NAMES } from '../src/locomotion.js';
import { FluctlightPolicy, Motors, projected_gravity } from '../src/fluctlight_policy.js';
import { POLICY } from '../src/policy_constants.js';

const base = new URL('../public/assets/lite_pro/', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, base), 'utf8'));

test('keyboard commands stay within the walking range', () => {
  assert.deepEqual(command_from_keys(new Set(['KeyW'])), [0.6, 0, 0]);
  assert.deepEqual(command_from_keys(new Set(['KeyS', 'KeyA'])), [-0.4, 0, 0.7]);
  assert.deepEqual(command_from_keys(new Set(['KeyD', 'KeyE'])), [0, -0.3, -0.7]);
  assert.deepEqual(command_from_keys(new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD'])), [0, 0, 0]);
  assert.deepEqual(command_from_keys(new Set()), [0, 0, 0]);
  assert.deepEqual(command_from_keys(new Set(['ArrowUp', 'ArrowLeft']), 0.8), [0.8, 0, 0.7]);
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
