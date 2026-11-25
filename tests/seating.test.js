import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SEATS, SEAT, nearby_seat, from_seat, seat_pose, seat_footprint } from '../src/seat.js';
import { SEATING_PRODUCTS } from '../src/seating_layout.js';
import { SEATING_ASSETS } from '../src/seating_assets.js';
import { seating_bodies } from '../src/seating_geometry.js';
import { make_navigation_maps } from '../src/path_planner.js';
import { FLOOR_HEIGHT } from '../src/building.js';

test('catalog support heights match the trained sit and stand clips without scaling the models', async () => {
  const contract = JSON.parse(await readFile(new URL('../public/assets/lite_pro/policies/sit.json', import.meta.url)));
  for (const [article, product] of Object.entries(SEATING_PRODUCTS)) {
    const asset = SEATING_ASSETS[article];
    assert.equal(asset.input_frame, 'Y-up');
    assert.equal(asset.sha256.length, 64);
    assert.ok(asset.hulls.length > 1 && asset.hulls.length <= 32);
    for (const clip of Object.values(contract.motion.clips)) {
      for (const height of [product.height, product.support_height]) {
        const delta = height - clip.seat.height;
        assert.ok(delta >= contract.motion.seat.offset_range.height[0] &&
          delta <= contract.motion.seat.offset_range.height[1], `${product.name}: incompatible support height`);
      }
    }
  }
});

test('every sitting location has a clear staging point and remains a real navigation obstacle', () => {
  const maps = make_navigation_maps();
  assert.equal(new Set(SEATS.map(s => s.id)).size, SEATS.length);
  for (const seat of SEATS) {
    const staging = from_seat(seat, 0.85, 0);
    assert.ok(maps[seat.floor].free(staging), `${seat.id}: staging is blocked`);
    assert.equal(maps[seat.floor].free(seat.position), false);
    assert.equal(seat_pose(seat)[2], seat.floor * FLOOR_HEIGHT + seat.height);
    assert.equal(seat_footprint(seat).length, 4);
    assert.ok(seating_bodies().some(h => h.name.startsWith(`seat_${seat.id}_`)));
  }
});

test('F is offered only in front of a nearby seat on the same floor with a clear approach', () => {
  const clear = { line_clear: () => true }, blocked = { line_clear: () => false };
  const position = from_seat(SEAT, 1.2, 0);
  assert.equal(nearby_seat(position, SEAT.floor, [clear, clear], [SEAT]), SEAT);
  assert.equal(nearby_seat(position, 1 - SEAT.floor, [clear, clear], [SEAT]), null);
  assert.equal(nearby_seat(position, SEAT.floor, [blocked, blocked], [SEAT]), null);
  assert.equal(nearby_seat(from_seat(SEAT, -0.7, 0), SEAT.floor, null, [SEAT]), null);
  assert.equal(nearby_seat(from_seat(SEAT, 2, 0), SEAT.floor, null, [SEAT]), null);
  assert.equal(nearby_seat(from_seat(SEAT, 0.8, 1.2), SEAT.floor, null, [SEAT]), null);
});
