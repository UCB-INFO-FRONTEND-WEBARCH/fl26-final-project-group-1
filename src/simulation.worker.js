import load_mujoco from '@mujoco/mujoco';
import mujoco_wasm_url from '@mujoco/mujoco/mujoco.wasm?url';
import * as ort from 'onnxruntime-web/wasm';
import ort_wasm_url from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import ort_module_url from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { make_scene_xml, SPAWN } from './scene_layout.js';
import {
  PHYSICS_DT, CONTROL_DECIMATION, DEFAULT_ANGLES, JOINT_NAMES,
  make_observation, apply_pd_control, heading_from_quaternion,
} from './locomotion.js';

let mujoco;
let model;
let state;
let session;
let action = new Float32Array(12);
let hidden;
let cell;
let command = [0, 0, 0];
let step = 0;
let paused = false;
let fallen = false;
let reset_requested = false;
let distance = 0;
let accumulated = 0;
let last_wall_time = 0;
let inference_ms = 0;
let rendered_ids = [];
let last_frame_step = -1;
let simulation_rate = 1;
let rate_wall_time = 0;
let rate_step = 0;
let last_frame_wall = 0;
let frame_in_flight = false;
let recycled_buffer = null;
let force_frame = true;
const observation = new Float32Array(47);
const ASSET_BASE = `${import.meta.env.BASE_URL}assets/g1/`;

function report_loading(message) {
  self.postMessage({ type: 'loading', message });
}

async function fetch_file(path) {
  const response = await fetch(`${ASSET_BASE}${path}`);
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function reset_simulation() {
  mujoco.mj_resetData(model, state);
  state.qpos.set(SPAWN, 0);
  state.qpos.set(DEFAULT_ANGLES, 7);
  action.fill(0);
  hidden = new ort.Tensor('float32', new Float32Array(64), [1, 1, 64]);
  cell = new ort.Tensor('float32', new Float32Array(64), [1, 1, 64]);
  step = 0;
  distance = 0;
  accumulated = 0;
  fallen = false;
  reset_requested = false;
  last_frame_step = -1;
  rate_wall_time = performance.now();
  rate_step = 0;
  mujoco.mj_forward(model, state);
  send_frame();
}

function robot_geometry(visual_manifest, visual_buffer) {
  const geometries = [];
  for (let id = 0; id < model.ngeom; id++) {
    // The official model provides separate visual meshes (group 1) and collision geoms.
    if (model.geom_bodyid[id] === 0 || model.geom_group[id] !== 1) continue;
    const mesh_id = model.geom_dataid[id];
    if (mesh_id < 0) continue;
    const visual = visual_manifest.meshes.find(mesh => mesh.mesh_id === mesh_id);
    if (!visual) throw new Error(`Optimized visual mesh ${mesh_id} is missing.`);
    geometries.push({
      id,
      vertices: new Float32Array(visual_buffer, visual.position_offset, visual.vertex_count * 3),
      normals: new Float32Array(visual_buffer, visual.normal_offset, visual.vertex_count * 3),
      faces: new Uint32Array(visual_buffer, visual.index_offset, visual.index_count),
      color: Array.from(model.geom_rgba.slice(id * 4, id * 4 + 3)),
    });
  }
  rendered_ids = geometries.map(geometry => geometry.id);
  return geometries;
}

function send_frame() {
  // At most one pose is queued. A slow renderer always gets current state, never a backlog.
  if (frame_in_flight) return;
  mujoco.mj_kinematics(model, state);
  const transforms = recycled_buffer ? new Float32Array(recycled_buffer) : new Float32Array(rendered_ids.length * 12);
  recycled_buffer = null;
  const positions = state.geom_xpos;
  const rotations = state.geom_xmat;
  for (let index = 0; index < rendered_ids.length; index++) {
    const id = rendered_ids[index];
    transforms.set(positions.subarray(id * 3, id * 3 + 3), index * 12);
    transforms.set(rotations.subarray(id * 9, id * 9 + 9), index * 12 + 3);
  }
  self.postMessage({
    type: 'frame', transforms,
    telemetry: {
      position: Array.from(state.qpos.slice(0, 3)),
      heading: heading_from_quaternion(state.qpos),
      speed: Math.hypot(state.qvel[0], state.qvel[1]),
      command: [...command],
      time: step * PHYSICS_DT,
      distance,
      paused,
      fallen,
      inference_ms,
      simulation_rate,
    },
  }, [transforms.buffer]);
  frame_in_flight = true;
  force_frame = false;
  last_frame_wall = performance.now();
  last_frame_step = step;
}

async function update_policy() {
  make_observation(state.qpos, state.qvel, action, command, step, observation);
  const started = performance.now();
  const output = await session.run({
    observation: new ort.Tensor('float32', observation, [1, 47]), hidden, cell,
  });
  inference_ms = performance.now() - started;
  action = output.action.data;
  hidden = output.next_hidden;
  cell = output.next_cell;
  if (!action.every(Number.isFinite)) throw new Error('The walking policy returned invalid joint targets.');
}

async function pump() {
  try {
    const now = performance.now();
    const elapsed = Math.min((now - last_wall_time) / 1000, 0.06);
    last_wall_time = now;
    if (reset_requested) reset_simulation();
    if (paused || fallen) {
      accumulated = 0;
    } else {
      accumulated = Math.min(accumulated + elapsed, 0.1);
      while (accumulated >= PHYSICS_DT && !paused && !reset_requested) {
        const previous_x = state.qpos[0];
        const previous_y = state.qpos[1];
        apply_pd_control(state.qpos, state.qvel, action, state.ctrl);
        mujoco.mj_step(model, state);
        step++;
        accumulated -= PHYSICS_DT;
        distance += Math.hypot(state.qpos[0] - previous_x, state.qpos[1] - previous_y);
        if (step % CONTROL_DECIMATION === 0) {
          await update_policy();
          const [w, x, y, z] = state.qpos.slice(3, 7);
          const upright = 1 - 2 * (x * x + y * y);
          if (state.qpos[2] < 0.45 || upright < 0.45 || !Number.isFinite(w + z)) {
            fallen = true;
            command = [0, 0, 0];
            break;
          }
        }
      }
    }
    if (now - rate_wall_time > 1000) {
      simulation_rate = (step - rate_step) * PHYSICS_DT / ((now - rate_wall_time) / 1000);
      rate_wall_time = now;
      rate_step = step;
    }
    if (force_frame || (step !== last_frame_step && now - last_frame_wall >= 20)) {
      send_frame();
    }
    const delay = paused || fallen ? 100 : Math.max(1, 20 - (performance.now() - now));
    setTimeout(pump, delay);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || String(error) });
  }
}

