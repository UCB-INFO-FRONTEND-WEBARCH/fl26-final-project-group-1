import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ShoulderCamera } from '../src/shoulder_camera.js';

function fixture() {
  const camera = new THREE.PerspectiveCamera(52, 1.6, 0.05, 100);
  camera.up.set(0, 0, 1);
  const target = new THREE.Vector3();
  const controller = new ShoulderCamera(camera, target);
  return { camera, target, controller };
}

test('the camera stays behind the right shoulder and rotates with the heading in Z-up space', () => {
  const { camera, target, controller } = fixture();
  const position = new THREE.Vector3(2, 3, 0.73);
  controller.update(position, 0, 0, true);
  assert.ok(camera.position.x < position.x);
  assert.ok(camera.position.y < position.y);
  assert.ok(camera.position.z > target.z);
  assert.ok(target.x > position.x);
  const offset = camera.position.clone().sub(position);
  controller.update(position, Math.PI / 2, 0, true);
  assert.ok(camera.position.clone().sub(position).distanceTo(offset.applyAxisAngle(camera.up, Math.PI / 2)) < 1e-9);
  const view = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(view.distanceTo(target.clone().sub(camera.position).normalize()) < 1e-9);
});

test('smoothing takes the short heading turn and behaves the same at different frame rates', () => {
  function simulate(frames) {
    const { controller, camera } = fixture();
    controller.update(new THREE.Vector3(0, 0, 0.73), Math.PI - 0.01, 0, true);
    const initial = camera.position.clone();
    const position = new THREE.Vector3(0.5, 0.2, 0.75);
    for (let frame = 0; frame < frames; frame++) controller.update(position, -Math.PI + 0.01, 1 / frames);
    assert.ok(camera.position.distanceTo(initial) < 0.7);
    return camera.position;
  }
  assert.ok(simulate(30).distanceTo(simulate(120)) < 1e-8);
});

test('an obstacle pulls the camera in before its near plane clips, then it eases back out', () => {
  const { camera, controller } = fixture();
  const wall = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(-1.8, 0, 1.5), new THREE.Vector3(0.2, 3, 3));
  controller.add_obstacle(wall);
  const position = new THREE.Vector3(0, 0, 0.73);
  controller.update(position, 0, 0, true);
  assert.ok(camera.position.x > wall.max.x + 0.13);
  assert.ok(!wall.containsPoint(camera.position));
  const shortened = controller.arm_length;
  controller.obstacles.length = 0;
  controller.update(position, 0, 1 / 60);
  assert.ok(controller.arm_length > shortened && controller.arm_length < 2);
  for (let frame = 0; frame < 120; frame++) controller.update(position, 0, 1 / 60);
  assert.ok(camera.position.distanceTo(new THREE.Vector3(-2.6, -0.55, 1.58)) < 0.001);
});

test('zoom stays bounded and a reset or floor change restores the same relative framing', () => {
  const { camera, target, controller } = fixture();
  const ground = new THREE.Vector3(0, 0, 0.73);
  controller.zoom(1e6);
  assert.ok(controller.distance <= 4.5);
  controller.zoom(1e-6);
  assert.ok(controller.distance >= 1.4);
  controller.update(ground, 0.6, 0, true);
  const camera_offset = camera.position.clone().sub(ground);
  const target_offset = target.clone().sub(ground);
  const upstairs = new THREE.Vector3(5, -3, 0.73 + 2.64);
  controller.update(upstairs, 0.6, 1 / 60);
  assert.ok(camera.position.clone().sub(upstairs).distanceTo(camera_offset) < 1e-9);
  assert.ok(target.clone().sub(upstairs).distanceTo(target_offset) < 1e-9);
  controller.initialized = false;
  controller.update(ground, 0.6, 1 / 60);
  assert.ok(camera.position.clone().sub(ground).distanceTo(camera_offset) < 1e-9);
});
