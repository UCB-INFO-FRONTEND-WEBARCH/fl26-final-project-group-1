import { SEATS } from './seating_layout.js';
import { SEATING_ASSETS } from './seating_assets.js';

/** The same unscaled, grounded catalog geometry used by the renderer, transformed into MuJoCo's world frame. */
export function seating_bodies() {
  return SEATS.filter(seat => !seat.existing).flatMap(seat => {
    const c = Math.cos(seat.model_yaw), s = Math.sin(seat.model_yaw);
    const components = seat.components ?? [{article:seat.article, offset:[0,0,0]}];
    return components.flatMap((component, part) => {
      const cp = Math.cos(component.pitch ?? 0), sp = Math.sin(component.pitch ?? 0);
      return SEATING_ASSETS[component.article].hulls.map((hull, index) => ({
        name: `seat_${seat.id}_${part}_${index}`, source: seat.id, role: 'furniture',
        vertices: hull.map(([x, y, z]) => {
          const px = x + component.offset[0], py = cp * y - sp * z + component.offset[1];
          return [seat.position[0] + c * px - s * py, seat.position[1] + s * px + c * py,
            seat.position[2] + sp * y + cp * z + component.offset[2]];
        }),
      }));
    });
  });
}
