import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import load_mujoco from '@mujoco/mujoco';
import { make_scene_xml } from '../src/scene_layout.js';
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

async function until(simulation, done, seconds) {
  const start = simulation.step_count;
  while (!simulation.fallen && (simulation.step_count - start) * PHYSICS_DT < seconds) {
    const previous = simulation.state.qpos.slice(0, 3);
    await simulation.advance(4);
    const displacement = Math.hypot(...previous.map((v, i) => simulation.state.qpos[i] - v));
    assert.ok(displacement < .04, `Robot position jumped ${displacement.toFixed(3)} m during seating`);
    if (done()) return true;
  }
  return false;
}

for (const seat of seats) for (const seed of seat.kind === 'Sofa' ? [1, 2, 3, 4] : [1]) {
  console.log(`CHECK ${seat.id} · ${seat.label} · floor ${seat.floor} · seed ${seed}`);
  const simulation = new Simulation(mujoco, model, policies, maps, seeded_random(seed));
  const start = [...from_seat(seat, 1.25, 0), (seat.floor_z ?? seat.floor * FLOOR_HEIGHT) + STANDING_HEIGHT];
  assert.ok(maps[seat.floor].free(start, seat.precise_approach), `${seat.id}: start is blocked`);
  simulation.reset(start, seat.yaw);
  assert.equal(nearby_seat(start, seat.floor, maps)?.id, seat.id);
  assert.equal(simulation.request_sit(seat.id), true);
  const seated = await until(simulation, () => simulation.mode === MODE.SEATED || simulation.mode === MODE.FALLING ||
    (!simulation.approach && simulation.mode === MODE.WALK), 30);
  assert.ok(seated && simulation.mode === MODE.SEATED, `${seat.id}: ${simulation.mode} / ${simulation.seat_message}`);
  await until(simulation, () => simulation.mode !== MODE.SEATED, seat.kind === 'Sofa' ? 10 : 2);
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
  await until(simulation, () => simulation.mode !== MODE.WALK, 2);
  assert.equal(simulation.mode, MODE.WALK, `${seat.id}: fell after standing without input`);
  simulation.command = [.4, 0, 0];
  await until(simulation, () => simulation.mode !== MODE.WALK, 3);
  assert.equal(simulation.mode, MODE.WALK, `${seat.id}: fell walking away`);
  const [away] = to_seat(seat, simulation.state.qpos);
  assert.ok(away > 1, `${seat.id}: stuck after standing (${away.toFixed(2)} m from the front)`);
  assert.equal(simulation.controller.falls, 0, `${seat.id}: fell during the interaction`);
  console.log(`PASS ${seat.id}: walked up, sat on its real collider, stood and walked ${away.toFixed(2)} m clear`);
  simulation.dispose();
}
await release_policies(policies);
model.delete();
