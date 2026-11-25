// The sit check shared by the demo and Hephaestus physics checks: walk to the Lite Pro seat from across the room,
// line up, sit down, sit for a while, stand up and walk away. A movement key during the walk to the seat cancels it.
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';
import { MODE } from '../src/robot_controller.js';
import { PHYSICS_DT } from '../src/locomotion.js';
import { FLOOR_HEIGHT } from '../src/building.js';
import { SEAT, to_seat } from '../src/seat.js';
import { make_navigation_maps } from '../src/path_planner.js';
import { seeded_random } from './load_policies.js';

async function run_until(simulation, done, limit_s) {
  const start = simulation.step_count;
  while (!simulation.fallen && (simulation.step_count - start) * PHYSICS_DT < limit_s) {
    await simulation.advance(4);
    if (done()) return true;
  }
  return false;
}

/** Sit on the map's seat from `start` (x, y, z) facing `yaw`, stand up and walk away, for each seed. */
export async function check_sit(mujoco, model, policies, starts, seeds = [1, 2]) {
  for (const [index, [start, yaw]] of starts.entries()) {
    for (const seed of seeds) {
      const label = `sit from (${start[0].toFixed(1)}, ${start[1].toFixed(1)}), seed ${seed}`;
      const simulation = new Simulation(mujoco, model, policies, make_navigation_maps(), seeded_random(seed + 31 * index));
      simulation.reset(start, yaw);
      assert.ok(simulation.request_sit(SEAT.id), `${label}: the sit request was refused (${simulation.seat_message})`);
      const sat_down = await run_until(simulation, () => simulation.mode === MODE.SIT_DOWN || !simulation.approach, 60);
      assert.ok(sat_down && simulation.mode === MODE.SIT_DOWN,
        `${label}: the walk to the seat ended without sitting (${simulation.seat_message ?? simulation.mode})`);
      const reached = simulation.step_count * PHYSICS_DT;
      await run_until(simulation, () => simulation.mode === MODE.SEATED && simulation.controller.mode_time > 2 ||
        simulation.mode === MODE.FALLING, 10);
      const [x, y] = to_seat(SEAT, simulation.state.qpos);
      const height = simulation.state.qpos[2] - SEAT.floor * FLOOR_HEIGHT;
      assert.equal(simulation.mode, MODE.SEATED, `${label}: did not stay seated (${simulation.mode})`);
      assert.ok(x < -0.1 && x > -SEAT.depth + 0.1 && Math.abs(y) < 0.15, `${label}: seated off the seat at ${x.toFixed(2)}, ${y.toFixed(2)}`);
      assert.ok(height > SEAT.support_height && height < SEAT.height + 0.2, `${label}: pelvis at ${height.toFixed(2)} m`);
      assert.ok(simulation.request_stand(), `${label}: the stand request was refused`);
      const stood = await run_until(simulation, () => simulation.mode === MODE.WALK || simulation.mode === MODE.FALLING, 8);
      assert.ok(stood && simulation.mode === MODE.WALK, `${label}: did not stand up (${simulation.mode})`);
      await run_until(simulation, () => simulation.mode !== MODE.WALK, 1);
      simulation.command = [0.4, 0, 0];
      await run_until(simulation, () => simulation.mode !== MODE.WALK, 3);
      const [away] = to_seat(SEAT, simulation.state.qpos);
      assert.equal(simulation.mode, MODE.WALK, `${label}: fell walking away from the seat`);
      assert.ok(away > 0.6, `${label}: did not walk away from the seat`);
      assert.equal(simulation.controller.falls, 0, `${label}: fell`);
      console.log(`PASS ${label}: at the seat in ${reached.toFixed(1)} s, seated ${(-x * 100).toFixed(0)} cm deep, ` +
        `${(y * 100).toFixed(0)} cm off centre, stood up and walked out to ${away.toFixed(1)} m in front`);
      simulation.dispose();
    }
  }
  // A movement key cancels the walk to the seat.
  const simulation = new Simulation(mujoco, model, policies, make_navigation_maps(), seeded_random(5));
  simulation.reset(starts[0][0], starts[0][1]);
  simulation.request_sit(SEAT.id);
  await simulation.advance(200);
  assert.ok(simulation.approach, 'the walk to the seat did not start');
  simulation.cancel_approach();
  assert.equal(simulation.approach, null);
  assert.equal(simulation.navigation.state.status, 'idle');
  assert.equal(simulation.controller.can_stand, false);
  simulation.dispose();
}
