import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_FURNITURE, SCENE_WALLS, FURNITURE_ASSETS } from '../src/scene_layout.js';

test('every furniture placement has grounded, finite collision geometry at the original model scale', () => {
  assert.deepEqual(new Set(SCENE_FURNITURE.map((item) => item.article)), new Set(Object.keys(FURNITURE_ASSETS)));
  for (const [article, asset] of Object.entries(FURNITURE_ASSETS)) {
    assert.match(article, /^\d{8}$/);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.ok(asset.size.every((value) => Number.isFinite(value) && value > 0));
    assert.ok(asset.hulls.length > 0 && asset.hulls.length <= 32);
    const vertices = asset.hulls.flat();
    assert.ok(asset.hulls.every((hull) => hull.length >= 4));
    assert.ok(vertices.every((point) => point.length === 3 && point.every(Number.isFinite)));
    for (let axis = 0; axis < 3; axis++) {
      const minimum = Math.min(...vertices.map((point) => point[axis]));
      const maximum = Math.max(...vertices.map((point) => point[axis]));
      const lower = axis === 2 ? 0 : -asset.size[axis] / 2;
      const upper = axis === 2 ? asset.size[axis] : asset.size[axis] / 2;
      assert.ok(minimum >= lower - 0.04 && maximum <= upper + 0.04, `${article}: collider has wrong scale or frame`);
    }
  }
});

test('furniture footprints fit inside the apartment and do not intersect its walls or doorways', () => {
  for (const item of SCENE_FURNITURE) {
    const [width, depth] = FURNITURE_ASSETS[item.article].size;
    const cosine = Math.cos(item.yaw);
    const sine = Math.sin(item.yaw);
    const half_x = (Math.abs(cosine) * width + Math.abs(sine) * depth) / 2;
    const half_y = (Math.abs(sine) * width + Math.abs(cosine) * depth) / 2;
    const [x, y] = item.position;
    assert.ok(Math.abs(x) + half_x < 6.91 && Math.abs(y) + half_y < 5.91, `${item.name}: outside apartment`);
    for (const wall of SCENE_WALLS) {
      const overlaps_x = Math.abs(x - wall.center[0]) < half_x + wall.size[0] / 2;
      const overlaps_y = Math.abs(y - wall.center[1]) < half_y + wall.size[1] / 2;
      assert.ok(!overlaps_x || !overlaps_y, `${item.name}: intersects ${wall.name}`);
    }
    assert.ok(Math.abs(x - 1.4) > half_x + 0.25 || Math.abs(y) > half_y + 0.9, `${item.name}: blocks living-room doorway`);
    assert.ok(Math.abs(y - 1.8) > half_y + 0.25 || Math.abs(x - 5.05) > half_x + 0.95, `${item.name}: blocks study doorway`);
  }
});
