import { IS_HEPHAESTUS, MAP } from './world.js';
// All dimensions are metres, in the same Z-up frame as MuJoCo.
export const FLOOR_HEIGHT = IS_HEPHAESTUS ? MAP.floor_height : 2.64;
export const STANDING_HEIGHT = 0.73;
export const FLOOR_NAMES = IS_HEPHAESTUS ? MAP.floor_names : ['Ground floor', 'Upper floor'];
export const BUILDING_BOUNDS = IS_HEPHAESTUS ? MAP.bounds : [-12, 7, -7, 7];
export const ELEVATOR = IS_HEPHAESTUS ? { enabled: false, center: [-1000, -1000], landing: [-1000, -1000], size: [0,0,0], opening: [-1001,-999,-1001,-999] } : {
  center: [-8.4, -2], landing: [-6.15, -2],
  size: [1.7, 1.7, 0.16], speed: 0.3,
  opening: [-9.3, -7.5, -2.9, -1.1],
};
export const STAIRS = IS_HEPHAESTUS ? { opening: [Math.min(...MAP.stair_regions.map(r=>r[0])), Math.max(...MAP.stair_regions.map(r=>r[1])), Math.min(...MAP.stair_regions.map(r=>r[2])), Math.max(...MAP.stair_regions.map(r=>r[3]))], steps: 20, center_x: MAP.stair_path[0][0], lower_landing: MAP.stair_path[0].slice(0,2), upper_landing: MAP.stair_path.at(-1).slice(0,2) } : {
  opening: [-11.8, -9.6, -5.4, 5.4], steps: 24,
  center_x: -10.7, lower_landing: [-10.7, -6.1], upper_landing: [-10.7, 6.1],
};

export function on_stairs(position, padding = 0) {
  if (IS_HEPHAESTUS) return MAP.stair_regions.some(([l,r,b,t]) => position[0]>=l-padding && position[0]<=r+padding && position[1]>=b-padding && position[1]<=t+padding);
  const [left, right, bottom, top] = STAIRS.opening;
  return position[0] >= left - padding && position[0] <= right + padding && position[1] >= bottom - padding && position[1] <= top + padding;
}

export function stair_height(position) {
  if (IS_HEPHAESTUS) {
    const candidates=MAP.steps.filter(s => point_in_ring(position,s.polygon));
    return candidates.length ? Math.max(...candidates.map(s=>s.height)) : stair_projection(position).point[2];
  }
  const fraction = (position[1] - STAIRS.opening[2]) / (STAIRS.opening[3] - STAIRS.opening[2]);
  return Math.max(1, Math.min(STAIRS.steps, Math.floor(fraction * STAIRS.steps) + 1)) * FLOOR_HEIGHT / STAIRS.steps;
}

export function floor_of(position) {
  return Math.max(0, Math.min(1, Math.round((position[2] - STANDING_HEIGHT) / FLOOR_HEIGHT)));
}

export const STAIR_BOXES = IS_HEPHAESTUS ? MAP.steps.map((s,i)=> { const xs=s.polygon.map(p=>p[0]),ys=s.polygon.map(p=>p[1]); const l=Math.min(...xs),r=Math.max(...xs),b=Math.min(...ys),t=Math.max(...ys); return {name:`stair_${i}`,center:[(l+r)/2,(b+t)/2,s.height-.09],size:[r-l,t-b,.18]}; }) : Array.from({ length: STAIRS.steps }, (_, index) => {
  const height = (index + 1) * FLOOR_HEIGHT / STAIRS.steps;
  const tread = (STAIRS.opening[3] - STAIRS.opening[2]) / STAIRS.steps;
  return { name: `stair_${index}`, center: [STAIRS.center_x, STAIRS.opening[2] + (index + 0.5) * tread, height / 2],
    size: [STAIRS.opening[1] - STAIRS.opening[0], tread, height] };
});
export const STAIR_PATH = IS_HEPHAESTUS ? MAP.stair_path : [[...STAIRS.lower_landing, 0],
  ...STAIR_BOXES.map(box => [box.center[0], box.center[1], box.size[2]]),
  [...STAIRS.upper_landing, FLOOR_HEIGHT]];
export const STAIR_RAIL_BOXES = IS_HEPHAESTUS ? [] : STAIR_BOXES.flatMap((box, index) => [-1.14, 1.14].flatMap((offset, side) => [
  { name: `stair_rail_${index}_${side}`, center: [box.center[0] + offset, box.center[1], box.size[2] + 0.85], size: [0.06, box.size[1], 0.06] },
  ...((index % 5 === 0 || index === STAIRS.steps - 1) ? [{ name: `stair_post_${index}_${side}`,
    center: [box.center[0] + offset, box.center[1], box.size[2] + 0.425], size: [0.06, 0.06, 0.85] }] : []),
]));

export const SHAFT_BOXES = IS_HEPHAESTUS ? [] : [
  { name: 'shaft_back', center: [-9.4, -2, 2.65], size: [0.12, 2.12, 5.3] },
  { name: 'shaft_south', center: [-8.4, -3, 2.65], size: [2.12, 0.12, 5.3] },
  { name: 'shaft_north', center: [-8.4, -1, 2.65], size: [2.12, 0.12, 5.3] },
];

// Split the upper slab around real openings, rather than drawing holes over a solid floor.
export function upper_slabs() {
  if (IS_HEPHAESTUS) return [];
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

export function box_xml(box, prefix = '', group = 0) {
  return `<geom name="${prefix}${box.name || 'slab'}" type="box" pos="${box.center.join(' ')}" size="${box.size.map(value => value / 2).join(' ')}" group="${group}"/>`;
}

// Geometry helpers are independent of the straight stair's old X/Y assumptions.
export function point_in_ring(p, ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if ((a[1]>p[1]) !== (b[1]>p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
export function stair_projection(position) {
  let result={distance:Infinity,progress:0,point:STAIR_PATH[0],index:0},travel=0;
  for(let i=1;i<STAIR_PATH.length;i++) {
    const a=STAIR_PATH[i-1],b=STAIR_PATH[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    const t=Math.max(0,Math.min(1,((position[0]-a[0])*dx+(position[1]-a[1])*dy)/(length*length)));
    const point=a.map((v,k)=>v+t*(b[k]-v));const distance=Math.hypot(position[0]-point[0],position[1]-point[1]);
    if(distance<result.distance) result={distance,point,progress:travel+t*length,index:i};
    travel+=length;
  }
  return result;
}
