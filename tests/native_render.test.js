import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {configure_native_materials,plant_cells,stabilize_native_surfaces} from '../src/native_render.js';

test('solid finishes reject internal back faces and keep a stable floor, finish, and trim depth order',()=>{
  const root=new THREE.Group();
  const oak=new THREE.MeshStandardMaterial({name:'V13 · natural oak floor',side:THREE.DoubleSide});
  const stone=new THREE.MeshStandardMaterial({name:'V13 · honed limestone',side:THREE.DoubleSide});
  const wall=new THREE.MeshStandardMaterial({name:'V13 · warm limewash plaster',side:THREE.DoubleSide});
  function surface(role,material){
    const group=new THREE.Group();group.userData.map_role=role;
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);group.add(mesh);root.add(group);return mesh;
  }
  const floor=surface('floor',oak),other_floor=surface('floor',oak),arch_oak=surface('architecture',oak);
  const cladding=surface('architecture',stone),plaster=surface('architecture',wall);
  const positions=floor.geometry.attributes.position.array.slice();
  stabilize_native_surfaces(root);
  assert.equal(floor.material.side,THREE.FrontSide);
  assert.equal(plaster.material.side,THREE.FrontSide);
  assert.equal(floor.material.polygonOffsetFactor,0);
  assert.equal(floor.material.polygonOffsetUnits,-4);
  assert.equal(cladding.material.polygonOffsetUnits,-8);
  assert.equal(plaster.material.polygonOffset,false);
  assert.equal(arch_oak.material.polygonOffset,false);
  assert.equal(floor.material,other_floor.material);
  assert.notEqual(floor.material,arch_oak.material);
  assert.equal(oak.side,THREE.DoubleSide);
  assert.deepEqual(floor.geometry.attributes.position.array,positions);
  const fixed=floor.material;
  stabilize_native_surfaces(root);
  assert.equal(floor.material,fixed);
  configure_native_materials(root,true);configure_native_materials(root,false);
  assert.equal(floor.material.polygonOffsetUnits,-4);
});

test('glass, cutouts, light sheets, furniture, and instanced foliage retain their authored sides',()=>{
  const root=new THREE.Group();
  const furniture=new THREE.Group();furniture.userData.map_role='furniture';root.add(furniture);
  const solids=[
    new THREE.MeshPhysicalMaterial({name:'V13 · low iron glass',side:THREE.DoubleSide,transmission:1}),
    new THREE.MeshStandardMaterial({name:'V13 · cutout',side:THREE.DoubleSide,alphaTest:.5}),
    new THREE.MeshStandardMaterial({name:'V14 · opal luminaire',side:THREE.DoubleSide,emissive:0xffffff}),
  ];
  for(const material of solids)root.add(new THREE.Mesh(new THREE.PlaneGeometry(),material));
  const chair=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial({side:THREE.DoubleSide}));
  furniture.add(chair);
  const leaves=new THREE.InstancedMesh(new THREE.PlaneGeometry(),
    new THREE.MeshStandardMaterial({name:'V13 · leaves',side:THREE.DoubleSide}),1);root.add(leaves);
  stabilize_native_surfaces(root);
  assert.equal(chair.material.side,THREE.DoubleSide);
  assert.equal(leaves.material.side,THREE.DoubleSide);
  for(const material of solids)assert.equal(material.side,THREE.DoubleSide);
});

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
