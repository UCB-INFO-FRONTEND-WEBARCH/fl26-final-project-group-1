import * as THREE from 'three';
import { ARRIVAL_LEVELS, ARRIVAL_HOLD_SECONDS } from './arrival_levels.js';
export { ARRIVAL_LEVELS, ARRIVAL_HOLD_SECONDS };
const DIVE_SECONDS = 1.05;

export class ArrivalCamera {
  constructor(camera, target, origin, shoulder_position, shoulder_target, reduced_motion = false) {
    this.camera = camera;
    this.target = target;
    this.ready = false;
    this.level = 0;
    this.elapsed = 0;
    this.moving = false;
    this.done = false;
    this.dive_seconds = reduced_motion ? 0 : DIVE_SECONDS;
    this.points = ARRIVAL_LEVELS.map(level => ({
      position: origin.clone().add(new THREE.Vector3(...level.offset)), target: origin.clone(),
    }));
    this.points.push({ position: shoulder_position.clone(), target: shoulder_target.clone() });
    this.apply(0);
  }

  apply(progress) {
    const from = this.points[this.level];
    const to = this.points[this.level + 1];
    // A smooth stop at each altitude makes every pause distinct from the dive.
    const eased = progress * progress * (3 - 2 * progress);
    this.camera.position.lerpVectors(from.position, to.position, eased);
    this.target.lerpVectors(from.target, to.target, eased);
    const landing = this.level === ARRIVAL_LEVELS.length - 1 ? eased : 0;
    this.camera.up.set(0, 1 - landing, landing).normalize();
    this.camera.lookAt(this.target);
  }

  update(seconds) {
    if (this.done) return;
    // The first hold starts only after the complete aerial render is visible.
    if (this.level === 0 && !this.ready) return;
    this.elapsed += seconds;
    if (!this.moving) {
      if (this.elapsed < ARRIVAL_HOLD_SECONDS) return;
      this.moving = true;
      this.elapsed = 0;
    } else {
      this.apply(this.dive_seconds ? Math.min(1, this.elapsed / this.dive_seconds) : 1);
      if (this.elapsed < this.dive_seconds) return;
      this.level++;
      this.elapsed = 0;
      this.moving = false;
      this.done = this.level === ARRIVAL_LEVELS.length;
    }
  }
}
