import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { update_camera_depth } from '../src/camera_depth.js';
import { stabilize_native_surfaces } from '../src/native_render.js';

test('wide views retain depth separation while shoulder and close orbit views keep near clearance', () => {
  const camera = new THREE.PerspectiveCamera(44,1,.05,700), target = new THREE.Vector3();
  for (const [mode,distance,near] of [['top',43,.43],['orbit',350,3.5],['orbit',1000,5],
    ['orbit',2,.05],['shoulder',350,.05],['arrival',12,.12]]) {
    camera.position.set(0,0,distance);
    update_camera_depth(camera,target,mode);
    assert.equal(camera.near,near);
    assert.equal(camera.far,700);
    assert.equal(update_camera_depth(camera,target,mode),false);
    const front = new THREE.Vector3(0,0,-10).applyMatrix4(camera.projectionMatrix).z;
    const behind = new THREE.Vector3(0,0,-10.001).applyMatrix4(camera.projectionMatrix).z;
    assert.ok(behind>front,'A surface behind another must retain its depth order');
  }
});

test('floor depth bias leaves the 28.8 mm rug above the slab in wide views', () => {
  const root = new THREE.Group();root.userData.map_role = 'floor';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial({name:'V13 · natural oak floor'}));
  root.add(floor);stabilize_native_surfaces(root);
  assert.equal(floor.material.polygonOffsetFactor,0,'A floor slope must not amplify depth bias');
  const camera = new THREE.PerspectiveCamera(44,1,.05,700), target = new THREE.Vector3();
  const depth = distance => Math.round((new THREE.Vector3(0,0,-distance)
    .applyMatrix4(camera.projectionMatrix).z * .5 + .5) * 16777215);
  for (const distance of [43,350,500]) {
    camera.position.set(0,0,distance);update_camera_depth(camera,target,'orbit');
    assert.ok(depth(distance)+floor.material.polygonOffsetUnits>depth(distance-.0288),
      'The slab must remain behind the source rug');
  }
});

test('the wide-view near plane resolves floor seams and facade layers in a 24-bit depth buffer', () => {
  const camera = new THREE.PerspectiveCamera(44,1,.05,700), target = new THREE.Vector3();
  const depth = distance => Math.round((new THREE.Vector3(0,0,-distance)
    .applyMatrix4(camera.projectionMatrix).z * .5 + .5) * 16777215);
  for (const [mode,distance,separation,min_steps] of [['top',43,.001,3],['orbit',350,.02,8]]) {
    camera.near = .05;camera.updateProjectionMatrix();
    assert.ok(depth(distance+separation)-depth(distance)<=1,'Original layers share a depth step');
    camera.position.set(0,0,distance);
    update_camera_depth(camera,target,mode);
    assert.ok(depth(distance+separation)-depth(distance)>=min_steps,'Fixed layers need separate depth steps');
  }
});
