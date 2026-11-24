import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import load_mujoco from '@mujoco/mujoco';
import { make_scene_xml, SPAWN, SCENE_FURNITURE, FURNITURE_ASSETS } from '../src/scene_layout.js';
import { PHYSICS_DT, CONTROL_DECIMATION, DEFAULT_ANGLES } from '../src/locomotion.js';
import { load_robot_files } from '../src/robot_assets.js';
import { Simulation } from '../src/simulation.js';
import { MODE } from '../src/robot_controller.js';
import { load_policies, release_policies, seeded_random } from './load_policies.js';
import { make_navigation_maps } from '../src/path_planner.js';
import { FLOOR_HEIGHT, STANDING_HEIGHT, STAIRS, ELEVATOR, floor_of, on_stairs, stair_height } from '../src/building.js';

const asset_base = new URL('../public/assets/lite_pro/', import.meta.url);
const mujoco = await load_mujoco({
  locateFile: () => fileURLToPath(new URL('../node_modules/@mujoco/mujoco/mujoco.wasm', import.meta.url)),
});
await load_robot_files(mujoco, (path) => readFile(new URL(path, asset_base)));
mujoco.FS.writeFile('/robot/apartment.xml', make_scene_xml());
const model = mujoco.MjModel.from_xml_path('/robot/apartment.xml');
const policies = await load_policies();

