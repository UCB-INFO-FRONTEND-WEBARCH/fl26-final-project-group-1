import * as THREE from 'three';

export class ShoulderCamera {
  constructor(camera, target) {
    this.camera = camera;
    this.target = target;
    this.distance = 2.6;
    this.obstacles = [];
    this.anchor = new THREE.Vector3();
    this.pivot = new THREE.Vector3();
    this.desired_position = new THREE.Vector3();
    this.previous_position = new THREE.Vector3();
    this.previous_target = new THREE.Vector3();
    this.hit = new THREE.Vector3();
    this.ray = new THREE.Ray();
    this.initialized = false;
  }

  add_obstacle(bounds) {
    // Leave space for the near plane, rather than moving the lens onto a surface.
    this.obstacles.push(bounds.clone().expandByScalar(0.14));
  }

  zoom(factor) {
    this.distance = THREE.MathUtils.clamp(this.distance * factor, 1.4, 4.5);
  }

  update(position, heading, seconds, snap = false) {
    this.previous_position.copy(this.camera.position);
    this.previous_target.copy(this.target);
    snap ||= !this.initialized || this.anchor.distanceToSquared(position) > 16;
    if (snap) {
      this.anchor.copy(position);
      this.heading = heading;
      this.initialized = true;
    } else {
      this.anchor.lerp(position, 1 - Math.exp(-12 * seconds));
      // Take the short turn across the -pi/pi boundary. Ignore body roll and pitch.
      const turn = Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading));
      this.heading += turn * (1 - Math.exp(-8 * seconds));
    }
    const forward_x = Math.cos(this.heading);
    const forward_y = Math.sin(this.heading);
    this.pivot.copy(this.anchor);
    this.pivot.z += 0.35;
    this.target.set(this.pivot.x + forward_x * 0.65, this.pivot.y + forward_y * 0.65, this.pivot.z);
    this.desired_position.set(
      this.anchor.x - forward_x * this.distance + forward_y * 0.55,
      this.anchor.y - forward_y * this.distance - forward_x * 0.55,
      this.anchor.z + 0.85,
    );
    this.ray.origin.copy(this.pivot);
    this.ray.direction.copy(this.desired_position).sub(this.pivot).normalize();
    let available = this.pivot.distanceTo(this.desired_position);
    for (const bounds of this.obstacles) {
      if (this.ray.intersectBox(bounds, this.hit)) {
        available = Math.min(available, this.pivot.distanceTo(this.hit));
      }
    }
    // Pull in immediately at an obstruction; ease back out when the path clears.
    this.arm_length = snap || available < this.arm_length ? available
      : THREE.MathUtils.lerp(this.arm_length, available, 1 - Math.exp(-6 * seconds));
    this.ray.at(Math.max(0.05, this.arm_length), this.camera.position);
    this.camera.lookAt(this.target);
    return this.previous_position.distanceToSquared(this.camera.position) > 1e-10 ||
      this.previous_target.distanceToSquared(this.target) > 1e-10;
  }
}
