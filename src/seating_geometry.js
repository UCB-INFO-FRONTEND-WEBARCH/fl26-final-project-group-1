import { SEATS } from './seating_layout.js';
import { SEATING_ASSETS } from './seating_assets.js';

/** The same unscaled, grounded catalog geometry used by the renderer, transformed into MuJoCo's world frame. */
export function seating_bodies() {
  return SEATS.flatMap(seat => {
    const c = Math.cos(seat.model_yaw), s = Math.sin(seat.model_yaw);
    return SEATING_ASSETS[seat.article].hulls.map((hull, index) => ({
      name: `seat_${seat.id}_${index}`, source: seat.id, role: 'furniture',
      vertices: hull.map(([x, y, z]) => [seat.position[0] + c * x - s * y,
        seat.position[1] + s * x + c * y, seat.position[2] + z]),
    }));
  });
}
