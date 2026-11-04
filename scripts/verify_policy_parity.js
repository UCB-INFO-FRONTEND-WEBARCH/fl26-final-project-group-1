import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import load_mujoco from '@mujoco/mujoco';
import * as ort from 'onnxruntime-web/wasm';
import { Demo } from '../public/assets/lite_pro/reference/core.js';
import { POLICY } from '../src/policy_constants.js';
import { load_robot_files } from '../src/robot_assets.js';
import { make_scene_xml, SPAWN } from '../src/scene_layout.js';
import { Simulation } from '../src/simulation.js';
import { CONTROL_DECIMATION } from '../src/locomotion.js';

function seeded_random() {
  let seed = 2026;
  return () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
}

const base = new URL('../public/assets/lite_pro/', import.meta.url);
const mujoco = await load_mujoco();
await load_robot_files(mujoco, name => readFile(new URL(name, base)));
mujoco.FS.writeFile('/robot/apartment.xml', make_scene_xml());
const model = mujoco.MjModel.from_xml_path('/robot/apartment.xml');
ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(await readFile(new URL('policy.onnx', base)));
const reference_state = new mujoco.MjData(model);
const reference = new Demo(mujoco, model, reference_state, POLICY, session, ort);
reference.reset(SPAWN[0], SPAWN[1]);
const port = new Simulation(mujoco, model, session, null, seeded_random());
const reference_random = seeded_random();
const random = Math.random;
const maximum = { depth: 0, image: 0, observation: 0, action: 0, pose: 0 };
function compare(name, actual, expected) {
  assert.equal(actual.length, expected.length);
  const error = actual.reduce((value, entry, index) => Math.max(value, Math.abs(entry - expected[index])), 0);
  maximum[name] = Math.max(maximum[name], error);
  assert.ok(error < 1e-6, `${name} differs from the upstream browser controller: ${error}`);
}
try {
  // Includes history rollover, depth noise, delayed targets, and a changing velocity goal.
  for (let step = 0; step < 24; step++) {
    const command = step < 12 ? [0.6, 0, 0] : [0.3, 0.1, -0.2];
    Math.random = reference_random;
    await reference.step(command);
    Math.random = random;
    port.command = command;
    await port.advance(CONTROL_DECIMATION);
    compare('depth', port.policy.raw, reference.raw);
    compare('image', port.policy.image, reference.image);
    compare('observation', port.policy.obs, reference.obs);
    compare('action', port.action, reference.lastAction);
    compare('pose', port.state.qpos, reference_state.qpos);
  }
  console.log('PASS upstream controller parity (24 noisy, stateful steps):', maximum);
} finally {
  Math.random = random;
  reference.geomid.delete();
  reference.dist.delete();
  reference_state.delete();
  port.dispose();
  await session.release();
  model.delete();
}
