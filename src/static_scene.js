import { WALKABLE_GROUP } from './geom_groups.js';
// Fixed bodies give MuJoCo short-range depth rays useful body bounds. Keeping
// every hull in worldbody forces every ray to scan the entire apartment.
/** Floors, stairs and rugs are walkable, which the elevation map sees; everything else stays in group 0. */
export function hull_group(hull) {
  return hull.role === 'floor' || hull.role === 'stairs' || /\brug\b/i.test(hull.source ?? '') ? WALKABLE_GROUP : 0;
}

export function static_world_xml(physics, cell_size = 4) {
  const cells = new Map();
  for (const hull of physics) {
    const center = [0, 1, 2].map(axis => {
      const values = hull.vertices.map(v => v[axis]);
      return (Math.min(...values) + Math.max(...values)) / 2;
    });
    const key = center.map(value => Math.floor(value / cell_size)).join('_');
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(`<geom name="${hull.name}" type="mesh" mesh="${hull.name}" group="${hull_group(hull)}" density="0" friction="0.9 0.005 0.0001" margin="0"/>`);
  }
  // Bodies have no joints or transforms: contacts and ray surfaces stay exactly
  // where they were authored. All are welded to world, so no static/static pairs.
  return [...cells].map(([key, geoms]) => `<body name="map_cell_${key}">${geoms.join('\n')}</body>`).join('\n');
}
