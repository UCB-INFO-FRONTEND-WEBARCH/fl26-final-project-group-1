import { IS_HEPHAESTUS } from './world.js';
import { FLOOR_HEIGHT } from './building.js';

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

export const SEATS = placements.map(placement => {
  const product = SEATING_PRODUCTS[placement.article];
  const model_yaw = placement.yaw - product.yaw;
  const c = Math.cos(model_yaw), s = Math.sin(model_yaw);
  return { ...product, ...placement, name: placement.id, model_yaw,
    position: [placement.front[0] - c * product.front[0] + s * product.front[1],
      placement.front[1] - s * product.front[0] - c * product.front[1], placement.floor * FLOOR_HEIGHT],
    label: product.name };
});

export const SEAT = SEATS[0];
