import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { CharacterPose, VRM_TO_ROBOT } from './character_pose.js';
import { CHARACTER_ASSET } from './character_asset.js';
import { dispose_model } from './model_assets.js';

export async function load_character(rig, signal) {
  const response = await fetch(CHARACTER_ASSET.url, { signal });
  if (!response.ok) throw new Error(`Character download failed (HTTP ${response.status}).`);
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== CHARACTER_ASSET.sha256) throw new Error('The character file does not match its pinned version.');
  signal.throwIfAborted();
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(bytes, new URL('.', CHARACTER_ASSET.url).href);
  try {
    signal.throwIfAborted();
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('The character file has no VRM humanoid rig.');
    const pose = new CharacterPose(vrm.humanoid, rig, vrm.nodeConstraintManager);
    const object = new THREE.Group();
    object.quaternion.copy(VRM_TO_ROBOT);
    object.add(vrm.scene);
    object.traverse(node => {
      node.frustumCulled = false;
      if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; }
    });
    return { object, pose };
  } catch (error) {
    dispose_model(gltf.scene);
    throw error;
  }
}
