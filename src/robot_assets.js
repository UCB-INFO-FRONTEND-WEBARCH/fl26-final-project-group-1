import { JOINT_NAMES, NUM_ACTIONS } from './locomotion.js';

export async function load_robot_files(mujoco, read_file) {
  mujoco.FS.mkdir('/g1');
  mujoco.FS.mkdir('/g1/meshes');
  const manifest = JSON.parse(new TextDecoder().decode(await read_file('manifest.json')));
  const files = manifest.files.filter((item) => item.file.endsWith('.xml') || item.file.endsWith('.STL'));
  await Promise.all(
    files.map(async (item) => {
      mujoco.FS.writeFile(`/g1/${item.file}`, await read_file(item.file));
    }),
  );
  return manifest;
}

export function validate_model(mujoco, model) {
  const lift = mujoco.mj_name2id(model, 3, 'lift_joint');
  const extra = lift < 0 ? 0 : 1;
  if (model.nu !== NUM_ACTIONS + extra || model.nq !== NUM_ACTIONS + 7 + extra || model.nv !== NUM_ACTIONS + 6 + extra) {
    throw new Error('G1 model dimensions do not match the walking policy.');
  }
  const MJOBJ_JOINT = 3;
  for (let joint = 0; joint < NUM_ACTIONS; joint++) {
    if (mujoco.mj_id2name(model, MJOBJ_JOINT, joint + 1) !== JOINT_NAMES[joint]) {
      throw new Error('G1 model joint ordering does not match the walking policy.');
    }
  }
  if (extra && (model.jnt_qposadr[lift] !== 19 || model.jnt_dofadr[lift] !== 18 || mujoco.mj_name2id(model, 19, 'lift_motor') !== 12)) {
    throw new Error('The elevator must follow the G1 policy joints and actuators.');
  }
}

export function robot_geometry(model, manifest, buffer) {
  const geometries = [];
  for (let id = 0; id < model.ngeom; id++) {
    // Group 1 contains visual meshes. Other groups contain collision geometry.
    if (model.geom_bodyid[id] === 0 || model.geom_group[id] !== 1) continue;
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
