import { ELEVATOR, FLOOR_HEIGHT, STANDING_HEIGHT } from './building.js';

export class Elevator {
  constructor(mujoco, model) {
    this.model = model;
    const joint = mujoco.mj_name2id(model, 3, 'lift_joint');
    this.position_index = model.jnt_qposadr[joint];
    this.velocity_index = model.jnt_dofadr[joint];
    this.actuator = mujoco.mj_name2id(model, 19, 'lift_motor');
    this.gates = [0, 1].map(floor => mujoco.mj_name2id(model, 5, `lift_gate_${floor}`));
    this.front_rail = mujoco.mj_name2id(model, 5, 'lift_rail_front');
    this.reset();
  }
  reset() {
    this.target_floor = 0;
    this.setpoint = 0;
    this.velocity = 0;
    this.height = 0;
    this.open_floor = 0;
    this.moving = false;
  }
  request(floor) { this.target_floor = floor; }
  occupied(position) {
    return Math.abs(position[0] - ELEVATOR.center[0]) < 0.69 && Math.abs(position[1] - ELEVATOR.center[1]) < 0.69 &&
      Math.abs(position[2] - this.height - STANDING_HEIGHT) < 0.25;
  }
  advance(state, dt) {
    this.height = state.qpos[this.position_index];
    const difference = this.target_floor * FLOOR_HEIGHT - this.height;
    const desired = Math.max(-ELEVATOR.speed, Math.min(ELEVATOR.speed, difference * 0.8));
    this.velocity += Math.max(-0.15 * dt, Math.min(0.15 * dt, desired - this.velocity));
    this.setpoint = Math.max(0, Math.min(FLOOR_HEIGHT, this.setpoint + this.velocity * dt));
    if (Math.abs(difference) < 0.015 && Math.abs(state.qvel[this.velocity_index]) < 0.025) {
      this.setpoint = this.target_floor * FLOOR_HEIGHT;
      this.velocity = 0;
      this.open_floor = this.target_floor;
      this.moving = false;
    } else { this.open_floor = -1; this.moving = true; }
    state.ctrl[this.actuator] = this.setpoint;
    for (let floor = 0; floor < this.gates.length; floor++) {
      const closed = Number(this.open_floor !== floor);
      this.model.geom_contype[this.gates[floor]] = closed;
      this.model.geom_conaffinity[this.gates[floor]] = closed;
    }
    this.model.geom_contype[this.front_rail] = Number(this.moving);
    this.model.geom_conaffinity[this.front_rail] = Number(this.moving);
  }
  telemetry() {
    return { height: this.height, open_floor: this.open_floor, target_floor: this.target_floor, moving: this.moving };
  }
}
