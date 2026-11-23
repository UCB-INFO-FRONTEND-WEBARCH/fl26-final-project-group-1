const originals = new WeakMap();

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
