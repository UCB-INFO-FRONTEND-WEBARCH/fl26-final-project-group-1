import * as ort from 'onnxruntime-web/wasm';
import { SPAWN } from './scene_layout.js';
import {
  PHYSICS_DT,
  CONTROL_DECIMATION,
  DEFAULT_ANGLES,
  NUM_ACTIONS,
  NUM_OBSERVATIONS,
  HIDDEN_SIZE,
  make_observation,
  apply_pd_control,
  heading_from_quaternion,
} from './locomotion.js';
import { validate_model } from './robot_assets.js';
import { Elevator } from './elevator.js';
import { Navigation } from './navigation.js';
import { FLOOR_HEIGHT, floor_of, on_stairs, stair_height } from './building.js';

export class Simulation {
  constructor(mujoco, model, session, navigation_maps = null) {
    validate_model(mujoco, model);
    this.mujoco = mujoco;
    this.model = model;
    this.session = session;
    this.state = new mujoco.MjData(model);
    this.action = new Float32Array(NUM_ACTIONS);
    this.observation = new Float32Array(NUM_OBSERVATIONS);
    this.observation_tensor = new ort.Tensor('float32', this.observation, [1, NUM_OBSERVATIONS]);
    this.command = [0, 0, 0];
    this.elevator = mujoco.mj_name2id(model, 3, 'lift_joint') >= 0 ? new Elevator(mujoco, model) : null;
    this.navigation = navigation_maps ? new Navigation(navigation_maps, this.elevator) : null;
    this.paused = false;
    this.inference_ms = 0;
    this.reset();
  }

  request_reset() {
    this.navigation?.cancel();
    this.command = [0, 0, 0];
    this.paused = false;
    this.reset_requested = true;
  }

  reset(start = SPAWN) {
    this.mujoco.mj_resetData(this.model, this.state);
    this.state.qpos.set(start);
    this.state.qpos.set(DEFAULT_ANGLES, 7);
    this.action.fill(0);
    this.hidden = new ort.Tensor('float32', new Float32Array(HIDDEN_SIZE), [1, 1, HIDDEN_SIZE]);
    this.cell = new ort.Tensor('float32', new Float32Array(HIDDEN_SIZE), [1, 1, HIDDEN_SIZE]);
    this.step_count = 0;
    this.distance = 0;
    this.fallen = false;
    this.reset_requested = false;
    this.elevator?.reset();
    this.navigation?.cancel();
    // Preserve commands and pause requests that arrived after request_reset().
    this.mujoco.mj_forward(this.model, this.state);
  }

  async advance(steps) {
    let completed = 0;
    while (completed < steps && !this.paused && !this.fallen && !this.reset_requested) {
      const qpos = this.state.qpos;
      const previous_x = qpos[0];
      const previous_y = qpos[1];
      this.elevator?.advance(this.state, PHYSICS_DT);
      if (this.elevator?.moving && this.elevator.occupied(qpos)) this.command = [0, 0, 0];
      apply_pd_control(qpos, this.state.qvel, this.action, this.state.ctrl);
      this.mujoco.mj_step(this.model, this.state);
      this.step_count++;
      completed++;
      this.distance += Math.hypot(this.state.qpos[0] - previous_x, this.state.qpos[1] - previous_y);
      if (this.step_count % CONTROL_DECIMATION !== 0) continue;

      if (this.navigation && ['walking', 'waiting', 'riding', 'arrived'].includes(this.navigation.state.status)) {
        this.command = this.navigation.update(this.state.qpos, heading_from_quaternion(this.state.qpos), this.step_count * PHYSICS_DT);
      }

      make_observation(
        this.state.qpos,
        this.state.qvel,
        this.action,
        this.command,
        this.step_count,
        this.observation,
      );
      const started = performance.now();
      const output = await this.session.run({
        observation: this.observation_tensor,
        hidden: this.hidden,
        cell: this.cell,
      });
      this.inference_ms = performance.now() - started;
      if (!output.action.data.every(Number.isFinite)) {
        throw new Error('The walking policy returned invalid joint targets.');
      }
      this.action = output.action.data;
      this.hidden = output.next_hidden;
      this.cell = output.next_cell;

      const pose = this.state.qpos;
      const upright = 1 - 2 * (pose[4] * pose[4] + pose[5] * pose[5]);
      const surface = this.elevator?.occupied(pose) ? this.elevator.height : on_stairs(pose) ? stair_height(pose) : floor_of(pose) * FLOOR_HEIGHT;
      if (pose[2] - surface < 0.45 || upright < 0.45 || !pose.every(Number.isFinite)) {
        this.fallen = true;
        this.command = [0, 0, 0];
        this.navigation?.cancel();
      }
    }
    return completed;
  }

  telemetry() {
    return {
      position: Array.from(this.state.qpos.slice(0, 3)),
      heading: heading_from_quaternion(this.state.qpos),
      speed: Math.hypot(this.state.qvel[0], this.state.qvel[1]),
      command: [...this.command],
      time: this.step_count * PHYSICS_DT,
      distance: this.distance,
      paused: this.paused,
      fallen: this.fallen,
      inference_ms: this.inference_ms,
      floor: floor_of(this.state.qpos),
      elevator: this.elevator?.telemetry(),
      navigation: this.navigation?.state,
    };
  }

  dispose() {
    this.state.delete();
  }
}
