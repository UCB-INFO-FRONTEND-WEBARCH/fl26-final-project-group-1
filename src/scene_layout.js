import { PHYSICS_DT } from './locomotion.js';
import { SCENE_FURNITURE } from './furniture_layout.js';
import { FURNITURE_ASSETS } from './furniture_assets.js';

export { SCENE_FURNITURE, FURNITURE_ASSETS };

// Metres, MuJoCo coordinates: +X forward, +Y left, +Z up.
export const SPAWN = [-4.7, -3.4, 0.793];

export const SCENE_WALLS = [
  { name: 'north_wall', center: [0, 6, 1.35], size: [14.3, 0.18, 2.7] },
  { name: 'south_wall', center: [0, -6, 1.35], size: [14.3, 0.18, 2.7] },
  { name: 'east_wall', center: [7, 0, 1.35], size: [0.18, 12, 2.7] },
  { name: 'west_wall', center: [-7, 0, 1.35], size: [0.18, 12, 2.7] },
  { name: 'partition_north', center: [1.4, 3.45, 1.35], size: [0.18, 5.1, 2.7] },
  { name: 'partition_south', center: [1.4, -3.45, 1.35], size: [0.18, 5.1, 2.7] },
  { name: 'study_wall_west', center: [2.75, 1.8, 1.35], size: [2.7, 0.18, 2.7] },
  { name: 'study_wall_east', center: [6.5, 1.8, 1.35], size: [1, 0.18, 2.7] },
];

export const ROOM_LABELS = [
  { name: 'LIVING ROOM', position: [-3.5, -0.7], number: '01' },
  { name: 'KITCHEN', position: [3.6, -0.8], number: '02' },
  { name: 'STUDY', position: [3.7, 2.5], number: '03' },
];

export function make_scene_xml() {
  const walls = SCENE_WALLS.map((wall) =>
    `<geom name="${wall.name}" type="box" pos="${wall.center.join(' ')}" size="${wall.size.map((value) => value / 2).join(' ')}"/>`,
  ).join('\n');
  const meshes = Object.entries(FURNITURE_ASSETS).flatMap(([article, asset]) =>
    asset.hulls.map((vertices, index) =>
      `<mesh name="ikea_${article}_${index}" vertex="${vertices.flat().join(' ')}"/>`),
  ).join('\n');
  const furniture = SCENE_FURNITURE.map((item) => {
    const geoms = FURNITURE_ASSETS[item.article].hulls.map((_, index) =>
      `<geom name="${item.name}_collision_${index}" type="mesh" mesh="ikea_${item.article}_${index}" group="3" density="0" friction="0.8 0.005 0.0001" margin="0.001"/>`,
    ).join('\n');
    return `<body name="${item.name}" pos="${item.position.join(' ')}" euler="0 0 ${item.yaw}">${geoms}</body>`;
  }).join('\n');
  return `<mujoco model="RoboPlay IKEA apartment">
    <include file="g1_12dof.xml"/>
    <option timestep="${PHYSICS_DT}" gravity="0 0 -9.81"/>
    <asset>${meshes}</asset>
    <worldbody>
      <geom name="floor" type="plane" size="7 6 0.1" friction="1 0.005 0.0001"/>
      ${walls}
      ${furniture}
    </worldbody>
  </mujoco>`;
}
