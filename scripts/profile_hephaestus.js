// Same seeded workload before/after: separate the elevation map, inference and physical stepping.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import load_mujoco from '@mujoco/mujoco';
import {make_scene_xml} from '../src/scene_layout.js';
import {load_robot_files} from '../src/robot_assets.js';
import {Simulation} from '../src/simulation.js';
import {CONTROL_DECIMATION,PHYSICS_DT} from '../src/locomotion.js';
import {MODE} from '../src/robot_controller.js';
import {load_policies,release_policies,seeded_random} from './load_policies.js';

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
const policies=await load_policies();
const sim=new Simulation(mujoco,model,policies,null,seeded_random(7));
const map_ms=[],inference=[],cycle=[];
const elevation=sim.controller.policies.walk_stairs?.map;
if(elevation){const sense=elevation.sense.bind(elevation);elevation.sense=state=>{const start=performance.now();const heights=sense(state);map_ms.push(performance.now()-start);return heights;};}
const summarize=values=>({mean:values.reduce((a,b)=>a+b,0)/values.length,p95:[...values].sort((a,b)=>a-b)[Math.floor(values.length*.95)]});
const rows=[];
for(const [name,command] of [['idle',[0,0,0]],['walking',[.6,0,0]]]){
 sim.reset();sim.command=command;
 await sim.advance(100);
 map_ms.length=inference.length=cycle.length=0;
 const started=performance.now(),first=sim.step_count;
 for(let i=0;i<200;i++){
  const start=performance.now();await sim.advance(CONTROL_DECIMATION);cycle.push(performance.now()-start);inference.push(sim.controller.inference_ms);
  if(sim.fallen||sim.mode!==MODE.WALK)throw new Error(`Robot fell in ${name} benchmark`);
 }
 const wall_ms=performance.now()-started,seconds=(sim.step_count-first)*PHYSICS_DT;
 const row={name,simulated_seconds:seconds,wall_ms,rtf:seconds/(wall_ms/1000),cycle_ms:summarize(cycle),map_ms:summarize(map_ms),inference_ms:summarize(inference),position:sim.telemetry().position};rows.push(row);console.log(JSON.stringify(row));
}
const report={node:process.version,geoms:model.ngeom,bodies:model.nbody,compile_ms,rows};
await mkdir('local_assets/hephaestus',{recursive:true});
await writeFile(options.output||'local_assets/hephaestus/profile.json',JSON.stringify(report,null,2));
sim.dispose();model.delete();await release_policies(policies);
