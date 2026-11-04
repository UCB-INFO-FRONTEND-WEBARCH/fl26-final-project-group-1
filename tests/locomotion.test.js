import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { command_from_keys, heading_from_quaternion, NUM_ACTIONS, NUM_OBSERVATIONS } from '../src/locomotion.js';
import { LiteProPolicy } from '../src/lite_pro_policy.js';
import { POLICY } from '../src/policy_constants.js';

test('keyboard commands stay within the Lite Pro velocity-mode range', () => {
  assert.deepEqual(command_from_keys(new Set(['KeyW'])), [0.6, 0, 0]);
  assert.deepEqual(command_from_keys(new Set(['KeyS', 'KeyA'])), [-0.4, 0, 0.7]);
  assert.deepEqual(command_from_keys(new Set(['KeyD', 'KeyE'])), [0, -0.3, -0.7]);
  assert.deepEqual(command_from_keys(new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD'])), [0, 0, 0]);
  assert.deepEqual(command_from_keys(new Set()), [0, 0, 0]);
  assert.deepEqual(command_from_keys(new Set(['ArrowUp', 'ArrowLeft']), 0.8), [0.8, 0, 0.7]);
});

test('the shipped S3 checkpoint and constants match the pinned browser export', async () => {
  const base = new URL('../public/assets/lite_pro/', import.meta.url);
  const contract = JSON.parse(await readFile(new URL('contract.json', base)));
  const source = await readFile(new URL('constants.json', base));
  assert.equal(createHash('sha256').update(source).digest('hex'), contract.constants_sha256);
  const constants = JSON.parse(source);
  delete constants.meshes;
  assert.deepEqual(POLICY, constants);
  const model = await readFile(new URL('policy.onnx', base));
  assert.equal(createHash('sha256').update(model).digest('hex'), contract.sha256);
  assert.equal(NUM_ACTIONS, 34);
  assert.equal(NUM_OBSERVATIONS, 2798);
  assert.equal(POLICY.timestep * POLICY.decimation, 0.02);
  assert.deepEqual(POLICY.camera.resize_shape, [18, 32]);
  assert.deepEqual(POLICY.goal_mask, [0, 0, 0, 0, 0, 0, 0, 1]);
});

test('velocity goals ramp over ten future frames and keep a constant ground-relative height', () => {
  const frames = LiteProPolicy.prototype.command_frames.call({ command: [0, 0, 0] }, [0.6, -0.3, 0.7]);
  assert.equal(frames.length, 10);
  assert.deepEqual(frames[0], [0, 0, 0, 0.73]);
  assert.ok(Math.abs(frames[1][0] - 0.1) < 1e-6);
  assert.deepEqual(frames[9], [0.6, -0.3, 0.7, 0.73]);
});

test('observation history stays term-major and clears motion goals in velocity mode', () => {
  let value = 1;
  const policy = { config: POLICY, obs: new Float32Array(NUM_OBSERVATIONS), hist: null,
    proprio: () => [[0, 0, -1], [value, 0, 0], Array(34).fill(value), Array(34).fill(2 * value), Array(34).fill(3 * value)] };
  const frames = Array.from({ length: 10 }, () => [0.6, 0, 0, 0.73]);
  const image = new Float32Array(576).fill(0.5);
  LiteProPolicy.prototype.build_observation.call(policy, frames, image);
  value = 2;
  const observation = LiteProPolicy.prototype.build_observation.call(policy, frames, image);
  assert.ok(observation.slice(0, 770).every(entry => entry === 0));
  assert.ok(Math.abs(observation[824] - 0.6) < 1e-6);
  assert.deepEqual(Array.from(observation.slice(1350, 1358)), POLICY.goal_mask);
  assert.ok(observation.slice(1358, 1934).every(entry => entry === 0.5));
  assert.ok(observation.slice(1982, 1982 + 7 * 34).every(entry => entry === 1));
  assert.ok(observation.slice(1982 + 7 * 34, 2254).every(entry => entry === 2));
  assert.ok(observation.slice(2526 + 7 * 34).every(entry => entry === 6));
});

test('motor torque limits enforce braking above the motor speed limit', () => {
  const policy = { config: POLICY, num_joints: 34,
    joint_qpos: Array.from({ length: 34 }, (_, index) => index + 7),
    joint_qvel: Array.from({ length: 34 }, (_, index) => index + 6),
    state: { qpos: Float64Array.from([0, 0, 0.73, 1, 0, 0, 0, ...POLICY.default_joint_pos]), qvel: new Float64Array(40) } };
  const targets = POLICY.default_joint_pos.map(value => value + 100);
  const torques = new Float64Array(34);
  LiteProPolicy.prototype.torque.call(policy, targets, torques);
  assert.deepEqual(Array.from(torques), POLICY.effort_limit);
  policy.state.qvel.set(POLICY.velocity_limit.map(value => value * 2), 6);
  LiteProPolicy.prototype.torque.call(policy, targets, torques);
  assert.deepEqual(Array.from(torques), POLICY.effort_limit.map(value => -value));
});

test('heading retains MuJoCo wxyz quaternion ordering', () => {
  assert.ok(Math.abs(heading_from_quaternion([0, 0, 0.73, Math.SQRT1_2, 0, 0, Math.SQRT1_2]) - Math.PI / 2) < 1e-6);
});
