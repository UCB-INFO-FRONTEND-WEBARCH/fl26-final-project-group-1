import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MAP,IS_HEPHAESTUS,HAS_ELEVATOR} from '../../src/world.js';
import {HEPHAESTUS_PHYSICS} from '../../src/hephaestus_physics.js';
import {make_navigation_maps} from '../../src/path_planner.js';
import {Navigation} from '../../src/navigation.js';
import {FLOOR_HEIGHT,STAIRS,STAIR_PATH,on_stairs,stair_height,stair_projection} from '../../src/building.js';
import {make_scene_xml,SPAWN} from '../../src/scene_layout.js';
import {teleport_position} from '../../src/teleport.js';
import {SEATS,from_seat,nearby_seat,seat_footprint} from '../../src/seat.js';
import {seating_bodies} from '../../src/seating_geometry.js';
import {SEATING_ASSETS} from '../../src/seating_assets.js';

test('default map retains V20 metric provenance and declares its real connectors',()=>{
 assert.equal(IS_HEPHAESTUS,true);assert.equal(HAS_ELEVATOR,false);assert.equal(MAP.units,'metres');
 assert.equal(MAP.source_sha256,'884a527e1530fcbd9d5fb5b65fd26ab2838131fdf682cf8d7d32bfc4f4856848');
 assert(MAP.context_bounds[0][2]<-140,'Full tower exterior must extend below the roof apartment');
 assert(MAP.context_bounds[1][2]-MAP.context_bounds[0][2]>140);
 assert.equal(FLOOR_HEIGHT,3.6);assert.equal(MAP.plants.length,330);assert(Math.abs(MAP.origin[2]-3.03)<1e-6);
 const xml=make_scene_xml();assert(!xml.includes('type="plane"'));assert(!xml.includes('lift_joint'));
 assert(HEPHAESTUS_PHYSICS.length>500);assert(HEPHAESTUS_PHYSICS.length<5000);
});
test('all shipped scene assets match their manifest hashes and use supported glTF',async()=>{
 for(const f of MAP.files){
  const b=await readFile(new URL(`../../public/assets/hephaestus/${f.file}`,import.meta.url));
  assert.equal(b.length,f.bytes,f.file);assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256,f.file);
  if(!f.file.endsWith('.glb'))continue;
  assert.equal(b.toString('ascii',0,4),'glTF');const n=b.readUInt32LE(12);const doc=JSON.parse(b.subarray(20,20+n).toString());
  assert.equal(doc.asset.version,'2.0');assert(b.length<100*1024*1024);
  for(const texture of doc.textures||[]){
   if(texture.extensions?.EXT_texture_webp)assert.equal(doc.images[texture.extensions.EXT_texture_webp.source].mimeType,'image/webp');
  }
  const bindings=(value)=>Object.entries(value).flatMap(([key,child])=>{
   if(!child||typeof child!=='object')return [];
   return key.endsWith('Texture')&&'index' in child?[child]:bindings(child);
  });
  for(const mesh of doc.meshes||[])for(const primitive of mesh.primitives){
   for(const binding of bindings(doc.materials?.[primitive.material]||{})){
    const coord=binding.extensions?.KHR_texture_transform?.texCoord??binding.texCoord??0;
    assert(Number.isInteger(coord)&&coord>=0,`${f.file}: invalid UV binding`);
    assert(`TEXCOORD_${coord}` in primitive.attributes,`${f.file}: texture references absent UV layer`);
   }
  }
 }
});
test('native navigation preserves the central aisle, rejects furniture and excludes the mezzanine void',()=>{
 const maps=make_navigation_maps();assert(maps[0].free(SPAWN));
 const path=maps[0].plan(SPAWN,[-2.8,0]);assert(path);assert(path.slice(1).every((p,i)=>maps[0].line_clear(path[i],p)));
 assert.equal(maps[0].free([0,2.735]),false); // Actual north connector sofa.
 assert.equal(maps[1].free([0,0]),false);assert.equal(maps[0].free([100,100]),false);
 assert(maps[0].plan(SPAWN,[9,-3.7]));assert(maps[0].free(STAIRS.lower_landing));assert(maps[1].free(STAIRS.upper_landing));
});
test('the L stair is height-aware in both directions and never creates an elevator route',()=>{
 const maps=make_navigation_maps(),nav=new Navigation(maps,null);
 assert.equal(nav.transfer,'stairs');nav.set_goal(SPAWN,[-15,-2,1],0);
 assert.equal(nav.state.status,'walking',nav.state.message);assert.deepEqual(nav.segments.map(s=>s.type),['walk','stairs','walk']);
 const up=nav.segments[1].path;assert.equal(up[0][2],0);assert.equal(up.at(-1)[2],3.6);
 assert(up.some((p,i)=>i>0&&Math.abs(p[0]-up[i-1][0])>.1));assert(up.some((p,i)=>i>0&&Math.abs(p[1]-up[i-1][1])>.1));
 assert(up.slice(1).every((p,i)=>p[2]>=up[i][2]));
 nav.set_goal([-15,-2,4.33],[2.7,0,0],0);assert.equal(nav.state.status,'walking',nav.state.message);
 const down=nav.segments[1].path;assert.equal(down[0][2],3.6);assert.equal(down.at(-1)[2],0);assert(down.slice(1).every((p,i)=>p[2]<=down[i][2]));
 for(const p of STAIR_PATH.slice(1,-1)){assert(on_stairs(p,.2));assert(Number.isFinite(stair_height(p)));assert(stair_projection(p).distance<1e-6);}
});

