import test from 'node:test';
import assert from 'node:assert/strict';
import { RobotController, MODE } from '../src/robot_controller.js';
import { WALKABLE_GROUP } from '../src/geom_groups.js';

function standing_controller() {
  return Object.assign(Object.create(RobotController.prototype), {
    mode:MODE.STAND_UP, mode_time:0, stand_time:0, still_time:0, done_time:0, root_height:.77,
    reference:{frame:70,last_frame:94,done:false}, body:{root_qvel:0},
    state:{qvel:new Float64Array(6)}, feet_grounded:()=>true, at_rest:()=>false,
    resume_walking() { this.mode = MODE.WALK; },
  });
}
const upright = {height:.75, upright:.99};

test('standing can transfer to walking before the clip ends, after sustained ground support', () => {
  const controller = standing_controller();
  for (let i=0;i<6;i++) controller.update_mode(upright,.02);
  assert.equal(controller.mode, MODE.STAND_UP);
  controller.update_mode(upright,.02);
  assert.equal(controller.mode, MODE.WALK);
});

test('the early handoff rejects an early clip phase, absent foot support, and vertical motion', () => {
  for (const configure of [c=>{c.reference.frame=30;}, c=>{c.feet_grounded=()=>false;}, c=>{c.state.qvel[2]=.7;}]) {
    const controller = standing_controller(); configure(controller);
    for (let i=0;i<20;i++) controller.update_mode(upright,.02);
    assert.equal(controller.mode, MODE.STAND_UP);
  }
});

test('feet on furniture do not count as feet on the walkable floor', () => {
  const controller = Object.assign(Object.create(RobotController.prototype), {
    foot_sides:new Map([[8,1],[9,2]]), model:{geom_group:[WALKABLE_GROUP,0]}, state:{},
  });
  for (const [pairs,expected] of [[[[0,8],[0,9]],true], [[[0,8],[1,9]],false], [[],false]]) {
    controller.state.ncon=pairs.length;
    controller.state.contact={get:i=>({geom1:pairs[i][0],geom2:pairs[i][1],delete(){}})};
    assert.equal(controller.feet_grounded(),expected);
  }
});

test('walking starts with measured body velocity without changing the robot pose', () => {
  const controller = Object.assign(Object.create(RobotController.prototype), {
    body:{root_qvel:0}, state:{qvel:Float64Array.from([0,.6,0,0,0,.1]),qpos:Float64Array.from([1,2,.75])},
    root_pose:()=>[1,2,Math.PI/2], reference:{}, switch_between_steps(mode){this.mode=mode;},
  });
  controller.resume_walking();
  assert.equal(controller.mode,MODE.WALK);
  assert.equal(controller.reference,null);
  assert.ok(Math.abs(controller.command[0]-.6)<1e-10);
  assert.ok(Math.abs(controller.command[1])<1e-10);
  assert.deepEqual(Array.from(controller.state.qpos),[1,2,.75]);
});
