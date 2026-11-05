import { JOINT_NAMES, NUM_ACTIONS } from './locomotion.js';

export const ROBOT_POSE_SIZE = 7 + NUM_ACTIONS;

/** Copy the measured pelvis pose (xyz, wxyz) and policy-ordered joint angles. */
export function write_robot_pose(output, state, joint_qpos) {
  output.set(state.qpos.subarray(0, 7));
  for (let index = 0; index < NUM_ACTIONS; index++) output[7 + index] = state.qpos[joint_qpos[index]];
}

/** Read joint axes and the sole height at zero joint angles, relative to the pelvis. */
export function character_rig(mujoco, model, geometries) {
  const rest = new mujoco.MjData(model);
  try {
    rest.qpos.fill(0);
    rest.qpos[3] = 1;
    mujoco.mj_forward(model, rest);
    const joints = JOINT_NAMES.map(name => mujoco.mj_name2id(model, 3, name));
    const axes = joints.map(id => Array.from(rest.xaxis.subarray(id * 3, id * 3 + 3)));
    const hips = ['robot/left_hip_pitch', 'robot/right_hip_pitch'].map(name => mujoco.mj_name2id(model, 3, name));
    const hip_center = [0, 1].map(axis => hips.reduce((sum, id) => sum + rest.xanchor[id * 3 + axis], 0) / 2);
    let sole = Infinity;
    for (const { id, vertices } of geometries) {
      const z = rest.geom_xpos[id * 3 + 2];
      const r = rest.geom_xmat.subarray(id * 9 + 6, id * 9 + 9);
      for (let index = 0; index < vertices.length; index += 3) {
        sole = Math.min(sole, z + r[0] * vertices[index] + r[1] * vertices[index + 1] + r[2] * vertices[index + 2]);
      }
    }
    return { joint_names: JOINT_NAMES.map(name => name.slice('robot/'.length)), axes, hip_center, sole };
  } finally {
    rest.delete();
  }
}

export async function load_robot_files(mujoco, read_file) {
  mujoco.FS.mkdir('/robot');
  mujoco.FS.mkdir('/robot/meshes');
  const manifest = JSON.parse(new TextDecoder().decode(await read_file('manifest.json')));
  const files = manifest.files.filter((item) => /\.(xml|stl)$/i.test(item.file));
  await Promise.all(
    files.map(async (item) => {
      mujoco.FS.writeFile(`/robot/${item.file}`, await read_file(item.file));
    }),
  );
  return manifest;
}

export function validate_model(mujoco, model) {
  const lift = mujoco.mj_name2id(model, 3, 'lift_joint');
  const extra = lift < 0 ? 0 : 1;
  if (model.nu !== NUM_ACTIONS + extra || model.nq !== NUM_ACTIONS + 7 + extra || model.nv !== NUM_ACTIONS + 6 + extra) {
    throw new Error('Lite Pro model dimensions do not match the S3 policy.');
  }
  const MJOBJ_JOINT = 3;
  for (let joint = 0; joint < NUM_ACTIONS; joint++) {
    if (mujoco.mj_id2name(model, MJOBJ_JOINT, joint + 1) !== JOINT_NAMES[joint]) {
      throw new Error('Lite Pro joint ordering does not match the S3 policy.');
    }
    const actuator = mujoco.mj_name2id(model, 19, JOINT_NAMES[joint]);
    if (actuator < 0 || model.actuator_trnid[actuator * 2] !== joint + 1) {
      throw new Error('Lite Pro actuator mapping does not match the S3 policy.');
    }
  }
  if (extra && (model.jnt_qposadr[lift] !== NUM_ACTIONS + 7 || model.jnt_dofadr[lift] !== NUM_ACTIONS + 6 || mujoco.mj_name2id(model, 19, 'lift_motor') !== NUM_ACTIONS)) {
    throw new Error('The elevator must follow the Lite Pro joints and actuators.');
  }
}

export function robot_geometry(model, manifest, buffer) {
  const geometries = [];
  for (let id = 0; id < model.ngeom; id++) {
    // Group 2 contains the trained robot's visual meshes, also seen by its depth camera.
    if (model.geom_bodyid[id] === 0 || model.geom_group[id] !== 2) continue;
    const mesh_id = model.geom_dataid[id];
    if (mesh_id < 0) continue;
    const mesh = manifest.meshes.find((item) => item.mesh_id === mesh_id);
    if (!mesh) throw new Error(`Optimized visual mesh ${mesh_id} is missing.`);
    geometries.push({
      id,
      vertices: new Float32Array(buffer, mesh.position_offset, mesh.vertex_count * 3),
      normals: new Float32Array(buffer, mesh.normal_offset, mesh.vertex_count * 3),
      faces: new Uint32Array(buffer, mesh.index_offset, mesh.index_count),
      color: Array.from(model.geom_rgba.slice(id * 4, id * 4 + 3)),
    });
  }
  return geometries;
}
