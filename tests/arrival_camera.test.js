import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArrivalCamera, ARRIVAL_LEVELS, ARRIVAL_HOLD_SECONDS } from '../src/arrival_camera.js';

function fixture(reduced_motion = false) {
  const camera = new THREE.PerspectiveCamera();
  const target = new THREE.Vector3();
  const origin = new THREE.Vector3(-4.7, -3.4, 0.73);
  const destination = origin.clone().add(new THREE.Vector3(-2.6, -0.55, 0.85));
  const destination_target = origin.clone().add(new THREE.Vector3(0.65, 0, 0.35));
  const sequence = new ArrivalCamera(camera, target, origin, destination, destination_target, reduced_motion);
  return { camera, target, origin, destination, destination_target, sequence };
}

test('loading time does not consume the first visible hold before a smooth dive', () => {
  const { camera, sequence } = fixture();
  const initial = camera.position.clone();
  sequence.update(30);
  assert.equal(sequence.level, 0);
  assert.equal(sequence.moving, false);
  assert.deepEqual(camera.position, initial);
  sequence.ready = true;
  sequence.update(ARRIVAL_HOLD_SECONDS - 0.01);
  assert.equal(sequence.moving, false);
  assert.deepEqual(camera.position, initial);
  sequence.update(0.02);
  assert.equal(sequence.moving, true);
  assert.deepEqual(camera.position, initial);
  sequence.update(0.3);
  assert.ok(camera.position.z < initial.z && camera.position.z > 85);
  assert.equal(sequence.done, false);
});

test('every altitude holds at least half a second and the last dive matches the shoulder camera', () => {
  const { camera, target, destination, destination_target, sequence } = fixture();
  const original_destination = destination.clone();
  sequence.ready = true;
  const held = Array(ARRIVAL_LEVELS.length).fill(0);
  for (let frame = 0; frame < 2000 && !sequence.done; frame++) {
    const level = sequence.level;
    const stationary = !sequence.moving;
    sequence.update(1 / 120);
    if (stationary) held[level] += 1 / 120;
  }
  assert.ok(ARRIVAL_HOLD_SECONDS >= 0.5);
  assert.equal(held.length, 3);
  assert.ok(held.every(seconds => seconds >= ARRIVAL_HOLD_SECONDS));
  assert.equal(sequence.done, true);
  assert.ok(camera.position.distanceTo(destination) < 1e-9);
  assert.ok(target.distanceTo(destination_target) < 1e-9);
  assert.deepEqual(camera.up, new THREE.Vector3(0, 0, 1));
  assert.deepEqual(destination, original_destination);
  const forward = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(forward.distanceTo(target.clone().sub(camera.position).normalize()) < 1e-9);
});

test('reduced motion keeps the altitude holds and uses cuts instead of dives', () => {
  const { sequence, camera } = fixture(true);
  sequence.ready = true;
  for (let level = 0; level < ARRIVAL_LEVELS.length; level++) {
    const held_position = camera.position.clone();
    sequence.update(0.5);
    assert.deepEqual(camera.position, held_position);
    assert.equal(sequence.moving, false);
    sequence.update(ARRIVAL_HOLD_SECONDS - 0.49);
    assert.deepEqual(camera.position, held_position);
    sequence.update(1 / 60);
    assert.equal(sequence.level, level + 1);
  }
  assert.equal(sequence.done, true);
});
