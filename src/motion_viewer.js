import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SITE_BASE } from './asset_paths.js';
import { STAIR_BOXES, STAIRS, FLOOR_HEIGHT } from './building.js';

async function read_asset(path, signal, binary = false) {
  const response = await fetch(`${SITE_BASE}assets/${path}`, { signal });
  if (!response.ok) throw new Error(`Could not load the motion recording (HTTP ${response.status}).`);
  return binary ? response.arrayBuffer() : response.json();
}

export class MotionViewer {
  constructor(container, depth_canvas, on_frame) {
    this.container = container;
    this.depth_canvas = depth_canvas;
    this.on_frame = on_frame;
    this.abort = new AbortController();
    this.playing = false;
    this.visible = false;
    this.time = 0;
    this.direction = 'up';
    this.meshes = [];
    this.cache = {};
    this.dirty = true;
    this.disposed = false;
    this.loop = time => this.render(time);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f2f4f7');
    this.scene.fog = new THREE.Fog('#f2f4f7', 12, 28);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.domElement.setAttribute('aria-label', 'Recorded Lite Pro policy motion on the apartment stairs. Drag to rotate the view.');
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(39, 1, 0.05, 60);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(3.8, -3.4, 2.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0.7);
    this.controls.update();
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.addEventListener('change', () => { this.dirty = true; this.wake(); });
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#6e829e', 1.8));
    const light = new THREE.DirectionalLight('#ffffff', 2);
    light.position.set(3, -5, 10);
    this.scene.add(light);
    const side_light = new THREE.DirectionalLight('#b9d7ff', 0.7);
    side_light.position.set(-4, 3, 5);
    this.scene.add(side_light);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    const stair_material = new THREE.MeshStandardMaterial({ color: '#d6dfe9', roughness: 0.85 });
    for (const box of STAIR_BOXES) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(...box.size), stair_material);
      step.position.set(box.center[0] - STAIRS.center_x, box.center[1], box.center[2]);
      this.world.add(step);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(step.geometry),
        new THREE.LineBasicMaterial({ color: '#a5b8ce', transparent: true, opacity: 0.35 }));
      edge.position.copy(step.position);
      this.world.add(edge);
    }
    for (const [y, z] of [[-8.4, -0.05], [8.4, FLOOR_HEIGHT - 0.05]]) {
      const landing = new THREE.Mesh(new THREE.BoxGeometry(5, 6, 0.1), stair_material);
      landing.position.set(0, y, z);
      this.world.add(landing);
    }
    this.robot = new THREE.Group();
    this.world.add(this.robot);
    this.next_rotation = new THREE.Quaternion();
    this.depth_context = depth_canvas.getContext('2d');
    this.depth_image = this.depth_context.createImageData(32, 18);
    this.resize_observer = new ResizeObserver(() => this.resize());
    this.resize_observer.observe(container);
    this.intersection = new IntersectionObserver(entries => {
      this.visible = entries[0].isIntersecting;
      this.wake();
    });
    this.intersection.observe(container);
    this.visibility_change = () => this.wake();
    document.addEventListener('visibilitychange', this.visibility_change);
    this.resize();
  }

  async load() {
    const signal = this.abort.signal;
    const [manifest, visuals, buffer] = await Promise.all([
      read_asset('explainer/motion.json', signal),
      read_asset('lite_pro/visuals.json', signal),
      read_asset('lite_pro/visuals.bin', signal, true),
    ]);
    if (this.disposed) return;
    this.manifest = manifest;
    for (const geom of manifest.geometries) {
      const mesh = visuals.meshes.find(item => item.mesh_id === geom.mesh_id);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(
        new Float32Array(buffer, mesh.position_offset, mesh.vertex_count * 3), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(
        new Float32Array(buffer, mesh.normal_offset, mesh.vertex_count * 3), 3));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer, mesh.index_offset, mesh.index_count), 1));
      const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(...geom.color), roughness: 0.48, metalness: 0.18 });
      const object = new THREE.Mesh(geometry, material);
      this.meshes.push(object);
      this.robot.add(object);
    }
    await this.select('up');
  }

  async select(direction) {
    this.direction = direction;
    this.clip = null;
    this.time = 0;
    this.on_frame({ loading: true, time: 0, duration: 0 });
    if (!this.cache[direction]) {
      this.cache[direction] = Promise.all([
        read_asset(`explainer/${direction}.poses.bin`, this.abort.signal, true),
        read_asset(`explainer/${direction}.depth.bin`, this.abort.signal, true),
      ]).then(([poses, depth]) => ({ ...this.manifest.clips[direction],
        poses: new Float32Array(poses), depth: new Uint8Array(depth) }));
    }
    const clip = await this.cache[direction];
    if (this.disposed || direction !== this.direction) return;
    this.clip = clip;
    this.on_frame({ loading: false, time: 0, duration: clip.duration });
    this.dirty = true;
    this.wake();
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.wake();
  }

  seek(time) {
    this.time = Math.max(0, Math.min(time, this.clip?.duration || 0));
    this.dirty = true;
    this.wake();
  }

  set_playing(playing) {
    this.playing = playing;
    this.wake();
  }

  wake() {
    if (this.disposed || this.pending || !this.visible || document.hidden) return;
    this.previous_time = 0;
    this.pending = requestAnimationFrame(this.loop);
  }

  render(now) {
    this.pending = 0;
    if (this.disposed || !this.visible || document.hidden) return;
    if (this.clip && this.playing) {
      if (this.previous_time) this.time = (this.time + Math.min((now - this.previous_time) / 1000, 0.1)) % this.clip.duration;
      this.dirty = true;
    }
    this.previous_time = now;
    if (this.clip && this.dirty) {
      const frame = this.time * this.manifest.fps;
      const first = Math.min(Math.floor(frame), this.clip.frames - 1);
      const second = Math.min(first + 1, this.clip.frames - 1);
      const fraction = frame - first;
      const stride = this.meshes.length * 7;
      const poses = this.clip.poses;
      this.meshes.forEach((mesh, index) => {
        const a = first * stride + index * 7;
        const b = second * stride + index * 7;
        mesh.position.set(poses[a] + (poses[b] - poses[a]) * fraction - STAIRS.center_x,
          poses[a + 1] + (poses[b + 1] - poses[a + 1]) * fraction,
          poses[a + 2] + (poses[b + 2] - poses[a + 2]) * fraction);
        mesh.quaternion.fromArray(poses, a + 3);
        this.next_rotation.fromArray(poses, b + 3);
        mesh.quaternion.slerp(this.next_rotation, fraction);
      });
      const roots = this.clip.roots;
      const y = roots[first * 3 + 1] + (roots[second * 3 + 1] - roots[first * 3 + 1]) * fraction;
      const z = roots[first * 3 + 2] + (roots[second * 3 + 2] - roots[first * 3 + 2]) * fraction;
      this.world.position.set(0, -y, 0.73 - z);
      for (let pixel = 0; pixel < 576; pixel++) {
        const value = this.clip.depth[first * 576 + pixel];
        this.depth_image.data.set([value, value, value, 255], pixel * 4);
      }
      this.depth_context.putImageData(this.depth_image, 0, 0);
      this.renderer.render(this.scene, this.camera);
      if (first !== this.last_reported_frame || !this.playing) {
        this.on_frame({ time: this.time, duration: this.clip.duration, loading: false });
        this.last_reported_frame = first;
      }
      this.dirty = false;
    } else if (this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
    if (this.playing && this.clip) this.pending = requestAnimationFrame(this.loop);
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    cancelAnimationFrame(this.pending);
    this.resize_observer.disconnect();
    this.intersection.disconnect();
    document.removeEventListener('visibilitychange', this.visibility_change);
    this.controls.dispose();
    const geometries = new Set();
    const materials = new Set();
    this.scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
