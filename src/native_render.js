import { FrontSide } from 'three';

const originals = new WeakMap();

/** Separate authored finish layers without moving the source geometry or changing collision surfaces. */
export function stabilize_native_surfaces(root) {
  const variants = new Map();
  root.traverse(object => {
    if (!object.isMesh) return;
    let owner = object;
    while (owner && !owner.userData.map_role) owner = owner.parent;
    const role = owner?.userData.map_role;
    const prepare = source => {
      // Imported furniture and foliage can contain intentional sheets and mirrored faces.
      if (role === 'furniture' || object.isInstancedMesh || source.transparent ||
        source.transmission > 0 || source.alphaTest > 0) return source;
      const name = source.name;
      const solid = /^(V1[34] ·|P6 · champagne frames|Architecture ·)/.test(name) &&
        !source.emissive?.getHex();
      const layer = role === 'floor' ? 1 :
        /honed limestone|warm buff brick|oiled oak skirting|champagne frames|solid oak tread/.test(name) ? 2 : 0;
      if (!solid && !layer) return source;
      if ((!solid || source.side === FrontSide) && (!layer || (source.polygonOffset &&
        source.polygonOffsetFactor === 0 && source.polygonOffsetUnits === -4 * layer))) return source;
      if (!variants.has(source)) variants.set(source, new Map());
      const key = `${solid}/${layer}`;
      const copies = variants.get(source);
      if (!copies.has(key)) {
        const material = source.clone();
        if (solid) material.side = FrontSide;
        if (layer) {
          material.polygonOffset = true;
          // Slope-scaled offsets can pull a wide floor through thin rugs and furniture.
          material.polygonOffsetFactor = 0;
          material.polygonOffsetUnits = -4 * layer;
        }
        copies.set(key, material);
      }
      return copies.get(key);
    };
    object.material = Array.isArray(object.material) ? object.material.map(prepare) : prepare(object.material);
  });
}

export function configure_native_materials(root, fast) {
  root.traverse(object => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!originals.has(material)) originals.set(material, {
        transmission: material.transmission,
        transparent: material.transparent,
        opacity: material.opacity,
        depthWrite: material.depthWrite,
        forceSinglePass: material.forceSinglePass,
      });
      const source = originals.get(material);
      // Thin glass in Fast uses one alpha pass. Quality restores the authored
      // physical transmission, which otherwise re-renders the whole apartment.
      const glass = fast && source.transmission > 0;
      if (source.transmission !== undefined) material.transmission = glass ? 0 : source.transmission;
      material.transparent = glass || source.transparent;
      material.opacity = glass ? Math.min(source.opacity, .22) : source.opacity;
      material.depthWrite = glass ? false : source.depthWrite;
      material.forceSinglePass = fast || source.forceSinglePass;
      material.needsUpdate = true;
    }
  });
}

export function freeze_native_transforms(root) {
  root.updateMatrixWorld(true);
  root.traverse(object => {
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
  });
}

export function plant_cells(placements, size = 8) {
  const cells = new Map();
  for (const placement of placements) {
    const key = [placement.matrix[0][3], placement.matrix[1][3]].map(v => Math.floor(v / size)).join('_');
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(placement);
  }
  return [...cells.values()];
}
