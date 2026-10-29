import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import draco_module_url from 'three/addons/libs/draco/gltf/draco_wasm_wrapper.js?url';
import draco_wasm_url from 'three/addons/libs/draco/gltf/draco_decoder.wasm?url';

export function create_model_loader() {
  const draco = new DRACOLoader();
  draco.setDecoderPath({ js: draco_module_url, wasm: draco_wasm_url });
  draco.setWorkerLimit(1);
  return { draco, loader: new GLTFLoader().setDRACOLoader(draco) };
}

export function dispose_model(model) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  model.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    texture.source?.data?.close?.();
    texture.dispose();
  }
}
