import {spawnSync} from 'node:child_process';
const run=(args,map)=>{const r=spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,CENTORIA_MAP:map}});if(r.status!==0)process.exit(r.status||1);};
if(process.argv.includes('--simulation')){
 run(['scripts/verify_policy_fixtures.js'],'demo');run(['scripts/verify_simulation.js'],'demo');run(['scripts/verify_hephaestus.js'],'hephaestus');
 run(['scripts/verify_seating.js'],'demo');run(['scripts/verify_seating.js'],'hephaestus');
}else{run(['--test','tests/*.test.js'],'demo');run(['--test','tests/hephaestus/*.test.js'],'hephaestus');}
