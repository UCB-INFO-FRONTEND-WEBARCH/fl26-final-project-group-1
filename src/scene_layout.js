import { PHYSICS_DT } from './locomotion.js';
import { SCENE_FURNITURE } from './furniture_layout.js';
import { FURNITURE_ASSETS } from './furniture_assets.js';
import { FLOOR_HEIGHT, STANDING_HEIGHT, STAIR_BOXES, STAIR_RAIL_BOXES, SHAFT_BOXES, LIFT_RAILS, ELEVATOR, upper_slabs, box_xml } from './building.js';

export { SCENE_FURNITURE, FURNITURE_ASSETS };

// Metres, MuJoCo coordinates: +X forward, +Y left, +Z up.
export const SPAWN = [-4.7, -3.4, STANDING_HEIGHT];

export const SCENE_WALLS = [
  { name: 'north_wall', center: [-2.5, 6, 1.35], size: [19.3, 0.18, 2.7] },
  { name: 'south_wall', center: [-2.5, -6, 1.35], size: [19.3, 0.18, 2.7] },
  { name: 'east_wall', center: [7, 0, 1.35], size: [0.18, 12, 2.7] },
  { name: 'west_wall', center: [-12, 0, 1.35], size: [0.18, 12, 2.7] },
  { name: 'annex_south', center: [-7, -5.55, 1.35], size: [0.18, 0.9, 2.7] },
  { name: 'annex_between_entries', center: [-7, -3.05, 1.35], size: [0.18, 0.5, 2.7] },
  { name: 'annex_middle', center: [-7, 1.25, 1.35], size: [0.18, 4.1, 2.7] },
  { name: 'annex_north', center: [-7, 5.65, 1.35], size: [0.18, 0.7, 2.7] },
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
  const walls = [0, 1].flatMap(floor => SCENE_WALLS.map(wall => box_xml({ ...wall,
    center: [wall.center[0], wall.center[1], wall.center[2] + floor * FLOOR_HEIGHT] }, floor ? 'upper_' : ''))).join('\n');
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
      ${upper_slabs().map((slab, index) => box_xml({ ...slab, name: `upper_slab_${index}` })).join('\n')}
      ${[...STAIR_BOXES, ...STAIR_RAIL_BOXES, ...SHAFT_BOXES].map(box => box_xml(box)).join('\n')}
      ${[0, 1].map(floor => box_xml({ name: `lift_gate_${floor}`, center: [-7.48, -4.2, floor * FLOOR_HEIGHT + 0.8], size: [0.1, 1.72, 1.6] })).join('\n')}
      <body name="lift" pos="${ELEVATOR.center.join(' ')} 0" gravcomp="1">
        <joint name="lift_joint" type="slide" axis="0 0 1" range="0 ${FLOOR_HEIGHT}" damping="500"/>
        <geom name="lift_deck" type="box" pos="0 0 -0.08" size="0.85 0.85 0.08" mass="1000" friction="1 0.005 0.0001" group="3"/>
        ${LIFT_RAILS.map(rail => box_xml({ ...rail, name: `lift_rail_${rail.name}` })).join('\n')}
      </body>
    </worldbody>
    <contact><exclude body1="world" body2="lift"/></contact>
    <actuator><position name="lift_motor" joint="lift_joint" kp="80000" kv="18000" ctrlrange="0 ${FLOOR_HEIGHT}" forcerange="-100000 100000"/></actuator>
  </mujoco>`;
}
