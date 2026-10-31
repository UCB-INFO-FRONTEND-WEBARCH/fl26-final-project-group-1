import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import load_mujoco from '@mujoco/mujoco';
import * as ort from 'onnxruntime-web/wasm';
import { make_scene_xml, SPAWN, SCENE_FURNITURE, FURNITURE_ASSETS } from '../src/scene_layout.js';
import { PHYSICS_DT, CONTROL_DECIMATION, DEFAULT_ANGLES } from '../src/locomotion.js';
import { load_robot_files } from '../src/robot_assets.js';
import { Simulation } from '../src/simulation.js';
import { make_navigation_maps } from '../src/path_planner.js';
import { FLOOR_HEIGHT, STAIRS, floor_of } from '../src/building.js';

const asset_base = new URL('../public/assets/g1/', import.meta.url);
const mujoco = await load_mujoco({
  locateFile: () => fileURLToPath(new URL('../node_modules/@mujoco/mujoco/mujoco.wasm', import.meta.url)),
});
await load_robot_files(mujoco, (path) => readFile(new URL(path, asset_base)));
mujoco.FS.writeFile('/g1/apartment.xml', make_scene_xml());
const model = mujoco.MjModel.from_xml_path('/g1/apartment.xml');
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = {
  wasm: new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url).href,
  mjs: new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', import.meta.url).href,
};
const session = await ort.InferenceSession.create(
  new Uint8Array(await readFile(new URL('policy.onnx', asset_base))),
  { executionProviders: ['wasm'] },
);

async function simulate(command, seconds, start = SPAWN) {
  const simulation = new Simulation(mujoco, model, session);
  simulation.reset(start);
  simulation.command = command;
  let min_height = 10;
  let obstacle_contact = false;
  const contact_names = new Set();
  for (let step = 0; step < seconds / PHYSICS_DT; step++) {
    await simulation.advance(1);
    min_height = Math.min(min_height, simulation.state.qpos[2]);
    if (simulation.fallen) break;
    if (simulation.step_count % CONTROL_DECIMATION !== 0) continue;
    mujoco.mj_kinematics(model, simulation.state);
    for (let index = 0; index < simulation.state.ncon; index++) {
      // Each contact has an Embind handle that the caller must delete.
      const contact = simulation.state.contact.get(index);
      const first_name = mujoco.mj_id2name(model, 5, contact.geom1);
      const second_name = mujoco.mj_id2name(model, 5, contact.geom2);
      if ((first_name && first_name !== 'floor') || (second_name && second_name !== 'floor'))
        obstacle_contact = true;
      for (const name of [first_name, second_name]) if (name && name !== 'floor') contact_names.add(name);
      contact.delete();
    }
  }
  const result = { ...simulation.telemetry(), min_height, obstacle_contact, contact_names: [...contact_names] };
  simulation.dispose();
  return result;
}

const results = {};
for (const [name, command, duration] of [
  ['idle', [0, 0, 0], 20],
  ['forward', [0.5, 0, 0], 9],
  ['backward', [-0.5, 0, 0], 2],
  ['turn', [0, 0, 0.7], 12],
  ['strafe', [0, 0.35, 0], 6],
]) {
  console.log(`Checking physics: ${name}`);
  const result = await simulate(command, duration);
  assert.ok(result.min_height > 0.7, `${name}: robot lost balance`);
  results[name] = result;
}
assert.ok(results.forward.position[0] > -1);
assert.ok(results.backward.position[0] < -5.2);
assert.ok(results.strafe.position[1] > -2.2);
assert.ok(Math.abs(results.turn.heading) > 0.5);
results.doorway = await simulate([0.5, 0, 0], 8, [-0.7, 0.2, 0.793]);
assert.ok(
  results.doorway.position[0] > 2.2 && results.doorway.min_height > 0.7,
  'Cannot walk through doorway',
);
results.wall_collision = await simulate([0.5, 0, 0], 10, [-0.7, -3.4, 0.793]);
assert.ok(results.wall_collision.obstacle_contact, 'Partition did not produce a collision');
assert.ok(results.wall_collision.position[0] < 1.6, 'Robot passed through a wall');
results.furniture_collision = await simulate([0.5, 0, 0], 6, [-6.3, 1.35, 0.793]);
assert.ok(results.furniture_collision.contact_names.some((name) => name.startsWith('coffee_table_collision_')),
  'IKEA coffee table did not produce robot contacts');
assert.ok(results.furniture_collision.position[0] < -3.5, 'Robot passed through the coffee table');
for (const [name, result] of Object.entries(results)) {
  console.log(
    `${name}: position [${result.position.map((value) => value.toFixed(3)).join(', ')}], min height ${result.min_height.toFixed(3)} m`,
  );
}

