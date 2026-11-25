import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import load_mujoco from '@mujoco/mujoco';
import { make_scene_xml, SPAWN, SPAWN_YAW } from '../src/scene_layout.js';
import { load_robot_files } from '../src/robot_assets.js';
import { Simulation } from '../src/simulation.js';
import { MODE } from '../src/robot_controller.js';
import { PHYSICS_DT } from '../src/locomotion.js';
import { FLOOR_HEIGHT, STANDING_HEIGHT } from '../src/building.js';
import { SEATS, from_seat, to_seat, nearby_seat } from '../src/seat.js';
import { make_navigation_maps } from '../src/path_planner.js';
import { HEPHAESTUS_PHYSICS } from '../src/hephaestus_physics.js';
import { load_policies, release_policies, seeded_random } from './load_policies.js';

const mujoco = await load_mujoco({ locateFile: () => fileURLToPath(new URL('../node_modules/@mujoco/mujoco/mujoco.wasm', import.meta.url)) });
await load_robot_files(mujoco, path => readFile(new URL(`../public/assets/lite_pro/${path}`, import.meta.url)));
mujoco.FS.writeFile('/robot/seating.xml', make_scene_xml());
const model = mujoco.MjModel.from_xml_path('/robot/seating.xml');
const policies = await load_policies();
const maps = make_navigation_maps();
const requested = process.env.SEAT_ID;
const seats = requested ? SEATS.filter(seat => seat.id === requested || seat.article === requested || seat.kind.toLowerCase() === requested) : SEATS;
assert.ok(seats.length, 'Unknown seat filter');

if (mujoco.mj_name2id(model, 3, 'lift_joint') >= 0) {
  const probe = new Simulation(mujoco, model, policies, maps, seeded_random(1));
  const lift = probe.elevator;
  probe.state.qpos[lift.position_index] = .42;
  probe.state.qvel[lift.velocity_index] = .12;
  probe.state.time = 1.25;
  probe.step_count = 250;
  probe.controller.falls = 2;
  probe.controller.getups = 1;
  probe.paused = true;
  probe.place_robot(SPAWN, SPAWN_YAW);
  assert.equal(probe.state.qpos[lift.position_index], .42);
  assert.equal(probe.state.qvel[lift.velocity_index], .12);
  assert.equal(probe.state.time, 1.25);
  assert.equal(probe.step_count, 250);
  assert.equal(probe.controller.falls, 2);
  assert.equal(probe.controller.getups, 1);
  assert.equal(probe.paused, true);
  probe.dispose();
}

async function until(simulation, done, seconds) {
  const start = simulation.step_count;
  while (!simulation.fallen && (simulation.step_count - start) * PHYSICS_DT < seconds) {
    await simulation.advance(4);
    if (done()) return true;
  }
  return false;
}

for (const seat of seats) for (const seed of seat.alignment_assist ? [1, 2] : [1]) {
  console.log(`CHECK ${seat.id} · ${seat.label} · floor ${seat.floor} · seed ${seed}`);
  const simulation = new Simulation(mujoco, model, policies, maps, seeded_random(seed));
  const start = [...from_seat(seat, seat.existing ? seat.staging : 1.25, 0), seat.floor * FLOOR_HEIGHT + STANDING_HEIGHT];
  assert.ok(maps[seat.floor].free(start, seat.precise_approach), `${seat.id}: start is blocked`);
  simulation.reset(start, seat.yaw);
  assert.equal(nearby_seat(start, seat.floor, maps)?.id, seat.id);
  assert.equal(simulation.request_sit(seat.id), true);
  let initial_falls = 0;
  if (seat.alignment_assist) {
    // The local alignment must not reset the world, clock, pause state or recorded recovery history.
    simulation.step_count = 400;
    simulation.state.time = 400 * PHYSICS_DT;
    simulation.controller.falls = initial_falls = 2;
    simulation.controller.getups = 1;
    const lift = simulation.elevator;
    const original_lift = lift && [simulation.state.qpos[lift.position_index], simulation.state.qvel[lift.velocity_index]];
    if (lift) { simulation.state.qpos[lift.position_index] = .42; simulation.state.qvel[lift.velocity_index] = .12; }
    const paused = simulation.paused;
    simulation.walking_command();
    assert.equal(simulation.mode, MODE.SIT_DOWN);
    assert.equal(simulation.step_count, 400);
    assert.ok(Math.abs(simulation.state.time - 400 * PHYSICS_DT) < 1e-10);
    assert.equal(simulation.paused, paused);
    assert.equal(simulation.controller.falls, 2);
    assert.equal(simulation.controller.getups, 1);
    if (lift) {
      assert.equal(simulation.state.qpos[lift.position_index], .42);
      assert.equal(simulation.state.qvel[lift.velocity_index], .12);
      simulation.state.qpos[lift.position_index] = original_lift[0];
      simulation.state.qvel[lift.velocity_index] = original_lift[1];
      mujoco.mj_forward(model, simulation.state);
    }
  }
  const seated = await until(simulation, () => simulation.mode === MODE.SEATED || simulation.mode === MODE.FALLING ||
    (!simulation.approach && simulation.mode === MODE.WALK), 30);
  assert.ok(seated && simulation.mode === MODE.SEATED, `${seat.id}: ${simulation.mode} / ${simulation.seat_message}`);
  await until(simulation, () => simulation.mode !== MODE.SEATED, seat.existing ? 4 : 2);
  const [depth, lateral] = to_seat(seat, simulation.state.qpos);
  console.log('SEATED', { depth, lateral, height: simulation.state.qpos[2] - seat.floor * FLOOR_HEIGHT, time: simulation.step_count * PHYSICS_DT });
  assert.equal(simulation.mode, MODE.SEATED);
  assert.ok(depth < (seat.existing ? -0.03 : -0.05) && depth > -seat.depth && Math.abs(lateral) < seat.width / 2 - 0.1);
  const native_names = new Set(HEPHAESTUS_PHYSICS.filter(h => h.source === seat.collision_source).map(h => h.name));
  let seat_contact = false;
  for (let index = 0; index < simulation.state.ncon; index++) {
    const contact = simulation.state.contact.get(index);
    seat_contact ||= [contact.geom1, contact.geom2].some(id => {
      const name = mujoco.mj_id2name(model, 5, id);
      return seat.collision_source ? native_names.has(name) : name?.startsWith(seat.collision_prefix ?? `seat_${seat.id}_`);
    });
    contact.delete();
  }
  assert.ok(seat_contact, `${seat.id}: no physical seat contact`);
  assert.equal(simulation.request_stand(), true);
  const stood = await until(simulation, () => simulation.mode === MODE.WALK || simulation.mode === MODE.FALLING, 8);
  assert.ok(stood && simulation.mode === MODE.WALK, `${seat.id}: could not stand (${simulation.mode})`);
  simulation.command = [seat.existing ? .25 : .4, 0, 0];
  await until(simulation, () => simulation.mode !== MODE.WALK, seat.existing ? .7 : 2);
  if (seat.existing) {
    simulation.command = [0, 0, 0];
    await until(simulation, () => simulation.mode !== MODE.WALK, 2);
  }
  assert.equal(simulation.mode, MODE.WALK, `${seat.id}: fell walking away`);
  assert.equal(simulation.controller.falls, initial_falls, `${seat.id}: fell during the interaction`);
  console.log(`PASS ${seat.id}: ${seat.alignment_assist ? 'aligned, ' : 'walked up, '}sat on its real collider, stood and walked away`);
  simulation.dispose();
}
await release_policies(policies);
model.delete();
