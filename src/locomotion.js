import { POLICY } from './policy_constants.js';

export const PHYSICS_DT = POLICY.timestep;
export const CONTROL_DECIMATION = POLICY.decimation;
export const NUM_ACTIONS = POLICY.joint_names.length;
export const NUM_OBSERVATIONS = Math.max(...Object.values(POLICY.obs_slices).map(slice => slice[1]));
export const DEFAULT_ANGLES = POLICY.default_joint_pos;
export const JOINT_NAMES = POLICY.joint_names.map(name => `robot/${name}`);

export function command_from_keys(keys, speed = 0.6) {
  const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
  const turn = Number(keys.has('KeyA') || keys.has('ArrowLeft')) - Number(keys.has('KeyD') || keys.has('ArrowRight'));
  const lateral = Number(keys.has('KeyQ')) - Number(keys.has('KeyE'));
  return [forward * (forward < 0 ? Math.min(speed, 0.4) : speed), lateral * Math.min(speed, 0.3), turn * 0.7];
}

export function heading_from_quaternion(qpos) {
  const [w, x, y, z] = qpos.slice(3, 7);
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}
