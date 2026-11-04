// All dimensions are metres, in the same Z-up frame as MuJoCo.
export const FLOOR_HEIGHT = 2.64;
export const STANDING_HEIGHT = 0.73;
export const FLOOR_NAMES = ['Ground floor', 'Upper floor'];
export const BUILDING_BOUNDS = [-12, 7, -7, 7];
export const ELEVATOR = {
  center: [-8.4, -2], landing: [-6.15, -2],
  size: [1.7, 1.7, 0.16], speed: 0.3,
  opening: [-9.3, -7.5, -2.9, -1.1],
};
export const STAIRS = {
  opening: [-11.8, -9.6, -5.4, 5.4], steps: 24,
  center_x: -10.7, lower_landing: [-10.7, -6.1], upper_landing: [-10.7, 6.1],
};

export function on_stairs(position, padding = 0) {
  const [left, right, bottom, top] = STAIRS.opening;
  return position[0] >= left - padding && position[0] <= right + padding && position[1] >= bottom - padding && position[1] <= top + padding;
}

export function stair_height(position) {
  const fraction = (position[1] - STAIRS.opening[2]) / (STAIRS.opening[3] - STAIRS.opening[2]);
  return Math.max(1, Math.min(STAIRS.steps, Math.floor(fraction * STAIRS.steps) + 1)) * FLOOR_HEIGHT / STAIRS.steps;
}

export function floor_of(position) {
  return Math.max(0, Math.min(1, Math.round((position[2] - STANDING_HEIGHT) / FLOOR_HEIGHT)));
}

export const STAIR_BOXES = Array.from({ length: STAIRS.steps }, (_, index) => {
  const height = (index + 1) * FLOOR_HEIGHT / STAIRS.steps;
  const tread = (STAIRS.opening[3] - STAIRS.opening[2]) / STAIRS.steps;
  return { name: `stair_${index}`, center: [STAIRS.center_x, STAIRS.opening[2] + (index + 0.5) * tread, height / 2],
    size: [STAIRS.opening[1] - STAIRS.opening[0], tread, height] };
});
export const STAIR_PATH = [[...STAIRS.lower_landing, 0],
  ...STAIR_BOXES.map(box => [box.center[0], box.center[1], box.size[2]]),
  [...STAIRS.upper_landing, FLOOR_HEIGHT]];
export const STAIR_RAIL_BOXES = STAIR_BOXES.flatMap((box, index) => [-1.14, 1.14].flatMap((offset, side) => [
  { name: `stair_rail_${index}_${side}`, center: [box.center[0] + offset, box.center[1], box.size[2] + 0.85], size: [0.06, box.size[1], 0.06] },
  ...((index % 5 === 0 || index === STAIRS.steps - 1) ? [{ name: `stair_post_${index}_${side}`,
    center: [box.center[0] + offset, box.center[1], box.size[2] + 0.425], size: [0.06, 0.06, 0.85] }] : []),
]));

export const SHAFT_BOXES = [
  { name: 'shaft_back', center: [-9.4, -2, 2.65], size: [0.12, 2.12, 5.3] },
  { name: 'shaft_south', center: [-8.4, -3, 2.65], size: [2.12, 0.12, 5.3] },
  { name: 'shaft_north', center: [-8.4, -1, 2.65], size: [2.12, 0.12, 5.3] },
];

// Split the upper slab around real openings, rather than drawing holes over a solid floor.
export function upper_slabs() {
  const holes = [STAIRS.opening, ELEVATOR.opening];
  const xs = [...new Set([BUILDING_BOUNDS[0], BUILDING_BOUNDS[1], ...holes.flatMap(hole => hole.slice(0, 2))])].sort((a, b) => a - b);
  const ys = [...new Set([BUILDING_BOUNDS[2], BUILDING_BOUNDS[3], ...holes.flatMap(hole => hole.slice(2))])].sort((a, b) => a - b);
  const slabs = [];
  for (let y = 0; y < ys.length - 1; y++) {
    for (let x = 0; x < xs.length - 1; x++) {
      const cx = (xs[x] + xs[x + 1]) / 2;
      const cy = (ys[y] + ys[y + 1]) / 2;
      if (holes.some(hole => cx > hole[0] && cx < hole[1] && cy > hole[2] && cy < hole[3])) continue;
      slabs.push({ center: [cx, cy, FLOOR_HEIGHT - 0.07], size: [xs[x + 1] - xs[x], ys[y + 1] - ys[y], 0.14] });
    }
  }
  return slabs;
}

export const LIFT_RAILS = [
  { name: 'back', center: [-0.81, 0, 0.55], size: [0.08, 1.7, 1.1] },
  { name: 'south', center: [0, -0.81, 0.55], size: [1.7, 0.08, 1.1] },
  { name: 'north', center: [0, 0.81, 0.55], size: [1.7, 0.08, 1.1] },
  { name: 'front', center: [0.81, 0, 0.55], size: [0.08, 1.7, 1.1] },
];

export function box_xml(box, prefix = '') {
  return `<geom name="${prefix}${box.name || 'slab'}" type="box" pos="${box.center.join(' ')}" size="${box.size.map(value => value / 2).join(' ')}" group="0"/>`;
}