const ray_state = new mujoco.MjData(model);
mujoco.mj_forward(model, ray_state);
function furniture_ray(name, point, direction) {
  const item = SCENE_FURNITURE.find((item) => item.name === name);
  const cosine = Math.cos(item.yaw);
  const sine = Math.sin(item.yaw);
  const origin = [item.position[0] + cosine * point[0] - sine * point[1],
    item.position[1] + sine * point[0] + cosine * point[1], item.position[2] + point[2]];
  const vector = [cosine * direction[0] - sine * direction[1], sine * direction[0] + cosine * direction[1], direction[2]];
  return mujoco.mj_ray(model, ray_state, origin, vector, [0, 0, 0, 1, 0, 0], true, -1,
    new Int32Array(1), new Float64Array(3));
}
const tabletop = furniture_ray('coffee_table', [0, 0, 1], [0, 0, -1]);
assert.ok(Math.abs(1 - tabletop - FURNITURE_ASSETS['00104291'].size[2]) < 0.025, 'Tabletop collider does not match its visible height');
const table_opening = furniture_ray('coffee_table', [0, -1, 0.31], [0, 1, 0]);
assert.ok(table_opening < 0 || table_opening > 1.5, 'Empty space between table shelf and tabletop is blocked');
const table_leg = furniture_ray('coffee_table', [-0.564, -1, 0.1], [0, 1, 0]);
assert.ok(table_leg > 0.55 && table_leg < 0.75, 'Table-leg collider is missing or misplaced');
const bookcase_opening = furniture_ray('bookshelf_south', [0, -0.5, 0.65], [0, 1, 0]);
assert.ok(bookcase_opening > 0.57 && bookcase_opening < 0.68, 'Bookcase opening is filled or its back panel is missing');
const desk_opening = furniture_ray('study_desk', [0, -0.6, 0.3], [0, 1, 0]);
assert.ok(desk_opening < 0 || desk_opening > 0.9, 'Desk knee space is blocked');
ray_state.delete();

const table = SCENE_FURNITURE.find((item) => item.name === 'coffee_table');
const probe_xml = make_scene_xml().replace('<include file="g1_12dof.xml"/>', '<compiler angle="radian"/>')
  .replace('<worldbody>', `<worldbody><body name="probe" pos="${table.position[0]} ${table.position[1]} 0.9"><freejoint/><geom type="sphere" size="0.05" mass="1"/></body>`);
const probe_model = mujoco.MjModel.from_xml_string(probe_xml);
const probe_state = new mujoco.MjData(probe_model);
for (let step = 0; step < 1000; step++) mujoco.mj_step(probe_model, probe_state);
assert.ok(Math.abs(probe_state.qpos[2] - (FURNITURE_ASSETS[table.article].size[2] + 0.05)) < 0.025,
  'Physical probe did not settle on the IKEA tabletop');
probe_state.delete();
probe_model.delete();

const simulation = new Simulation(mujoco, model, session);
simulation.command = [0.5, 0, 0];
await simulation.advance(100);
assert.ok(simulation.hidden.data.some((value) => value !== 0));
simulation.paused = true;
const pose = simulation.state.qpos.slice();
assert.equal(await simulation.advance(10), 0);
assert.deepEqual(simulation.state.qpos, pose);
simulation.request_reset();
simulation.command = [0.3, 0, 0];
simulation.reset();
assert.deepEqual(simulation.command, [0.3, 0, 0]);
assert.equal(simulation.step_count, 0);
assert.equal(simulation.distance, 0);
assert.ok(simulation.hidden.data.every((value) => value === 0));
assert.ok(simulation.cell.data.every((value) => value === 0));
assert.deepEqual(Array.from(simulation.state.qpos.slice(7, 19)), DEFAULT_ANGLES);
assert.equal(simulation.paused, false);
simulation.state.qpos[2] = 0.3;
await simulation.advance(10);
assert.equal(simulation.fallen, true);
assert.deepEqual(simulation.command, [0, 0, 0]);
assert.equal(await simulation.advance(10), 0);
simulation.dispose();

const invalid_session = {
  run: async (feeds) => {
    const output = await session.run(feeds);
    output.action.data[0] = NaN;
    return output;
  },
};
const invalid = new Simulation(mujoco, model, invalid_session);
await assert.rejects(invalid.advance(10), /invalid joint targets/);
assert.ok(invalid.action.every(Number.isFinite));
invalid.dispose();

