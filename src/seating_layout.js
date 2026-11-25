import { IS_HEPHAESTUS } from './world.js';
import { FLOOR_HEIGHT } from './building.js';

// Anchor coordinates are measured in runtime metres after grounding in Z-up and applying the stated model scale.
// The front support and the support under the hips both stay within the clip's trained height range.
export const SEATING_PRODUCTS = {
  '90434310': { name: 'ULRIKSBERG', kind: 'Armchair', front: [0, -0.265], yaw: -Math.PI / 2,
    height: 0.367, support_height: 0.332, width: 0.60, depth: 0.53,
    source: 'https://www.ikea.com/gb/en/p/ulriksberg-armchair-rattan-anthracite-90434310/' },
  '69499704': { name: 'KIVIK', kind: 'Sofa', front: [.36, -.336], yaw: -Math.PI / 2,
    height: .35, support_height: .35, width: .5, depth: .5, scale: .8,
    source: 'https://www.ikea.com/us/en/p/kivik-sofa-gunnared-blue-s69499704/' },
};

const placements = IS_HEPHAESTUS ? [
  { id: 'lounge_armchair', article: '90434310', front: [7, 0], yaw: Math.PI, floor: 0 },
  { id: 'reading_armchair', article: '90434310', front: [10, -3], yaw: Math.PI / 2, floor: 0 },
  { id: 'west_armchair', article: '90434310', front: [-20, -3], yaw: 0, floor: 0 },
  { id: 'mezzanine_armchair', article: '90434310', front: [-16, -3], yaw: 0, floor: 1 },
  { id: 'mezzanine_reading_armchair', article: '90434310', front: [-16, -5], yaw: 0, floor: 1 },
  // Sofa feet rest on the source carpet, whose top is 28.8 mm above the slab.
  { id: 'sofa_north', article: '69499704', front: [.51, 2.7], yaw: -Math.PI / 2, floor: 0, floor_z: .0288 },
  { id: 'sofa_south', article: '69499704', front: [-.51, -2.7], yaw: Math.PI / 2, floor: 0, floor_z: .0288 },
] : [
  { id: 'living_armchair', article: '90434310', front: [-2.6, -5.9], yaw: Math.PI / 2, floor: 0 },
  { id: 'upper_armchair', article: '90434310', front: [-2.6, -5.9], yaw: Math.PI / 2, floor: 1 },
];

export const SEATS = placements.map(placement => {
  const product = SEATING_PRODUCTS[placement.article];
  const model_yaw = placement.yaw - product.yaw;
  const c = Math.cos(model_yaw), s = Math.sin(model_yaw);
  return { ...product, ...placement, name: placement.id, model_yaw,
    position: [placement.front[0] - c * product.front[0] + s * product.front[1],
      placement.front[1] - s * product.front[0] - c * product.front[1], placement.floor_z ?? placement.floor * FLOOR_HEIGHT],
    label: product.name };
});

export const SEAT = SEATS[0];
