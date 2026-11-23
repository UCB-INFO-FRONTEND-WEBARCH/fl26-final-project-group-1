import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import load_mujoco from '@mujoco/mujoco';
import * as ort from 'onnxruntime-web/wasm';
import {make_scene_xml,SPAWN,SPAWN_YAW} from '../src/scene_layout.js';
import {Simulation} from '../src/simulation.js';
import {load_robot_files} from '../src/robot_assets.js';
import {make_navigation_maps} from '../src/path_planner.js';
import {MAP} from '../src/world.js';
import {PHYSICS_DT} from '../src/locomotion.js';
const base=new URL('../public/assets/lite_pro/',import.meta.url);
const mujoco=await load_mujoco({locateFile:()=>fileURLToPath(new URL('../node_modules/@mujoco/mujoco/mujoco.wasm',import.meta.url))});
await load_robot_files(mujoco,p=>readFile(new URL(p,base)));
console.log('Hephaestus: compile actual source-derived collision bodies');
mujoco.FS.writeFile('/robot/apartment.xml',make_scene_xml());const model=mujoco.MjModel.from_xml_path('/robot/apartment.xml');
assert(model,'MuJoCo rejected the map');
const state=new mujoco.MjData(model);mujoco.mj_forward(model,state);
const ray=(p,d)=>mujoco.mj_ray(model,state,p,d,[1,0,0,0,0,0],true,-1,new Int32Array(1),new Float64Array(3));
const carpet=ray([0,0,2],[0,0,-1]);assert(Math.abs(2-carpet-.0293)<.005,`Carpet floor mismatch ${carpet}`);
const void_ray=ray([0,0,5],[0,0,-1]);assert(Math.abs(5-void_ray-.0293)<.005,'Mezzanine void was filled by a convex floor hull');
const table=ray([-.8,1.315,1],[0,0,-1]);assert(Math.abs(1-table-.39335)<.025,`Table height mismatch ${table}`);
const glass=ray([0,7,1],[0,1,0]);assert(glass>.2&&glass<.35,`Glazing collider missing ${glass}`);
const upper=ray([-15,-2,5],[0,0,-1]);assert(Math.abs(5-upper-3.6)<.01,`Upper slab mismatch ${upper}`);
state.delete();
ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths={wasm:new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',import.meta.url).href,mjs:new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',import.meta.url).href};
const session=await ort.InferenceSession.create(new Uint8Array(await readFile(new URL('policy.onnx',base))),{executionProviders:['wasm']});
let seed=1;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
const maps=make_navigation_maps(),sim=new Simulation(mujoco,model,session,maps,random);const initial_pose=Array.from(sim.state.qpos.slice(0,7));const results={};
// Spatial body bounds must accelerate the existing surfaces, never simplify
// what the trained head camera sees. Compare all 1,296 rays at twelve poses.
mujoco.FS.writeFile('/robot/flat_reference.xml',make_scene_xml({spatial_cells:false}));
const reference_model=mujoco.MjModel.from_xml_path('/robot/flat_reference.xml');
assert.equal(reference_model.ngeom,model.ngeom);
const reference=new Simulation(mujoco,reference_model,session,null,random);
let depth_error=0;
for(const position of [SPAWN,[9,-3.7,.73],[-15,-2,4.33]])for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
 sim.reset(position,yaw);reference.reset(position,yaw);
 const actual=sim.policy.cast_depth(),expected=reference.policy.cast_depth();
 for(let i=0;i<actual.length;i++)depth_error=Math.max(depth_error,Math.abs(actual[i]-expected[i]));
}
assert(depth_error<1e-9,`Spatial grouping changed policy depth: ${depth_error}`);
reference.dispose();reference_model.delete();sim.reset();
console.log('Hephaestus: spatial depth parity',depth_error);
async function run(name,seconds,command,start=SPAWN,yaw=SPAWN_YAW){
 sim.reset(start,yaw);sim.command=command;let min=Infinity;const begin=performance.now();
 for(let i=0;i<seconds/PHYSICS_DT;i++){await sim.advance(1);min=Math.min(min,sim.state.qpos[2]);if(sim.fallen)break;}
 const result={...sim.telemetry(),min_height:min,wall_seconds:(performance.now()-begin)/1000};results[name]=result;console.log(name,JSON.stringify({position:result.position,fallen:result.fallen,min_height:min,wall_seconds:result.wall_seconds}));assert(!result.fallen,`${name}: robot fell`);return result;
}
console.log('Hephaestus: real policy standing on custom carpet');await run('idle',8,[0,0,0]);
console.log('Hephaestus: real policy walking the central aisle');const forward=await run('aisle_walk',8,[.6,0,0]);assert(SPAWN[0]-forward.position[0]>1.2,'Manual forward command did not move west');
console.log('Hephaestus: plan and follow a native-map destination');sim.reset();sim.navigation.set_goal(sim.state.qpos,[-1.5,0,0],0);assert.equal(sim.navigation.state.status,'walking',sim.navigation.state.message);
let max_tracking_y=0;for(let i=0;i<24/PHYSICS_DT;i++){await sim.advance(1);max_tracking_y=Math.max(max_tracking_y,Math.abs(sim.state.qpos[1]));if(sim.fallen||sim.navigation.state.status==='arrived')break;}
assert(max_tracking_y<.65,`Automatic route left central aisle: ${max_tracking_y}`);
assert(!sim.fallen,'Automatic aisle route fell');assert.equal(sim.navigation.state.status,'arrived',sim.navigation.state.message);results.automatic_aisle=sim.telemetry();
// Pause and reset must still work with a no-lift model and a source-normalized spawn.
sim.paused=true;const before=Array.from(sim.state.qpos);assert.equal(await sim.advance(20),0);assert.deepEqual(Array.from(sim.state.qpos),before);sim.paused=false;sim.reset();assert.deepEqual(Array.from(sim.state.qpos.slice(0,7)),initial_pose);assert.equal(sim.elevator,null);
const report={status:'PASS',map:MAP.id,source_sha256:MAP.source_sha256,geom_count:model.ngeom,body_count:model.nbody,spatial_depth_max_error:depth_error,ray_checks:{carpet,void_ray,table,glass,upper},results,limits:MAP.limits};await mkdir(new URL('../local_assets/hephaestus/',import.meta.url),{recursive:true});await writeFile(new URL('../local_assets/hephaestus/verification.json',import.meta.url),JSON.stringify(report,null,2));console.log('HEPHAESTUS_PHYSICS_PASS',model.ngeom);sim.dispose();model.delete();await session.release();
