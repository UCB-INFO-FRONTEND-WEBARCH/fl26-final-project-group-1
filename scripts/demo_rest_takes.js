// Screen seeds for the "take a rest" demo video: run the demo script headless, as the browser worker does, and report
// falls, where the robot sits, and foot slip. Usage: node scripts/demo_rest_takes.js [first seed] [last seed]
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import load_mujoco from '@mujoco/mujoco';
import { make_scene_xml } from '../src/scene_layout.js';
import { load_robot_files } from '../src/robot_assets.js';
import { Simulation } from '../src/simulation.js';
import { CONTROL_DECIMATION } from '../src/locomotion.js';
import { to_seat } from '../src/seat.js';
import { make_navigation_maps } from '../src/path_planner.js';
import { RestDemo, seeded_random } from '../src/demo_rest.js';
import { load_policies, release_policies } from './load_policies.js';

const [first = 1, last = first] = process.argv.slice(2).map(Number);
const mujoco = await load_mujoco({ locateFile: () => fileURLToPath(new URL('../node_modules/@mujoco/mujoco/mujoco.wasm', import.meta.url)) });
await load_robot_files(mujoco, path => readFile(new URL(`../public/assets/lite_pro/${path}`, import.meta.url)));
mujoco.FS.writeFile('/robot/demo.xml', make_scene_xml());
const model = mujoco.MjModel.from_xml_path('/robot/demo.xml');
const policies = await load_policies();
const maps = make_navigation_maps();
const foot_bodies = ['left', 'right'].map(side => mujoco.mj_name2id(model, 1, `robot/${side}_foot`));

/** The foot sides (0 left, 1 right) touching anything this step. */
function stance(simulation) {
  const sides = new Set(), { state } = simulation;
  for (let i = 0; i < state.ncon; i++) {
    const contact = state.contact.get(i);
    for (const geom of [contact.geom1, contact.geom2]) {
      if (simulation.feet.includes(geom)) sides.add(foot_bodies.indexOf(model.geom_bodyid[geom]));
    }
    contact.delete();
  }
  return sides;
}

for (let seed = first; seed <= last; seed++) {
  const simulation = new Simulation(mujoco, model, policies, maps, seeded_random(seed));
  const demo = new RestDemo(simulation);
  // Foot slip: how far a foot's origin moves in one unbroken stance, worst case per stage.
  const slide = [0, 0], previous = [null, null], worst = {};
  while (!demo.ended && demo.time < 60) {
    await demo.advance(CONTROL_DECIMATION);
    const touching = stance(simulation);
    for (let side = 0; side < 2; side++) {
      const b = foot_bodies[side], xy = [simulation.state.xpos[3 * b], simulation.state.xpos[3 * b + 1]];
      if (touching.has(side) && previous[side]) slide[side] += Math.hypot(xy[0] - previous[side][0], xy[1] - previous[side][1]);
      else slide[side] = 0;
      previous[side] = touching.has(side) ? xy : null;
      worst[demo.stage] = Math.max(worst[demo.stage] ?? 0, slide[side]);
    }
  }
  const [depth, lateral] = to_seat(demo.seat, simulation.state.qpos);
  const ok = demo.stage === 'seated' && simulation.controller.falls === 0;
  console.log(JSON.stringify({ seed, ok, stage: demo.stage, falls: simulation.controller.falls,
    seated_at: demo.seated_at, end: +demo.time.toFixed(2), depth: +depth.toFixed(3), lateral: +lateral.toFixed(3),
    slip_cm: Object.fromEntries(Object.entries(worst).map(([stage, m]) => [stage, +(m * 100).toFixed(1)])) }));
  simulation.dispose();
}
await release_policies(policies);
model.delete();
