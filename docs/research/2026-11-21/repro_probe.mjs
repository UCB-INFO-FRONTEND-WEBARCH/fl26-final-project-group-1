// A short repeatability experiment, not a task-success benchmark.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import load_mujoco from '@mujoco/mujoco';
import * as ort from 'onnxruntime-web/wasm';
import { load_robot_files } from '../../../src/robot_assets.js';
import { make_scene_xml } from '../../../src/scene_layout.js';
import { Simulation } from '../../../src/simulation.js';

const root = new URL('../../../', import.meta.url);
const asset_base = new URL('public/assets/lite_pro/', root);
const read_asset = (path) => readFile(new URL(path, asset_base));

function seeded_random(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function maximum_difference(first, second) {
  return first.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - second[index])), 0);
}

const mujoco = await load_mujoco({
  locateFile: () => fileURLToPath(new URL('node_modules/@mujoco/mujoco/mujoco.wasm', root)),
});
await load_robot_files(mujoco, read_asset);
mujoco.FS.writeFile('/robot/research.xml', make_scene_xml());
const model = mujoco.MjModel.from_xml_path('/robot/research.xml');
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = {
  wasm: new URL('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', root).href,
  mjs: new URL('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', root).href,
};
const session = await ort.InferenceSession.create(new Uint8Array(await read_asset('policy.onnx')), {
  executionProviders: ['wasm'],
});

async function rollout(seed) {
  const simulation = new Simulation(mujoco, model, session, null, seeded_random(seed));
  simulation.command = [0.5, 0, 0];
  const poses = [];
  const actions = [];
  try {
    for (let step = 0; step < 100; step++) {
      await simulation.advance(4);
      poses.push(...simulation.state.qpos);
      actions.push(...simulation.action);
    }
    return { poses, actions, telemetry: simulation.telemetry() };
  } finally {
    simulation.dispose();
  }
}

try {
  const first = await rollout(1);
  const same = await rollout(1);
  const other = await rollout(2);
  const mujoco_package = JSON.parse(await readFile(new URL('node_modules/@mujoco/mujoco/package.json', root)));
  const ort_package = JSON.parse(await readFile(new URL('node_modules/onnxruntime-web/package.json', root)));
  const result = {
    description: '100 control steps (2 simulated seconds) each, forward 0.5 m/s, full apartment, ' +
      'no planner, noise enabled; two fresh seed-1 runs and one seed-2 run',
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      mujoco: mujoco_package.version,
      onnxruntime_web: ort_package.version,
      execution_provider: 'wasm',
      threads: 1,
    },
    same_seed: {
      pose_max_abs_error: maximum_difference(first.poses, same.poses),
      action_max_abs_error: maximum_difference(first.actions, same.actions),
    },
    changed_seed: {
      pose_max_abs_error: maximum_difference(first.poses, other.poses),
      action_max_abs_error: maximum_difference(first.actions, other.actions),
    },
    runs: [first, same, other].map((run, index) => ({
      seed: index === 2 ? 2 : 1,
      pose_sha256: createHash('sha256')
        .update(Buffer.from(new Float64Array(run.poses).buffer)).digest('hex'),
      position: run.telemetry.position,
      time: run.telemetry.time,
      fallen: run.telemetry.fallen,
    })),
    limits: 'Same host, process, physics version, initial state and provider only; ' +
      'not evidence of cross-browser determinism, broad task success, or real-world transfer. ' +
      'The pose maximum mixes qpos units; trajectory hashes use host Float64 byte order.',
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await session.release();
  model.delete();
}
