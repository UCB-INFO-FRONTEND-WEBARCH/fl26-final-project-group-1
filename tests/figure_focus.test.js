import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { figure_opacity } from '../src/figure_focus.js';

test('the figure softens before the lens reaches its body and is absent inside it', () => {
  const pelvis = new THREE.Vector3(0, 0, 0.77), rotation = new THREE.Quaternion();
  assert.equal(figure_opacity(new THREE.Vector3(-2.6, -0.55, 1.62), pelvis, rotation), 1);
  assert.equal(figure_opacity(new THREE.Vector3(0, 0, 1.35), pelvis, rotation), 0);
  assert.equal(figure_opacity(new THREE.Vector3(0.4, 0, 0.7), pelvis, rotation), 0);
  let previous = 0;
  for (let distance = 0.55; distance <= 1.15; distance += 0.01) {
    const opacity = figure_opacity(new THREE.Vector3(distance, 0, 1.1), pelvis, rotation);
    assert.ok(opacity >= previous && opacity <= 1);
    previous = opacity;
  }
  const opacity = figure_opacity(new THREE.Vector3(0.85, 0, 1.1), pelvis, rotation);
  assert.ok(opacity > 0.4 && opacity < 0.6);
});

test('camera protection follows the pelvis during falls and on another floor', () => {
  const pelvis = new THREE.Vector3(3, 5, 4.37);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  assert.equal(figure_opacity(new THREE.Vector3(3.5, 5, 4.37), pelvis, rotation), 0);
  assert.equal(figure_opacity(new THREE.Vector3(3, 5, 6), pelvis, rotation), 1);
});
