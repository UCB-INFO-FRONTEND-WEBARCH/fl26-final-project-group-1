import * as THREE from 'three';
import { SITE_BASE } from './asset_paths.js';
import { MAP } from './world.js';

// These images are baked from V20's original procedural material graphs.
// World-space UVs keep the authored 180mm boards and 240x75mm brick courses.
export async function load_native_finishes(signal) {
  const loader=new THREE.TextureLoader(),textures={};
  try {
  for(const name of ['oak_color','oak_height','brick_color','brick_height']){
    const t=await loader.loadAsync(`${SITE_BASE}assets/hephaestus/${name}.png`);
    if(signal.aborted){t.dispose();signal.throwIfAborted();}
    t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;
    t.colorSpace=name.endsWith('color')?THREE.SRGBColorSpace:THREE.NoColorSpace;textures[name]=t;
  }
  return textures;
  } catch(error) {
    for(const texture of Object.values(textures))texture.dispose();
    throw error;
  }
}
export function apply_native_finishes(root,textures){
  root.updateMatrixWorld(true);
  root.traverse(mesh=>{
    if(!mesh.isMesh||Array.isArray(mesh.material))return;
    const m=mesh.material,name=m.name||'';
    const kind=name.includes('natural oak floor')?'oak':name.includes('warm buff brick')?'brick':null;
    if(!kind)return;
    const g=mesh.geometry=mesh.geometry.clone(),p=g.getAttribute('position'),n=g.getAttribute('normal'),uv=new Float32Array(p.count*2),origin=new THREE.Vector3(...MAP.origin),normal_matrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const v=new THREE.Vector3(),normal=new THREE.Vector3();
    for(let i=0;i<p.count;i++){
      v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld).add(origin);
      if(kind==='oak'){uv[i*2]=v.x/3.6;uv[i*2+1]=v.y/1.8;}
      else{normal.fromBufferAttribute(n,i).applyNormalMatrix(normal_matrix);uv[i*2]=(Math.abs(normal.x)>.5?v.y:v.x)/.96;uv[i*2+1]=v.z/1.2;}
    }
    g.setAttribute('uv',new THREE.BufferAttribute(uv,2));m.map=textures[kind+'_color'];m.bumpMap=textures[kind+'_height'];m.bumpScale=kind==='oak'?-.0008:-.002;m.color.setRGB(1,1,1);m.roughness=kind==='oak'?.48:.79;m.needsUpdate=true;
  });
}
