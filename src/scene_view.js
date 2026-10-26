import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SCENE_BOXES, ROOM_LABELS, SPAWN } from './scene_layout.js';

const COLORS = { wall: '#c7c9ce', sofa: '#92969f', table: '#c6c4c0', cabinet: '#aeb3bc' };

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
  const label = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 8),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  return label;
}

export class SceneView {
  constructor(container, on_fps, on_metrics = () => {}) {
    this.container = container;
    this.on_fps = on_fps;
    this.on_metrics = on_metrics;
    this.render_samples = [];
    this.needs_render = true;
    this.paused = false;
    this.quality = 'performance';
    this.static_geometries = [];
    this.edge_geometries = [];
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
    this.renderer.toneMappingExposure = 1.15;
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
    this.finish_static_geometry();
    this.set_camera('follow');
    this.resize_observer = new ResizeObserver(() => this.resize());
    this.resize_observer.observe(container);
    this.resize();
    this.last_fps_time = performance.now();
    this.frame_count = 0;
    this.renderer.setAnimationLoop(time => this.render(time));
    this.visibility_handler = () => {
      this.renderer.setAnimationLoop(document.hidden ? null : time => this.render(time));
      this.needs_render = true;
      this.last_fps_time = performance.now();
      this.frame_count = 0;
    };
    document.addEventListener('visibilitychange', this.visibility_handler);
  }

  box(center, size, color, edges = true) {
    const geometry = new THREE.BoxGeometry(...size);
    geometry.translate(...center);
    const vertex_color = new THREE.Color(color);
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let offset = 0; offset < colors.length; offset += 3) vertex_color.toArray(colors, offset);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.static_geometries.push(geometry);
    if (edges) {
      this.edge_geometries.push(new THREE.EdgesGeometry(geometry));
    }
  }

  finish_static_geometry() {
    const room = new THREE.Mesh(mergeGeometries(this.static_geometries),
      new THREE.MeshLambertMaterial({ vertexColors: true }));
    room.castShadow = true;
    room.receiveShadow = true;
    room.matrixAutoUpdate = false;
    const edges = new THREE.LineSegments(mergeGeometries(this.edge_geometries),
      new THREE.LineBasicMaterial({ color: '#777c87', transparent: true, opacity: 0.16 }));
    edges.matrixAutoUpdate = false;
    this.scene.add(room, edges);
    for (const geometry of [...this.static_geometries, ...this.edge_geometries]) geometry.dispose();
    this.static_geometries = [];
    this.edge_geometries = [];
  }

  build_room() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b0b3bb', 2.8));
    const sunlight = new THREE.DirectionalLight('#ffffff', 2.5);
    this.sunlight = sunlight;
    sunlight.position.set(-3, -6, 14);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    Object.assign(sunlight.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 0.5, far: 35 });
    sunlight.shadow.normalBias = 0.025;
    sunlight.shadow.bias = -0.0001;
    this.scene.add(sunlight);
    this.box([0, 0, -0.16], [14.25, 12.25, 0.28], '#c9cbd0');
    this.box([-2.8, 0, -0.015], [8.4, 12, 0.03], '#eeeff1', false);
    this.box([4.2, -2.1, -0.012], [5.6, 7.8, 0.03], '#e2e6ec', false);
    this.box([4.2, 3.9, -0.012], [5.6, 4.2, 0.03], '#eae9e7', false);

    const grid_positions = [];
    for (let x = -7; x <= 7; x++) grid_positions.push(x, -6, 0.008, x, 6, 0.008);
    for (let y = -6; y <= 6; y++) grid_positions.push(-7, y, 0.008, 7, y, 0.008);
    const grid_geometry = new THREE.BufferGeometry();
    grid_geometry.setAttribute('position', new THREE.Float32BufferAttribute(grid_positions, 3));
    this.scene.add(new THREE.LineSegments(grid_geometry,
      new THREE.LineBasicMaterial({ color: '#9a9da7', transparent: true, opacity: 0.14 })));

    for (const box of SCENE_BOXES) {
      const center = [...box.center];
      const size = [...box.size];
      if (box.kind === 'wall') {
        // Cutaway walls expose the interior; the physics keeps their full 2.7 m height.
        size[2] = ['south_wall', 'west_wall'].includes(box.name) ? 0.26 : 0.85;
        center[2] = size[2] / 2;
      }
      this.box(center, size, COLORS[box.kind]);
      if (box.kind === 'cabinet') {
        this.box([center[0], center[1], size[2] + 0.015], [size[0] + 0.025, size[1] + 0.025, 0.03], '#e1e2e5');
      }
    }

    // Small gray-box details keep the room legible without extra environment assets.
    for (let index = 0; index < 3; index++) {
      this.box([-5.28 + index * 0.88, 3.42, 0.59], [0.83, 0.8, 0.1], '#a8adb6');
    }
    this.box([4.2, 5.38, 1.06], [0.9, 0.09, 0.52], '#626875');
    this.box([4.2, 5.38, 0.82], [0.12, 0.1, 0.2], '#626875');
    this.box([4.2, 5.26, 0.8], [0.5, 0.3, 0.025], '#999eaa');
    this.box([3.1, -5.44, 0.94], [0.65, 0.58, 0.025], '#7b8391');

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
    this.box([1.4, 0, 0.013], [0.24, 1.8, 0.025], '#a4bedc', false);
    this.box([5.05, 1.8, 0.013], [1.9, 0.24, 0.025], '#a4bedc', false);

    this.robot_marker = new THREE.Group();
    const marker_material = new THREE.MeshBasicMaterial({ color: '#0071e3', transparent: true, opacity: 0.7 });
    this.robot_marker.add(new THREE.Mesh(new THREE.RingGeometry(0.37, 0.39, 48), marker_material));
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 3), marker_material);
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.x = 0.53;
    this.robot_marker.add(arrow);
    this.scene.add(this.robot_marker);
    // A cheap contact shadow keeps the feet grounded without a second robot draw pass.
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
      this.camera.position.set(-11.8, -14.8, 13.2);
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
    this.renderer.shadowMap.enabled = quality === 'quality';
    // The room is static; bake its shadow once. The robot uses the contact shadow.
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
    this.frame_count++;
    if (time - this.last_fps_time > 700) {
      this.on_fps(Math.round(this.frame_count * 1000 / (time - this.last_fps_time)));
      const samples = this.render_samples.sort((a, b) => a - b);
      this.on_metrics({
        render_ms: samples.reduce((sum, value) => sum + value, 0) / samples.length,
        p95_ms: samples[Math.floor(samples.length * 0.95)],
        triangles: this.renderer.info.render.triangles,
        draw_calls: this.renderer.info.render.calls,
        pixel_ratio: this.renderer.getPixelRatio(),
      });
      this.render_samples = [];
      this.frame_count = 0;
      this.last_fps_time = time;
    }
  }

  dispose() {
    document.removeEventListener('visibilitychange', this.visibility_handler);
    this.resize_observer.disconnect();
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.sunlight.shadow.map?.dispose();
    const geometries = new Set();
    const materials = new Set();
    this.scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
