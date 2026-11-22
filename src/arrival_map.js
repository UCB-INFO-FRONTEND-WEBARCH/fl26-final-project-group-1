import * as THREE from 'three';
import { dispose_model } from './model_assets.js';
import { satellite_frame } from './arrival_geography.js';

const QUAD_VERTEX = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MAP_FRAGMENT = `
uniform sampler2D uImages[4];
uniform vec3 uBounds[4];
uniform vec2 uCenter;
uniform vec2 uSpan;
uniform float uNight;
varying vec2 vUv;
vec4 sample_map(sampler2D image, vec3 bounds, vec2 world) {
  vec2 uv = (world - bounds.xy) / bounds.z + 0.5;
  float edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
  return vec4(texture2D(image, clamp(uv, 0.0, 1.0)).rgb, smoothstep(0.0, 0.05, edge));
}
void main() {
  vec2 world = uCenter + (vUv - 0.5) * uSpan;
  vec3 color = sample_map(uImages[0], uBounds[0], world).rgb;
  vec4 detail = sample_map(uImages[1], uBounds[1], world); color = mix(color, detail.rgb, detail.a);
  detail = sample_map(uImages[2], uBounds[2], world); color = mix(color, detail.rgb, detail.a);
  detail = sample_map(uImages[3], uBounds[3], world); color = mix(color, detail.rgb, detail.a);
  float gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
  vec3 day = mix(color, vec3(gray) * vec3(0.94, 1.0, 1.07), 0.14);
  vec3 night = color * vec3(0.095, 0.15, 0.28) + gray * vec3(0.008, 0.012, 0.025);
  gl_FragColor = vec4(mix(day, night, uNight), 1.0);
}`;

const LIGHT_VERTEX = `
uniform float uPixelsPerMeter;
varying float vStrength;
varying float vVisibility;
void main() {
  vStrength = position.z;
  // Reveal local roads only when their lights can resolve into separate points.
  float local_visibility = smoothstep(0.02, 0.08, uPixelsPerMeter);
  vVisibility = mix(local_visibility, 1.0, step(0.55, vStrength)) * min(1.0, uPixelsPerMeter * 25.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, 0.0, 1.0);
  gl_PointSize = clamp((10.0 + vStrength * 10.0) * uPixelsPerMeter, 3.0, 15.0);
}`;
const LIGHT_FRAGMENT = `
varying float vStrength;
varying float vVisibility;
void main() {
  float radius = length(gl_PointCoord - 0.5) * 2.0;
  float core = exp(-radius * radius * 24.0);
  float glow = exp(-radius * radius * 4.0) * 0.24;
  vec3 color = mix(vec3(1.0, 0.43, 0.10), vec3(1.0, 0.90, 0.62), core);
  gl_FragColor = vec4(color, (core + glow) * (0.4 + vStrength * 0.6) * vVisibility);
}`;

const CLOUD_FRAGMENT = `
uniform sampler2D uMap;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uNight;
uniform vec2 uCenter;
uniform vec2 uSpan;
uniform float uSpeed;
uniform float uCover;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 radial = (vUv - 0.5) * uSpeed * 0.009;
  vec3 color = (texture2D(uMap, vUv).rgb * 2.0 + texture2D(uMap, vUv + radial).rgb
    + texture2D(uMap, vUv - radial).rgb) * 0.25;
  // Wind moves in world metres, so cloud motion keeps the map's exact pan and zoom scale.
  vec2 world = uCenter + (vUv - 0.5) * uSpan;
  vec2 p = (world - vec2(450.0, 150.0) * uTime) / 36000.0 + vec2(0.31, 0.17);
  // Separate layer speeds and a moving flow field make the cloud edges curl and billow.
  vec2 billow = vec2(sin(p.y * 11.0 + uTime * 0.65), cos(p.x * 9.0 - uTime * 0.5)) * 0.028;
  vec2 broad_position = p + billow;
  float broad = texture2D(uNoise, broad_position).r;
  float detail = texture2D(uNoise, p * 2.7 + vec2(0.3, 0.7)
    + vec2(0.018, -0.014) * uTime - billow * 1.7).r;
  float density = broad * 0.70 + detail * 0.30;
  float shade = (texture2D(uNoise, broad_position + vec2(0.035, -0.045)).r - broad) * 2.8;
  float cloud = smoothstep(0.40, 0.65, density) * uCover;
  vec3 cloudColor = mix(vec3(0.72, 0.77, 0.84), vec3(0.095, 0.13, 0.205), uNight);
  cloudColor += shade * mix(0.22, 0.10, uNight);
  color = mix(color * (1.0 - cloud * 0.25), cloudColor, cloud);
  float vignette = dot(vUv - 0.5, vUv - 0.5);
  color *= 1.0 - vignette * 0.45;
  float grain = fract(sin(dot(gl_FragCoord.xy + floor(uTime * 12.0), vec2(12.9898, 78.233))) * 43758.5453);
  color += (grain - 0.5) * 0.007;
  gl_FragColor = vec4(color, uOpacity);
  #include <colorspace_fragment>
}`;

function smooth(value) { return value * value * (3 - 2 * value); }

