// Record physical policy motion once. The explanation page plays poses without loading the simulator.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import load_mujoco from '@mujoco/mujoco';
import * as ort from 'onnxruntime-web/wasm';
import { Matrix4, Quaternion } from 'three';
import { load_robot_files } from '../src/robot_assets.js';
import { make_scene_xml } from '../src/scene_layout.js';
import { Simulation } from '../src/simulation.js';
import { make_navigation_maps } from '../src/path_planner.js';
import { STAIRS, STANDING_HEIGHT, FLOOR_HEIGHT } from '../src/building.js';

const source = new URL('../public/assets/lite_pro/', import.meta.url);
const destination = new URL('../public/assets/explainer/', import.meta.url);
const contract = JSON.parse(await readFile(new URL('contract.json', source), 'utf8'));
await mkdir(destination, { recursive: true });
const mujoco = await load_mujoco();
await load_robot_files(mujoco, name => readFile(new URL(name, source)));
mujoco.FS.writeFile('/robot/apartment.xml', make_scene_xml());
const model = mujoco.MjModel.from_xml_path('/robot/apartment.xml');
ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(await readFile(new URL('policy.onnx', source)));
const geometries = [];
for (let id = 0; id < model.ngeom; id++) {
  if (model.geom_bodyid[id] === 0 || model.geom_group[id] !== 2) continue;
  geometries.push({ id, mesh_id: model.geom_dataid[id], color: Array.from(model.geom_rgba.slice(id * 4, id * 4 + 3)) });
}
const rotation = new Matrix4();
const quaternion = new Quaternion();
const manifest = {
  description: 'Seeded physical S3 policy runs in the RoboPlay apartment. Recorded at 10 frames/s. No pose corrections.',
  source: contract.source,
  source_commit: contract.commit,
  report: contract.artifact,
  checkpoint: contract.checkpoint,
  policy_sha256: contract.sha256,
  license: contract.license,
  seed: 1,
  fps: 10,
  geometries,
  clips: {},
};
for (const direction of ['up', 'down']) {
  let seed = 1;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const simulation = new Simulation(mujoco, model, session, make_navigation_maps(), random);
  const ascending = direction === 'up';
  simulation.reset([...(ascending ? STAIRS.lower_landing : STAIRS.upper_landing),
    STANDING_HEIGHT + (ascending ? 0 : FLOOR_HEIGHT)], ascending ? Math.PI / 2 : -Math.PI / 2);
  simulation.navigation.transfer = 'stairs';
  simulation.navigation.set_goal(simulation.state.qpos,
    [...(ascending ? STAIRS.upper_landing : STAIRS.lower_landing), ascending ? 1 : 0], 0);
  const poses = [];
  const depth = [];
  const roots = [];
  while (!simulation.fallen && simulation.step_count < 6000) {
    await simulation.advance(20);
    roots.push(...simulation.state.qpos.slice(0, 3));
    for (const { id } of geometries) {
      poses.push(...simulation.state.geom_xpos.slice(id * 3, id * 3 + 3));
      const r = simulation.state.geom_xmat.subarray(id * 9, id * 9 + 9);
      rotation.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
      quaternion.setFromRotationMatrix(rotation);
      poses.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }
    depth.push(...simulation.policy.image.map(value => Math.round(Math.max(0, Math.min(1, value)) * 255)));
    if (simulation.navigation.state.status === 'arrived') break;
  }
  assert.equal(simulation.fallen, false, `${direction}: policy fell during recording`);
  assert.equal(simulation.navigation.state.status, 'arrived', `${direction}: route did not finish`);
  const frames = roots.length / 3;
  await writeFile(new URL(`${direction}.poses.bin`, destination), new Uint8Array(new Float32Array(poses).buffer));
  await writeFile(new URL(`${direction}.depth.bin`, destination), new Uint8Array(depth));
  manifest.clips[direction] = { frames, duration: (frames - 1) / manifest.fps, roots };
  console.log(`${direction}: ${frames} physical frames, ${geometries.length} visual meshes`);
  simulation.dispose();
}
await writeFile(new URL('motion.json', destination), JSON.stringify(manifest));
await session.release();
model.delete();
