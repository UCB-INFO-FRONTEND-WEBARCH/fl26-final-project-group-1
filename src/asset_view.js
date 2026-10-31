import * as THREE from 'three';
import { create_model_loader, dispose_model } from './model_assets.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';


export class AssetView {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D furniture preview');
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f5f5f7');
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(this.renderer);
    this.environment = generator.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.7;
    room.dispose();
    generator.dispose();
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b0b3bb', 1.2));
    const sunlight = new THREE.DirectionalLight('#ffffff', 1.9);
    sunlight.position.set(3, 6, 5);
    this.scene.add(sunlight);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.001, 1000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.51;
    this.controls.autoRotateSpeed = 1;
    this.size = new THREE.Vector3(1, 1, 1);
    this.target = new THREE.Vector3(0, 0.5, 0);
    this.mode = 'perspective';
    this.needs_render = true;
    this.decoding = false;
    const { loader, draco } = create_model_loader();
    this.loader = loader;
    this.draco = draco;
    this.resize_observer = new ResizeObserver(() => this.resize());
    this.resize_observer.observe(container);
    this.resize();
    this.set_camera('perspective');
    this.visibility_handler = () => {
      this.renderer.setAnimationLoop(document.hidden ? null : () => this.render());
      this.needs_render = true;
    };
    document.addEventListener('visibilitychange', this.visibility_handler);
    this.renderer.setAnimationLoop(() => this.render());
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5, Math.sqrt(1_000_000 / Math.max(width * height, 1))));
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(height, 1);
    this.set_camera(this.mode);
    this.needs_render = true;
  }

  async load(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Could not load this model (HTTP ${response.status}).`);
    const bytes = await response.arrayBuffer();
    signal.throwIfAborted();
    let model;
    this.decoding = true;
    try {
      model = await this.loader.parseAsync(bytes, new URL('.', new URL(url, location.href)).href);
    } finally {
      this.decoding = false;
      if (signal.aborted) this.draco.dispose();
    }
    if (signal.aborted) {
      dispose_model(model.scene);
      signal.throwIfAborted();
    }
    this.model = model.scene;
    const bounds = new THREE.Box3().setFromObject(this.model);
    const center = bounds.getCenter(new THREE.Vector3());
    bounds.getSize(this.size);
    this.model.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
    this.scene.add(this.model);
    this.target.set(0, this.size.y / 2, 0);
    const extent = Math.max(this.size.x, this.size.y, this.size.z, 0.1);
    const grid_size = Math.pow(10, Math.ceil(Math.log10(extent * 2)));
    this.grid = new THREE.GridHelper(grid_size, 20, '#c6c9d0', '#e1e3e8');
    this.grid.position.y = -0.002;
    this.scene.add(this.grid);
    this.set_camera('perspective');
    let triangles = 0;
    this.model.traverse((object) => {
      if (object.isMesh) triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    });
    return { size: this.size.toArray(), triangles: Math.round(triangles) };
  }

  set_camera(mode) {
    this.mode = mode;
    const extent = Math.max(this.size.x, this.size.y, this.size.z, 0.05);
    const half_fov = Math.min(THREE.MathUtils.degToRad(this.camera.fov) / 2,
      Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect));
    const distance = this.size.length() / 2 / Math.sin(half_fov) * 1.15;
    const direction = mode === 'front' ? new THREE.Vector3(0, 0.02, 1)
      : mode === 'top' ? new THREE.Vector3(0, 1, 0.001) : new THREE.Vector3(1, 0.65, 1.25);
    this.camera.position.copy(this.target).add(direction.normalize().multiplyScalar(distance));
    this.camera.near = Math.max(0.0001, extent / 1000);
    this.camera.far = Math.max(100, extent * 100);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.target);
    this.controls.minDistance = extent * 0.15;
    this.controls.maxDistance = extent * 10;
    this.controls.update();
    this.needs_render = true;
  }

  set_options({ wireframe, grid, rotate }) {
    this.controls.autoRotate = rotate;
    if (this.grid) this.grid.visible = grid;
    this.model?.traverse((object) => {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material) material.wireframe = wireframe;
      }
    });
    this.needs_render = true;
  }

  render() {
    const changed = this.controls.update();
    if (document.hidden || (!this.needs_render && !changed && !this.controls.autoRotate)) return;
    this.renderer.render(this.scene, this.camera);
    this.needs_render = false;
  }

  dispose() {
    document.removeEventListener('visibilitychange', this.visibility_handler);
    this.resize_observer.disconnect();
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    // Terminating an in-flight decode leaves its promise pending. load() releases it after decoding.
    if (!this.decoding) this.draco.dispose();
    dispose_model(this.scene);
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
