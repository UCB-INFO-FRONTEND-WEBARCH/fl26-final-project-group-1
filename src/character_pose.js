// Direct joint-to-bone mapping from Lite-Motion-Retargeting site/app.js at 8a732d145917.
import * as THREE from 'three';

// VRM: Y up, +Z forward. Robot: Z up, +X forward.
export const VRM_TO_ROBOT = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0),
));
const ROBOT_TO_VRM = VRM_TO_ROBOT.clone().invert();

export const CHARACTER_BONES = {
  chest: ['waist_yaw', 'waist_roll', 'waist_pitch'],
  head: ['neck_yaw', 'neck_roll', 'neck_pitch'],
};
for (const side of ['left', 'right']) {
  CHARACTER_BONES[`${side}UpperLeg`] = [`${side}_hip_pitch`, `${side}_hip_roll`, `${side}_hip_yaw`];
  CHARACTER_BONES[`${side}LowerLeg`] = [`${side}_knee_pitch`];
  CHARACTER_BONES[`${side}Foot`] = [`${side}_ankle_yaw`, `${side}_ankle_pitch`, `${side}_ankle_roll`];
  CHARACTER_BONES[`${side}UpperArm`] = [`${side}_shoulder_pitch`, `${side}_shoulder_roll`, `${side}_shoulder_yaw`];
  CHARACTER_BONES[`${side}LowerArm`] = [`${side}_elbow_pitch`];
  CHARACTER_BONES[`${side}Hand`] = [`${side}_wrist_yaw`, `${side}_wrist_roll`, `${side}_wrist_pitch`];
}

export class CharacterPose {
  constructor(humanoid, rig, node_constraints) {
    this.humanoid = humanoid;
    this.node_constraints = node_constraints;
    this.hips = humanoid.getNormalizedBoneNode('hips');
    const indices = new Map(rig.joint_names.map((name, index) => [name, index]));
    const mapped = new Set();
    this.bones = Object.entries(CHARACTER_BONES).map(([name, chain]) => {
      const node = humanoid.getNormalizedBoneNode(name);
      if (!node) throw new Error(`The character rig is missing its ${name} bone.`);
      const turns = chain.map(joint => {
        const index = indices.get(joint);
        if (index === undefined) throw new Error(`The robot rig is missing joint ${joint}.`);
        mapped.add(index);
        return { index, axis: new THREE.Vector3(...rig.axes[index]).applyQuaternion(ROBOT_TO_VRM) };
      });
      return { node, turns };
    });
    if (mapped.size !== rig.joint_names.length) throw new Error('The character mapping must use every controlled joint.');
    const left = humanoid.getNormalizedBoneNode('leftUpperLeg').position;
    const right = humanoid.getNormalizedBoneNode('rightUpperLeg').position;
    const legs = left.clone().add(right).multiplyScalar(0.5).applyQuaternion(VRM_TO_ROBOT);
    this.offset = new THREE.Vector3(rig.hip_center[0] - legs.x, rig.hip_center[1] - legs.y,
      rig.sole + this.hips.position.y);
    this.root_rotation = new THREE.Quaternion();
    this.turn = new THREE.Quaternion();
    this.position = new THREE.Vector3();
  }

  update(pose) {
    for (const { node, turns } of this.bones) {
      node.quaternion.identity();
      for (const { index, axis } of turns) node.quaternion.multiply(this.turn.setFromAxisAngle(axis, pose[7 + index]));
    }
    this.root_rotation.set(pose[4], pose[5], pose[6], pose[3]).normalize();
    this.hips.quaternion.copy(ROBOT_TO_VRM).multiply(this.root_rotation).multiply(VRM_TO_ROBOT);
    this.position.fromArray(pose);
    this.hips.position.copy(this.offset).applyQuaternion(this.root_rotation).add(this.position).applyQuaternion(ROBOT_TO_VRM);
    // Copy normalized bone rotations to the skin. No IK, smoothing, or secondary animation.
    this.humanoid.update();
    // VRM twist bones are part of the skin binding, rather than extra motion.
    this.node_constraints?.update();
  }
}
