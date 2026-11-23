import test from 'node:test';
import assert from 'node:assert/strict';
import {NavigationOverlay} from '../src/navigation_overlay.js';

test('a paused route remains visible above transparent surfaces and includes actual stair height',()=>{
  const overlay=new NavigationOverlay();
  const navigation={version:1,status:'walking',path:[[2.7,0,0],[0,0,0],[-1,0,.18]],goal:[-1,0,0,.18]};
  assert(overlay.update(navigation));
  assert(overlay.route.visible&&overlay.outline.visible&&overlay.destination.visible);
  for(const object of overlay.children){
    assert(object.material.transparent);assert.equal(object.material.depthTest,false);assert.equal(object.material.depthWrite,false);
    assert(object.renderOrder>=10000);
  }
  assert(overlay.route.material.linewidth>=3);
  assert.equal(overlay.geometry.getAttribute('instanceStart').count,2);
  assert(Math.abs(overlay.geometry.getAttribute('instanceEnd').getZ(1)-.25)<1e-6);
  assert.equal(overlay.destination.position.z,.255);
  assert.equal(overlay.update(navigation),false);
  overlay.update({version:2,status:'idle',path:[],goal:null});
  assert(overlay.children.every(object=>!object.visible));
});
