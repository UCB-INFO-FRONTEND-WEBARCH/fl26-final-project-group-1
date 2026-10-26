import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('render LOD stays within its size budget and contains valid indexed geometry', async () => {
  const base = new URL('../public/assets/g1/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('visuals.json', base), 'utf8'));
  const source = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  const binary = await readFile(new URL('visuals.bin', base));
  assert.equal(manifest.source_commit, source.commit);
  assert.equal(createHash('sha256').update(binary).digest('hex'), manifest.sha256);
  assert.ok(manifest.optimized_triangles < 30000);
  assert.ok(binary.byteLength < 1024 * 1024);
  const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
  let triangles = 0;
  for (const mesh of manifest.meshes) {
    const positions = new Float32Array(buffer, mesh.position_offset, mesh.vertex_count * 3);
    const normals = new Float32Array(buffer, mesh.normal_offset, mesh.vertex_count * 3);
    const indices = new Uint32Array(buffer, mesh.index_offset, mesh.index_count);
    assert.ok(positions.every(Number.isFinite));
    assert.ok(normals.every(Number.isFinite));
    assert.ok(indices.every(index => index < mesh.vertex_count), `Mesh ${mesh.mesh_id} has an invalid index`);
    assert.equal(indices.length % 3, 0);
    triangles += indices.length / 3;
  }
  assert.equal(triangles, manifest.optimized_triangles);
});
