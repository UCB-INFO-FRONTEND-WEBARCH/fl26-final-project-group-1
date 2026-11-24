import test from 'node:test';
import assert from 'node:assert/strict';
import { make_navigation_maps } from '../src/path_planner.js';
import { teleport_position } from '../src/teleport.js';
import { FLOOR_HEIGHT, STANDING_HEIGHT } from '../src/building.js';

const maps = make_navigation_maps();

test('teleport accepts open destinations on either floor without requiring a route', () => {
  for (const floor of [0, 1]) {
    const point = maps[floor].point(maps[floor].blocked.indexOf(0));
    assert.deepEqual(teleport_position([...point, floor], maps), [...point, floor * FLOOR_HEIGHT + STANDING_HEIGHT]);
  }
});

test('teleport rejects malformed targets, blocked locations, voids and unknown floors', () => {
  const blocked = maps[0].point(maps[0].blocked.indexOf(1));
  for (const target of [null, [], [0, 0], [0, 0, 0, 0], [NaN, 0, 0], [0, Infinity, 0],
    [0, 0, -1], [0, 0, 2], [0, 0, 0.5], [1000, 1000, 0], [...blocked, 0]]) {
    assert.equal(teleport_position(target, maps), null);
  }
  assert.equal(teleport_position([0, 0, 0], null), null);
});
