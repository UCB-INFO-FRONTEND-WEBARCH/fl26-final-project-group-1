function smooth(value) { return value * value * (3 - 2 * value); }
function lerp(from, to, progress) { return from + (to - from) * progress; }
export const SATELLITE_STOP_IMAGES = [0, 1, 3];
// Keep Santa Clara inside the local-road lighting coverage; show twice the area width at Building K.
const STOP_SCOPE_SCALE = [1, 0.325, 2];

/** Keep aerial detail at up to 1.5x display scale without applying the 3D scene's 1MP cap. */
export function aerial_pixel_ratio(width, height, device_ratio = 1) {
  return Math.min(device_ratio, 1.5, Math.sqrt(4_000_000 / Math.max(width * height, 1)));
}

export function satellite_frame(manifest, level, progress, aspect) {
  const focus = manifest.target.focus;
  const span_at_stop = index => {
    const extent = index < SATELLITE_STOP_IMAGES.length
      ? manifest.images[SATELLITE_STOP_IMAGES[index]].extent * STOP_SCOPE_SCALE[index] : 36;
    const span = extent * 0.78 / Math.max(1, aspect);
    if (index !== 0) return span;
    // Use 80% of the previous regional scope after cropping to the available image.
    const image = manifest.images[0];
    const width = image.extent - Math.abs(focus[0] - image.center[0]) * 2;
    const height = image.extent - Math.abs(focus[1] - image.center[1]) * 2;
    return Math.min(span, width * 0.98 / aspect, height * 0.98) * 0.8;
  };
  const eased = smooth(progress);
  return {
    center: [...focus],
    span: Math.exp(lerp(Math.log(span_at_stop(level)), Math.log(span_at_stop(level + 1)), eased)),
    handoff: level >= 3 ? 1 : level === 2 ? smooth(Math.max(0, Math.min(1, (progress - 0.28) / 0.6))) : 0,
    cover: lerp([0.80, 0.60, 0, 0][level], [0.60, 0, 0, 0][level], eased),
  };
}
