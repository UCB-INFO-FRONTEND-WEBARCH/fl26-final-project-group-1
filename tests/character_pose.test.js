import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import load_mujoco from '@mujoco/mujoco';
import { POLICY } from '../src/policy_constants.js';
import { CharacterPose, CHARACTER_BONES, VRM_TO_ROBOT } from '../src/character_pose.js';
import { load_robot_files, robot_geometry, character_rig, write_robot_pose, ROBOT_POSE_SIZE } from '../src/robot_assets.js';

function character_fixture() {
  const nodes = new Map(['hips', ...Object.keys(CHARACTER_BONES)].map(name => [name, new THREE.Object3D()]));
  nodes.get('hips').position.set(0, 1, 0);
  nodes.get('leftUpperLeg').position.set(0.1, -0.1, 0);
  nodes.get('rightUpperLeg').position.set(-0.1, -0.1, 0);
  const humanoid = { getNormalizedBoneNode: name => nodes.get(name), update() {} };
  const axes = POLICY.joint_names.map(name => name.endsWith('_pitch') ? [0, 1, 0] : name.endsWith('_roll') ? [1, 0, 0] : [0, 0, 1]);
  const rig = { joint_names: POLICY.joint_names, axes, hip_center: [0.02, 0], sole: -0.775 };
  const pose = new Float32Array(ROBOT_POSE_SIZE);
  pose[3] = 1;
  return { nodes, rig, pose, mapper: new CharacterPose(humanoid, rig) };
}

test('the render pose carries measured angles in policy order and excludes the lift', () => {
  const state = { qpos: new Float64Array(42).map((_, index) => index / 7) };
  state.qpos[41] = 999;
  const before = state.qpos.slice();
  const addresses = POLICY.joint_names.map((_, index) => 40 - index);
  const packet = new Float32Array(ROBOT_POSE_SIZE + 4).fill(-123);
  write_robot_pose(packet.subarray(2, -2), state, addresses);
  const expected = new Float32Array([...state.qpos.subarray(0, 7), ...addresses.map(index => state.qpos[index])]);
  assert.deepEqual(packet.subarray(2, -2), expected);
  assert.equal(packet[0], -123);
  assert.equal(packet.at(-1), -123);
  assert.deepEqual(state.qpos, before);
});

test('the character preserves root motion and joint angles through the VRM coordinate change', () => {
  const { mapper, pose, nodes } = character_fixture();
  pose.set([2, 3, 1, Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  pose[7 + POLICY.joint_names.indexOf('left_knee_pitch')] = 0.4;
  const before = pose.slice();
  mapper.update(pose);
  const root = VRM_TO_ROBOT.clone().multiply(nodes.get('hips').quaternion).multiply(VRM_TO_ROBOT.clone().invert());
  assert.ok(root.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)) < 1e-6);
  const position = nodes.get('hips').position.clone().applyQuaternion(VRM_TO_ROBOT);
  assert.ok(position.distanceTo(new THREE.Vector3(2, 3.02, 1.225)) < 1e-6);
  assert.ok(Math.abs(nodes.get('leftLowerLeg').quaternion.angleTo(new THREE.Quaternion()) - 0.4) < 1e-6);
  assert.deepEqual(pose, before);
});

test('a ball bone composes all joint angles in the robot chain order', () => {
  const { mapper, pose, nodes } = character_fixture();
  pose.set([0.3, -0.2, 0.5], 7);
  mapper.update(pose);
  const rotation = VRM_TO_ROBOT.clone().multiply(nodes.get('leftUpperLeg').quaternion)
    .multiply(VRM_TO_ROBOT.clone().invert());
  const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.3, 0.5, 'YXZ'));
  assert.ok(rotation.angleTo(expected) < 1e-6);
  assert.equal(new Set(Object.values(CHARACTER_BONES).flat()).size, 34);
});

test('rig metadata comes from the trained model without changing live physics state', async () => {
  const base = new URL('../public/assets/lite_pro/', import.meta.url);
  const mujoco = await load_mujoco();
  await load_robot_files(mujoco, name => readFile(new URL(name, base)));
  const model = mujoco.MjModel.from_xml_path('/robot/robot.xml');
  const live = new mujoco.MjData(model);
  try {
    live.qpos.set([2, -3, 0.8]);
    live.qpos[12] = 0.3;
    const before = live.qpos.slice();
    const model_default = model.qpos0.slice();
    const manifest = JSON.parse(await readFile(new URL('visuals.json', base), 'utf8'));
    const binary = await readFile(new URL('visuals.bin', base));
    const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
    const rig = character_rig(mujoco, model, robot_geometry(model, manifest, buffer));
    assert.deepEqual(rig.joint_names, POLICY.joint_names);
    assert.ok(rig.axes.every(axis => Math.abs(Math.hypot(...axis) - 1) < 1e-6));
    assert.ok(Math.abs(rig.hip_center[0] - 0.02) < 1e-6);
    assert.ok(Math.abs(rig.hip_center[1]) < 1e-6);
    assert.ok(Math.abs(rig.sole + 0.775) < 0.001);
    assert.deepEqual(live.qpos, before);
    assert.deepEqual(model.qpos0, model_default);
  } finally {
    live.delete();
    model.delete();
  }
});
