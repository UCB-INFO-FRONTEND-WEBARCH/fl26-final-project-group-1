// Remove whole furniture components from the joined render mesh and matching physics input.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Vector3, Quaternion } from 'three';
import { HEPHAESTUS_MAP } from '../../src/hephaestus_data.js';
import { HEPHAESTUS_PHYSICS } from '../../src/hephaestus_physics.js';

const root = new URL('../../', import.meta.url);
const layout = JSON.parse(await readFile(new URL('lounge_layout.json', import.meta.url)));
const inside = (point, bounds) => point.every((v, i) => v >= bounds[0][i] && v <= bounds[1][i]);
const removed = points => layout.removed.some(region => points.every(p => inside(p, region.bounds)));
const carpet = name => /carpet|vollerslev/i.test(name);
const path = new URL('public/assets/hephaestus/lower.glb', root);
const bytes = await readFile(process.argv[2] ?? path);
const json_size = bytes.readUInt32LE(12);
const doc = JSON.parse(bytes.subarray(20, 20 + json_size));
const binary = bytes.subarray(28 + json_size);
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const decoded = new Map(), replacements = new Map();
function buffer_view(index) {
  if (decoded.has(index)) return decoded.get(index);
  const view = doc.bufferViews[index], ext = view.extensions?.EXT_meshopt_compression;
  let result;
  if (ext) {
    result = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(result, ext.count, ext.byteStride,
      binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter);
  } else result = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  decoded.set(index, result);
  return result;
}
function accessor(index, components) {
  const a = doc.accessors[index], view = doc.bufferViews[a.bufferView];
  const raw = buffer_view(a.bufferView), data = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const size = {5123: 2, 5125: 4, 5126: 4}[a.componentType];
  const read = {5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32'}[a.componentType];
  if (!size || a.normalized) throw new Error('Unexpected quantized accessor format');
  return Array.from({length: a.count}, (_, i) => Array.from({length: components}, (_, c) =>
    data[read]((a.byteOffset ?? 0) + i * (view.byteStride ?? components * size) + c * size, true)));
}
function matrix(node) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(new Vector3(...(node.translation ?? [0,0,0])),
    new Quaternion(...(node.rotation ?? [0,0,0,1])), new Vector3(...(node.scale ?? [1,1,1])));
}
let discarded = 0, retained = 0;
const point = new Vector3();
for (const parent of doc.nodes.filter(n => ['furniture','architecture'].includes(n.extras?.map_role))) {
  for (const child_index of parent.children) {
    const child = doc.nodes[child_index], transform = matrix(parent).multiply(matrix(child));
    const mesh = doc.meshes[child.mesh], positions = new Map(), empty = new Set();
    for (const primitive of mesh.primitives) {
      if (carpet(doc.materials[primitive.material]?.name ?? '')) continue;
      const id = primitive.attributes.POSITION;
      if (!positions.has(id)) positions.set(id, accessor(id, 3).map(p => {
        point.set(...p).applyMatrix4(transform);
        return [point.x, -point.z, point.y]; // glTF Y-up -> runtime Z-up
      }));
      const vertices = positions.get(id), indices = accessor(primitive.indices, 1).flat(), kept = [];
      for (let i = 0; i < indices.length; i += 3) {
        const triangle = indices.slice(i, i + 3);
        if (removed(triangle.map(index => vertices[index]))) discarded++;
        else { kept.push(...triangle); retained++; }
      }
      if (kept.length === indices.length) continue;
      if (!kept.length) { empty.add(primitive); continue; }
      // Joined GLBs share index streams across materials. Give the edited primitive
      // its own accessor and stream so unrelated furniture keeps its original offsets.
      const a = {...doc.accessors[primitive.indices]};
      const size = a.componentType === 5125 ? 4 : 2;
      const packed = size === 4 ? new Uint32Array(kept) : new Uint16Array(kept);
      const compressed = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(packed.buffer), kept.length, size, 'TRIANGLES');
      a.bufferView = doc.bufferViews.length;
      a.byteOffset = 0;
      a.count = kept.length;
      delete a.min; delete a.max;
      const fallback_offset = Math.ceil(doc.buffers[1].byteLength / 4) * 4;
      doc.buffers[1].byteLength = fallback_offset + kept.length * size;
      doc.bufferViews.push({buffer:1, byteOffset:fallback_offset, byteLength:kept.length * size, target:34963,
        extensions:{EXT_meshopt_compression:{buffer:0, byteOffset:0, byteLength:compressed.length,
          byteStride:size, mode:'TRIANGLES', count:kept.length}}});
      replacements.set(a.bufferView, compressed);
      primitive.indices = doc.accessors.length;
      doc.accessors.push(a);
    }
    mesh.primitives = mesh.primitives.filter(p => !empty.has(p));
  }
}
// Repack compressed streams and embedded textures, preserving shared source streams.
const chunks = []; let offset = 0;
for (const [index, view] of doc.bufferViews.entries()) {
  const ext = view.extensions?.EXT_meshopt_compression;
  if (!ext && view.buffer !== 0) continue;
  const start = ext ? ext.byteOffset : view.byteOffset ?? 0;
  const length = ext ? ext.byteLength : view.byteLength;
  const payload = replacements.get(index) ?? binary.subarray(start, start + length);
  const padding = (4 - offset % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
  if (ext) { ext.byteOffset = offset; ext.byteLength = payload.length; }
  else view.byteOffset = offset;
  chunks.push(Buffer.from(payload)); offset += payload.length;
}
chunks.push(Buffer.alloc((4 - offset % 4) % 4));
const packed = Buffer.concat(chunks); doc.buffers[0].byteLength = packed.length;
const json = Buffer.from(JSON.stringify(doc)), padded_json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2,4);
header.writeUInt32LE(28 + padded_json.length + packed.length,8); header.writeUInt32LE(padded_json.length,12); header.writeUInt32LE(0x4e4f534a,16);
const bin_header = Buffer.alloc(8); bin_header.writeUInt32LE(packed.length); bin_header.writeUInt32LE(0x004e4942,4);
await writeFile(path, Buffer.concat([header,padded_json,bin_header,packed]));

const physics = HEPHAESTUS_PHYSICS.filter(p => ['floor','stairs','roof'].includes(p.role) || carpet(p.source) || !removed(p.vertices));
const furniture = HEPHAESTUS_MAP.furniture.filter(f => carpet(f.name) || !removed([
  [f.bounds[0][0],f.bounds[0][1],.1], [f.bounds[1][0],f.bounds[1][1],.5],
]));
const map = {...HEPHAESTUS_MAP, furniture, lounge_layout: {sofas: 2, coffee_tables: 2, removed: layout.removed}};
await mkdir(new URL('local_assets/hephaestus/', root), {recursive:true});
await writeFile(new URL('local_assets/hephaestus/lounge_input.json', root), JSON.stringify({map,physics}));
console.log(JSON.stringify({discarded_triangles:discarded,retained_triangles:retained,physics_removed:HEPHAESTUS_PHYSICS.length-physics.length}));
