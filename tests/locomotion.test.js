import test from 'node:test';
import assert from 'node:assert/strict';
import {
  command_from_keys, make_observation, apply_pd_control, heading_from_quaternion, DEFAULT_ANGLES,
} from '../src/locomotion.js';

test('WASD and Q/E produce robot-frame velocity commands; opposite inputs cancel', () => {
  assert.deepEqual(command_from_keys(new Set(['KeyW'])), [0.5, 0, 0]);
  assert.deepEqual(command_from_keys(new Set(['KeyS', 'KeyA'])), [-0.5, 0, 0.7]);
  assert.deepEqual(command_from_keys(new Set(['KeyD', 'KeyE'])), [0, -0.35, -0.7]);
  assert.deepEqual(command_from_keys(new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD'])), [0, 0, 0]);
  assert.deepEqual(command_from_keys(new Set()), [0, 0, 0]);
  assert.deepEqual(command_from_keys(new Set(['ArrowUp', 'ArrowLeft']), 0.8), [0.8, 0, 0.7]);
});

test('observations preserve the official 47-element deployment contract', () => {
  const qpos = Float64Array.from([0, 0, 0.793, 1, 0, 0, 0, ...DEFAULT_ANGLES]);
  const qvel = new Float64Array(18);
  qvel.set([2, 4, 6], 3);
  qvel.fill(2, 6);
  const action = Float32Array.from({ length: 12 }, (_, index) => index / 12);
  const observation = make_observation(qpos, qvel, action, [0.5, -0.3, 0.7], 100);
  assert.equal(observation.length, 47);
  assert.deepEqual(Array.from(observation.slice(0, 3)), [0.5, 1, 1.5]);
  assert.equal(observation[3], 0);
  assert.ok(Math.abs(observation[4]) < 1e-6);
  assert.equal(observation[5], -1);
  assert.equal(observation[6], 1);
  assert.ok(Math.abs(observation[7] + 0.6) < 1e-6);
  assert.ok(Math.abs(observation[8] - 0.175) < 1e-6);
  assert.ok(observation.slice(9, 21).every(value => value === 0));
  assert.ok(observation.slice(21, 33).every(value => Math.abs(value - 0.1) < 1e-6));
  assert.deepEqual(observation.slice(33, 45), action);
  assert.ok(Math.abs(observation[45] - 1) < 1e-6);
  assert.ok(Math.abs(observation[46]) < 1e-6);
});

test('projected gravity and heading use MuJoCo wxyz quaternion ordering', () => {
  const qpos = Float64Array.from([0, 0, 0.8, Math.SQRT1_2, 0, 0, Math.SQRT1_2, ...DEFAULT_ANGLES]);
  const observation = make_observation(qpos, new Float64Array(18), new Float32Array(12), [0, 0, 0], 0);
  assert.ok(Math.abs(observation[5] + 1) < 1e-6);
  assert.ok(Math.abs(heading_from_quaternion(qpos) - Math.PI / 2) < 1e-6);
});

test('PD torques use the published gains, damping, and 0.25 action scale', () => {
  const qpos = Float64Array.from([0, 0, 0.8, 1, 0, 0, 0, ...DEFAULT_ANGLES]);
  const qvel = new Float64Array(18);
  qvel.fill(1, 6);
  const ctrl = new Float64Array(12);
  apply_pd_control(qpos, qvel, new Float32Array(12).fill(1), ctrl);
  const expected = [23, 23, 23, 33.5, 8, 8, 23, 23, 23, 33.5, 8, 8];
  assert.ok(ctrl.every((value, index) => Math.abs(value - expected[index]) < 1e-10));
});
