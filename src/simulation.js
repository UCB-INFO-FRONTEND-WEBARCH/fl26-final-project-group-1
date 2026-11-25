import { SPAWN, SPAWN_YAW } from './scene_layout.js';
import { PHYSICS_DT, CONTROL_DECIMATION, DEFAULT_ANGLES, heading_from_quaternion, command_from_camera_motion } from './locomotion.js';
import { validate_model } from './robot_assets.js';
import { RobotController, MODE } from './robot_controller.js';
import { Elevator } from './elevator.js';
import { Navigation, hold_position, hold_point } from './navigation.js';
import { ELEVATOR, FLOOR_HEIGHT, STANDING_HEIGHT, floor_of } from './building.js';
import { teleport_position } from './teleport.js';
import { SEAT, SeatApproach, seat_pose } from './seat.js';

const OBJ_GEOM = 5;
// Standing still, the walking policy shuffles about 7 cm/s in one direction (0.7 m in 10 s), into furniture or out of
// any route. With no command, the robot holds the place and heading where it came to rest (hold_point); it stays
// within about 10 cm.
const IDLE_HOLD = { settle_speed: 0.15, yaw_tolerance: 0.05, yaw_gain: 1.5, yaw_limit: 0.5 };
// mjtWarning: MuJoCo resets a state with a bad position, velocity or acceleration and counts it here.
const BAD_STATE_WARNINGS = [3, 4, 5];

export class Simulation {
  /** @param policies {walk, getup_supine, getup_prone}: each {session, contract} (see robot_controller.js). */
  constructor(mujoco, model, policies, navigation_maps = null, random = Math.random) {
    validate_model(mujoco, model);
    this.mujoco = mujoco;
    this.model = model;
    this.state = new mujoco.MjData(model);
    this.controller = new RobotController(mujoco, model, this.state, policies, random);
    this.feet = [];
    for (let g = 0; g < model.ngeom; g++) {
      const name = mujoco.mj_id2name(model, OBJ_GEOM, g) || '';
      if (/^robot\/(left|right)_foot_collision_\d+$/.test(name)) this.feet.push(g);
    }
    this.command = [0, 0, 0];
    this.elevator = mujoco.mj_name2id(model, 3, 'lift_joint') >= 0 ? new Elevator(mujoco, model) : null;
    this.navigation = navigation_maps ? new Navigation(navigation_maps, this.elevator) : null;
    this.paused = false;
    this.teleports = 0;
    this.reset();
  }

  get action() { return this.controller.last_action; }
  /** The seat pose the sit policy reads: front edge, surface height and yaw. */
  get seat() { return seat_pose(SEAT, SEAT.floor * FLOOR_HEIGHT); }
  get joint_qpos() { return this.controller.body.joint_qpos; }
  get mode() { return this.controller.mode; }

  /** Walk to the seat, line up with it, and sit down. */
  request_sit() {
    if (!this.controller.can_sit || this.fallen) return false;
    this.navigation?.cancel();
    this.command = [0, 0, 0];
    this.seat_message = null;
    this.approach = new SeatApproach(SEAT, this.controller.sit_start(this.seat), this.navigation);
    if (this.navigation) this.approach.begin(this.state.qpos, this.step_count * PHYSICS_DT);
    else this.approach.set_phase('align');
    if (this.approach.phase === 'failed') return this.end_approach();
    return true;
  }

  /** Stand up from the seat. */
  request_stand() {
    return this.controller.stand();
  }

  end_approach() {
    if (!this.approach) return false;
    if (this.approach.phase === 'failed') this.seat_message = this.approach.message;
    this.approach = null;
    this.navigation?.cancel();
    this.command = [0, 0, 0];
    return false;
  }

  /** A manual command or another destination ends the walk to the seat. */
  cancel_approach() {
    if (this.approach) this.approach.phase = 'cancelled';
    this.end_approach();
    this.seat_message = null;
  }

  request_reset() {
    this.camera_motion = null;
    this.teleport_requested = null;
    this.cancel_approach();
    this.navigation?.cancel();
    this.command = [0, 0, 0];
    this.paused = false;
    this.reset_requested = true;
  }

