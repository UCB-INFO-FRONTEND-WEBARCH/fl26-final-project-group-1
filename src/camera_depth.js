/** Keep millimetre-scale seams resolvable in wide views without clipping the close shoulder camera. */
export function update_camera_depth(camera, target, mode) {
  const near = mode === 'shoulder' ? .05 :
    Math.max(.05, Math.min(5, camera.position.distanceTo(target) / 100));
  if (Math.abs(camera.near - near) < 1e-6) return false;
  camera.near = near;
  camera.updateProjectionMatrix();
  return true;
}
