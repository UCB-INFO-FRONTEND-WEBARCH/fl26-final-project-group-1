import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {configure_native_materials,plant_cells} from '../src/native_render.js';

test('Fast avoids the transmission pass and Quality restores the authored glass and texture',()=>{
  const material=new THREE.MeshPhysicalMaterial({transmission:1,opacity:.8,transparent:false,depthWrite:true});
  const texture=material.map=new THREE.Texture();
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);
  configure_native_materials(mesh,true);
  assert.equal(material.transmission,0);assert.equal(material.depthWrite,false);assert.equal(material.forceSinglePass,true);
  configure_native_materials(mesh,true); // repeated application must not replace the source snapshot
  configure_native_materials(mesh,false);
  assert.equal(material.transmission,1);assert.equal(material.opacity,.8);assert.equal(material.transparent,false);
  assert.equal(material.depthWrite,true);assert.equal(material.forceSinglePass,false);assert.equal(material.map,texture);
});

test('plant culling cells retain every authored placement without a building-wide instance bound',()=>{
  const placements=Array.from({length:100},(_,i)=>({matrix:[[1,0,0,i*2],[0,1,0,i%3],[0,0,1,0],[0,0,0,1]]}));
  const groups=plant_cells(placements);
  assert.equal(groups.flat().length,placements.length);
  assert.deepEqual(new Set(groups.flat()),new Set(placements));
  assert(groups.length>20);
  assert(groups.every(group=>Math.max(...group.map(p=>p.matrix[0][3]))-Math.min(...group.map(p=>p.matrix[0][3]))<8));
});
