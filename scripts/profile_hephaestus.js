// Same seeded workload before/after: separate depth, inference and physical stepping.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import load_mujoco from '@mujoco/mujoco';
import * as ort from 'onnxruntime-web/wasm';
import {make_scene_xml} from '../src/scene_layout.js';
import {load_robot_files} from '../src/robot_assets.js';
import {Simulation} from '../src/simulation.js';
import {CONTROL_DECIMATION,PHYSICS_DT} from '../src/locomotion.js';

const options=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const mujoco=await load_mujoco({locateFile:()=>fileURLToPath(new URL('../node_modules/@mujoco/mujoco/mujoco.wasm',import.meta.url))});
const base=new URL('../public/assets/lite_pro/',import.meta.url);
await load_robot_files(mujoco,p=>readFile(new URL(p,base)));
const xml=options.xml?await readFile(options.xml,'utf8'):make_scene_xml();
const compile_start=performance.now();
mujoco.FS.writeFile('/robot/profile.xml',xml);
const model=mujoco.MjModel.from_xml_path('/robot/profile.xml');
if(!model)throw new Error('Profile model failed to compile');
const compile_ms=performance.now()-compile_start;
ort.env.wasm.numThreads=1;
ort.env.wasm.wasmPaths={wasm:new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',import.meta.url).href,mjs:new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',import.meta.url).href};
const session=await ort.InferenceSession.create(new Uint8Array(await readFile(new URL('policy.onnx',base))),{executionProviders:['wasm']});
let seed=7;
const sim=new Simulation(mujoco,model,session,null,()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;});
const depth=[],inference=[],cycle=[];
const cast=sim.policy.cast_depth.bind(sim.policy);
sim.policy.cast_depth=()=>{const start=performance.now();const image=cast();depth.push(performance.now()-start);return image;};
const summarize=values=>({mean:values.reduce((a,b)=>a+b,0)/values.length,p95:[...values].sort((a,b)=>a-b)[Math.floor(values.length*.95)]});
const rows=[];
for(const [name,command] of [['idle',[0,0,0]],['walking',[.6,0,0]]]){
 sim.reset();sim.command=command;
 await sim.advance(100);
 depth.length=inference.length=cycle.length=0;
 const started=performance.now(),first=sim.step_count;
 for(let i=0;i<200;i++){
  const start=performance.now();await sim.advance(CONTROL_DECIMATION);cycle.push(performance.now()-start);inference.push(sim.policy.inference_ms);
  if(sim.fallen)throw new Error(`Robot fell in ${name} benchmark`);
 }
 const wall_ms=performance.now()-started,seconds=(sim.step_count-first)*PHYSICS_DT;
 const row={name,simulated_seconds:seconds,wall_ms,rtf:seconds/(wall_ms/1000),cycle_ms:summarize(cycle),depth_ms:summarize(depth),inference_ms:summarize(inference),position:sim.telemetry().position};rows.push(row);console.log(JSON.stringify(row));
}
const report={node:process.version,geoms:model.ngeom,bodies:model.nbody,compile_ms,rows};
await mkdir('local_assets/hephaestus',{recursive:true});
await writeFile(options.output||'local_assets/hephaestus/profile.json',JSON.stringify(report,null,2));
sim.dispose();model.delete();await session.release();
