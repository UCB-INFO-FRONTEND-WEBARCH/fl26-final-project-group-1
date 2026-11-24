import { FLOOR_HEIGHT, STANDING_HEIGHT } from './building.js';

export function teleport_position(goal, maps) {
  if (!Array.isArray(goal) || goal.length !== 3 || !goal.every(Number.isFinite)) return null;
  const [x, y, floor] = goal;
  if (![0, 1].includes(floor) || !maps?.[floor]?.free([x, y])) return null;
  return [x, y, floor * FLOOR_HEIGHT + STANDING_HEIGHT];
}
