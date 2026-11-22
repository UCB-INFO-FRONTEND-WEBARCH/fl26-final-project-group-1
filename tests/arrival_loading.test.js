import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ArrivalMap } from '../src/arrival_map.js';

const base = new URL('../public/assets/arrival/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));

test('the overview becomes ready while closer images and full road geometry remain deferred', async () => {
  const previous_fetch = globalThis.fetch;
  const previous_bitmap = globalThis.createImageBitmap;
  const requested = [];
  let release_details;
  let images_loaded;
  let bitmap_count = 0;
  const delayed_details = new Promise(resolve => { release_details = resolve; });
  const detail_images = new Promise(resolve => { images_loaded = resolve; });
  globalThis.fetch = async url => {
    const file = url.split('/').pop();
    requested.push(file);
    if (file === manifest.lights.file) await delayed_details;
    return new Response(await readFile(new URL(file, base)));
  };
  globalThis.createImageBitmap = async () => {
    if (++bitmap_count === 4) images_loaded();
    return { close() {} };
  };
  const map = new ArrivalMap();
  const signal = new AbortController().signal;
  try {
    await map.load_overview('/assets/arrival/', signal);
    assert.deepEqual(requested.sort(), ['manifest.json', manifest.images[0].file, manifest.lights.overview.file].sort());
    assert.equal(map.ready, true);
    assert.equal(map.details_ready, false);
    assert.equal(map.lights.geometry.attributes.position.count, manifest.lights.overview.count);
    const initial_samplers = map.map_material.uniforms.uImages.value;
    assert.ok(initial_samplers.every(texture => texture === map.textures[0]));

    const details = map.load_details('/assets/arrival/', signal);
    await detail_images;
    assert.equal(map.ready, true);
    assert.equal(map.details_ready, false);
    assert.equal(map.map_material.uniforms.uImages.value, initial_samplers);
    release_details();
    await details;
    assert.equal(map.details_ready, true);
    assert.equal(map.lights.geometry.attributes.position.count, manifest.lights.count);
    assert.equal(new Set(map.map_material.uniforms.uImages.value).size, 4);
  } finally {
    release_details();
    map.dispose();
    globalThis.fetch = previous_fetch;
    if (previous_bitmap) globalThis.createImageBitmap = previous_bitmap;
    else delete globalThis.createImageBitmap;
  }
});
