// Offline render-only LOD. Physics continues to load the untouched official meshes.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import load_mujoco from '@mujoco/mujoco';
import { MeshoptSimplifier } from 'meshoptimizer';
import { BufferAttribute, BufferGeometry } from 'three';
import { load_robot_files } from '../src/robot_assets.js';

const asset_base = new URL('../public/assets/g1/', import.meta.url);
const mujoco = await load_mujoco({
  locateFile: () => fileURLToPath(new URL('../node_modules/@mujoco/mujoco/mujoco.wasm', import.meta.url)),
});
await MeshoptSimplifier.ready;
const source_manifest = await load_robot_files(mujoco, (path) => readFile(new URL(path, asset_base)));
const model = mujoco.MjModel.from_xml_path('/g1/g1_12dof.xml');
const chunks = [];
let byte_offset = 0;
let original_triangles = 0;
let optimized_triangles = 0;

function append(array) {
  const offset = byte_offset;
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  chunks.push(bytes);
  byte_offset += bytes.byteLength;
  return offset;
}

const meshes = [];
for (let mesh_id = 0; mesh_id < model.nmesh; mesh_id++) {
  const vertex_start = model.mesh_vertadr[mesh_id] * 3;
  const face_start = model.mesh_faceadr[mesh_id] * 3;
  const positions = new Float32Array(
    model.mesh_vert.slice(vertex_start, vertex_start + model.mesh_vertnum[mesh_id] * 3),
  );
  const faces = new Uint32Array(
    model.mesh_face.slice(face_start, face_start + model.mesh_facenum[mesh_id] * 3),
  );
  const target_count = Math.max(240, Math.floor((faces.length * 0.05) / 3) * 3);
  const [simplified, error] = MeshoptSimplifier.simplify(faces, positions, 3, target_count, 0.004, [
    'ErrorAbsolute',
    'Permissive',
  ]);
  const [remap, vertex_count] = MeshoptSimplifier.compactMesh(simplified);
  const compact_positions = new Float32Array(vertex_count * 3);
  for (let vertex = 0; vertex < remap.length; vertex++) {
    if (remap[vertex] !== 0xffffffff) {
      compact_positions.set(positions.subarray(vertex * 3, vertex * 3 + 3), remap[vertex] * 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(compact_positions, 3));
  geometry.setIndex(new BufferAttribute(simplified, 1));
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal').array;
  meshes.push({
    mesh_id,
    vertex_count,
    index_count: simplified.length,
    position_offset: append(compact_positions),
    normal_offset: append(normals),
    index_offset: append(simplified),
    original_triangles: faces.length / 3,
    max_error_m: error,
  });
  original_triangles += faces.length / 3;
  optimized_triangles += simplified.length / 3;
  geometry.dispose();
}
const binary = Buffer.concat(chunks);
const manifest = {
  source_commit: source_manifest.commit,
  mujoco_version: '3.17.0',
  simplifier: 'meshoptimizer 1.3.0',
  max_error_m: 0.004,
  original_triangles,
  optimized_triangles,
  sha256: createHash('sha256').update(binary).digest('hex'),
  meshes,
};
await writeFile(new URL('visuals.bin', asset_base), binary);
await writeFile(new URL('visuals.json', asset_base), `${JSON.stringify(manifest, null, 2)}\n`);
model.delete();
console.log(
  `Render mesh: ${original_triangles.toLocaleString()} → ${optimized_triangles.toLocaleString()} triangles`,
);
console.log(`Visual asset: ${(binary.byteLength / 1024).toFixed(0)} KiB; geometry error capped at 4 mm`);