  /** Stand the robot in its default pose at (x, y), soles on the floor at z - STANDING_HEIGHT, facing yaw. */
  place(position = SPAWN, yaw = SPAWN_YAW) {
    const { mujoco, model, state } = this;
    const [x, y, z] = position;
    const body = this.controller.body;
    mujoco.mj_resetData(model, state);
    state.qpos.set([x, y, 1.0, Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)], body.root_qpos);
    body.joint_qpos.forEach((address, index) => { state.qpos[address] = DEFAULT_ANGLES[index]; });
    mujoco.mj_forward(model, state);
    let sole = Infinity;
    for (const g of this.feet) sole = Math.min(sole, state.geom_xpos[3 * g + 2] - model.geom_size[3 * g]);
    state.qpos[body.root_qpos + 2] += z - STANDING_HEIGHT - sole;
    mujoco.mj_forward(model, state);
  }

  reset(start = SPAWN, yaw = SPAWN_YAW) {
    this.camera_motion = null;
    this.place(start, yaw);
    this.controller.reset();
    this.step_count = 0;
    this.distance = 0;
    this.fallen = false; // the simulation diverged; only a reset continues
    this.reset_requested = false;
    this.teleport_requested = null;
    this.approach = null;
    this.seat_message = null;
    this.idle_anchor = null;
    this.elevator?.reset();
    this.elevator?.advance(this.state, 0);
    this.navigation?.cancel();
  }

  request_teleport(goal) {
    const position = teleport_position(goal, this.navigation?.maps);
    if (!position) return false;
    this.camera_motion = null;
    this.cancel_approach();
    this.teleport_requested = { position, floor: goal[2], yaw: heading_from_quaternion(this.state.qpos) };
    this.reset_requested = false;
    this.command = [0, 0, 0];
    this.navigation.cancel();
    return true;
  }

  teleport() {
    const target = this.teleport_requested;
    if (!target) return null;
    const time = this.state.time;
    const lift = this.elevator && [this.state.qpos[this.elevator.position_index], this.state.qvel[this.elevator.velocity_index]];
    this.place(target.position, Number.isFinite(target.yaw) ? target.yaw : SPAWN_YAW);
    this.state.time = time;
    if (lift) {
      this.state.qpos[this.elevator.position_index] = lift[0];
      this.state.qvel[this.elevator.velocity_index] = lift[1];
      this.elevator.advance(this.state, 0);
      this.mujoco.mj_forward(this.model, this.state);
    }
    this.controller.reset();
    this.command = [0, 0, 0];
    this.fallen = false;
    this.teleport_requested = null;
    this.idle_anchor = null;
    this.teleports++;
    return target;
  }

  /** The walking command for this control step: the walk to the seat, the route, a hold in a moving lift, or the manual command. */
  walking_command() {
    if (this.approach) {
      this.idle_anchor = null;
      const step_dt = PHYSICS_DT * CONTROL_DECIMATION;
      const speed = Math.hypot(this.state.qvel[0], this.state.qvel[1]);
      this.command = this.approach.update(this.state.qpos, heading_from_quaternion(this.state.qpos), this.step_count * PHYSICS_DT, step_dt, speed);
      if (this.approach.phase === 'ready') {
        this.approach = null;
        this.command = [0, 0, 0];
        this.controller.sit(this.seat, SEAT.floor * FLOOR_HEIGHT);
      } else if (this.approach.phase === 'failed') this.end_approach();
      return this.command;
    }
    const navigating = this.navigation && ['walking', 'waiting', 'riding', 'arrived'].includes(this.navigation.state.status);
    if (navigating) {
      this.command = this.navigation.update(this.state.qpos, heading_from_quaternion(this.state.qpos), this.step_count * PHYSICS_DT);
    } else if (this.camera_motion) {
      this.command = command_from_camera_motion(this.camera_motion, heading_from_quaternion(this.state.qpos));
    }
    this.elevator?.advance(this.state, 0);
    const riding = this.elevator?.moving && this.elevator.occupied(this.state.qpos);
    if (riding) this.command = [0, 0, 0];
    const hold_cabin = this.elevator?.occupied(this.state.qpos) && this.command.every(value => value === 0);
    if (!riding && !hold_cabin) {
      if (!navigating && this.controller.mode === MODE.WALK && this.command.every(value => value === 0)) return this.idle_command();
      this.idle_anchor = null;
      return this.command;
    }
    this.idle_anchor = null;
    const heading = heading_from_quaternion(this.state.qpos);
    const target = hold_position(this.state.qpos, ELEVATOR.center, heading, 0.25);
    target[2] = Math.max(-0.5, Math.min(0.5, -heading * 1.4));
    return target;
  }

  /** Hold the pose where the robot came to rest (see IDLE_HOLD). */
  idle_command() {
    const q = this.state.qpos;
    const heading = heading_from_quaternion(q);
    if (!this.idle_anchor) {
      if (Math.hypot(this.state.qvel[0], this.state.qvel[1]) > IDLE_HOLD.settle_speed) return [0, 0, 0];
      this.idle_anchor = [q[0], q[1], heading];
    }
    const turn = Math.atan2(Math.sin(this.idle_anchor[2] - heading), Math.cos(this.idle_anchor[2] - heading));
    return [...hold_point(q, this.idle_anchor, heading),
      Math.abs(turn) < IDLE_HOLD.yaw_tolerance ? 0 : Math.max(-IDLE_HOLD.yaw_limit, Math.min(IDLE_HOLD.yaw_limit, IDLE_HOLD.yaw_gain * turn))];
  }

  async advance(steps) {
    let completed = 0;
    const step_dt = PHYSICS_DT * CONTROL_DECIMATION;
    while (completed < steps && !this.paused && !this.fallen && !this.reset_requested && !this.teleport_requested) {
      if (this.step_count % CONTROL_DECIMATION === 0) {
        // Observations read the state after the last physics step, as mjlab's forward() before sensing does.
        this.mujoco.mj_forward(this.model, this.state);
        const was_walking = this.controller.mode === MODE.WALK;
        await this.controller.control(this.walking_command(), step_dt);
        if (was_walking && this.controller.mode !== MODE.WALK) {
          // A fall drops the route, the walk to the seat and the manual command; walking resumes standing still.
          this.camera_motion = null;
          if (this.approach) this.cancel_approach();
          this.command = [0, 0, 0];
          this.navigation?.cancel();
        }
      }
      const previous_x = this.state.qpos[0];
      const previous_y = this.state.qpos[1];
      this.elevator?.advance(this.state, PHYSICS_DT);
      if (this.elevator?.moving && this.elevator.occupied(this.state.qpos)) this.command = [0, 0, 0];
      this.controller.apply_control();
      this.mujoco.mj_step(this.model, this.state);
      this.step_count++;
      completed++;
      this.distance += Math.hypot(this.state.qpos[0] - previous_x, this.state.qpos[1] - previous_y);
      if (!this.state.qpos.every(Number.isFinite) || this.diverged()) {
        this.camera_motion = null;
        this.fallen = true;
        this.command = [0, 0, 0];
        this.navigation?.cancel();
      }
    }
    return completed;
  }

  /** True once MuJoCo has reset a diverged state (its bad-state warnings count up from 0 after each reset). */
  diverged() {
    const warnings = this.state.warning;
    return BAD_STATE_WARNINGS.some((index) => {
      const stat = warnings.get(index);
      const number = stat.number;
      stat.delete?.();
      return number > 0;
    });
  }

  /** Manual or route commands apply only while walking. */
  get accepts_commands() { return this.controller.mode === MODE.WALK && !this.fallen; }
  get can_sit() { return this.controller.can_sit && !this.fallen; }
  get can_stand() { return this.controller.can_stand && !this.fallen; }

  telemetry() {
    return {
      position: Array.from(this.state.qpos.slice(0, 3)),
      heading: heading_from_quaternion(this.state.qpos),
      speed: Math.hypot(this.state.qvel[0], this.state.qvel[1]),
      time: this.step_count * PHYSICS_DT,
      distance: this.distance,
      paused: this.paused,
      fallen: this.fallen,
      teleports: this.teleports,
      ...this.controller.telemetry(),
      inference_ms: this.controller.inference_ms,
      floor: floor_of(this.state.qpos),
      elevator: this.elevator?.telemetry(),
      navigation: this.navigation?.state,
      seat: {
        available: Boolean(this.controller.clips),
        can_sit: this.can_sit && !this.approach,
        can_stand: this.can_stand,
        approach: this.approach ? { phase: this.approach.phase, message: this.approach.message } : null,
        message: this.seat_message,
      },
    };
  }

  dispose() {
    this.controller.dispose();
    this.state.delete();
  }
}
