import { SPAWN } from './scene_layout.js';
import { PHYSICS_DT, CONTROL_DECIMATION, heading_from_quaternion } from './locomotion.js';
import { validate_model } from './robot_assets.js';
import { LiteProPolicy } from './lite_pro_policy.js';
import { Elevator } from './elevator.js';
import { Navigation, hold_position } from './navigation.js';
import { ELEVATOR, FLOOR_HEIGHT, floor_of, on_stairs, stair_height } from './building.js';

export class Simulation {
  constructor(mujoco, model, session, navigation_maps = null, random = Math.random) {
    validate_model(mujoco, model);
    this.mujoco = mujoco;
    this.model = model;
    this.state = new mujoco.MjData(model);
    this.policy = new LiteProPolicy(mujoco, model, this.state, session, random);
    this.command = [0, 0, 0];
    this.elevator = mujoco.mj_name2id(model, 3, 'lift_joint') >= 0 ? new Elevator(mujoco, model) : null;
    this.navigation = navigation_maps ? new Navigation(navigation_maps, this.elevator) : null;
    this.paused = false;
    this.reset();
  }

  get action() { return this.policy.last_action; }

  request_reset() {
    this.navigation?.cancel();
    this.command = [0, 0, 0];
    this.paused = false;
    this.reset_requested = true;
  }

  reset(start = SPAWN, yaw = 0) {
    this.policy.reset(start, yaw);
    this.step_count = 0;
    this.distance = 0;
    this.fallen = false;
    this.reset_requested = false;
    this.elevator?.reset();
    this.elevator?.advance(this.state, 0);
    this.navigation?.cancel();
  }

  async advance(steps) {
    let completed = 0;
    while (completed < steps && !this.paused && !this.fallen && !this.reset_requested) {
      if (this.step_count % CONTROL_DECIMATION === 0) {
        if (this.navigation && ['walking', 'waiting', 'riding', 'arrived'].includes(this.navigation.state.status)) {
          this.command = this.navigation.update(this.state.qpos, heading_from_quaternion(this.state.qpos), this.step_count * PHYSICS_DT);
        }
        this.elevator?.advance(this.state, 0);
        const riding = this.elevator?.moving && this.elevator.occupied(this.state.qpos);
        if (riding) this.command = [0, 0, 0];
        const hold_cabin = this.elevator?.occupied(this.state.qpos) && this.command.every(value => value === 0);
        let target = this.command;
        if (riding || hold_cabin) {
          const heading = heading_from_quaternion(this.state.qpos);
          target = hold_position(this.state.qpos, ELEVATOR.center, heading, 0.25);
          target[2] = Math.max(-0.5, Math.min(0.5, -heading * 1.4));
        }
        await this.policy.infer(target);
      }
      const previous_x = this.state.qpos[0];
      const previous_y = this.state.qpos[1];
      this.elevator?.advance(this.state, PHYSICS_DT);
      if (this.elevator?.moving && this.elevator.occupied(this.state.qpos)) this.command = [0, 0, 0];
      this.policy.apply_control();
      this.mujoco.mj_step(this.model, this.state);
      this.step_count++;
      completed++;
      this.distance += Math.hypot(this.state.qpos[0] - previous_x, this.state.qpos[1] - previous_y);
      if (this.step_count % CONTROL_DECIMATION !== 0) continue;

      const pose = this.state.qpos;
      const upright = 1 - 2 * (pose[4] * pose[4] + pose[5] * pose[5]);
      const surface = this.elevator?.occupied(pose) ? this.elevator.height : on_stairs(pose) ? stair_height(pose) : floor_of(pose) * FLOOR_HEIGHT;
      if (pose[2] - surface < 0.35 || upright < 0.4 || !pose.every(Number.isFinite)) {
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
      command: [...this.policy.command],
      time: this.step_count * PHYSICS_DT,
      distance: this.distance,
      paused: this.paused,
      fallen: this.fallen,
      inference_ms: this.policy.inference_ms,
      floor: floor_of(this.state.qpos),
      elevator: this.elevator?.telemetry(),
      navigation: this.navigation?.state,
    };
  }

  dispose() {
    this.policy.dispose();
    this.state.delete();
  }
}
