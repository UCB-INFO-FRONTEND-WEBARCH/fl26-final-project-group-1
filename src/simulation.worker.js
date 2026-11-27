import { HAS_ELEVATOR } from './world.js';
import load_mujoco from '@mujoco/mujoco';
import mujoco_wasm_url from '@mujoco/mujoco/mujoco.wasm?url';
import * as ort from 'onnxruntime-web/wasm';
import { POLICY } from './policy_constants.js';
import ort_wasm_url from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import ort_module_url from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { make_scene_xml } from './scene_layout.js';
import { PHYSICS_DT, CONTROL_DECIMATION } from './locomotion.js';
import { load_robot_files, robot_geometry, character_rig, write_robot_pose, ROBOT_POSE_SIZE } from './robot_assets.js';
import { Simulation } from './simulation.js';
import { make_navigation_maps } from './path_planner.js';
import { RestDemo, seeded_random } from './demo_rest.js';

const ASSET_BASE = `${import.meta.env.BASE_URL}assets/lite_pro/`;
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
let pending_goal = null;
// Seat actions are applied between physics batches, like navigation goals.
let pending_seat = null;
// The "take a rest" demo (demo_rest.js): a seeded simulation, stepped in real time or one video frame at a time.
let world = null;
let demo = null;
let ghost_state = null;
let stepped = false;

function report_loading(message) {
  self.postMessage({ type: 'loading', message });
}