const navigation_maps = make_navigation_maps();
async function navigate(goal, start = SPAWN, limit = 100) {
  const robot = new Simulation(mujoco, model, session, navigation_maps);
  robot.reset(start);
  robot.navigation.set_goal(robot.state.qpos, goal, 0);
  let min_height = Infinity;
  let previous = robot.state.qpos.slice(0, 3);
  let phase = '';
  let checked_lift_pause = false;
  const obstacle_contacts = new Set();
  while (['walking', 'waiting', 'riding'].includes(robot.navigation.state.status) && robot.step_count * PHYSICS_DT < limit) {
    await robot.advance(CONTROL_DECIMATION);
    const position = robot.state.qpos;
    const surface = robot.elevator.occupied(position) ? robot.elevator.height : floor_of(position) * FLOOR_HEIGHT;
    min_height = Math.min(min_height, position[2] - surface);
    assert.ok(Math.hypot(...previous.map((value, axis) => position[axis] - value)) < 0.04, 'Navigation moved the robot discontinuously');
    previous = position.slice(0, 3);
    for (let index = 0; index < robot.state.ncon; index++) {
      const contact = robot.state.contact.get(index);
      for (const id of [contact.geom1, contact.geom2]) {
        const name = mujoco.mj_id2name(model, 5, id);
        if (name && (name.includes('_collision_') || /wall|partition|annex_|stair_/.test(name))) obstacle_contacts.add(name);
      }
      contact.delete();
    }
    if (!checked_lift_pause && robot.elevator.moving && robot.elevator.occupied(position) && robot.elevator.height > 0.5 && robot.elevator.height < 2.8) {
      assert.ok(robot.elevator.gates.every(id => model.geom_contype[id] === 1), 'Landing gates opened during transit');
      assert.equal(model.geom_contype[robot.elevator.front_rail], 1);
      const frozen = robot.state.qpos.slice();
      robot.paused = true;
      assert.equal(await robot.advance(100), 0);
      assert.deepEqual(robot.state.qpos, frozen);
      assert.ok(robot.navigation.state.goal);
      robot.paused = false;
      checked_lift_pause = true;
    }
    if (phase !== robot.navigation.state.message) {
      phase = robot.navigation.state.message;
      console.log(`navigation: ${phase} at ${Array.from(previous).map(value => value.toFixed(2)).join(', ')}`);
    }
    if (robot.fallen) break;
  }
  if (robot.navigation.state.status === 'arrived') await robot.advance(Math.round(8 / PHYSICS_DT));
  const result = robot.telemetry();
  robot.dispose();
  assert.equal(result.navigation.status, 'arrived', JSON.stringify(result));
  assert.equal(result.fallen, false);
  assert.equal(obstacle_contacts.size, 0, `Navigation hit obstacles: ${[...obstacle_contacts].join(', ')}`);
  assert.equal(result.floor, goal[2]);
  assert.ok(Math.hypot(result.position[0] - goal[0], result.position[1] - goal[1]) < 0.35);
  assert.ok(min_height > 0.65, `Navigation lost balance: ${min_height}`);
  console.log(`PASS navigation to ${goal}: ${result.time.toFixed(1)} simulated seconds, minimum height ${min_height.toFixed(3)} m`);
}
await navigate([3, 0, 0]);
await navigate([...STAIRS.lower_landing, 0]);
await navigate([-4.7, 5.1, 0]);
await navigate([-4.7, -3.4, 1]);
await navigate([-4.7, -3.4, 0], [-4.7, -3.4, FLOOR_HEIGHT + SPAWN[2]]);
await navigate([3.5, 3, 1], [3, 0, FLOOR_HEIGHT + SPAWN[2]]);

const rider = new Simulation(mujoco, model, session);
rider.reset([-8.4, -4.2, SPAWN[2]]);
rider.elevator.request(1);
rider.command = [0.5, 0, 0];
await rider.advance(Math.round(22 / PHYSICS_DT));
assert.equal(rider.fallen, false, 'Manual input upset the robot during lift travel');
assert.equal(rider.elevator.open_floor, 1);
assert.ok(rider.state.qpos[2] > FLOOR_HEIGHT + 0.7, 'The lift did not physically carry its rider');
assert.deepEqual(rider.command, [0, 0, 0], 'Manual motion bypassed the riding interlock');
rider.dispose();

const climber = new Simulation(mujoco, model, session, navigation_maps);
climber.navigation.transfer = 'stairs';
climber.navigation.set_goal(climber.state.qpos, [...STAIRS.upper_landing, 1], 0);
let attempted_stairs = false;
let touched_stairs = false;
for (let tick = 0; tick < 3500 && !climber.fallen && climber.navigation.state.status === 'walking'; tick++) {
  await climber.advance(CONTROL_DECIMATION);
  attempted_stairs ||= climber.navigation.state.message.includes('Attempting stairs');
  for (let index = 0; index < climber.state.ncon; index++) {
    const contact = climber.state.contact.get(index);
    touched_stairs ||= [contact.geom1, contact.geom2].some(id => mujoco.mj_id2name(model, 5, id)?.startsWith('stair_'));
    contact.delete();
  }
}
assert.ok(attempted_stairs, 'The stair route never reached the stair entry');
assert.ok(touched_stairs, 'The current policy was not allowed to attempt a physical stair');
console.log(`Stair attempt: fallen=${climber.fallen}, status=${climber.navigation.state.status}, position=${climber.telemetry().position.map(value => value.toFixed(2))}`);
climber.dispose();

await session.release();
model.delete();
console.log('PASS: 8 manual physics scenarios, 6 navigation routes including the stair entry and elevator trips both ways, a physical stair attempt, collision probes, pause/reset, fall detection, and invalid-action rejection.');
