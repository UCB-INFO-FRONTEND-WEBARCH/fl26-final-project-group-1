import { IS_HEPHAESTUS, MAP } from './world.js';
import { FLOOR_HEIGHT } from './building.js';
import { SCENE_FURNITURE } from './furniture_layout.js';

// Anchor coordinates are measured on the unscaled catalog meshes after grounding in Z-up.
// The front support and the support under the hips both stay within the clip's trained height range.
export const SEATING_PRODUCTS = {
  '90434310': { name: 'ULRIKSBERG', kind: 'Armchair', front: [0, -0.265], yaw: -Math.PI / 2,
    height: 0.367, support_height: 0.332, width: 0.60, depth: 0.53,
    source: 'https://www.ikea.com/gb/en/p/ulriksberg-armchair-rattan-anthracite-90434310/' },
};

const placements = IS_HEPHAESTUS ? [
  { id: 'lounge_armchair', article: '90434310', front: [7, 0], yaw: Math.PI, floor: 0 },
  { id: 'reading_armchair', article: '90434310', front: [10, -3], yaw: Math.PI / 2, floor: 0 },
  { id: 'west_armchair', article: '90434310', front: [-20, -3], yaw: 0, floor: 0 },
  { id: 'mezzanine_armchair', article: '90434310', front: [-16, -3], yaw: 0, floor: 1 },
  { id: 'mezzanine_reading_armchair', article: '90434310', front: [-16, -5], yaw: 0, floor: 1 },
] : [
  { id: 'living_armchair', article: '90434310', front: [-2.6, -5.9], yaw: Math.PI / 2, floor: 0 },
  { id: 'upper_armchair', article: '90434310', front: [-2.6, -5.9], yaw: Math.PI / 2, floor: 1 },
];

const armchairs = placements.map(placement => {
  const product = SEATING_PRODUCTS[placement.article];
  const model_yaw = placement.yaw - product.yaw;
  const c = Math.cos(model_yaw), s = Math.sin(model_yaw);
  return { ...product, ...placement, name: placement.id, model_yaw,
    position: [placement.front[0] - c * product.front[0] + s * product.front[1],
      placement.front[1] - s * product.front[0] - c * product.front[1], placement.floor * FLOOR_HEIGHT],
    label: product.name };
});

// These sofas already exist in the room and have their own authored collision meshes.
// Seat heights exceed the clips' training range; each enabled anchor is checked with the real policy and contacts.
const sofa_anchors = [
  ['sofa_north', 'KIVIK sofa with chaise · Main lounge north', [.35, 2.599], -Math.PI / 2],
  ['sofa_south', 'KIVIK sofa with chaise · Main lounge south', [-.35, -2.599], Math.PI / 2],
  ['sofa_north_east', 'V20 / KIVIK north / east return', [2.5632, 1.8], Math.PI],
  ['sofa_north_west', 'V20 / KIVIK north / west return', [-2.5632, 2.5], 0],
  ['sofa_south_east', 'V20 / KIVIK south / east return', [2.5632, -2.5], Math.PI],
  ['sofa_south_west', 'V20 / KIVIK south / west return', [-2.5632, -1.8], 0],
];
const sofas = IS_HEPHAESTUS ? sofa_anchors.map(([id, prefix, front, yaw]) => {
  const item = MAP.furniture.find(item => item.name.startsWith(prefix));
  return { id, name: id, label: 'KIVIK', kind: 'Sofa', existing: true, front, yaw, floor: item.floor,
    height: .485, width: .75, depth: .53, staging: .5, precise_approach: true,
    bounds: item.bounds, collision_source: item.name, position: item.bounds[0] };
}) : SCENE_FURNITURE.filter(item => item.article === '39440593').map(item => ({
  id: `${item.name}_seat`, name: `${item.name}_seat`, label: 'KIVIK', kind: 'Sofa', existing: true,
  article: item.article, front: [item.position[0] + .4, item.position[1] - .46], yaw: -Math.PI / 2,
  floor: Math.round(item.position[2] / FLOOR_HEIGHT), height: .46, width: .75, depth: .53,
  staging: .75, precise_approach: true, collision_prefix: `${item.name}_`, position: item.position,
  bounds: [[item.position[0] - 1.15, item.position[1] - .48, item.position[2]],
    [item.position[0] + 1.15, item.position[1] + .48, item.position[2] + .85]],
}));

export const SEATS = [...armchairs, ...sofas];
export const SEAT = SEATS[0];
