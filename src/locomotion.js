// Port of Unitree's deploy_mujoco.py and g1.yaml at commit 276801e46c5d.
export const PHYSICS_DT = 0.002;
export const CONTROL_DECIMATION = 10;
export const NUM_ACTIONS = 12;
export const NUM_OBSERVATIONS = 47;
export const HIDDEN_SIZE = 64;
export const DEFAULT_ANGLES = [-0.1, 0, 0, 0.3, -0.2, 0, -0.1, 0, 0, 0.3, -0.2, 0];
export const KP = [100, 100, 100, 150, 40, 40, 100, 100, 100, 150, 40, 40];
export const KD = [2, 2, 2, 4, 2, 2, 2, 2, 2, 4, 2, 2];
export const JOINT_NAMES = ['left', 'right'].flatMap((side) =>
  ['hip_pitch', 'hip_roll', 'hip_yaw', 'knee', 'ankle_pitch', 'ankle_roll'].map(
    (joint) => `${side}_${joint}_joint`,
  ),
);

export function command_from_keys(keys, speed = 0.5) {
  const forward =
    Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
  const turn =
    Number(keys.has('KeyA') || keys.has('ArrowLeft')) - Number(keys.has('KeyD') || keys.has('ArrowRight'));
  const lateral = Number(keys.has('KeyQ')) - Number(keys.has('KeyE'));
  return [forward * speed, lateral * Math.min(speed, 0.35), turn * 0.7];
}

export function make_observation(
  qpos,
  qvel,
  action,
  command,
  step,
  observation = new Float32Array(NUM_OBSERVATIONS),
) {
  const qw = qpos[3];
  const qx = qpos[4];
  const qy = qpos[5];
  const qz = qpos[6];
  for (let axis = 0; axis < 3; axis++) observation[axis] = qvel[3 + axis] * 0.25;
  observation[3] = 2 * (-qz * qx + qw * qy);
  observation[4] = -2 * (qz * qy + qw * qx);
  observation[5] = 1 - 2 * (qw * qw + qz * qz);
  observation[6] = command[0] * 2;
  observation[7] = command[1] * 2;
  observation[8] = command[2] * 0.25;
  for (let joint = 0; joint < NUM_ACTIONS; joint++) {
    observation[9 + joint] = qpos[7 + joint] - DEFAULT_ANGLES[joint];
    observation[21 + joint] = qvel[6 + joint] * 0.05;
    observation[33 + joint] = action[joint];
  }
  const phase = ((step * PHYSICS_DT) % 0.8) / 0.8;
  observation[45] = Math.sin(2 * Math.PI * phase);
  observation[46] = Math.cos(2 * Math.PI * phase);
  return observation;
}

export function apply_pd_control(qpos, qvel, action, ctrl) {
  for (let joint = 0; joint < NUM_ACTIONS; joint++) {
    const target = DEFAULT_ANGLES[joint] + action[joint] * 0.25;
    ctrl[joint] = KP[joint] * (target - qpos[7 + joint]) - KD[joint] * qvel[6 + joint];
  }
}

export function heading_from_quaternion(qpos) {
  const w = qpos[3];
  const x = qpos[4];
  const y = qpos[5];
  const z = qpos[6];
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}
