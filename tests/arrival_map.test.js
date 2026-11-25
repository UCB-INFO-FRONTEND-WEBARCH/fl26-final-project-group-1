import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { satellite_frame, SATELLITE_STOP_IMAGES } from '../src/arrival_geography.js';
import { resolve_theme } from '../src/theme.js';

const base = new URL('../public/assets/arrival/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));

test('aerial images and road lights match their recorded source hashes', async () => {
  for (const asset of [...manifest.images, manifest.lights, manifest.lights.overview]) {
    const bytes = await readFile(new URL(asset.file, base));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    if (asset.file.endsWith('.jpg')) assert.equal(bytes.readUInt16BE(), 0xffd8);
    else {
      assert.equal(bytes.length, asset.count * 3 * 4);
      for (let index = 0; index < bytes.length; index += 12) {
        assert.ok(Number.isFinite(bytes.readFloatLE(index)) && Number.isFinite(bytes.readFloatLE(index + 4)));
        assert.ok(bytes.readFloatLE(index + 8) > 0 && bytes.readFloatLE(index + 8) <= 1);
      }
    }
  }
});

test('geographic zoom levels meet without jumps and converge on the Building K roof', () => {
  for (const aspect of [0.5, 1, 16 / 9, 3]) {
    for (let level = 0; level < 2; level++) {
      const end = satellite_frame(manifest, level, 1, aspect);
      const next = satellite_frame(manifest, level + 1, 0, aspect);
      assert.deepEqual(end.center, next.center);
      assert.ok(Math.abs(end.span - next.span) < 1e-6);
    }
    const roof = satellite_frame(manifest, 2, 0, aspect);
    assert.deepEqual(roof.center, manifest.target.focus);
    assert.equal(roof.handoff, 0);
    const interior = satellite_frame(manifest, 2, 1, aspect);
    assert.equal(interior.handoff, 1);
    assert.ok(interior.span < roof.span);
  }
});

test('Building K projects to the screen center throughout every aerial zoom', () => {
  for (const aspect of [0.4, 1, 16 / 9, 3, 4]) {
    for (let level = 0; level < 3; level++) {
      for (let step = 0; step <= 100; step++) {
        const frame = satellite_frame(manifest, level, step / 100, aspect);
        const [x, y] = manifest.target.focus;
        assert.equal((x - frame.center[0]) / (frame.span * aspect) + 0.5, 0.5);
        assert.equal((y - frame.center[1]) / frame.span + 0.5, 0.5);
      }
    }
  }
});

test('the centered Bay Area view stays inside the available image coverage', () => {
  const image = manifest.images[0];
  for (const aspect of [0.4, 1, 16 / 9, 3, 4]) {
    const frame = satellite_frame(manifest, 0, 0, aspect);
    for (const side of [-1, 1]) {
      const x = frame.center[0] + side * frame.span * aspect / 2;
      const y = frame.center[1] + side * frame.span / 2;
      assert.ok(Math.abs(x - image.center[0]) < image.extent / 2);
      assert.ok(Math.abs(y - image.center[1]) < image.extent / 2);
    }
  }
});

test('Santa Clara framing fits inside local-street lighting coverage at every screen shape', () => {
  const [west, south, east, north] = manifest.lights.local_bounds;
  for (const aspect of [0.4, 0.5, 1, 16 / 9, 3]) {
    const frame = satellite_frame(manifest, 1, 0, aspect);
    const [x, y] = frame.center;
    assert.ok(x - frame.span * aspect / 2 > west && x + frame.span * aspect / 2 < east);
    assert.ok(y - frame.span / 2 > south && y + frame.span / 2 < north);
  }
});

test('Building K shows twice the previous scope width and height without clouds', () => {
  for (const aspect of [0.5, 1, 16 / 9, 3]) {
    const previous_span = manifest.images[3].extent * 0.78 / Math.max(1, aspect);
    const frame = satellite_frame(manifest, 2, 0, aspect);
    assert.ok(Math.abs(frame.span - previous_span * 2) < 1e-6);
    assert.equal(frame.cover, 0);
  }
});

test('Building K stays clear of clouds through its hold and the room handoff', () => {
  for (let step = 0; step <= 100; step++) {
    assert.equal(satellite_frame(manifest, 2, step / 100, 16 / 9).cover, 0);
  }
  assert.equal(SATELLITE_STOP_IMAGES.length, 3);
});

test('saved theme choices override system preferences; otherwise the system chooses day or night', () => {
  assert.equal(resolve_theme(null, false), 'light');
  assert.equal(resolve_theme(null, true), 'dark');
  assert.equal(resolve_theme('light', true), 'light');
  assert.equal(resolve_theme('dark', false), 'dark');
  assert.equal(resolve_theme('invalid', true), 'dark');
});