async function initialize() {
  report_loading('Starting MuJoCo physics');
  mujoco = await load_mujoco({ locateFile: () => mujoco_wasm_url });
  mujoco.FS.mkdir('/g1');
  mujoco.FS.mkdir('/g1/meshes');
  report_loading('Loading official Unitree G1 meshes');
  const manifest = JSON.parse(new TextDecoder().decode(await fetch_file('manifest.json')));
  const model_files = manifest.files.filter(item => item.file.endsWith('.xml') || item.file.endsWith('.STL'));
  await Promise.all(model_files.map(async item => {
    mujoco.FS.writeFile(`/g1/${item.file}`, await fetch_file(item.file));
  }));
  mujoco.FS.writeFile('/g1/apartment.xml', make_scene_xml());
  model = mujoco.MjModel.from_xml_path('/g1/apartment.xml');
  state = new mujoco.MjData(model);
  if (model.nu !== 12 || model.nq !== 19 || model.nv !== 18) {
    throw new Error('G1 model dimensions do not match the walking policy.');
  }
  for (let joint = 0; joint < 12; joint++) {
    if (mujoco.mj_id2name(model, 3, joint + 1) !== JOINT_NAMES[joint]) {
      throw new Error('G1 model joint ordering does not match the walking policy.');
    }
  }
  report_loading('Loading pretrained walking policy');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: ort_wasm_url, mjs: ort_module_url };
  session = await ort.InferenceSession.create(await fetch_file('policy.onnx'), {
    executionProviders: ['wasm'], graphOptimizationLevel: 'all',
  });
  report_loading('Preparing optimized G1 visuals');
  const [visual_json, visual_bytes] = await Promise.all([fetch_file('visuals.json'), fetch_file('visuals.bin')]);
  const visual_manifest = JSON.parse(new TextDecoder().decode(visual_json));
  const geometries = robot_geometry(visual_manifest, visual_bytes.buffer);
  self.postMessage({ type: 'ready', geometries }, [visual_bytes.buffer]);
  reset_simulation();
  last_wall_time = performance.now();
  pump();
}

self.onmessage = event => {
  const message = event.data;
  if (message.type === 'command') command = message.command;
  if (message.type === 'pause') {
    paused = message.paused;
    command = [0, 0, 0];
    force_frame = true;
  }
  if (message.type === 'reset') {
    command = [0, 0, 0];
    paused = false;
    reset_requested = true;
    force_frame = true;
  }
  if (message.type === 'frame_received') {
    frame_in_flight = false;
    recycled_buffer = message.buffer;
  }
};

initialize().catch(error => {
  self.postMessage({ type: 'error', message: error.message || String(error) });
});