test('teleport can reach the mezzanine while rejecting the open void and real sofa footprints', () => {
 const maps = make_navigation_maps();
 assert.deepEqual(teleport_position([-15, -2, 1], maps), [-15, -2, FLOOR_HEIGHT + 0.73]);
 assert.equal(teleport_position([0, 0, 1], maps), null);
 assert.equal(teleport_position([0, 2.735, 0], maps), null);
});

test('all five catalog chairs have connected approaches on their own floor', () => {
 const maps=make_navigation_maps();
 assert.equal(SEATS.filter(seat=>seat.kind==='Armchair').length,5);
 assert(SEATS.some(s=>s.floor===1));
 for(const seat of SEATS.filter(seat=>seat.kind==='Armchair')){
  const stage=from_seat(seat,.85,0);
  assert(maps[seat.floor].free(stage),seat.id);
  assert(maps[seat.floor].plan(seat.floor?[-15,-2]:SPAWN,stage),`${seat.id}: disconnected staging point`);
  assert.equal(nearby_seat([...stage,seat.floor*FLOOR_HEIGHT+.73],seat.floor,maps)?.id,seat.id);
 }
});

test('two compatible lounge sofas have open walking approaches and replace the tall native sofas', () => {
 const map=make_navigation_maps()[0],sofas=SEATS.filter(seat=>seat.kind==='Sofa');
 assert.equal(sofas.length,2);
 assert.equal(MAP.furniture.filter(f=>f.product==='kivik').length,0);
 assert.equal(HEPHAESTUS_PHYSICS.filter(p=>p.source.includes('KIVIK')).length,0);
 for(const sofa of sofas){
  assert.equal(sofa.label,'KIVIK');
  assert.equal(sofa.scale,.8);
  const vertices=seating_bodies().filter(body=>body.source===sofa.id).flatMap(body=>body.vertices);
  const footprint=seat_footprint(sofa);
  for(let axis=0;axis<3;axis++){
   const span=Math.max(...vertices.map(p=>p[axis]))-Math.min(...vertices.map(p=>p[axis]));
   const expected=SEATING_ASSETS[sofa.article].size[axis]*sofa.scale;
   assert(Math.abs(span-expected)<.02,`${sofa.id}: collider scale differs on axis ${axis}`);
   if(axis<2){
    const nav_span=Math.max(...footprint.map(p=>p[axis]))-Math.min(...footprint.map(p=>p[axis]));
    assert(Math.abs(nav_span-expected)<1e-6,`${sofa.id}: navigation scale differs on axis ${axis}`);
   }
  }
  const stage=from_seat(sofa,.85,0);
  assert(map.free(stage),sofa.id);
  assert(map.plan(SPAWN,stage),`${sofa.id}: disconnected approach`);
  assert.equal(nearby_seat(stage,0,[map])?.id,sofa.id);
 }
});

test('removed lounge furniture leaves no invisible navigation or teleport barriers', () => {
 const maps=make_navigation_maps();
 for(const point of [[2.7,1.8],[-2.7,2.5],[2.7,-2.5],[-2.7,-1.8],[.8,1.3],[-.8,-1.3]]){
  assert(maps[0].free(point),point.join(','));
  assert(teleport_position([...point,0],maps),point.join(','));
 }
});
