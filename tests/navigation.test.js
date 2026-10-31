import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigationMap, rectangle, make_navigation_maps } from '../src/path_planner.js';
import { Navigation } from '../src/navigation.js';
import { ELEVATOR, STAIRS, FLOOR_HEIGHT, upper_slabs } from '../src/building.js';
import { SPAWN } from '../src/scene_layout.js';

test('Theta* preserves arbitrary-angle paths and goes around inflated obstacles', () => {
  const map = new NavigationMap([rectangle([-0.5, 0.5, -1.5, 1.5])], [-4, 4, -4, 4]);
  assert.deepEqual(map.plan([-3, -3], [2, -2.5]), [[-3, -3], [2, -2.5]]);
  const path = map.plan([-3, 0], [3, 0]);
  assert.ok(path.length > 2);
  assert.ok(path.slice(1).every((point, index) => map.line_clear(path[index], point)));
  assert.ok(path.some(point => Math.abs(point[1]) > 1.9));
  assert.equal(map.plan([-3, 0], [0, 0]), null);
  assert.equal(map.plan([-3, 0], [NaN, 0]), null);
  assert.equal(map.plan([-3, 0], [10, 0]), null);
});

test('sealed passages and touching grid corners cannot be crossed', () => {
  const map = new NavigationMap([rectangle([-0.1, 0.1, -4, 4])], [-4, 4, -4, 4]);
  assert.equal(map.plan([-2, 0], [2, 0]), null);
  const corners = new NavigationMap([], [0, 4, 0, 4], 1, 0);
  corners.blocked[1] = 1;
  corners.blocked[4] = 1;
  assert.equal(corners.line_clear([0.5, 0.5], [1.5, 1.5]), false);
});

test('both floors have reachable rooms and lift landings; stair wells remain forbidden', () => {
  const maps = make_navigation_maps();
  for (const map of maps) {
    assert.ok(map.plan(SPAWN, [3, 0]));
    assert.ok(map.plan([3, 0], [3.5, 3]));
    assert.ok(map.plan(SPAWN, ELEVATOR.landing));
    assert.ok(map.plan(ELEVATOR.landing, ELEVATOR.center));
    assert.equal(map.line_clear([-8.17891738379347, -4.2017249566608506], ELEVATOR.center), true);
    assert.equal(map.free([-8.5, 0]), false);
  }
  const lift = { moving: false, occupied: () => false };
  const navigation = new Navigation(maps, lift);
  navigation.set_goal(SPAWN, [3, 0, 1], 0);
  assert.equal(navigation.state.status, 'walking');
  assert.deepEqual(navigation.segments.filter(segment => segment.type !== 'walk').map(segment => segment.type), ['call', 'ride']);
  assert.ok(navigation.state.path.some(point => point[2] === FLOOR_HEIGHT));
  navigation.cancel();
  assert.equal(navigation.state.status, 'idle');
  assert.deepEqual(navigation.update(SPAWN, 0, 1), [0, 0, 0]);
});

test('upper floor slabs leave actual stairs and elevator openings', () => {
  for (const hole of [STAIRS.opening, ELEVATOR.opening]) {
    const point = [(hole[0] + hole[1]) / 2, (hole[2] + hole[3]) / 2];
    assert.ok(!upper_slabs().some(slab => Math.abs(point[0] - slab.center[0]) < slab.size[0] / 2 &&
      Math.abs(point[1] - slab.center[1]) < slab.size[1] / 2));
  }
});