function cloud_noise() {
  const size = 256;
  const pixels = new Uint8Array(size * size);
  const hash = (x, y) => {
    let value = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let value = 0;
      for (let octave = 0; octave < 6; octave++) {
        const period = 4 * 2 ** octave;
        const px = x / size * period, py = y / size * period;
        const ix = Math.floor(px), iy = Math.floor(py);
        const fx = smooth(px - ix), fy = smooth(py - iy);
        const a = THREE.MathUtils.lerp(hash(ix % period, iy % period), hash((ix + 1) % period, iy % period), fx);
        const b = THREE.MathUtils.lerp(hash(ix % period, (iy + 1) % period), hash((ix + 1) % period, (iy + 1) % period), fx);
        value += THREE.MathUtils.lerp(a, b, fy) * 0.5 ** (octave + 1);
      }
      pixels[y * size + x] = Math.round(value * 255);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RedFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class ArrivalMap {
  constructor() {
    this.scene = new THREE.Scene();
    this.composite = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.z = 1;
    this.screen_camera = new THREE.Camera();
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.noise = cloud_noise();
    this.size = new THREE.Vector2();
    this.time = 0;
    this.night = false;
    this.ready = false;
    this.textures = [];
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.map_material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX, fragmentShader: MAP_FRAGMENT, depthTest: false, depthWrite: false,
      uniforms: { uImages: { value: [] }, uBounds: { value: [] }, uCenter: { value: new THREE.Vector2() },
        uSpan: { value: new THREE.Vector2() }, uNight: { value: 0 } },
    });
    this.scene.add(new THREE.Mesh(this.geometry, this.map_material));
    this.cloud_material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX, fragmentShader: CLOUD_FRAGMENT, transparent: true,
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { uMap: { value: this.target.texture }, uNoise: { value: this.noise }, uTime: { value: 0 },
        uNight: { value: 0 }, uCenter: { value: new THREE.Vector2() },
        uSpan: { value: new THREE.Vector2() }, uSpeed: { value: 0 },
        uCover: { value: 0.8 }, uOpacity: { value: 1 } },
    });
    this.composite.add(new THREE.Mesh(this.geometry, this.cloud_material));
  }

  async load(base, signal) {
    const response = await fetch(`${base}manifest.json`, { signal });
    if (!response.ok) throw new Error('The satellite map could not load.');
    this.manifest = await response.json();
    await Promise.all(this.manifest.images.map(async (image, index) => {
      const response = await fetch(`${base}${image.file}`, { signal });
      if (!response.ok) throw new Error(`The ${image.label} image could not load.`);
      const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY' });
      if (signal.aborted) { bitmap.close(); signal.throwIfAborted(); }
      const texture = new THREE.Texture(bitmap);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      this.textures[index] = texture;
    }));
    const lights_response = await fetch(`${base}${this.manifest.lights.file}`, { signal });
    if (!lights_response.ok) throw new Error('The road lighting could not load.');
    const positions = new Float32Array(await lights_response.arrayBuffer());
    signal.throwIfAborted();
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.light_material = new THREE.ShaderMaterial({
      vertexShader: LIGHT_VERTEX, fragmentShader: LIGHT_FRAGMENT, transparent: true,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
      uniforms: { uPixelsPerMeter: { value: 1 } },
    });
    this.lights = new THREE.Points(geometry, this.light_material);
    this.lights.frustumCulled = false;
    this.lights.renderOrder = 1;
    this.scene.add(this.lights);
    this.map_material.uniforms.uImages.value = this.textures;
    this.map_material.uniforms.uBounds.value = this.manifest.images.map(image => new THREE.Vector3(...image.center, image.extent));
    this.ready = true;
  }

  render(renderer, scene, camera, arrival, seconds) {
    if (!this.ready || arrival.level >= 3) { renderer.render(scene, camera); return; }
    if (arrival.level === 2) renderer.render(scene, camera);
    else renderer.clear();
    const progress = arrival.moving ? Math.min(1, arrival.elapsed / Math.max(arrival.dive_seconds, 0.001)) : 0;
    renderer.getDrawingBufferSize(this.size);
    const aspect = this.size.x / this.size.y;
    const frame = satellite_frame(this.manifest, arrival.level, progress, aspect);
    const uniforms = this.map_material.uniforms;
    uniforms.uCenter.value.set(...frame.center);
    uniforms.uSpan.value.set(frame.span * aspect, frame.span);
    uniforms.uNight.value = this.night ? 1 : 0;
    this.lights.visible = this.night;
    this.light_material.uniforms.uPixelsPerMeter.value = this.size.y / frame.span;
    this.camera.left = -frame.span * aspect / 2;
    this.camera.right = frame.span * aspect / 2;
    this.camera.top = frame.span / 2;
    this.camera.bottom = -frame.span / 2;
    this.camera.position.set(...frame.center, 1);
    this.camera.updateProjectionMatrix();
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    this.time += seconds;
    const cloud = this.cloud_material.uniforms;
    cloud.uTime.value = this.time;
    cloud.uNight.value = this.night ? 1 : 0;
    cloud.uCenter.value.copy(uniforms.uCenter.value);
    cloud.uSpan.value.copy(uniforms.uSpan.value);
    cloud.uSpeed.value = arrival.moving ? Math.sin(progress * Math.PI) : 0;
    cloud.uCover.value = frame.cover;
    cloud.uOpacity.value = 1 - frame.handoff;
    renderer.autoClear = false;
    renderer.render(this.composite, this.screen_camera);
    renderer.autoClear = true;
  }

  dispose() {
    dispose_model(this.scene);
    dispose_model(this.composite);
    for (const texture of this.textures) {
      texture?.source.data.close();
      texture?.dispose();
    }
    this.target.dispose();
    this.noise.dispose();
  }
}
