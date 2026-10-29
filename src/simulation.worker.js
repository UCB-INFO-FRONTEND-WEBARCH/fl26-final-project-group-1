import load_mujoco from '@mujoco/mujoco';
import mujoco_wasm_url from '@mujoco/mujoco/mujoco.wasm?url';
import * as ort from 'onnxruntime-web/wasm';
import ort_wasm_url from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import ort_module_url from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { make_scene_xml } from './scene_layout.js';
import { PHYSICS_DT, CONTROL_DECIMATION } from './locomotion.js';
import { load_robot_files, robot_geometry } from './robot_assets.js';
import { Simulation } from './simulation.js';

const ASSET_BASE = `${import.meta.env.BASE_URL}assets/g1/`;
const FRAME_INTERVAL_MS = PHYSICS_DT * CONTROL_DECIMATION * 1000;
let simulation;
let rendered_ids = [];
let accumulated = 0;
let last_wall_time = 0;
let last_frame_step = -1;
let simulation_rate = 1;
let rate_wall_time = 0;
let rate_step = 0;
let last_frame_wall = 0;
let frame_in_flight = false;
let recycled_buffer = null;
let force_frame = true;

function report_loading(message) {
  self.postMessage({ type: 'loading', message });
}

async function fetch_file(path) {
  const response = await fetch(`${ASSET_BASE}${path}`);
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function send_frame() {
  // One pending pose prevents stale frames from accumulating on a slow renderer.
  if (frame_in_flight) return;
  const { mujoco, model, state } = simulation;
  mujoco.mj_kinematics(model, state);
  const transforms = recycled_buffer
    ? new Float32Array(recycled_buffer)
    : new Float32Array(rendered_ids.length * 12);
  recycled_buffer = null;
  const positions = state.geom_xpos;
  const rotations = state.geom_xmat;
  for (let index = 0; index < rendered_ids.length; index++) {
    const id = rendered_ids[index];
    transforms.set(positions.subarray(id * 3, id * 3 + 3), index * 12);
    transforms.set(rotations.subarray(id * 9, id * 9 + 9), index * 12 + 3);
  }
  self.postMessage(
    {
      type: 'frame',
      transforms,
      telemetry: { ...simulation.telemetry(), simulation_rate },
    },
    [transforms.buffer],
  );
  frame_in_flight = true;
  force_frame = false;
  last_frame_wall = performance.now();
  last_frame_step = simulation.step_count;
}

async function pump() {
  try {
    const now = performance.now();
    const elapsed = Math.min((now - last_wall_time) / 1000, 0.06);
    last_wall_time = now;
    if (simulation.reset_requested) {
      simulation.reset();
      accumulated = 0;
      last_frame_step = -1;
      rate_wall_time = now;
      rate_step = 0;
      force_frame = true;
    }
    if (simulation.paused || simulation.fallen) {
      accumulated = 0;
    } else {
      accumulated = Math.min(accumulated + elapsed, 0.1);
      const completed = await simulation.advance(Math.floor(accumulated / PHYSICS_DT));
      accumulated -= completed * PHYSICS_DT;
    }
    if (now - rate_wall_time > 1000) {
      simulation_rate = ((simulation.step_count - rate_step) * PHYSICS_DT) / ((now - rate_wall_time) / 1000);
      rate_wall_time = now;
      rate_step = simulation.step_count;
    }
    if (
      force_frame ||
      (simulation.step_count !== last_frame_step && now - last_frame_wall >= FRAME_INTERVAL_MS)
    ) {
      send_frame();
    }
    const delay =
      simulation.paused || simulation.fallen
        ? 100
        : Math.max(1, FRAME_INTERVAL_MS - (performance.now() - now));
    setTimeout(pump, delay);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || String(error) });
  }
}

async function initialize() {
  report_loading('Starting MuJoCo physics');
  const mujoco = await load_mujoco({ locateFile: () => mujoco_wasm_url });
  report_loading('Loading official Unitree G1 meshes');
  await load_robot_files(mujoco, fetch_file);
  mujoco.FS.writeFile('/g1/apartment.xml', make_scene_xml());
  const model = mujoco.MjModel.from_xml_path('/g1/apartment.xml');

  report_loading('Loading pretrained walking policy');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: ort_wasm_url, mjs: ort_module_url };
  const session = await ort.InferenceSession.create(await fetch_file('policy.onnx'), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  simulation = new Simulation(mujoco, model, session);
  simulation.paused = true;

  report_loading('Preparing optimized G1 visuals');
  const [visual_json, visual_bytes] = await Promise.all([
    fetch_file('visuals.json'),
    fetch_file('visuals.bin'),
  ]);
  const manifest = JSON.parse(new TextDecoder().decode(visual_json));
  const geometries = robot_geometry(model, manifest, visual_bytes.buffer);
  rendered_ids = geometries.map((geometry) => geometry.id);
  self.postMessage({ type: 'ready', geometries }, [visual_bytes.buffer]);
  last_wall_time = rate_wall_time = performance.now();
  send_frame();
  pump();
}

self.onmessage = (event) => {
  if (!simulation) return;
  const message = event.data;
  switch (message.type) {
    case 'command':
      simulation.command = message.command;
      break;
    case 'pause':
      simulation.paused = message.paused;
      simulation.command = [0, 0, 0];
      force_frame = true;
      break;
    case 'reset':
      simulation.request_reset();
      force_frame = true;
      break;
    case 'frame_received':
      frame_in_flight = false;
      recycled_buffer = message.buffer;
      break;
  }
};

initialize().catch((error) => {
  self.postMessage({ type: 'error', message: error.message || String(error) });
});
