import * as THREE from 'three';

// A conservative torso/head capsule rotates with the pelvis, including during a get-up.
export function figure_opacity(camera, position, rotation) {
  const { x, y, z, w } = rotation;
  const up_x = 2 * (x * z + w * y), up_y = 2 * (y * z - w * x), up_z = 1 - 2 * (x * x + y * y);
  const dx = camera.x - position.x, dy = camera.y - position.y, dz = camera.z - position.z;
  const height = THREE.MathUtils.clamp(dx * up_x + dy * up_y + dz * up_z, -0.35, 0.6);
  const distance = Math.hypot(dx - up_x * height, dy - up_y * height, dz - up_z * height);
  return THREE.MathUtils.smoothstep(distance, 0.55, 1.15);
}

const VERTEX = `varying vec2 screen_uv;
void main() { screen_uv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const KERNEL = `
vec4 blur(sampler2D source, vec2 step_uv) {
  vec4 sum = sample_color(source, screen_uv) * 0.227027;
  sum += sample_color(source, screen_uv + step_uv * 1.384615) * 0.316216;
  sum += sample_color(source, screen_uv - step_uv * 1.384615) * 0.316216;
  sum += sample_color(source, screen_uv + step_uv * 3.230769) * 0.070270;
  sum += sample_color(source, screen_uv - step_uv * 3.230769) * 0.070270;
  return sum;
}`;

export class FigureFocus {
  constructor() {
    this.size = new THREE.Vector2();
  }

  initialize() {
    this.world = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    this.world.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.figure = this.world.clone();
    this.figure.samples = 0;
    this.blurred = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.horizontal = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { source: { value: this.figure.texture }, world_depth: { value: this.world.depthTexture },
        figure_depth: { value: this.figure.depthTexture }, step_uv: { value: new THREE.Vector2() } },
      vertexShader: VERTEX,
      fragmentShader: `varying vec2 screen_uv;
        uniform sampler2D source, world_depth, figure_depth;
        uniform vec2 step_uv;
        vec4 sample_color(sampler2D image, vec2 uv) {
          float visible = step(texture2D(figure_depth, uv).x, texture2D(world_depth, uv).x + 0.000001);
          return texture2D(image, uv) * visible;
        }
        ${KERNEL}
        void main() { gl_FragColor = blur(source, step_uv); }`,
    });
    this.composite = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { source: { value: this.blurred.texture }, world: { value: this.world.texture },
        step_uv: { value: new THREE.Vector2() }, opacity: { value: 1 } },
      vertexShader: VERTEX,
      fragmentShader: `varying vec2 screen_uv;
        uniform sampler2D source, world;
        uniform vec2 step_uv;
        uniform float opacity;
        vec4 sample_color(sampler2D image, vec2 uv) { return texture2D(image, uv); }
        ${KERNEL}
        void main() {
          vec4 figure = blur(source, step_uv) * opacity;
          gl_FragColor = vec4(figure.rgb + texture2D(world, screen_uv).rgb * (1.0 - figure.a), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.post_scene = new THREE.Scene();
    this.post_camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.horizontal);
    this.quad.frustumCulled = false;
    this.post_scene.add(this.quad);
  }

  async prepare(renderer, scene, camera, figures) {
    if (!this.world) this.initialize();
    const target = renderer.getRenderTarget();
    const pending = [];
    try {
      renderer.setRenderTarget(this.world);
      pending.push(renderer.compileAsync(scene, camera));
      this.quad.material = this.horizontal;
      renderer.setRenderTarget(this.blurred);
      pending.push(renderer.compileAsync(this.post_scene, this.post_camera));
      this.quad.material = this.composite;
      renderer.setRenderTarget(target);
      pending.push(renderer.compileAsync(this.post_scene, this.post_camera));
    } finally { renderer.setRenderTarget(target); }
    await Promise.all(pending);
    if (this.disposed) return;
    // Warm framebuffer allocation and first-use GPU state during loading, without changing the canvas.
    const auto_clear = renderer.autoClear;
    renderer.autoClear = false;
    this.composite.colorWrite = false;
    try { this.render(renderer, scene, camera, figures, 0.5); }
    finally { this.composite.colorWrite = true; renderer.autoClear = auto_clear; }
  }

  render(renderer, scene, camera, figures, opacity) {
    if (opacity === 1) { renderer.render(scene, camera); return; }
    const visibility = figures.map(figure => figure.visible);
    for (const figure of figures) figure.visible = false;
    if (opacity === 0) {
      try { renderer.render(scene, camera); }
      finally { figures.forEach((figure, index) => { figure.visible = visibility[index]; }); }
      return;
    }
    if (!this.world) this.initialize();
    renderer.getDrawingBufferSize(this.size);
    const width = this.size.x, height = this.size.y;
    if (this.world.width !== width || this.world.height !== height) {
      this.world.setSize(width, height);
      this.figure.setSize(Math.ceil(width / 2), Math.ceil(height / 2));
      this.blurred.setSize(this.figure.width, this.figure.height);
    }
    const target = renderer.getRenderTarget(), background = scene.background, layers = camera.layers.mask;
    const clear_color = renderer.getClearColor(new THREE.Color()), clear_alpha = renderer.getClearAlpha();
    const auto_reset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();
    try {
      renderer.setRenderTarget(this.world);
      renderer.render(scene, camera);
      figures.forEach((figure, index) => { figure.visible = visibility[index]; });
      camera.layers.set(1);
      scene.background = null;
      renderer.setClearColor(0, 0);
      renderer.setRenderTarget(this.figure);
      renderer.render(scene, camera);
      const radius = 1 + (1 - opacity) * 5;
      this.horizontal.uniforms.step_uv.value.set(radius / width, 0);
      this.quad.material = this.horizontal;
      renderer.setRenderTarget(this.blurred);
      renderer.render(this.post_scene, this.post_camera);
      this.composite.uniforms.step_uv.value.set(0, radius / height);
      this.composite.uniforms.opacity.value = opacity;
      this.quad.material = this.composite;
      renderer.setRenderTarget(target);
      renderer.render(this.post_scene, this.post_camera);
    } finally {
      figures.forEach((figure, index) => { figure.visible = visibility[index]; });
      camera.layers.mask = layers;
      scene.background = background;
      renderer.setClearColor(clear_color, clear_alpha);
      renderer.setRenderTarget(target);
      renderer.info.autoReset = auto_reset;
    }
  }

  dispose() {
    this.disposed = true;
    this.world?.dispose();
    this.figure?.dispose();
    this.blurred?.dispose();
    this.horizontal?.dispose();
    this.composite?.dispose();
    this.quad?.geometry.dispose();
  }
}