async function simulate(command, seconds, start = SPAWN) {
  const simulation = new Simulation(mujoco, model, policies, null, seeded_random());
  simulation.reset(start);
  simulation.command = command;
  let min_height = 10;
  let obstacle_contact = false;
  const contact_names = new Set();
  for (let step = 0; step < seconds / PHYSICS_DT; step++) {
    await simulation.advance(1);
    min_height = Math.min(min_height, simulation.state.qpos[2]);
    if (simulation.fallen || simulation.mode !== MODE.WALK) break;
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
  result.fell = result.mode !== MODE.WALK || result.fallen;
  simulation.dispose();
  return result;
}

const results = {};
for (const [name, command, duration] of [
  ['idle', [0, 0, 0], 20],
  ['forward', [0.6, 0, 0], 9],
  ['backward', [-0.4, 0, 0], 2],
  ['turn', [0, 0, 0.7], 12],
  ['strafe', [0, 0.3, 0], 6],
]) {
  console.log(`Checking physics: ${name}`);
  const result = await simulate(command, duration);
  assert.ok(!result.fell && result.min_height > 0.55, `${name}: robot lost balance`);
  results[name] = result;
}
assert.ok(results.forward.position[0] > -1);
assert.ok(results.backward.position[0] < -5.2);
assert.ok(results.strafe.position[1] > -2.2);
assert.ok(Math.abs(results.turn.heading) > 0.5);
results.doorway = await simulate([0.5, 0, 0], 8, [-0.7, 0.2, STANDING_HEIGHT]);
assert.ok(
  results.doorway.position[0] > 2.2 && results.doorway.min_height > 0.55,
  'Cannot walk through doorway',
);
results.wall_collision = await simulate([0.5, 0, 0], 10, [-0.7, -3.4, STANDING_HEIGHT]);
assert.ok(results.wall_collision.obstacle_contact, 'Partition did not produce a collision');
assert.ok(results.wall_collision.position[0] < 1.6, 'Robot passed through a wall');
results.furniture_collision = await simulate([0.5, 0, 0], 6, [-6.3, 1.35, STANDING_HEIGHT]);
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
  return mujoco.mj_ray(model, ray_state, origin, vector, [1, 0, 0, 0, 0, 0], true, -1,
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
const probe_xml = make_scene_xml().replace('<include file="robot.xml"/>', '<compiler angle="radian"/>')
  .replace('<worldbody>', `<worldbody><body name="probe" pos="${table.position[0]} ${table.position[1]} 0.9"><freejoint/><geom type="sphere" size="0.05" mass="1"/></body>`);
const probe_model = mujoco.MjModel.from_xml_string(probe_xml);
const probe_state = new mujoco.MjData(probe_model);
for (let step = 0; step < 1000; step++) mujoco.mj_step(probe_model, probe_state);
assert.ok(Math.abs(probe_state.qpos[2] - (FURNITURE_ASSETS[table.article].size[2] + 0.05)) < 0.025,
  'Physical probe did not settle on the IKEA tabletop');
probe_state.delete();
probe_model.delete();

const simulation = new Simulation(mujoco, model, policies, null, seeded_random());
simulation.command = [0.5, 0, 0];
await simulation.advance(100);
assert.ok(simulation.controller.policies.walk.terms[0].slots.length > 0);
assert.ok(simulation.action.some(value => value !== 0));
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
assert.equal(simulation.mode, MODE.WALK);
assert.equal(simulation.controller.policies.walk.terms[0].slots.length, 0);
assert.ok(simulation.action.every(value => value === 0));
assert.deepEqual(Array.from(simulation.state.qpos.slice(7, 41)), DEFAULT_ANGLES);
assert.equal(simulation.paused, false);

// A fall hands the robot to the get-up policy for the side it lies on, which stands it up and returns it to walking.
// The open living-room floor at (-3, -2) leaves room to roll.
console.log('Checking fall recovery');
for (const [label, quaternion, policy] of [['face up', [Math.SQRT1_2, 0, -Math.SQRT1_2, 0], 'getup_supine'],
  ['face down', [Math.SQRT1_2, 0, Math.SQRT1_2, 0], 'getup_prone']]) {
  simulation.reset([-3, -2, STANDING_HEIGHT]);
  simulation.command = [0.5, 0, 0];
  simulation.state.qpos[2] = 0.25;
  simulation.state.qpos.set(quaternion, 3);
  const modes = [];
  for (let step = 0; step < 15 / (PHYSICS_DT * CONTROL_DECIMATION) && !simulation.fallen; step++) {
    await simulation.advance(CONTROL_DECIMATION);
    const mode = `${simulation.mode}:${simulation.controller.policy_name}`;
    if (modes.at(-1) !== mode) modes.push(mode);
    if (simulation.controller.getups > 0 && simulation.mode === MODE.WALK) break;
  }
  console.log(`${label}: ${modes.join(' -> ')} in ${(simulation.step_count * PHYSICS_DT).toFixed(1)} s`);
  assert.deepEqual(simulation.command, [0, 0, 0], 'A fall must drop the walking command');
  assert.ok(modes.includes(`getup:${policy}`), `${label}: the ${policy} policy did not take over`);
  assert.equal(simulation.mode, MODE.WALK, `${label}: the robot did not get up`);
  assert.ok(simulation.state.qpos[2] > 0.65, `${label}: the robot is not standing`);
}
simulation.state.qpos[0] = NaN;
await simulation.advance(1);
assert.equal(simulation.fallen, true);
assert.equal(await simulation.advance(10), 0);
simulation.dispose();

const invalid_policies = { ...policies, walk: { ...policies.walk, session: {
  run: async (feeds) => {
    const output = await policies.walk.session.run(feeds);
    output[policies.walk.contract.output].data[0] = NaN;
    return output;
  },
} } };
const invalid = new Simulation(mujoco, model, invalid_policies);
await assert.rejects(invalid.advance(10), /invalid joint targets/);
assert.ok(invalid.action.every(Number.isFinite));
invalid.dispose();

const navigation_maps = make_navigation_maps();
// Stair routes are experimental: the walking policies do not climb these 11 cm risers yet, so their outcome is reported,
// not asserted.
async function navigate(goal, { start = SPAWN, limit = 100, transfer = 'elevator', yaw = 0, experimental = false } = {}) {
  const robot = new Simulation(mujoco, model, policies, navigation_maps, seeded_random());
  robot.reset(start, yaw);
  robot.navigation.transfer = transfer;
  robot.navigation.set_goal(robot.state.qpos, goal, 0);
  let min_height = Infinity;
  let previous = robot.state.qpos.slice(0, 3);
  let phase = '';
  let checked_lift_pause = false;
  const obstacle_contacts = new Set();
  while (['walking', 'waiting', 'riding'].includes(robot.navigation.state.status) && robot.step_count * PHYSICS_DT < limit) {
    await robot.advance(CONTROL_DECIMATION);
    const position = robot.state.qpos;
    const surface = robot.elevator.occupied(position) ? robot.elevator.height : on_stairs(position) ? stair_height(position) : floor_of(position) * FLOOR_HEIGHT;
    min_height = Math.min(min_height, position[2] - surface);
    if (!experimental) assert.ok(Math.hypot(...previous.map((value, axis) => position[axis] - value)) < 0.04, 'Navigation moved the robot discontinuously');
    previous = position.slice(0, 3);
    for (let index = 0; index < robot.state.ncon; index++) {
      const contact = robot.state.contact.get(index);
      for (const id of [contact.geom1, contact.geom2]) {
        const name = mujoco.mj_id2name(model, 5, id);
        if (name && !name.startsWith('robot/') && (name.includes('_collision_') || /wall|partition|annex_/.test(name) || (transfer !== 'stairs' && name.startsWith('stair_')))) obstacle_contacts.add(name);
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
    if (robot.fallen || robot.mode !== MODE.WALK) break;
  }
  if (robot.navigation.state.status === 'arrived') await robot.advance(Math.round(8 / PHYSICS_DT));
  const result = robot.telemetry();
  robot.dispose();
  if (experimental) {
    console.log(`EXPERIMENTAL navigation to ${goal}: ${result.navigation.status}, mode ${result.mode}, ` +
      `${result.time.toFixed(1)} s, at ${result.position.map(value => value.toFixed(2)).join(', ')}`);
    return result;
  }
  assert.equal(result.navigation.status, 'arrived', JSON.stringify(result));
  assert.equal(result.mode, MODE.WALK);
  assert.equal(result.fallen, false);
  assert.equal(obstacle_contacts.size, 0, `Navigation hit obstacles: ${[...obstacle_contacts].join(', ')}`);
  assert.equal(result.floor, goal[2]);
  assert.ok(Math.hypot(result.position[0] - goal[0], result.position[1] - goal[1]) < 0.35);
  assert.ok(min_height > (transfer === 'stairs' ? 0.45 : 0.6), `Navigation lost balance: ${min_height}`);
  console.log(`PASS navigation to ${goal}: ${result.time.toFixed(1)} simulated seconds, minimum height ${min_height.toFixed(3)} m`);
}
await navigate([3, 0, 0]);
await navigate([...STAIRS.lower_landing, 0]);
await navigate([-4.7, 5.1, 0]);
await navigate([-4.7, -3.4, 1]);
await navigate([-4.7, -3.4, 0], { start: [-4.7, -3.4, FLOOR_HEIGHT + SPAWN[2]] });
await navigate([3.5, 3, 1], { start: [3, 0, FLOOR_HEIGHT + SPAWN[2]] });

const rider = new Simulation(mujoco, model, policies, null, seeded_random());
rider.reset([...ELEVATOR.center, SPAWN[2]]);
rider.elevator.request(1);
rider.command = [0.5, 0, 0];
await rider.advance(Math.round(22 / PHYSICS_DT));
assert.equal(rider.mode, MODE.WALK, 'Manual input upset the robot during lift travel');
assert.equal(rider.elevator.open_floor, 1);
assert.ok(rider.state.qpos[2] > FLOOR_HEIGHT + 0.7, 'The lift did not physically carry its rider');
assert.deepEqual(rider.command, [0, 0, 0], 'Manual motion bypassed the riding interlock');
rider.dispose();

await navigate([...STAIRS.upper_landing, 1], {
  start: [...STAIRS.lower_landing, STANDING_HEIGHT], yaw: Math.PI / 2, transfer: 'stairs', experimental: true,
});
await navigate([...STAIRS.lower_landing, 0], {
  start: [...STAIRS.upper_landing, FLOOR_HEIGHT + STANDING_HEIGHT], yaw: -Math.PI / 2, transfer: 'stairs', experimental: true,
});

await release_policies(policies);
model.delete();
console.log('PASS: manual locomotion and collisions, fall recovery face up and face down, 6 navigation routes including elevator travel, arrival hold, pause/reset, and invalid-action rejection. Stair routes reported as experimental.');
