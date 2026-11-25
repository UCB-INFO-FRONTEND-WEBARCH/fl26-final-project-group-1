// Replays the mjlab play rollouts that `export-browser` recorded, and checks that this runtime builds the same
// observation, elevation map and action at every step. The robot stands on a plane, as in the fixture tasks, or on
// the tile of stairs that a policy with an elevation map was also recorded on. A sit policy's fixture plays one chair
// clip on its nominal seat; each step records the clip frame, the clip's placement and the seat.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import load_mujoco from '@mujoco/mujoco';
import * as ort from 'onnxruntime-web/wasm';
import { load_robot_files } from '../src/robot_assets.js';
import { LiteProBody, FluctlightPolicy, MotionClips, Reference, WALKABLE_GROUP } from '../src/fluctlight_policy.js';
import { POLICY } from '../src/policy_constants.js';

const asset_base = new URL('../public/assets/lite_pro/', import.meta.url);
const fixture_base = new URL('../tests/fixtures/fluctlight/', import.meta.url);
const mujoco = await load_mujoco({
  locateFile: () => fileURLToPath(new URL('../node_modules/@mujoco/mujoco/mujoco.wasm', import.meta.url)),
});
await load_robot_files(mujoco, (path) => readFile(new URL(path, asset_base)));

/** The robot on a plane, or on the terrain body a fixture names (its geoms are in the walkable group). */
async function scene(terrain) {
  const ground = terrain
    ? await readFile(new URL(terrain, fixture_base), 'utf8')
    : `<geom name="floor" type="plane" size="0 0 0.01" group="${WALKABLE_GROUP}"/>`;
  mujoco.FS.writeFile('/robot/fixture.xml', `<mujoco><include file="robot.xml"/><worldbody>${ground}</worldbody></mujoco>`);
  return mujoco.MjModel.from_xml_path('/robot/fixture.xml');
}
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = {
  wasm: new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url).href,
  mjs: new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', import.meta.url).href,
};

const json = async (url) => JSON.parse(await readFile(url, 'utf8'));
const max_diff = (a, b) => a.reduce((m, value, i) => Math.max(m, Math.abs(value - b[i])), 0);

const fixtures = Object.keys(POLICY.policies).flatMap((name) => [[name, name], [name, `${name}.stairs`]]);
for (const [name, stem] of fixtures) {
  const contract = await json(new URL(POLICY.policies[name], asset_base));
  const fixture = await json(new URL(`${stem}.json`, fixture_base)).catch((error) => {
    if (stem !== name && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!fixture) continue;
  const model = await scene(fixture.terrain);
  const state = new mujoco.MjData(model);
  const session = await ort.InferenceSession.create(
    new Uint8Array(await readFile(new URL(`policies/${contract.onnx}`, asset_base))), { executionProviders: ['wasm'] });
  const body = new LiteProBody(mujoco, model, contract);
  const clips = contract.motion
    ? new MotionClips(contract.motion, new Uint8Array(await readFile(new URL(`policies/${contract.motion.file}`, asset_base))))
    : null;
  const policy = new FluctlightPolicy(mujoco, model, body, session, contract, { deterministic: true, clips });
  policy.reset();
  const command_size = contract.observations[0].name === 'velocity_command' ? contract.observations[0].size : 0;
  let obs_error = 0, map_error = 0, action_error = 0, flips = 0;
  for (const [step, frame] of fixture.frames.entries()) {
    mujoco.mj_resetData(model, state);
    state.qpos.set(frame.root_qpos, body.root_qpos);
    state.qvel.set(frame.root_qvel, body.root_qvel);
    body.joint_qpos.forEach((a, i) => { state.qpos[a] = frame.joint_pos[i]; });
    body.joint_qvel.forEach((a, i) => { state.qvel[a] = frame.joint_vel[i]; });
    mujoco.mj_forward(model, state);
    let input = command_size ? frame.obs.slice(0, command_size) : null;
    if (fixture.clip) {
      // The fixture's env held only this clip, so its frame index is the clip's own. Play has no estimate errors.
      const { frame: index, yaw, offset, seat, seat_estimate_error, odometry_error } = frame.reference;
      assert.ok([...seat_estimate_error, ...odometry_error].every((v) => v === 0), `${stem}: the fixture has estimate errors`);
      input = new Reference(clips, fixture.clip, { yaw, offset }, seat);
      input.frame = index;
    }
    const obs = policy.observe(state, input);
    obs_error = Math.max(obs_error, max_diff(obs, frame.obs));
    // mjlab's first map on the stairs tile predates the robot's move there, and so does its first action.
    const valid = step >= (fixture.map_valid_from ?? 0);
    const heights = policy.map?.heights ?? new Float32Array(frame.actor_map?.length ?? 0);
    // A ray near the robot that meets a stair edge can hit the tread in one simulator and the riser or the next tread
    // in the other (mjlab casts in float32). It moves the ground height, so every cell shifts by one offset. Such a
    // step checks the grid up to that offset, and its action is not compared.
    let flipped = false;
    if (frame.actor_map && valid) {
      const offset = heights[0] - frame.actor_map[0];
      const residual = heights.reduce((m, h, k) => Math.max(m, Math.abs(h - frame.actor_map[k] - offset)), 0);
      flipped = Math.abs(offset) > 1e-4 && residual < 1e-4;
      flips += flipped;
      map_error = Math.max(map_error, flipped ? residual : max_diff(heights, frame.actor_map));
    }
    const target = await policy.act();
    if (valid && !flipped) action_error = Math.max(action_error, max_diff(policy.last_action, frame.action));
    assert.ok(target.every(Number.isFinite));
    // Continue from the recorded action, so one step's rounding does not carry into the next.
    policy.last_action.set(frame.action);
  }
  console.log(`${stem}: ${fixture.frames.length} steps, max |diff| observation ${obs_error.toExponential(2)}, ` +
    `map ${map_error.toExponential(2)}, action ${action_error.toExponential(2)}` +
    (flips ? ` (${flips} steps with a stair-edge ray flip in the ground height)` : ''));
  assert.ok(flips <= 0.05 * fixture.frames.length, `${name}: too many ground-height flips`);
  assert.ok(obs_error < 1e-4, `${name}: the observation differs from mjlab`);
  assert.ok(map_error < 1e-4, `${name}: the elevation map differs from mjlab`);
  assert.ok(action_error < 1e-3, `${name}: the action differs from mjlab`);
  policy.dispose();
  await session.release();
  state.delete();
  model.delete();
}
console.log('Policy fixtures match mjlab.');
