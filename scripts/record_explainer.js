// Record physical policy motion once. The explanation page plays poses without loading the simulator.
// Runs in the demo apartment, whose straight stair the page's 3D view shows: CENTORIA_MAP=demo node scripts/record_explainer.js
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import load_mujoco from '@mujoco/mujoco';
import { Matrix4, Quaternion } from 'three';
import { load_robot_files } from '../src/robot_assets.js';
import { make_scene_xml } from '../src/scene_layout.js';
import { Simulation } from '../src/simulation.js';
import { MODE } from '../src/robot_controller.js';
import { make_navigation_maps } from '../src/path_planner.js';
import { STAIRS, STAIR_BOXES, STANDING_HEIGHT, FLOOR_HEIGHT } from '../src/building.js';
import { ROBOT_VISUAL_GROUP } from '../src/geom_groups.js';
import { IS_HEPHAESTUS } from '../src/world.js';
import { POLICY } from '../src/policy_constants.js';
import { ASSET_BASE, load_policies, release_policies, seeded_random } from './load_policies.js';

assert.ok(!IS_HEPHAESTUS, 'Record in the demo apartment: CENTORIA_MAP=demo node scripts/record_explainer.js');
const destination = new URL('../public/assets/explainer/', import.meta.url);
const source = JSON.parse(await readFile(new URL('manifest.json', ASSET_BASE), 'utf8'));
await mkdir(destination, { recursive: true });
const mujoco = await load_mujoco();
await load_robot_files(mujoco, name => readFile(new URL(name, ASSET_BASE)));
mujoco.FS.writeFile('/robot/apartment.xml', make_scene_xml());
const model = mujoco.MjModel.from_xml_path('/robot/apartment.xml');
const policies = await load_policies();
const geometries = [];
for (let id = 0; id < model.ngeom; id++) {
  if (model.geom_bodyid[id] === 0 || model.geom_group[id] !== ROBOT_VISUAL_GROUP) continue;
  geometries.push({ id, mesh_id: model.geom_dataid[id], color: Array.from(model.geom_rgba.slice(id * 4, id * 4 + 3)) });
}
const rotation = new Matrix4();
const quaternion = new Quaternion();
// The stairs policy's elevation map, as grey levels: mid grey is the ground underfoot, white 0.5 m above, black 0.5 m below.
const MAP_RANGE = 0.5;
const LABELS = ['walk', 'walk_stairs', 'falling', 'getup_supine', 'getup_prone'];
const manifest = {
  description: 'Seeded physical runs of the Fluctlight policies in the Centoria demo apartment. Recorded at 10 frames/s. No pose corrections.',
  source: source.source,
  source_commit: source.commit,
  checkpoints: POLICY.checkpoints,
  seed: 1,
  fps: 10,
  geometries,
  map: { width: 21, height: 21, range_m: MAP_RANGE, policy: 'walk_stairs' },
  labels: LABELS,
  stairs: { boxes: STAIR_BOXES, center_x: STAIRS.center_x, floor_height: FLOOR_HEIGHT,
    landings: [STAIRS.lower_landing, STAIRS.upper_landing] },
  clips: {},
};

/** Run one seeded clip until `done`; record the visual poses, the map and the active policy every 0.1 s. */
async function record(name, setup, done, limit_s) {
  const simulation = new Simulation(mujoco, model, policies, make_navigation_maps(), seeded_random(1));
  setup(simulation);
  const map = simulation.controller.policies.walk_stairs.map;
  const poses = [], heights = [], roots = [], labels = [];
  while (!simulation.fallen && simulation.step_count * 0.005 < limit_s) {
    await simulation.advance(20);
    roots.push(...simulation.state.qpos.slice(0, 3));
    for (const { id } of geometries) {
      poses.push(...simulation.state.geom_xpos.slice(id * 3, id * 3 + 3));
      const r = simulation.state.geom_xmat.subarray(id * 9, id * 9 + 9);
      rotation.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
      quaternion.setFromRotationMatrix(rotation);
      poses.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }
    // The map as the stairs policy would see it now, whichever policy drives.
    mujoco.mj_forward(model, simulation.state);
    for (const h of map.sense(simulation.state)) heights.push(Math.round(Math.max(0, Math.min(1, (h + MAP_RANGE) / (2 * MAP_RANGE))) * 255));
    labels.push(LABELS.indexOf(simulation.mode === MODE.FALLING ? 'falling' : simulation.controller.policy_name));
    if (done(simulation)) break;
  }
  assert.equal(simulation.fallen, false, `${name}: the simulation diverged`);
  assert.ok(done(simulation), `${name}: the clip did not finish`);
  const frames = roots.length / 3;
  await writeFile(new URL(`${name}.poses.bin`, destination), new Uint8Array(new Float32Array(poses).buffer));
  await writeFile(new URL(`${name}.map.bin`, destination), new Uint8Array(heights));
  manifest.clips[name] = { frames, duration: (frames - 1) / manifest.fps, roots, labels };
  console.log(`${name}: ${frames} physical frames, ${geometries.length} visual meshes, ` +
    `${simulation.controller.falls} falls, ${simulation.controller.getups} get-ups`);
  simulation.dispose();
}

await record('down', simulation => {
  simulation.reset([...STAIRS.upper_landing, STANDING_HEIGHT + FLOOR_HEIGHT], -Math.PI / 2);
  simulation.navigation.transfer = 'stairs';
  simulation.navigation.set_goal(simulation.state.qpos, [...STAIRS.lower_landing, 0], 0);
}, simulation => simulation.navigation.state.status === 'arrived' && simulation.controller.falls === 0, 60);

await record('getup', simulation => {
  // Face down on open living-room floor, then let go. A get-up needs about 1.5 m of free floor around the body.
  simulation.reset([-3, -2, STANDING_HEIGHT], Math.PI / 2);
  simulation.state.qpos[2] = 0.25;
  simulation.state.qpos.set([Math.SQRT1_2, 0, Math.SQRT1_2, 0], 3);
}, simulation => simulation.controller.getups > 0 && simulation.mode === MODE.WALK && simulation.controller.mode_time > 1.5, 20);

await writeFile(new URL('motion.json', destination), JSON.stringify(manifest));
await release_policies(policies);
model.delete();