async function fetch_file(path) {
  const response = await fetch(`${ASSET_BASE}${path}`);
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function write_transforms(transforms, state) {
  const positions = state.geom_xpos;
  const rotations = state.geom_xmat;
  for (let index = 0; index < rendered_ids.length; index++) {
    const id = rendered_ids[index];
    transforms.set(positions.subarray(id * 3, id * 3 + 3), index * 12);
    transforms.set(rotations.subarray(id * 9, id * 9 + 9), index * 12 + 3);
  }
}

/** The demo's planned pose for its current sub-task, posed by forward kinematics on a scratch state. */
function ghost_transforms() {
  const pose = demo?.ghost();
  if (!pose) return null;
  const { body } = simulation.controller;
  ghost_state.qpos.set(simulation.state.qpos);
  ghost_state.qpos.set(pose.root, body.root_qpos);
  body.joint_qpos.forEach((address, index) => { ghost_state.qpos[address] = pose.joints[index]; });
  world.mujoco.mj_kinematics(world.model, ghost_state);
  const transforms = new Float32Array(rendered_ids.length * 12);
  write_transforms(transforms, ghost_state);
  return transforms;
}

function send_frame() {
  // One pending pose prevents stale frames from accumulating on a slow renderer.
  if (frame_in_flight) return;
  // Read the transforms from the physics step without changing camera observation state.
  const { state } = simulation;
  const transforms = recycled_buffer
    ? new Float32Array(recycled_buffer)
    : new Float32Array(rendered_ids.length * 12 + ROBOT_POSE_SIZE);
  recycled_buffer = null;
  write_transforms(transforms, state);
  write_robot_pose(transforms.subarray(rendered_ids.length * 12), state, simulation.joint_qpos);
  self.postMessage(
    {
      type: 'frame',
      transforms,
      telemetry: { ...simulation.telemetry(), simulation_rate, demo: demo?.report() },
      ghost: ghost_transforms(),
    },
    [transforms.buffer],
  );
  frame_in_flight = true;
  force_frame = false;
  last_frame_wall = performance.now();
  last_frame_step = simulation.step_count;
}

async function pump() {
  if (stepped) return;
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
    if (simulation.teleport_requested) {
      const target = simulation.teleport();
      pending_goal = null;
      accumulated = 0;
      last_frame_step = -1;
      force_frame = true;
      self.postMessage({ type: 'teleport_result', ok: true, floor: target.floor });
    }
    if (pending_goal && simulation.accepts_commands) {
      simulation.cancel_approach();
      simulation.navigation.set_goal(simulation.state.qpos, pending_goal, simulation.step_count * PHYSICS_DT);
      pending_goal = null;
      simulation.command = [0, 0, 0];
      force_frame = true;
    }
    if (pending_seat) {
      if (pending_seat.type === 'sit') simulation.request_sit(pending_seat.seat_id);
      else simulation.request_stand();
      pending_seat = null;
      force_frame = true;
    }
    if (simulation.paused || simulation.fallen) {
      accumulated = 0;
    } else {
      accumulated = Math.min(accumulated + elapsed, 0.1);
      const steps = Math.floor(accumulated / PHYSICS_DT);
      const completed = await (demo ? demo.advance(steps) : simulation.advance(steps));
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
  report_loading('Loading Berkeley Lite Pro model');
  await load_robot_files(mujoco, fetch_file);
  mujoco.FS.writeFile('/robot/apartment.xml', make_scene_xml());
  const model = mujoco.MjModel.from_xml_path('/robot/apartment.xml');

  report_loading('Loading walking, get-up and sitting policies');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: ort_wasm_url, mjs: ort_module_url };
  const policies = Object.fromEntries(await Promise.all(Object.entries(POLICY.policies).map(async ([name, path]) => {
    const contract = JSON.parse(new TextDecoder().decode(await fetch_file(path)));
    const session = await ort.InferenceSession.create(await fetch_file(`policies/${contract.onnx}`), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    const clips = contract.motion ? await fetch_file(`policies/${contract.motion.file}`) : null;
    return [name, { session, contract, ...(clips ? { clips } : {}) }];
  })));
  report_loading(HAS_ELEVATOR?'Preparing floor routes and elevator controls':'Preparing Hephaestus floor routes and stairs');
  world = { mujoco, model, policies };
  simulation = new Simulation(mujoco, model, policies, make_navigation_maps());
  simulation.paused = true;

  report_loading('Preparing optimized Lite Pro visuals');
  const [visual_json, visual_bytes] = await Promise.all([
    fetch_file('visuals.json'),
    fetch_file('visuals.bin'),
  ]);
  const manifest = JSON.parse(new TextDecoder().decode(visual_json));
  const geometries = robot_geometry(model, manifest, visual_bytes.buffer);
  rendered_ids = geometries.map((geometry) => geometry.id);
  self.postMessage({ type: 'ready', geometries, character_rig: character_rig(mujoco, model, geometries) }, [visual_bytes.buffer]);
  last_wall_time = rate_wall_time = performance.now();
  send_frame();
  pump();
}

self.onmessage = (event) => {
  if (!simulation) return;
  const message = event.data;
  switch (message.type) {
    case 'command':
      simulation.camera_motion = null;
      simulation.teleport_requested = null;
      pending_goal = null;
      // A movement key ends the walk to the seat; a key release does not.
      if (message.command.some((value) => value !== 0)) {
        pending_seat = null;
        simulation.cancel_approach();
      }
      if (!simulation.approach) simulation.navigation.cancel();
      simulation.command = simulation.accepts_commands ? message.command : [0, 0, 0];
      force_frame = true;
      break;
    case 'camera_command':
      simulation.teleport_requested = null;
      pending_goal = null;
      // Camera-relative movement ends the walk to the seat; a release does not.
      if (message.motion && Math.hypot(message.motion[0], message.motion[1]) > 0) {
        pending_seat = null;
        simulation.cancel_approach();
      }
      if (!simulation.approach) simulation.navigation.cancel();
      simulation.camera_motion = simulation.accepts_commands ? message.motion : null;
      simulation.command = [0, 0, 0];
      force_frame = true;
      break;
    case 'sit':
    case 'stand':
      pending_goal = null;
      pending_seat = message;
      break;
    case 'goal':
      pending_seat = null;
      simulation.camera_motion = null;
      simulation.teleport_requested = null;
      pending_goal = message.goal;
      break;
    case 'teleport':
      if (simulation.request_teleport(message.goal)) {
        pending_goal = null;
        pending_seat = null;
      }
      else self.postMessage({ type: 'teleport_result', ok: false });
      break;
    case 'cancel_navigation':
      pending_seat = null;
      simulation.camera_motion = null;
      simulation.teleport_requested = null;
      pending_goal = null;
      simulation.cancel_approach();
      simulation.navigation.cancel();
      simulation.command = [0, 0, 0];
      force_frame = true;
      break;
    case 'speed':
      if (Number.isFinite(message.speed)) simulation.navigation.speed = Math.max(0.2, Math.min(0.8, message.speed));
      break;
    case 'transfer':
      if (['elevator', 'stairs'].includes(message.transfer)) {
        simulation.camera_motion = null;
        pending_goal = null;
        pending_seat = null;
        simulation.cancel_approach();
        simulation.navigation.cancel();
        simulation.navigation.transfer = message.transfer;
        simulation.command = [0, 0, 0];
        force_frame = true;
      }
      break;
    case 'pause':
      simulation.camera_motion = null;
      simulation.paused = message.paused;
      simulation.command = [0, 0, 0];
      force_frame = true;
      break;
    case 'reset':
      pending_goal = null;
      pending_seat = null;
      simulation.request_reset();
      force_frame = true;
      break;
    case 'frame_received':
      frame_in_flight = false;
      recycled_buffer = message.buffer;
      break;
    case 'demo': {
      // A fresh simulation with seeded noise; the loaded policies carry over. Stepped runs advance only on 'step'.
      const { mujoco, model, policies } = world;
      simulation.dispose();
      simulation = new Simulation(mujoco, model, policies, make_navigation_maps(), seeded_random(message.seed));
      demo = new RestDemo(simulation);
      ghost_state ??= new mujoco.MjData(model);
      simulation.paused = !message.stepped;
      stepped = message.stepped;
      pending_goal = pending_seat = null;
      force_frame = true;
      frame_in_flight = false;
      send_frame();
      break;
    }
    case 'step':
      // Advance to the video frame's simulation time, then send that frame.
      demo.advance(Math.round(message.time / PHYSICS_DT) - simulation.step_count).then(() => {
        frame_in_flight = false;
        send_frame();
      }).catch((error) => self.postMessage({ type: 'error', message: error.message || String(error) }));
      break;
  }
};

initialize().catch((error) => {
  self.postMessage({ type: 'error', message: error.message || String(error) });
});
