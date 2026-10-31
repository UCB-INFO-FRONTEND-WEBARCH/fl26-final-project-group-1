import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { create_model_loader, dispose_model } from './model_assets.js';
import { IKEA_BASE, model_path } from './asset_paths.js';
import { FLOOR_HEIGHT, ELEVATOR, STAIR_BOXES, STAIR_RAIL_BOXES, SHAFT_BOXES, LIFT_RAILS, upper_slabs } from './building.js';
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
  constructor(container, on_metrics, on_destination) {
    this.container = container;
    this.on_metrics = on_metrics;
    this.on_destination = on_destination;
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
    this.install_picking();
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
    this.floor_groups = [new THREE.Group(), new THREE.Group()];
    this.floor_surfaces = [];
    this.furniture_shadows = [];
    this.viewed_floor = 0;
    this.scene.add(...this.floor_groups);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b0b3bb', 2));
    const sunlight = new THREE.DirectionalLight('#ffffff', 2);
    this.sunlight = sunlight;
    sunlight.position.set(-3, -6, 14);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    Object.assign(sunlight.shadow.camera, { left: -14, right: 12, top: 12, bottom: -12, near: 0.5, far: 40 });
    sunlight.shadow.normalBias = 0.025;
    sunlight.shadow.bias = -0.0001;
    this.scene.add(sunlight);

    function box_geometry(center, size) {
      return new THREE.BoxGeometry(...size).translate(...center);
    }
    function boxes_mesh(boxes, material) {
      const geometries = boxes.map(box => box_geometry(box.center, box.size));
      const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
      for (const geometry of geometries) geometry.dispose();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      return mesh;
    }
    const shadow_canvas = document.createElement('canvas');
    shadow_canvas.width = shadow_canvas.height = 64;
    const context = shadow_canvas.getContext('2d');
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(29, 29, 40, 0.24)');
    gradient.addColorStop(1, 'rgba(29, 29, 40, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const shadow_material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadow_canvas), transparent: true, depthWrite: false });

    for (let floor = 0; floor < 2; floor++) {
      const z = floor * FLOOR_HEIGHT;
      const group = this.floor_groups[floor];
      const slabs = floor ? upper_slabs() : [{ center: [-1.5, 0, -0.08], size: [17, 12, 0.16] }];
      const surface = boxes_mesh(slabs, new THREE.MeshLambertMaterial({ color: floor ? '#e8e7e5' : '#eeeff1' }));
      surface.userData.floor = floor;
      group.add(surface);
      this.floor_surfaces.push(surface);
      const walls = SCENE_WALLS.map(box => {
        const height = ['south_wall', 'west_wall'].includes(box.name) ? 0.26 : 0.85;
        return { center: [box.center[0], box.center[1], z + height / 2], size: [box.size[0], box.size[1], height] };
      });
      group.add(boxes_mesh(walls, new THREE.MeshLambertMaterial({ color: '#c7c9ce' })));
      const grid = [];
      for (let x = -10; x <= 7; x++) grid.push(x, -6, z + 0.008, x, 6, z + 0.008);
      for (let y = -6; y <= 6; y++) grid.push(-10, y, z + 0.008, 7, y, z + 0.008);
      group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(grid, 3)),
        new THREE.LineBasicMaterial({ color: '#9a9da7', transparent: true, opacity: 0.14 })));
      for (const room of ROOM_LABELS) {
        const label = floor_label(`${room.number}  /  ${floor ? ['LOUNGE', 'GALLERY', 'WORKSPACE'][Number(room.number) - 1] : room.name}`, 2.6);
        label.position.set(...room.position, z + 0.015);
        group.add(label);
      }
      const lift_label = floor_label('ELEVATOR', 1.45, '#0071e3');
      lift_label.position.set(-6, -4.8, z + 0.02);
      group.add(lift_label);
      const contact = SCENE_FURNITURE.filter(item => Math.floor((item.position[2] + 0.01) / FLOOR_HEIGHT) === floor).map(item => {
        const [width, depth] = FURNITURE_ASSETS[item.article].size;
        return new THREE.PlaneGeometry(width * 1.1, depth * 1.1).rotateZ(item.yaw)
          .translate(item.position[0], item.position[1], item.position[2] + 0.007);
      });
      const shadow = new THREE.Mesh(mergeGeometries(contact), shadow_material);
      group.add(shadow);
      this.furniture_shadows.push(shadow);
      for (const geometry of contact) geometry.dispose();
    }

    const stairs = [...STAIR_BOXES, ...STAIR_RAIL_BOXES];
    this.scene.add(boxes_mesh(stairs, new THREE.MeshLambertMaterial({ color: '#c5cbd4' })));
    this.scene.add(boxes_mesh(SHAFT_BOXES, new THREE.MeshLambertMaterial({ color: '#8eb9db', transparent: true, opacity: 0.16, depthWrite: false })));
    this.lift_group = new THREE.Group();
    this.lift_group.position.set(...ELEVATOR.center, 0);
    this.lift_deck = new THREE.Mesh(box_geometry([0, 0, -0.08], ELEVATOR.size), new THREE.MeshLambertMaterial({ color: '#a8bbd4' }));
    this.lift_group.add(this.lift_deck);
    for (const rail of LIFT_RAILS) {
      const mesh = new THREE.Mesh(box_geometry(rail.center, rail.size), new THREE.MeshLambertMaterial({ color: '#86a8c5', transparent: true, opacity: 0.22, depthWrite: false }));
      this.lift_group.add(mesh);
      if (rail.name === 'front') this.lift_front = mesh;
    }
    this.scene.add(this.lift_group);
    this.lift_gates = [0, 1].map(floor => {
      const gate = new THREE.Mesh(box_geometry([-7.48, -4.2, floor * FLOOR_HEIGHT + 0.8], [0.1, 1.72, 1.6]),
        new THREE.MeshLambertMaterial({ color: '#8aafcf', transparent: true, opacity: 0.3, depthWrite: false }));
      this.floor_groups[floor].add(gate);
      return gate;
    });
    this.robot_marker = new THREE.Mesh(new THREE.RingGeometry(0.37, 0.39, 48),
      new THREE.MeshBasicMaterial({ color: '#0071e3', transparent: true, opacity: 0.7 }));
    this.robot_shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.75), shadow_material);
    this.scene.add(this.robot_marker, this.robot_shadow);
    this.route = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#0071e3', depthTest: false }));
    this.destination = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.22, 32),
      new THREE.MeshBasicMaterial({ color: '#0071e3', depthTest: false, side: THREE.DoubleSide }));
    this.destination.visible = false;
    this.route.frustumCulled = false;
    this.route.visible = false;
    this.scene.add(this.route, this.destination);
    this.navigation_version = -1;
    this.set_floor(0);
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
        this.floor_groups[Math.floor((item.position[2] + 0.01) / FLOOR_HEIGHT)].add(group);
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
        this.floor_groups[Math.floor((item.position[2] + 0.01) / FLOOR_HEIGHT)].add(group);
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
    this.current_floor = telemetry.floor || 0;
    this.lift_moving = telemetry.elevator?.moving || false;
    if (this.mode === 'follow' && this.viewed_floor !== this.current_floor) this.set_floor(this.current_floor);
    const robot_visible = this.viewed_floor === 'all' || this.viewed_floor === this.current_floor;
    for (let index = 0; index < this.robot_meshes.length; index++) {
      const t = transforms.subarray(index * 12, index * 12 + 12);
      this.robot_meshes[index].matrix.set(t[3], t[4], t[5], t[0], t[6], t[7], t[8], t[1],
        t[9], t[10], t[11], t[2], 0, 0, 0, 1);
      this.robot_meshes[index].matrixWorldNeedsUpdate = true;
      this.robot_meshes[index].visible = robot_visible;
    }
    const on_lift = Math.abs(telemetry.position[0] - ELEVATOR.center[0]) < 0.8 && Math.abs(telemetry.position[1] - ELEVATOR.center[1]) < 0.8;
    const surface = on_lift ? (telemetry.elevator?.height || 0) : this.current_floor * FLOOR_HEIGHT;
    this.robot_marker.visible = this.robot_shadow.visible = robot_visible;
    this.robot_marker.position.set(telemetry.position[0], telemetry.position[1], surface + 0.025);
    this.robot_marker.rotation.z = telemetry.heading;
    this.robot_shadow.position.set(telemetry.position[0], telemetry.position[1], surface + 0.016);
    if (telemetry.elevator) {
      this.lift_group.position.z = telemetry.elevator.height;
      this.lift_front.visible = telemetry.elevator.moving;
      this.lift_open_floor = telemetry.elevator.open_floor;
      for (let floor = 0; floor < 2; floor++) this.lift_gates[floor].visible = this.lift_open_floor !== floor;
    }
    this.set_navigation(telemetry.navigation);
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
      this.trail_positions.set([x, y, surface + 0.02], this.trail_count * 3);
      this.trail_count++;
      this.trail.geometry.getAttribute('position').needsUpdate = true;
      this.trail.geometry.setDrawRange(0, this.trail_count);
    }
  }

  set_camera(mode) {
    this.needs_render = true;
    this.mode = mode;
    const z = this.viewed_floor === 'all' ? 1.65 : this.viewed_floor * FLOOR_HEIGHT;
    if (mode === 'follow') {
      this.camera.position.copy(this.robot_position).add(new THREE.Vector3(-5.3, -6.3, 5));
      this.controls.target.copy(this.robot_position).add(new THREE.Vector3(0.7, 0.2, -0.2));
    } else if (mode === 'top') {
      this.camera.position.set(-1.5, -0.01, 23 + z);
      this.controls.target.set(-1.5, 0, z);
    } else {
      this.camera.position.set(-11.5, -14, 11 + z);
      this.controls.target.set(-1.5, 0, z + 0.1);
    }
    this.last_follow_position.copy(this.robot_position);
    this.controls.update();
  }

  set_floor(floor) {
    this.viewed_floor = floor;
    const robot_visible = floor === 'all' || floor === (this.current_floor || 0);
    for (const mesh of this.robot_meshes) mesh.visible = robot_visible;
    this.robot_marker.visible = this.robot_shadow.visible = robot_visible;
    for (let level = 0; level < 2; level++) {
      this.floor_groups[level].visible = floor === 'all' || floor === level;
      const material = this.floor_surfaces[level].material;
      material.transparent = floor === 'all' && level === 1;
      material.opacity = material.transparent ? 0.3 : 1;
      material.depthWrite = !material.transparent;
    }
    if (this.camera && this.mode !== 'follow') this.set_camera(this.mode);
    this.renderer.shadowMap.needsUpdate = this.renderer.shadowMap.enabled;
    this.needs_render = true;
  }

  set_navigation(navigation) {
    if (!navigation || navigation.version === this.navigation_version) return;
    this.navigation_version = navigation.version;
    this.route.geometry.dispose();
    this.route.geometry = new THREE.BufferGeometry().setFromPoints(navigation.path.map(point => new THREE.Vector3(point[0], point[1], point[2] + 0.045)));
    this.route.visible = navigation.path.length > 1;
    this.destination.visible = Boolean(navigation.goal);
    if (navigation.goal) this.destination.position.set(navigation.goal[0], navigation.goal[1], navigation.goal[2] * FLOOR_HEIGHT + 0.05);
    this.destination.material.color.set(navigation.status === 'arrived' ? '#30a46c' : navigation.status === 'blocked' ? '#d56b36' : '#0071e3');
    this.needs_render = true;
  }

  install_picking() {
    const canvas = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    let press = null;
    const down = event => { press = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null; };
    const move = event => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) press = null;
    };
    const cancel = () => { press = null; };
    const up = event => {
      const click = press;
      press = null;
      if (!click || click.id !== event.pointerId || event.button !== 0) return;
      const bounds = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1,
        1 - (event.clientY - bounds.top) / bounds.height * 2), this.camera);
      const surfaces = this.floor_surfaces.filter(surface => this.viewed_floor === 'all' || surface.userData.floor === this.viewed_floor);
      if (this.lift_open_floor >= 0 && (this.viewed_floor === 'all' || this.lift_open_floor === this.viewed_floor)) surfaces.push(this.lift_deck);
      const hit = raycaster.intersectObjects(surfaces, false)[0];
      if (hit) this.on_destination?.([hit.point.x, hit.point.y, hit.object === this.lift_deck ? this.lift_open_floor : hit.object.userData.floor]);
      canvas.focus({ preventScroll: true });
    };
    for (const [name, handler] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancel]]) canvas.addEventListener(name, handler);
    this.remove_picking = () => {
      for (const [name, handler] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancel]]) canvas.removeEventListener(name, handler);
    };
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
    for (const shadow of this.furniture_shadows) shadow.visible = quality === 'performance';
    this.renderer.shadowMap.enabled = quality === 'quality';
    // The room is static. Compute its shadow once. The robot uses the contact shadow.
    this.renderer.shadowMap.needsUpdate = quality === 'quality';
    this.resize();
  }

  render(time) {
    const started = performance.now();
    if (this.mode === 'follow') {
      const delta = this.follow_delta.copy(this.robot_position).sub(this.last_follow_position);
      if (!this.lift_moving) delta.z = 0;
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
    this.remove_picking();
    this.sunlight.shadow.map?.dispose();
    dispose_model(this.scene);
    this.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
