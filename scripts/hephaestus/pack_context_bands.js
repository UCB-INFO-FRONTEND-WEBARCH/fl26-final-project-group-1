// Partition the compressed context GLB at its authored band nodes. Keep the
// quantized geometry, transforms, and embedded textures for each band.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [, , source, destination] = process.argv;
if (!source || !destination) throw new Error('Usage: node pack_context_bands.js CONTEXT.glb OUTPUT_DIR');
const input = await readFile(source);
const json_size = input.readUInt32LE(12);
const doc = JSON.parse(input.subarray(20, 20 + json_size));
const binary = input.subarray(28 + json_size);
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);

const decoded = new Map();
function decode_stream(index) {
  if (!decoded.has(index)) {
    const stream = doc.bufferViews[index].extensions.EXT_meshopt_compression;
    const bytes = new Uint8Array(stream.count * stream.byteStride);
    // Retain the encoded normals. Three.js applies the filter on read.
    MeshoptDecoder.decodeGltfBuffer(bytes, stream.count, stream.byteStride,
      binary.subarray(stream.byteOffset, stream.byteOffset + stream.byteLength), stream.mode, 'NONE');
    decoded.set(index, bytes);
  }
  return decoded.get(index);
}

function texture_bindings(material) {
  return Object.entries(material).flatMap(([key, value]) => {
    if (!value || typeof value !== 'object') return [];
    return key.endsWith('Texture') && Number.isInteger(value.index) ? [value] : texture_bindings(value);
  });
}

function pack_band(band) {
  const out = { ...doc, nodes: [], meshes: [], materials: [], accessors: [], textures: [], images: [], bufferViews: [] };
  const chunks = [];
  let byte_offset = 0;
  let fallback_offset = 0;
  function append(bytes) {
    const start = byte_offset;
    const padding = (4 - bytes.length % 4) % 4;
    chunks.push(Buffer.from(bytes), Buffer.alloc(padding));
    byte_offset += bytes.length + padding;
    return start;
  }

  const remapped = new Map();
  function copy(kind, index, remap) {
    const key = `${kind}:${index}`;
    if (!remapped.has(key)) {
      const value = structuredClone(doc[kind][index]);
      remap?.(value);
      remapped.set(key, out[kind].push(value) - 1);
    }
    return remapped.get(key);
  }
  function copy_texture(index) {
    return copy('textures', index, texture => {
      texture.source = copy('images', texture.source, image => {
        image.bufferView = copy('bufferViews', image.bufferView, view => {
          const start = view.byteOffset ?? 0;
          view.byteOffset = append(binary.subarray(start, start + view.byteLength));
        });
      });
    });
  }
  function copy_node(index) {
    const tag = doc.nodes[index].extras?.context_band;
    if (tag && tag !== band) return null;
    return copy('nodes', index, node => {
      if (node.children) node.children = node.children.map(copy_node).filter(value => value !== null);
      if (node.mesh === undefined) return;
      node.mesh = copy('meshes', node.mesh, mesh => {
        for (const primitive of mesh.primitives) {
          primitive.indices = copy('accessors', primitive.indices);
          for (const [name, index] of Object.entries(primitive.attributes)) {
            primitive.attributes[name] = copy('accessors', index);
          }
          primitive.material = copy('materials', primitive.material, material => {
            for (const binding of texture_bindings(material)) binding.index = copy_texture(binding.index);
          });
        }
      });
    });
  }
  out.scenes = doc.scenes.map(scene => ({ ...scene, nodes: scene.nodes.map(copy_node).filter(value => value !== null) }));
  if (!out.meshes.length) throw new Error(`Missing ${band} geometry in the context GLB.`);

  const streams = Map.groupBy(out.accessors, accessor => accessor.bufferView);
  for (const [index, accessors] of streams) {
    const view = structuredClone(doc.bufferViews[index]);
    const compressed = view.extensions.EXT_meshopt_compression;
    const stride = compressed.byteStride;
    const original = decode_stream(index);
    const blocks = [];
    let length = 0;
    for (const accessor of accessors) {
      const start = accessor.byteOffset ?? 0;
      if (start % stride) throw new Error(`Misaligned context accessor in stream ${index}`);
      const block = original.subarray(start, start + accessor.count * stride);
      if (block.length !== accessor.count * stride) throw new Error(`Truncated context accessor in stream ${index}`);
      accessor.bufferView = out.bufferViews.length;
      accessor.byteOffset = length;
      blocks.push(block);
      length += block.length;
    }
    const count = length / stride;
    const encoded = MeshoptEncoder.encodeGltfBuffer(Buffer.concat(blocks), count, stride, compressed.mode);
    Object.assign(compressed, { byteOffset: append(encoded), byteLength: encoded.length, count });
    Object.assign(view, { byteOffset: fallback_offset, byteLength: length });
    out.bufferViews.push(view);
    fallback_offset += Math.ceil(length / 4) * 4;
  }
  out.buffers = [{ byteLength: byte_offset }, { ...doc.buffers[1], byteLength: fallback_offset }];
  const json = Buffer.from(JSON.stringify(out));
  const json_padding = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const json_length = json.length + json_padding.length;
  const header = Buffer.alloc(20);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json_length + byte_offset, 8);
  header.writeUInt32LE(json_length, 12);
  header.write('JSON', 16);
  const bin_header = Buffer.alloc(8);
  bin_header.writeUInt32LE(byte_offset);
  bin_header.write('BIN\0', 4);
  return Buffer.concat([header, json, json_padding, bin_header, ...chunks]);
}

for (const band of ['roof', 'tower']) {
  const bytes = pack_band(band);
  await writeFile(join(destination, `context-${band}.glb`), bytes);
  console.log(`${band}: ${bytes.length} bytes`);
}
