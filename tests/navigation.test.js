import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigationMap, rectangle, make_navigation_maps } from '../src/path_planner.js';
import { Navigation } from '../src/navigation.js';
import { ELEVATOR, STAIRS, FLOOR_HEIGHT, STAIR_BOXES, upper_slabs, stair_height } from '../src/building.js';
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

test('both floors have separate reachable stair and elevator approaches', () => {
  const maps = make_navigation_maps();
  for (const map of maps) {
    assert.ok(map.plan(SPAWN, [3, 0]));
    assert.ok(map.plan([3, 0], [3.5, 3]));
    assert.ok(map.plan(SPAWN, ELEVATOR.landing));
    assert.ok(map.plan(ELEVATOR.landing, ELEVATOR.center));
    assert.ok(map.plan(SPAWN, STAIRS.lower_landing));
    assert.ok(map.plan([0, 4.5], STAIRS.upper_landing));
    assert.equal(map.line_clear([-8.17891738379347, -4.2017249566608506], ELEVATOR.center), true);
    assert.equal(map.free([STAIRS.center_x, 0]), false);
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

test('stair mode and direct stair clicks create 3D routes without requiring the policy to succeed', () => {
  const maps = make_navigation_maps();
  const lift = { moving: false, occupied: () => false };
  const navigation = new Navigation(maps, lift);
  navigation.transfer = 'stairs';
  navigation.set_goal(SPAWN, [3, 0, 1], 0);
  assert.equal(navigation.state.status, 'walking');
  assert.deepEqual(navigation.segments.map(segment => segment.type), ['walk', 'stairs', 'walk']);
  const path = navigation.segments[1].path;
  assert.equal(path[0][2], 0);
  assert.equal(path.at(-1)[2], FLOOR_HEIGHT);
  assert.ok(path.slice(1).every((point, index) => point[2] >= path[index][2]));
  navigation.set_goal(SPAWN, [STAIRS.center_x, 0, 0], 0);
  assert.equal(navigation.state.status, 'walking');
  assert.equal(navigation.state.goal.length, 4);
  assert.equal(navigation.state.goal[3], stair_height([STAIRS.center_x, 0]));
  assert.ok(navigation.segments[1].path.at(-1)[2] > 0);
  navigation.set_goal([0, 0, FLOOR_HEIGHT + 0.793], [0, 0, 0], 0);
  const down = navigation.segments[1].path;
  assert.ok(down.slice(1).every((point, index) => point[2] <= down[index][2]));
  assert.equal(down.length, STAIR_BOXES.length + 2);
});

test('upper floor slabs leave actual stairs and elevator openings', () => {
  for (const hole of [STAIRS.opening, ELEVATOR.opening]) {
    const point = [(hole[0] + hole[1]) / 2, (hole[2] + hole[3]) / 2];
    assert.ok(!upper_slabs().some(slab => Math.abs(point[0] - slab.center[0]) < slab.size[0] / 2 &&
      Math.abs(point[1] - slab.center[1]) < slab.size[1] / 2));
  }
});
