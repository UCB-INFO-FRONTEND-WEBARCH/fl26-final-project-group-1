// Metres, MuJoCo coordinates: +X forward, +Y left, +Z up.
export const SPAWN = [-4.7, -3.4, 0.793];

export const SCENE_BOXES = [
  { name: 'north_wall', center: [0, 6, 1.35], size: [14.3, 0.18, 2.7], kind: 'wall' },
  { name: 'south_wall', center: [0, -6, 1.35], size: [14.3, 0.18, 2.7], kind: 'wall' },
  { name: 'east_wall', center: [7, 0, 1.35], size: [0.18, 12, 2.7], kind: 'wall' },
  { name: 'west_wall', center: [-7, 0, 1.35], size: [0.18, 12, 2.7], kind: 'wall' },
  { name: 'partition_north', center: [1.4, 3.45, 1.35], size: [0.18, 5.1, 2.7], kind: 'wall' },
  { name: 'partition_south', center: [1.4, -3.45, 1.35], size: [0.18, 5.1, 2.7], kind: 'wall' },
  { name: 'study_wall_west', center: [2.75, 1.8, 1.35], size: [2.7, 0.18, 2.7], kind: 'wall' },
  { name: 'study_wall_east', center: [6.5, 1.8, 1.35], size: [1, 0.18, 2.7], kind: 'wall' },
  { name: 'sofa_base', center: [-4.4, 3.5, 0.28], size: [2.9, 1.05, 0.56], kind: 'sofa' },
  { name: 'sofa_back', center: [-4.4, 3.98, 0.65], size: [2.9, 0.2, 0.75], kind: 'sofa' },
  { name: 'sofa_arm_left', center: [-5.8, 3.5, 0.48], size: [0.2, 1.05, 0.85], kind: 'sofa' },
  { name: 'sofa_arm_right', center: [-3, 3.5, 0.48], size: [0.2, 1.05, 0.85], kind: 'sofa' },
  { name: 'coffee_table', center: [-4.2, 1.2, 0.27], size: [1.8, 0.95, 0.54], kind: 'table' },
  { name: 'media_console', center: [0.55, 3.65, 0.35], size: [0.6, 2.8, 0.7], kind: 'cabinet' },
  { name: 'entry_storage', center: [-6.45, -0.4, 0.65], size: [0.7, 1.8, 1.3], kind: 'cabinet' },
  { name: 'kitchen_counter', center: [4.4, -5.45, 0.46], size: [4.3, 0.9, 0.92], kind: 'cabinet' },
  { name: 'kitchen_island', center: [5.1, -2.45, 0.46], size: [1.3, 2.1, 0.92], kind: 'table' },
  { name: 'fridge', center: [6.35, -4.1, 0.96], size: [0.9, 1.05, 1.92], kind: 'cabinet' },
  { name: 'study_desk', center: [4.2, 5.2, 0.39], size: [2.8, 0.9, 0.78], kind: 'table' },
  { name: 'desk_chair', center: [4.3, 3.85, 0.25], size: [0.65, 0.65, 0.5], kind: 'sofa' },
  { name: 'chair_back', center: [4.3, 3.58, 0.62], size: [0.65, 0.15, 0.75], kind: 'sofa' },
  { name: 'bookshelf', center: [6.5, 4.65, 0.95], size: [0.65, 2.1, 1.9], kind: 'cabinet' },
];

export const ROOM_LABELS = [
  { name: 'LIVING ROOM', position: [-3.5, -0.7], number: '01' },
  { name: 'KITCHEN', position: [3.6, -0.8], number: '02' },
  { name: 'STUDY', position: [3.7, 2.5], number: '03' },
];

export function make_scene_xml() {
  const boxes = SCENE_BOXES.map(box => {
    const size = box.size.map(value => value / 2).join(' ');
    return `<geom name="${box.name}" type="box" pos="${box.center.join(' ')}" size="${size}"/>`;
  }).join('\n');
  return `<mujoco model="RoboPlay apartment">
    <include file="g1_12dof.xml"/>
    <option timestep="0.002" gravity="0 0 -9.81"/>
    <worldbody>
      <geom name="floor" type="plane" size="7 6 0.1" friction="1 0.005 0.0001"/>
      ${boxes}
    </worldbody>
  </mujoco>`;
}
