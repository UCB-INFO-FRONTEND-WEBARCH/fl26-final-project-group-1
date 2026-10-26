import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import load_mujoco from '@mujoco/mujoco';
import * as ort from 'onnxruntime-web/wasm';
import { make_scene_xml, SPAWN } from '../src/scene_layout.js';
import {
  DEFAULT_ANGLES, JOINT_NAMES, make_observation, apply_pd_control, heading_from_quaternion,
} from '../src/locomotion.js';

const asset_base = new URL('../public/assets/g1/', import.meta.url);
const mujoco = await load_mujoco({ locateFile: () =>
  fileURLToPath(new URL('../node_modules/@mujoco/mujoco/mujoco.wasm', import.meta.url)) });
mujoco.FS.mkdir('/g1');
mujoco.FS.mkdir('/g1/meshes');
const manifest = JSON.parse(await readFile(new URL('manifest.json', asset_base), 'utf8'));
for (const item of manifest.files) {
  if (item.file.endsWith('.xml') || item.file.endsWith('.STL')) {
    mujoco.FS.writeFile(`/g1/${item.file}`, new Uint8Array(await readFile(new URL(item.file, asset_base))));
  }
}
mujoco.FS.writeFile('/g1/apartment.xml', make_scene_xml());
const model = mujoco.MjModel.from_xml_path('/g1/apartment.xml');
assert.equal(model.nu, 12);
assert.equal(model.nq, 19);
for (let index = 0; index < 12; index++) assert.equal(mujoco.mj_id2name(model, 3, index + 1), JOINT_NAMES[index]);
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = {
  wasm: new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url).href,
  mjs: new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', import.meta.url).href,
};
const session = await ort.InferenceSession.create(new Uint8Array(await readFile(new URL('policy.onnx', asset_base))),
  { executionProviders: ['wasm'] });

async function simulate(command, seconds, start = SPAWN) {
  const state = new mujoco.MjData(model);
  state.qpos.set(start);
  state.qpos.set(DEFAULT_ANGLES, 7);
  let action = new Float32Array(12);
  let hidden = new ort.Tensor('float32', new Float32Array(64), [1, 1, 64]);
  let cell = new ort.Tensor('float32', new Float32Array(64), [1, 1, 64]);
  let min_height = 10;
  let obstacle_contact = false;
  const observation = new Float32Array(47);
  for (let step = 1; step <= seconds / 0.002; step++) {
    apply_pd_control(state.qpos, state.qvel, action, state.ctrl);
    mujoco.mj_step(model, state);
    min_height = Math.min(min_height, state.qpos[2]);
    if (state.qpos[2] < 0.45) break;
    if (step % 10 !== 0) continue;
    // Match the browser's lightweight pose refresh instead of rerunning full dynamics.
    mujoco.mj_kinematics(model, state);
    // Contact wrappers own Embind handles; release each after inspecting it.
    for (let index = 0; index < state.ncon; index++) {
      const contact = state.contact.get(index);
      const first_name = mujoco.mj_id2name(model, 5, contact.geom1);
      const second_name = mujoco.mj_id2name(model, 5, contact.geom2);
      if ((first_name && first_name !== 'floor') || (second_name && second_name !== 'floor')) obstacle_contact = true;
      contact.delete();
    }
    make_observation(state.qpos, state.qvel, action, command, step, observation);
    const output = await session.run({
      observation: new ort.Tensor('float32', observation, [1, 47]), hidden, cell,
    });
    action = output.action.data;
    hidden = output.next_hidden;
    cell = output.next_cell;
    assert.ok(action.every(Number.isFinite));
  }
  const result = { position: Array.from(state.qpos.slice(0, 3)), min_height,
    heading: heading_from_quaternion(state.qpos), obstacle_contact };
  state.delete();
  return result;
}

const results = {};
for (const [name, command, duration] of [
  ['idle', [0, 0, 0], 20], ['forward', [0.5, 0, 0], 9], ['backward', [-0.5, 0, 0], 2],
  ['turn', [0, 0, 0.7], 12], ['strafe', [0, 0.35, 0], 6],
]) {
  const result = await simulate(command, duration);
  assert.ok(result.min_height > 0.7, `${name}: robot lost balance`);
  results[name] = result;
}
assert.ok(results.forward.position[0] > -1);
assert.ok(results.backward.position[0] < -5.2);
assert.ok(results.strafe.position[1] > -2.2);
assert.ok(Math.abs(results.turn.heading) > 0.5);
results.doorway = await simulate([0.5, 0, 0], 8, [-0.7, 0.2, 0.793]);
assert.ok(results.doorway.position[0] > 2.2 && results.doorway.min_height > 0.7, 'Cannot walk through doorway');
results.wall_collision = await simulate([0.5, 0, 0], 10, [-0.7, -3.4, 0.793]);
assert.ok(results.wall_collision.obstacle_contact, 'Partition did not produce a collision');
assert.ok(results.wall_collision.position[0] < 1.6, 'Robot passed through a wall');
for (const [name, result] of Object.entries(results)) {
  console.log(`${name}: position [${result.position.map(value => value.toFixed(3)).join(', ')}], min height ${result.min_height.toFixed(3)} m`);
}
await session.release();
model.delete();
console.log('PASS: bundled MuJoCo WASM + ONNX policy, all 7 simulation scenarios.');
