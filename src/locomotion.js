import { POLICY } from './policy_constants.js';

export const PHYSICS_DT = POLICY.timestep;
export const CONTROL_DECIMATION = POLICY.decimation;
export const NUM_ACTIONS = POLICY.joint_names.length;
export const DEFAULT_ANGLES = POLICY.default_joint_pos;
export const JOINT_NAMES = POLICY.joint_names.map(name => `robot/${name}`);
export const DEFAULT_WALK_SPEED = 0.8;

export function command_from_keys(keys, speed = DEFAULT_WALK_SPEED, boost = false) {
  const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
  const turn = Number(keys.has('KeyA') || keys.has('ArrowLeft')) - Number(keys.has('KeyD') || keys.has('ArrowRight'));
  const lateral = Number(keys.has('KeyQ')) - Number(keys.has('KeyE'));
  const multiplier = boost ? 2 : 1;
  return [forward * (forward < 0 ? Math.min(speed, 0.4) : speed), lateral * Math.min(speed, 0.3), turn * 0.7]
    .map(value => value * multiplier);
}

export function camera_motion_from_keys(keys, heading, speed = DEFAULT_WALK_SPEED, boost = false) {
  const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
  const left = Number(keys.has('KeyA') || keys.has('KeyQ') || keys.has('ArrowLeft')) -
    Number(keys.has('KeyD') || keys.has('KeyE') || keys.has('ArrowRight'));
  const multiplier = boost ? 2 : 1;
  const scale = speed * multiplier / Math.max(1, Math.hypot(forward, left));
  return [(forward * Math.cos(heading) - left * Math.sin(heading)) * scale,
    (forward * Math.sin(heading) + left * Math.cos(heading)) * scale, 0.7 * multiplier];
}

export function command_from_camera_motion(motion, heading) {
  const speed = Math.hypot(motion[0], motion[1]);
  if (speed < 1e-8) return [0, 0, 0];
  const angle = Math.atan2(motion[1], motion[0]) - heading;
  const error = Math.atan2(Math.sin(angle), Math.cos(angle));
  const turn_limit = motion[2];
  const lateral_limit = 0.3 * turn_limit / 0.7;
  return [speed * Math.max(0, Math.cos(error)),
    Math.max(-lateral_limit, Math.min(lateral_limit, speed * Math.sin(error))),
    Math.max(-turn_limit, Math.min(turn_limit, error * 2.5))];
}

export function heading_from_quaternion(qpos) {
  const [w, x, y, z] = qpos.slice(3, 7);
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}
