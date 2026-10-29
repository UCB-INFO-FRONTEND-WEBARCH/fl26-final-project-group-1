import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { create_model_loader, dispose_model } from './model_assets.js';
import { IKEA_BASE, model_path } from './asset_paths.js';
import { SCENE_WALLS, SCENE_FURNITURE, FURNITURE_ASSETS, ROOM_LABELS, SPAWN } from './scene_layout.js';

function floor_label(text, width, color = '#85858d') {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 1024, 128);
  context.fillStyle = color;
  context.font = '500 52px monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 512, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width / 8),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
}

export class SceneView {
  constructor(container, on_metrics) {
    this.container = container;
    this.on_metrics = on_metrics;
    this.render_samples = [];
    this.needs_render = true;
    this.paused = false;
    this.quality = 'performance';
    this.furniture_abort = new AbortController();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f5f5f7');
    this.scene.fog = new THREE.Fog('#f5f5f7', 23, 48);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D apartment with Unitree G1 robot');
    this.renderer.domElement.setAttribute('tabindex', '0');
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(44, 1, 0.05, 100);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 28;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.robot_position = new THREE.Vector3(...SPAWN);
    this.last_follow_position = this.robot_position.clone();
    this.robot_meshes = [];
    this.follow_delta = new THREE.Vector3();
    this.mode = 'follow';
    this.trail_count = 0;
    this.trail_positions = new Float32Array(1500 * 3);
    const trail_geometry = new THREE.BufferGeometry();
    trail_geometry.setAttribute('position', new THREE.BufferAttribute(this.trail_positions, 3).setUsage(THREE.DynamicDrawUsage));
    trail_geometry.setDrawRange(0, 0);
    this.trail = new THREE.Line(trail_geometry,
      new THREE.LineBasicMaterial({ color: '#0071e3', transparent: true, opacity: 0.5 }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    this.build_room();
    this.set_camera('follow');
    this.resize_observer = new ResizeObserver(() => this.resize());
    this.resize_observer.observe(container);
    this.resize();
    this.last_fps_time = performance.now();
    this.renderer.setAnimationLoop(time => this.render(time));
    this.visibility_handler = () => {
      this.renderer.setAnimationLoop(document.hidden ? null : time => this.render(time));
      this.needs_render = true;
      this.last_fps_time = performance.now();
      this.render_samples = [];
    };
    document.addEventListener('visibilitychange', this.visibility_handler);
  }

  build_room() {
    const static_geometries = [];
    const edge_geometries = [];
    function add_box(center, size, color, edges = true) {
      const geometry = new THREE.BoxGeometry(...size);
      geometry.translate(...center);
      const vertex_color = new THREE.Color(color);
      const colors = new Float32Array(geometry.getAttribute('position').count * 3);
      for (let offset = 0; offset < colors.length; offset += 3) vertex_color.toArray(colors, offset);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      static_geometries.push(geometry);
      if (edges) edge_geometries.push(new THREE.EdgesGeometry(geometry));
    }

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b0b3bb', 2));
    const sunlight = new THREE.DirectionalLight('#ffffff', 2);
    this.sunlight = sunlight;
    sunlight.position.set(-3, -6, 14);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    Object.assign(sunlight.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 0.5, far: 35 });
    sunlight.shadow.normalBias = 0.025;
    sunlight.shadow.bias = -0.0001;
    this.scene.add(sunlight);
    add_box([0, 0, -0.16], [14.25, 12.25, 0.28], '#c9cbd0');
    add_box([-2.8, 0, -0.015], [8.4, 12, 0.03], '#eeeff1', false);
    add_box([4.2, -2.1, -0.012], [5.6, 7.8, 0.03], '#e2e6ec', false);
    add_box([4.2, 3.9, -0.012], [5.6, 4.2, 0.03], '#eae9e7', false);

    const grid_positions = [];
    for (let x = -7; x <= 7; x++) grid_positions.push(x, -6, 0.008, x, 6, 0.008);
    for (let y = -6; y <= 6; y++) grid_positions.push(-7, y, 0.008, 7, y, 0.008);
    const grid_geometry = new THREE.BufferGeometry();
    grid_geometry.setAttribute('position', new THREE.Float32BufferAttribute(grid_positions, 3));
    this.scene.add(new THREE.LineSegments(grid_geometry,
      new THREE.LineBasicMaterial({ color: '#9a9da7', transparent: true, opacity: 0.14 })));

    for (const box of SCENE_WALLS) {
      const center = [...box.center];
      const size = [...box.size];
      // Cutaway walls expose the interior; physics keeps their full 2.7 m height.
      size[2] = ['south_wall', 'west_wall'].includes(box.name) ? 0.26 : 0.85;
      center[2] = size[2] / 2;
      add_box(center, size, '#c7c9ce');
    }

    for (const room of ROOM_LABELS) {
      const label = floor_label(`${room.number}  /  ${room.name}`, 2.6);
      label.position.set(...room.position, 0.015);
      this.scene.add(label);
    }
    const start_label = floor_label('START', 0.85, '#0071e3');
    start_label.position.set(SPAWN[0] - 0.7, SPAWN[1], 0.018);
    start_label.rotation.z = Math.PI / 2;
    this.scene.add(start_label);
    const spawn_ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.57, 64),
      new THREE.MeshBasicMaterial({ color: '#8eb3df', transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    spawn_ring.position.set(SPAWN[0], SPAWN[1], 0.018);
    this.scene.add(spawn_ring);
    add_box([1.4, 0, 0.013], [0.24, 1.8, 0.025], '#a4bedc', false);
    add_box([5.05, 1.8, 0.013], [1.9, 0.24, 0.025], '#a4bedc', false);

    this.robot_marker = new THREE.Group();
    const marker_material = new THREE.MeshBasicMaterial({ color: '#0071e3', transparent: true, opacity: 0.7 });
    this.robot_marker.add(new THREE.Mesh(new THREE.RingGeometry(0.37, 0.39, 48), marker_material));
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 3), marker_material);
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.x = 0.53;
    this.robot_marker.add(arrow);
    this.scene.add(this.robot_marker);
    // The contact shadow avoids a second render pass for the robot.
    const shadow_canvas = document.createElement('canvas');
    shadow_canvas.width = shadow_canvas.height = 64;
    const context = shadow_canvas.getContext('2d');
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(29, 29, 40, 0.24)');
    gradient.addColorStop(1, 'rgba(29, 29, 40, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    this.robot_shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadow_canvas), transparent: true, depthWrite: false }));
    this.scene.add(this.robot_shadow);
    const contact_geometries = SCENE_FURNITURE.map((item) => {
      const [width, depth] = FURNITURE_ASSETS[item.article].size;
      const geometry = new THREE.PlaneGeometry(width * 1.1, depth * 1.1);
      geometry.rotateZ(item.yaw);
      geometry.translate(item.position[0], item.position[1], item.position[2] + 0.007);
      return geometry;
    });
    this.furniture_shadow = new THREE.Mesh(mergeGeometries(contact_geometries),
      new THREE.MeshBasicMaterial({ map: this.robot_shadow.material.map, transparent: true, opacity: 0.65, depthWrite: false }));
    this.scene.add(this.furniture_shadow);
    for (const geometry of contact_geometries) geometry.dispose();

    const room = new THREE.Mesh(mergeGeometries(static_geometries),
      new THREE.MeshLambertMaterial({ vertexColors: true }));
    room.castShadow = true;
    room.receiveShadow = true;
    room.matrixAutoUpdate = false;
    const edges = new THREE.LineSegments(mergeGeometries(edge_geometries),
      new THREE.LineBasicMaterial({ color: '#777c87', transparent: true, opacity: 0.16 }));
    edges.matrixAutoUpdate = false;
    this.scene.add(room, edges);
    for (const geometry of [...static_geometries, ...edge_geometries]) geometry.dispose();
  }

  async load_furniture() {
    const { loader, draco } = create_model_loader();
    const signal = this.furniture_abort.signal;
    const results = await Promise.allSettled(Object.entries(FURNITURE_ASSETS).map(async ([article, asset]) => {
      const response = await fetch(`${IKEA_BASE}${model_path(article)}`, { signal });
      if (!response.ok) throw new Error(`Could not load IKEA article ${article}. Check the asset collection connection.`);
      const bytes = await response.arrayBuffer();
      signal.throwIfAborted();
      const gltf = await loader.parseAsync(bytes, '');
      if (signal.aborted) {
        dispose_model(gltf.scene);
        return;
      }
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const actual = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const origin = [center.x, bounds.min.y, center.z];
      const expected = [asset.size[0], asset.size[2], asset.size[1]];
      if (actual.toArray().some((size, axis) => Math.abs(size - expected[axis]) > 0.002) ||
          origin.some((value, axis) => Math.abs(value - asset.origin[axis]) > 0.002)) {
        dispose_model(gltf.scene);
        throw new Error(`The visual and collision geometry differ for IKEA article ${article}. Regenerate its colliders.`);
      }
      gltf.scene.position.sub(new THREE.Vector3(...asset.origin));
      const upright = new THREE.Group();
      upright.rotation.x = Math.PI / 2;
      upright.add(gltf.scene);
      for (const item of SCENE_FURNITURE.filter((item) => item.article === article)) {
        const group = new THREE.Group();
        group.name = item.name;
        group.position.set(...item.position);
        group.rotation.z = item.yaw;
        group.add(upright.clone(true));
        group.updateMatrixWorld(true);
        group.traverse((object) => {
          object.matrixAutoUpdate = false;
          if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
        });
        this.scene.add(group);
      }
    }));
    // Let every active decode finish before releasing its shared worker.
    draco.dispose();
    if (signal.aborted) return;
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(this.renderer);
    this.environment = generator.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.55;
    room.dispose();
    generator.dispose();
    if (new URLSearchParams(location.search).has('collisions')) {
      const material = new THREE.MeshBasicMaterial({ color: '#0071e3', wireframe: true, transparent: true, opacity: 0.4, depthTest: false });
      for (const item of SCENE_FURNITURE) {
        const group = new THREE.Group();
        group.position.set(...item.position);
        group.rotation.z = item.yaw;
        for (const hull of FURNITURE_ASSETS[item.article].hulls) {
          const geometry = new ConvexGeometry(hull.map((point) => new THREE.Vector3(...point)));
          group.add(new THREE.Mesh(geometry, material));
        }
        this.scene.add(group);
      }
    }
    this.renderer.shadowMap.needsUpdate = this.renderer.shadowMap.enabled;
    this.needs_render = true;
  }

  load_robot(geometries) {
    const material_cache = new Map();
    for (const descriptor of geometries) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(descriptor.vertices, 3));
      geometry.setIndex(new THREE.BufferAttribute(descriptor.faces, 1));
      geometry.setAttribute('normal', new THREE.BufferAttribute(descriptor.normals, 3));
      const key = descriptor.color.join(',');
      if (!material_cache.has(key)) {
        const color = new THREE.Color().setRGB(...descriptor.color, THREE.SRGBColorSpace);
        material_cache.set(key, new THREE.MeshLambertMaterial({ color }));
      }
      const mesh = new THREE.Mesh(geometry, material_cache.get(key));
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      this.robot_meshes.push(mesh);
      this.scene.add(mesh);
    }
  }

  update_frame(transforms, telemetry) {
    this.needs_render = true;
    this.paused = telemetry.paused || telemetry.fallen;
    this.robot_position.set(...telemetry.position);
    for (let index = 0; index < this.robot_meshes.length; index++) {
      const t = transforms.subarray(index * 12, index * 12 + 12);
      this.robot_meshes[index].matrix.set(t[3], t[4], t[5], t[0], t[6], t[7], t[8], t[1],
        t[9], t[10], t[11], t[2], 0, 0, 0, 1);
      this.robot_meshes[index].matrixWorldNeedsUpdate = true;
    }
    this.robot_marker.position.set(telemetry.position[0], telemetry.position[1], 0.025);
    this.robot_marker.rotation.z = telemetry.heading;
    this.robot_shadow.position.set(telemetry.position[0], telemetry.position[1], 0.016);
    if (telemetry.time < 0.02) {
      this.trail_count = 0;
      this.trail.geometry.setDrawRange(0, 0);
    }
    const offset = (this.trail_count - 1) * 3;
    const x = telemetry.position[0];
    const y = telemetry.position[1];
    if (this.trail_count === 0 || Math.hypot(x - this.trail_positions[offset], y - this.trail_positions[offset + 1]) > 0.12) {
      if (this.trail_count === 1500) {
        this.trail_positions.copyWithin(0, 3);
        this.trail_count--;
      }
      this.trail_positions.set([x, y, 0.02], this.trail_count * 3);
      this.trail_count++;
      this.trail.geometry.getAttribute('position').needsUpdate = true;
      this.trail.geometry.setDrawRange(0, this.trail_count);
    }
  }

  set_camera(mode) {
    this.needs_render = true;
    this.mode = mode;
    if (mode === 'follow') {
      this.camera.position.copy(this.robot_position).add(new THREE.Vector3(-5.3, -6.3, 5));
      this.controls.target.copy(this.robot_position).add(new THREE.Vector3(0.7, 0.2, -0.2));
    } else if (mode === 'top') {
      this.camera.position.set(0, -0.01, 20);
      this.controls.target.set(0, 0, 0);
    } else {
      this.camera.position.set(-9.5, -12, 10.4);
      this.controls.target.set(0, 0, 0.1);
    }
    this.last_follow_position.copy(this.robot_position);
    this.controls.update();
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    const cap = this.quality === 'performance' ? 1 : Math.min(window.devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(Math.min(cap, Math.sqrt(1_000_000 / Math.max(width * height, 1))));
    this.renderer.setSize(width, height);
    this.needs_render = true;
  }

  set_quality(quality) {
    this.quality = quality;
    this.furniture_shadow.visible = quality === 'performance';
    this.renderer.shadowMap.enabled = quality === 'quality';
    // The room is static. Compute its shadow once. The robot uses the contact shadow.
    this.renderer.shadowMap.needsUpdate = quality === 'quality';
    this.resize();
  }

  render(time) {
    const started = performance.now();
    if (this.mode === 'follow') {
      const delta = this.follow_delta.copy(this.robot_position).sub(this.last_follow_position);
      delta.z = 0;
      this.camera.position.add(delta);
      this.controls.target.add(delta);
      this.last_follow_position.copy(this.robot_position);
    }
    const camera_changed = this.controls.update();
    if (document.hidden || (this.paused && !this.needs_render && !camera_changed)) return;
    this.renderer.render(this.scene, this.camera);
    this.needs_render = false;
    this.render_samples.push(performance.now() - started);
    if (time - this.last_fps_time > 700) {
      const samples = this.render_samples.sort((a, b) => a - b);
      this.on_metrics({
        fps: Math.round(samples.length * 1000 / (time - this.last_fps_time)),
        render_ms: samples.reduce((sum, value) => sum + value, 0) / samples.length,
        p95_ms: samples[Math.floor(samples.length * 0.95)],
        triangles: this.renderer.info.render.triangles,
        draw_calls: this.renderer.info.render.calls,
        pixel_ratio: this.renderer.getPixelRatio(),
      });
      this.render_samples = [];
      this.last_fps_time = time;
    }
  }

  dispose() {
    this.furniture_abort.abort();
    document.removeEventListener('visibilitychange', this.visibility_handler);
    this.resize_observer.disconnect();
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.sunlight.shadow.map?.dispose();
    dispose_model(this.scene);
    this.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
