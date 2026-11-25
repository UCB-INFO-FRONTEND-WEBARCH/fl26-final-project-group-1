import {NavigationOverlay} from './navigation_overlay.js';
import {configure_native_materials,freeze_native_transforms,plant_cells} from './native_render.js';
import {load_native_finishes,apply_native_finishes} from './native_finishes.js';
import { IS_HEPHAESTUS, MAP } from './world.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { create_model_loader, dispose_model } from './model_assets.js';
import { SITE_BASE, IKEA_BASE, model_path } from './asset_paths.js';
import { ROBOT_POSE_SIZE } from './robot_assets.js';
import { CHARACTER_ASSET } from './character_asset.js';
import { ShoulderCamera } from './shoulder_camera.js';
import { FigureFocus, figure_opacity } from './figure_focus.js';
import { ArrivalCamera, ARRIVAL_LEVELS } from './arrival_camera.js';
import { get_theme, THEME_EVENT } from './theme.js';
import { FLOOR_HEIGHT, ELEVATOR, STAIRS, STAIR_BOXES, STAIR_RAIL_BOXES, SHAFT_BOXES, LIFT_RAILS, BUILDING_BOUNDS, on_stairs, stair_height, upper_slabs } from './building.js';
import { SCENE_WALLS, SCENE_FURNITURE, FURNITURE_ASSETS, ROOM_LABELS, SPAWN, SPAWN_YAW } from './scene_layout.js';
import { SEATS } from './seat.js';
import { SEATING_ASSETS } from './seating_assets.js';

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
  constructor(container, on_metrics, on_destination, renderer, on_camera_change) {
    this.container = container;
    this.on_metrics = on_metrics;
    this.on_destination = on_destination;
    this.on_camera_change = on_camera_change;
    this.figure_focus = new FigureFocus();
    this.render_samples = [];
    this.render_count = 0;
    this.render_suspended = false;
    this.needs_render = true;
    this.paused = false;
    this.quality = 'performance';
    this.furniture_abort = new AbortController();
    this.character_abort = new AbortController();
    this.arrival_abort = new AbortController();
    this.appearance = this.requested_appearance = 'robot';
    this.latest_robot_pose = new Float32Array(ROBOT_POSE_SIZE);
    this.has_robot_pose = false;
    this.disposed = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f5f5f7');
    this.scene.fog = new THREE.Fog('#f5f5f7', IS_HEPHAESTUS ? 60 : 23, IS_HEPHAESTUS ? 180 : 48);
    this.renderer = renderer;
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D apartment with Berkeley Lite Pro robot');
    this.renderer.domElement.setAttribute('tabindex', '0');
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(44, 1, 0.05, 100);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = IS_HEPHAESTUS ? 70 : 28;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.shoulder_camera = new ShoulderCamera(this.camera, this.controls.target);
    this.robot_position = new THREE.Vector3(...SPAWN);
    this.robot_rotation = new THREE.Quaternion();
    this.robot_heading = SPAWN_YAW;
    this.last_follow_position = this.robot_position.clone();
    this.robot_meshes = [];
    this.follow_delta = new THREE.Vector3();
    this.mode = 'shoulder';
    this.trail_count = 0;
    this.trail_positions = new Float32Array(1500 * 3);
    const trail_geometry = new THREE.BufferGeometry();
    trail_geometry.setAttribute('position', new THREE.BufferAttribute(this.trail_positions, 3).setUsage(THREE.DynamicDrawUsage));
    trail_geometry.setDrawRange(0, 0);
    this.trail = new THREE.Line(trail_geometry,
      new THREE.LineBasicMaterial({ color: '#0071e3', transparent: true, opacity: 0.5, depthTest: false, depthWrite: false }));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 9999;
    this.scene.add(this.trail);
    this.build_room();
    this.scene.traverse(object => { if (object.isLight) object.layers.enable(1); });
    this.theme_handler = () => this.set_theme(get_theme());
    this.theme_handler();
    window.addEventListener(THEME_EVENT, this.theme_handler);
    this.install_picking();
    this.install_shoulder_orbit();
    this.set_camera('shoulder');
    this.wheel_handler = event => {
      if (this.mode !== 'shoulder') return;
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1);
      this.zoom(Math.exp(THREE.MathUtils.clamp(pixels * 0.001, -1, 1)));
    };
    this.renderer.domElement.addEventListener('wheel', this.wheel_handler, { passive: false });
    this.resize_observer = new ResizeObserver(() => this.resize());
    this.resize_observer.observe(container);
    this.resize();
    this.last_fps_time = performance.now();
    this.last_render_time = this.last_fps_time;
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
    if (IS_HEPHAESTUS) return this.build_native_room();
    const camera_boxes = [
      ...[0, 1].flatMap(floor => SCENE_WALLS.map(box => ({
        center: [box.center[0], box.center[1], box.center[2] + floor * FLOOR_HEIGHT], size: box.size,
      }))),
      ...upper_slabs(), ...STAIR_BOXES, ...SHAFT_BOXES,
    ];
    for (const box of camera_boxes) {
      this.shoulder_camera.add_obstacle(new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(...box.center), new THREE.Vector3(...box.size)));
    }
    this.floor_groups = [new THREE.Group(), new THREE.Group()];
    this.floor_surfaces = [];
    this.furniture_shadows = [];
    this.viewed_floor = 0;
    this.scene.add(...this.floor_groups);
    this.ambient_light = new THREE.HemisphereLight('#ffffff', '#b0b3bb', 2);
    this.scene.add(this.ambient_light);
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
      const slabs = floor ? upper_slabs() : [{ center: [-2.5, 0, -0.08], size: [19, 14, 0.16] }];
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
      for (let x = BUILDING_BOUNDS[0]; x <= BUILDING_BOUNDS[1]; x++) grid.push(x, BUILDING_BOUNDS[2], z + 0.008, x, BUILDING_BOUNDS[3], z + 0.008);
      for (let y = BUILDING_BOUNDS[2]; y <= BUILDING_BOUNDS[3]; y++) grid.push(BUILDING_BOUNDS[0], y, z + 0.008, BUILDING_BOUNDS[1], y, z + 0.008);
      group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(grid, 3)),
        new THREE.LineBasicMaterial({ color: '#9a9da7', transparent: true, opacity: 0.14 })));
      for (const room of ROOM_LABELS) {
        const label = floor_label(`${room.number}  /  ${floor ? ['LOUNGE', 'GALLERY', 'WORKSPACE'][Number(room.number) - 1] : room.name}`, 2.6);
        label.position.set(...room.position, z + 0.015);
        group.add(label);
      }
      const lift_label = floor_label('ELEVATOR', 1.45, '#0071e3');
      lift_label.position.set(-6, ELEVATOR.center[1] - 0.6, z + 0.02);
      group.add(lift_label);
      const stair_label = floor_label(floor ? 'STAIRS DOWN' : 'STAIRS UP', 1.65, '#8b7651');
      stair_label.position.set(STAIRS.center_x, floor ? 6.45 : -6.45, z + 0.02);
      group.add(stair_label);
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
    this.stair_mesh = boxes_mesh(stairs, new THREE.MeshLambertMaterial({ color: '#c5cbd4' }));
    this.scene.add(this.stair_mesh);
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
      const gate = new THREE.Mesh(box_geometry([-7.48, ELEVATOR.center[1], floor * FLOOR_HEIGHT + 0.8], [0.1, 1.72, 1.6]),
        new THREE.MeshLambertMaterial({ color: '#8aafcf', transparent: true, opacity: 0.3, depthWrite: false }));
      this.floor_groups[floor].add(gate);
      return gate;
    });
    this.robot_marker = new THREE.Mesh(new THREE.RingGeometry(0.37, 0.39, 48),
      new THREE.MeshBasicMaterial({ color: '#0071e3', transparent: true, opacity: 0.7 }));
    this.robot_shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.75), shadow_material);
    this.scene.add(this.robot_marker, this.robot_shadow);
    this.navigation_overlay = new NavigationOverlay();
    this.scene.add(this.navigation_overlay);
    this.set_floor(0);
  }

  async load_seating() {
    const { loader, draco } = create_model_loader();
    const signal = this.furniture_abort.signal;
    this.seat_groups = [];
    try {
      await Promise.all(Object.entries(SEATING_ASSETS).map(async ([article, asset]) => {
        const response = await fetch(`${IKEA_BASE}${model_path(article)}`, { signal });
        if (!response.ok) throw new Error(`Could not load IKEA seating ${article}.`);
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
        if (hash !== asset.sha256) throw new Error(`IKEA seating ${article} differs from its collision mesh.`);
        const gltf = await loader.parseAsync(bytes, '');
        if (signal.aborted) { dispose_model(gltf.scene); return; }
        gltf.scene.position.sub(new THREE.Vector3(...asset.origin));
        const upright = new THREE.Group();
        upright.rotation.x = Math.PI / 2;
        upright.add(gltf.scene);
        for (const seat of SEATS.filter(seat => seat.article === article)) {
          const group = new THREE.Group();
          group.name = seat.id;
          group.userData.seat_id = seat.id;
          group.position.set(...seat.position);
          group.rotation.z = seat.model_yaw;
          group.add(upright.clone(true));
          group.updateMatrixWorld(true);
          group.traverse(object => {
            object.matrixAutoUpdate = false;
            if (object.isMesh) object.castShadow = object.receiveShadow = true;
          });
          // These low seats stay below the lens when seated; a full body AABB would trap the shoulder camera.
          this.floor_groups[seat.floor].add(group);
          this.seat_groups.push(group);
        }
      }));
    } finally { draco.dispose(); }
  }

  async load_furniture() {
    if (IS_HEPHAESTUS) return Promise.all([this.load_native_map(), this.load_seating()]);
    await this.load_seating();
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
        this.shoulder_camera.add_obstacle(new THREE.Box3().setFromObject(group));
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
    this.scene.environmentIntensity = this.theme === 'dark' ? 0.25 : 0.55;
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


  build_native_room() {
    this.floor_groups=[new THREE.Group(),new THREE.Group()];this.scene.add(...this.floor_groups);
    this.map_context=new THREE.Group();this.map_roof=new THREE.Group();this.scene.add(this.map_context,this.map_roof);
    this.floor_surfaces=[];this.furniture_shadows=[];this.viewed_floor=0;this.native_clip_materials=[];this.native_context_bands=[];this.native_furniture_groups=[];
    this.plant_cells=new THREE.Group();this.plant_overview=new THREE.Group();this.map_context.add(this.plant_cells,this.plant_overview);
    this.ambient_light=new THREE.HemisphereLight('#fff8ed','#aeb8bb',2);this.scene.add(this.ambient_light);
    this.sunlight=new THREE.DirectionalLight('#fff7e8',2);this.sunlight.position.set(0,-10,20);this.sunlight.castShadow=true;
    Object.assign(this.sunlight.shadow.camera,{left:-30,right:22,bottom:-15,top:15,near:.5,far:80});this.scene.add(this.sunlight);
    const invisible=new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide});
    const triangle_mesh=(triangles,z)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(triangles.flatMap(t=>t.flatMap(p=>[p[0],p[1],p[2]??z])),3));g.computeVertexNormals();return new THREE.Mesh(g,invisible);};
    for(let floor=0;floor<2;floor++){
      const surface=triangle_mesh(MAP.floor_triangles[floor],floor*FLOOR_HEIGHT);surface.userData.floor=floor;
      this.floor_groups[floor].add(surface);this.floor_surfaces.push(surface);
    }
    this.stair_mesh=triangle_mesh(MAP.steps.flatMap(s=>s.polygon.slice(1,-1).map((p,i)=>[s.polygon[0],p,s.polygon[i+2]].map(v=>[v[0],v[1],s.height]))),0);this.scene.add(this.stair_mesh);
    for(const box of MAP.camera_boxes)this.shoulder_camera.add_obstacle(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...box.center),new THREE.Vector3(...box.size)));
    this.lift_group=new THREE.Group();this.lift_deck=new THREE.Mesh(new THREE.BufferGeometry(),invisible);this.lift_front=new THREE.Group();this.lift_gates=[];this.lift_open_floor=-1;
    this.robot_marker=new THREE.Mesh(new THREE.RingGeometry(.37,.39,48),new THREE.MeshBasicMaterial({color:'#0071e3',transparent:true,opacity:.7}));
    this.robot_shadow=new THREE.Mesh(new THREE.CircleGeometry(.32,32),new THREE.MeshBasicMaterial({color:'#333333',transparent:true,opacity:.12,depthWrite:false}));
    this.scene.add(this.robot_marker,this.robot_shadow);
    this.navigation_overlay = new NavigationOverlay();
    this.scene.add(this.navigation_overlay);
    this.renderer.localClippingEnabled=true;
  }

  async load_native_map() {
    const {loader,draco}=create_model_loader(),signal=this.furniture_abort.signal;
    try {
      const finishes=await load_native_finishes(signal);
      const files=[{file:'lower.glb',layer:'lower'},{file:'upper.glb',layer:'upper'},{file:'roof.glb',layer:'roof'},{file:'context.glb',layer:'context'}];
      const loaded=await Promise.allSettled(files.map(async file=>{
        const response=await fetch(`${SITE_BASE}assets/hephaestus/${file.file}`,{signal});
        if(!response.ok)throw new Error(`Could not load Hephaestus ${file.layer} (HTTP ${response.status}).`);
        const gltf=await loader.parseAsync(await response.arrayBuffer(),'');
        if(signal.aborted){dispose_model(gltf.scene);return;}
        const upright=new THREE.Group();upright.rotation.x=Math.PI/2;upright.add(gltf.scene);apply_native_finishes(upright,finishes);
        const clipped = new Map();
        gltf.scene.traverse(o=>{
          if(o.userData.context_band)this.native_context_bands.push(o);
          if(o.userData.map_role==='furniture')this.native_furniture_groups.push(o);
          if(!o.isMesh)return;o.castShadow=o.receiveShadow=true;
          // Only architectural cutaways are clipped; source furniture stays whole.
          let owner=o;while(owner&&!owner.userData.map_role)owner=owner.parent;
          if(['architecture','glass'].includes(owner?.userData.map_role)){
            const clone = material => {
              if (!clipped.has(material)) clipped.set(material, material.clone());
              return clipped.get(material);
            };
            o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);
            const mats=Array.isArray(o.material)?o.material:[o.material];
            for(const m of mats)this.native_clip_materials.push({material:m,floor:file.layer==='upper'?1:0});
          }
        });
        const parent=file.layer==='context'?this.map_context:file.layer==='roof'?this.map_roof:this.floor_groups[file.layer==='upper'?1:0];parent.add(upright);
        configure_native_materials(upright,this.quality==='performance');
        freeze_native_transforms(upright);
      }));
      const failed=loaded.find(r=>r.status==='rejected');if(failed)throw failed.reason;
      // Lightweight procedural-plant exports retain their authored placements.
      for(const key of [...new Set(MAP.plants.map(p=>p.key))]) {
        const response=await fetch(`${SITE_BASE}assets/hephaestus/${key}.glb`,{signal});if(!response.ok)throw new Error(`Could not load plant ${key}.`);
        const gltf=await loader.parseAsync(await response.arrayBuffer(),'');
        if(signal.aborted){dispose_model(gltf.scene);signal.throwIfAborted();}
        const all_placements=MAP.plants.filter(p=>p.key===key),cells=plant_cells(all_placements),upright=new THREE.Matrix4().makeRotationX(Math.PI/2);
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse(mesh=>{
          if(!mesh.isMesh)return;
          for(const [parent,batches] of [[this.plant_cells,cells],[this.plant_overview,[all_placements]]])for(const placements of batches){
          const instanced=new THREE.InstancedMesh(mesh.geometry,mesh.material,placements.length);
          for(let i=0;i<placements.length;i++){
            const world=new THREE.Matrix4().fromArray(placements[i].matrix.flat()).transpose();
            instanced.setMatrixAt(i,world.multiply(upright).multiply(mesh.matrixWorld));
          }
          instanced.instanceMatrix.needsUpdate=true;instanced.computeBoundingSphere();instanced.castShadow=instanced.receiveShadow=true;parent.add(instanced);
          }
        });
      }
      if(signal.aborted)return;
      const room=new RoomEnvironment(),generator=new THREE.PMREMGenerator(this.renderer);this.environment=generator.fromScene(room,.04);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=this.theme==='dark'?.25:.55;room.dispose();generator.dispose();
      this.map_context_low=new THREE.Box3().setFromObject(this.map_context).min.z;
      configure_native_materials(this.map_context,this.quality==='performance');
      freeze_native_transforms(this.map_context);
      this.apply_native_view();this.renderer.shadowMap.needsUpdate=true;this.needs_render=true;
    } finally {draco.dispose();}
  }

  apply_native_view() {
    if(!IS_HEPHAESTUS)return;
    const interior=['shoulder','follow','arrival'].includes(this.mode);
    const building=this.viewed_floor==='all';
    this.plant_cells.visible=!building;this.plant_overview.visible=building;
    for(const detail of this.native_furniture_groups)detail.visible=!building||this.quality==='quality';
    for(const cell of this.native_context_bands)cell.visible=cell.userData.context_band==='roof'||this.viewed_floor==='all';
    for(let floor=0;floor<2;floor++)this.floor_groups[floor].visible=interior||this.viewed_floor==='all'||this.viewed_floor===floor;
    this.map_roof.visible=interior||this.viewed_floor==='all';
    for(const {material,floor} of this.native_clip_materials){
      material.clippingPlanes=(interior||this.viewed_floor==='all')?[]:[new THREE.Plane(new THREE.Vector3(0,0,-1),floor*FLOOR_HEIGHT+1.15)];material.needsUpdate=true;
    }
  }

  load_robot(geometries, rig) {
    this.character_rig = rig;
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
      mesh.layers.enable(1);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      this.robot_meshes.push(mesh);
      this.scene.add(mesh);
    }
  }

  async set_appearance(appearance) {
    this.requested_appearance = appearance;
    if (appearance === 'character' && !this.character) {
      if (!this.character_load) {
        this.character_load = import('./character_view.js').then(({ load_character }) =>
          load_character(this.character_rig, this.character_abort.signal)).then(async character => {
          if (this.disposed) {
            dispose_model(character.object);
            return;
          }
          this.character = character;
          character.object.traverse(object => { if (object.isMesh) object.layers.enable(1); });
          character.object.visible = false;
          this.scene.add(character.object);
          await this.renderer.compileAsync(character.object, this.camera, this.scene);
          if (!this.disposed) await this.figure_focus.prepare(this.renderer, this.scene, this.camera,
            [...this.robot_meshes, character.object]);
        }).catch(error => { this.character_load = null; throw error; });
      }
      await this.character_load;
    }
    if (this.disposed || this.requested_appearance !== appearance) return false;
    this.appearance = appearance;
    this.renderer.domElement.setAttribute('aria-label', appearance === 'character'
      ? `Interactive 3D apartment with ${CHARACTER_ASSET.name} character driven by Lite Pro`
      : 'Interactive 3D apartment with Berkeley Lite Pro robot');
    if (appearance === 'character' && this.has_robot_pose) this.character.pose.update(this.latest_robot_pose);
    this.update_figure_visibility();
    this.needs_render = true;
    return true;
  }

  update_figure_visibility() {
    const visible = this.viewed_floor === 'all' || this.viewed_floor === (this.current_floor || 0);
    for (const mesh of this.robot_meshes) mesh.visible = visible && this.appearance === 'robot';
    if (this.character) this.character.object.visible = visible && this.appearance === 'character';
    this.robot_marker.visible = this.robot_shadow.visible = visible;
  }

  update_frame(transforms, telemetry) {
    this.needs_render = true;
    this.paused = telemetry.paused || telemetry.fallen;
    this.robot_position.set(...telemetry.position);
    this.robot_heading = telemetry.heading;
    this.current_floor = telemetry.floor || 0;
    const teleported = telemetry.teleports !== undefined && telemetry.teleports !== (this.teleports || 0);
    this.teleports = telemetry.teleports || 0;
    if (teleported) {
      this.set_floor(this.current_floor);
      this.set_camera(this.mode);
    }
    this.lift_moving = telemetry.elevator?.moving || false;
    if ((this.mode === 'follow' || this.mode === 'shoulder') && this.viewed_floor !== this.current_floor) this.set_floor(this.current_floor);
    for (let index = 0; index < this.robot_meshes.length; index++) {
      const t = transforms.subarray(index * 12, index * 12 + 12);
      this.robot_meshes[index].matrix.set(t[3], t[4], t[5], t[0], t[6], t[7], t[8], t[1],
        t[9], t[10], t[11], t[2], 0, 0, 0, 1);
      this.robot_meshes[index].matrixWorldNeedsUpdate = true;
    }
    this.latest_robot_pose.set(transforms.subarray(this.robot_meshes.length * 12));
    this.robot_rotation.set(this.latest_robot_pose[4], this.latest_robot_pose[5],
      this.latest_robot_pose[6], this.latest_robot_pose[3]).normalize();
    this.has_robot_pose = true;
    if (this.appearance === 'character') this.character.pose.update(this.latest_robot_pose);
    this.update_figure_visibility();
    const on_lift = Math.abs(telemetry.position[0] - ELEVATOR.center[0]) < 0.8 && Math.abs(telemetry.position[1] - ELEVATOR.center[1]) < 0.8;
    this.vertical_motion = this.lift_moving || on_stairs(telemetry.position);
    const surface = on_lift ? (telemetry.elevator?.height || 0) : on_stairs(telemetry.position) ? stair_height(telemetry.position) : this.current_floor * FLOOR_HEIGHT;
    this.robot_marker.position.set(telemetry.position[0],telemetry.position[1],surface+(IS_HEPHAESTUS?.06:.025));
    this.robot_marker.rotation.z = telemetry.heading;
    this.robot_shadow.position.set(telemetry.position[0], telemetry.position[1], surface + 0.016);
    if (telemetry.elevator) {
      this.lift_group.position.z = telemetry.elevator.height;
      this.lift_front.visible = telemetry.elevator.moving;
      this.lift_open_floor = telemetry.elevator.open_floor;
      for (let floor = 0; floor < 2; floor++) this.lift_gates[floor].visible = this.lift_open_floor !== floor;
    }
    this.set_navigation(telemetry.navigation);
    if (this.arrival && this.arrival_world_ready && !this.arrival_destination_ready) this.prepare_arrival_destination();
    if (telemetry.time < 0.02 || teleported) {
      this.shoulder_camera.initialized = false;
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
      this.trail_positions.set([x, y, surface + (IS_HEPHAESTUS ? .065 : .02)], this.trail_count * 3);
      this.trail_count++;
      this.trail.geometry.getAttribute('position').needsUpdate = true;
      this.trail.geometry.setDrawRange(0, this.trail_count);
    }
  }

  set_camera(mode) {
    this.needs_render = true;
    this.mode = mode;
    // Flush any orbit inertia before a preset takes control of the camera.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    this.controls.enabled = mode !== 'shoulder';
    this.camera.fov = mode === 'shoulder' ? 52 : 44;
    this.camera.updateProjectionMatrix();
    this.apply_native_view();
    const z = this.viewed_floor === 'all' ? 1.65 : this.viewed_floor * FLOOR_HEIGHT;
    if (mode === 'shoulder') {
      this.shoulder_camera.update(this.robot_position, this.robot_heading, 0, true);
    } else if (mode === 'follow') {
      this.camera.position.copy(this.robot_position).add(new THREE.Vector3(-5.3, -6.3, 5));
      this.controls.target.copy(this.robot_position).add(new THREE.Vector3(0.7, 0.2, -0.2));
    } else if (mode === 'top') {
      this.camera.position.set(IS_HEPHAESTUS?-4:-2.5,-.01,(IS_HEPHAESTUS?43:24)+z);
      this.controls.target.set(IS_HEPHAESTUS?-4:-2.5,0,z);
    } else {
      this.camera.position.set(...(IS_HEPHAESTUS?[18,-23,23+z]:[-13,-15,12+z]));
      this.controls.target.set(IS_HEPHAESTUS?-5:-2.5,0,z+.1);
    }
    if(IS_HEPHAESTUS){
      const building=this.viewed_floor==='all'&&!['shoulder','follow'].includes(mode);
      this.controls.maxDistance=building?500:70;this.camera.far=building?700:300;
      this.scene.fog.near=building?400:60;this.scene.fog.far=building?1500:180;
      if(building){const middle=(this.map_context_low??-146)*.45;this.controls.target.set(-5,0,middle);this.camera.position.set(180,-220,100);}
      this.camera.updateProjectionMatrix();
    }
    this.last_follow_position.copy(this.robot_position);
    if (mode !== 'shoulder') this.controls.update();
  }

  start_arrival(preview, on_level, on_complete, on_reveal) {
    this.set_floor(0);
    this.shoulder_camera.update(this.robot_position, this.robot_heading, 0, true);
    this.reduced_motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.arrival = new ArrivalCamera(this.camera, this.controls.target, this.robot_position,
      this.camera.position, this.controls.target, this.reduced_motion);
    this.arrival.elapsed = preview.hold_seconds;
    this.arrival_map = preview.map;
    this.arrival_opening = preview.opening;
    this.arrival_abort = preview.abort;
    this.arrival_map.night = this.theme === 'dark';
    this.camera.far = 1000;
    this.camera.updateProjectionMatrix();
    this.mode = 'arrival';
    this.controls.enabled = false;
    this.on_arrival_level = on_level;
    this.on_arrival_complete = on_complete;
    this.on_arrival_reveal = on_reveal;
    this.arrival_level = 0;
    this.needs_render = true;
  }

  async load_arrival_assets() {
    await this.arrival_map.load_details(`${SITE_BASE}assets/arrival/`, this.arrival_abort.signal);
    this.refresh_arrival_ready();
    this.needs_render = true;
  }

  async set_arrival_ready() {
    this.arrival_world_ready = true;
    this.prepare_arrival_destination();
    // Compile PBR programs while the overview is still holding, before the
    // last zoom reveals the room. KHR_parallel_shader_compile is used if present.
    await this.renderer.compileAsync(this.scene,this.camera);
    if (this.disposed) return;
    await this.figure_focus.prepare(this.renderer, this.scene, this.camera, this.robot_meshes);
    if(this.disposed||!this.arrival)return;
    this.arrival_shaders_ready=true;
    this.refresh_arrival_ready();
  }

  refresh_arrival_ready() {
    if(this.disposed||!this.arrival)return;
    this.arrival.ready=Boolean(this.arrival_destination_ready&&this.arrival_shaders_ready&&this.arrival_map.details_ready);
  }

  prepare_arrival_destination() {
    if (!this.has_robot_pose || this.arrival_destination_ready) return;
    const position = this.camera.position.clone(), rotation = this.camera.quaternion.clone();
    const target = this.controls.target.clone(), up = this.camera.up.clone();
    this.camera.up.set(0, 0, 1);
    this.shoulder_camera.update(this.robot_position, this.robot_heading, 0, true);
    this.arrival.set_destination(this.camera.position, this.controls.target);
    this.camera.position.copy(position);this.camera.quaternion.copy(rotation);
    this.controls.target.copy(target);this.camera.up.copy(up);
    this.arrival_destination_ready = true;
    this.refresh_arrival_ready();
  }

  finish_arrival() {
    const position=this.camera.position.clone(),rotation=this.camera.quaternion.clone();
    this.arrival_map.dispose();
    this.arrival_map = this.arrival = this.arrival_opening = null;
    this.camera.up.set(0, 0, 1);
    this.camera.far = IS_HEPHAESTUS ? 300 : 100;
    this.set_camera('shoulder');
    this.arrival_handoff={position_m:position.distanceTo(this.camera.position),angle_degrees:THREE.MathUtils.radToDeg(rotation.angleTo(this.camera.quaternion))};
    this.on_arrival_complete();
  }

  zoom(factor) {
    if (this.arrival) return;
    if (this.mode === 'shoulder') this.shoulder_camera.zoom(factor);
    else {
      this.camera.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target);
      this.controls.update();
    }
    this.needs_render = true;
  }

  set_floor(floor) {
    this.viewed_floor = floor;
    this.update_figure_visibility();
    if(IS_HEPHAESTUS)this.apply_native_view();
    for (let level = 0; !IS_HEPHAESTUS && level < 2; level++) {
      this.floor_groups[level].visible = floor === 'all' || floor === level;
      const material = this.floor_surfaces[level].material;
      material.transparent = floor === 'all' && level === 1;
      material.opacity = material.transparent ? 0.3 : 1;
      material.depthWrite = !material.transparent;
    }
    if (this.camera && this.mode !== 'follow' && this.mode !== 'shoulder') this.set_camera(this.mode);
    this.renderer.shadowMap.needsUpdate = this.renderer.shadowMap.enabled;
    this.needs_render = true;
  }

  set_navigation(navigation) {
    if (this.navigation_overlay.update(navigation)) this.needs_render = true;
  }

  movement_heading() {
    return Math.atan2(this.controls.target.y - this.camera.position.y, this.controls.target.x - this.camera.position.x);
  }

  install_shoulder_orbit() {
    const canvas = this.renderer.domElement;
    let pointer = null;
    const down = event => {
      if (this.arrival || document.pointerLockElement || this.mode !== 'shoulder' || !event.isPrimary || ![0, 2].includes(event.button)) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false };
      canvas.setPointerCapture(event.pointerId);
    };
    const move = event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (!pointer.active && Math.hypot(dx, dy) <= 6) return;
      pointer.active = true;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      this.shoulder_camera.orbit(-dx * Math.PI * 2 / canvas.clientHeight, dy * Math.PI * 2 / canvas.clientHeight);
      this.needs_render = true;
    };
    const up = event => {
      if (pointer?.id !== event.pointerId) return;
      pointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const context = event => { if (this.mode === 'shoulder') event.preventDefault(); };
    const offset = new THREE.Vector3();
    const locked_move = event => {
      if (!document.pointerLockElement || this.arrival) return;
      const yaw = -event.movementX * 0.0025, pitch = event.movementY * 0.0025;
      if (this.mode === 'shoulder') this.shoulder_camera.orbit(yaw, pitch);
      else {
        offset.copy(this.camera.position).sub(this.controls.target);
        const radius = offset.length();
        const angle = Math.atan2(offset.y, offset.x) + yaw;
        const elevation = THREE.MathUtils.clamp(Math.atan2(offset.z, Math.hypot(offset.x, offset.y)) + pitch, 0.04, 1.53);
        offset.set(Math.cos(angle) * Math.cos(elevation), Math.sin(angle) * Math.cos(elevation), Math.sin(elevation));
        this.camera.position.copy(this.controls.target).addScaledVector(offset, radius);
        this.controls.update();
      }
      this.needs_render = true;
    };
    const locked_wheel = event => {
      if (!document.pointerLockElement || this.arrival) return;
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
      this.zoom(Math.exp(THREE.MathUtils.clamp(pixels * 0.001, -1, 1)));
    };
    const locked_context = event => { if (document.pointerLockElement) event.preventDefault(); };
    const handlers = [['pointerdown', down], ['pointermove', move], ['pointerup', up],
      ['pointercancel', up], ['lostpointercapture', up], ['contextmenu', context]];
    for (const [name, handler] of handlers) canvas.addEventListener(name, handler);
    document.addEventListener('mousemove', locked_move);
    document.addEventListener('wheel', locked_wheel, { passive: false });
    document.addEventListener('contextmenu', locked_context);
    this.remove_shoulder_orbit = () => {
      for (const [name, handler] of handlers) canvas.removeEventListener(name, handler);
      document.removeEventListener('mousemove', locked_move);
      document.removeEventListener('wheel', locked_wheel);
      document.removeEventListener('contextmenu', locked_context);
    };
  }

  install_picking() {
    const canvas = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    let press = null;
    const down = event => { press = !document.pointerLockElement && event.button === 0 && event.isPrimary
      ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null; };
    const move = event => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) press = null;
    };
    const cancel = () => { press = null; };
    const up = event => {
      const click = press;
      press = null;
      if (this.arrival || !click || click.id !== event.pointerId || event.button !== 0) return;
      const bounds = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1,
        1 - (event.clientY - bounds.top) / bounds.height * 2), this.camera);
      const surfaces = this.floor_surfaces.filter(surface => this.viewed_floor === 'all' || surface.userData.floor === this.viewed_floor);
      surfaces.push(this.stair_mesh);
      if (this.lift_open_floor >= 0 && (this.viewed_floor === 'all' || this.lift_open_floor === this.viewed_floor)) surfaces.push(this.lift_deck);
      // A click on the seat asks the robot to sit on it.
      if (this.seat_groups && this.on_seat) {
        const groups = this.seat_groups.filter(group => this.viewed_floor === 'all' ||
          SEATS.find(seat => seat.id === group.userData.seat_id).floor === this.viewed_floor);
        const seat_hit = raycaster.intersectObjects(groups, true)[0];
        const floor_hit = raycaster.intersectObjects(surfaces, false)[0];
        if (seat_hit && (!floor_hit || seat_hit.distance <= floor_hit.distance)) {
          let object = seat_hit.object;
          while (object && !object.userData.seat_id) object = object.parent;
          this.on_seat(object.userData.seat_id);
          canvas.focus({ preventScroll: true });
          return;
        }
      }
      const hit = raycaster.intersectObjects(surfaces, false)[0];
      if (hit) {
        if (hit.object === this.stair_mesh) this.on_destination?.([hit.point.x, hit.point.y, Math.round(stair_height([hit.point.x, hit.point.y]) / FLOOR_HEIGHT), stair_height([hit.point.x, hit.point.y])]);
        else this.on_destination?.([hit.point.x, hit.point.y, hit.object === this.lift_deck ? this.lift_open_floor : hit.object.userData.floor]);
      }
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
    if(IS_HEPHAESTUS){
      for(const root of [...this.floor_groups,this.map_roof,this.map_context])configure_native_materials(root,quality==='performance');
      this.apply_native_view();
    }
    for (const shadow of this.furniture_shadows) shadow.visible = quality === 'performance';
    this.renderer.shadowMap.enabled = quality === 'quality';
    // The room is static. Compute its shadow once. The robot uses the contact shadow.
    this.renderer.shadowMap.needsUpdate = quality === 'quality';
    this.resize();
  }

  set_theme(theme) {
    this.theme = theme;
    const night = theme === 'dark';
    this.scene.background.set(night ? '#111925' : '#f5f5f7');
    this.scene.fog.color.copy(this.scene.background);
    this.ambient_light.intensity = night ? 0.85 : 2;
    this.sunlight.intensity = night ? 0.9 : 2;
    this.sunlight.color.set(night ? '#a8bdde' : '#ffffff');
    this.scene.environmentIntensity = night ? 0.25 : 0.55;
    if (this.arrival_map) this.arrival_map.night = night;
    this.needs_render = true;
  }

  /** Keep physics and the map live without redrawing the covered 3D scene. */
  set_map_open(open) {
    this.render_suspended = open;
    this.needs_render = true;
    this.render_samples = [];
    this.last_render_time = this.last_fps_time = performance.now();
    this.on_metrics({ ...this.metrics, render_suspended: open, render_count: this.render_count,
      ...(open ? { fps: 0, render_ms: 0, p95_ms: 0, draw_calls: 0, triangles: 0 } : {}) });
  }

  render(time) {
    if (this.render_suspended || document.hidden) return;
    const started = performance.now();
    const seconds = Math.max(0, Math.min((time - this.last_render_time) / 1000, 0.1));
    this.last_render_time = time;
    if (this.mode === 'follow') {
      const delta = this.follow_delta.copy(this.robot_position).sub(this.last_follow_position);
      if (!this.vertical_motion) delta.z = 0;
      this.camera.position.add(delta);
      this.controls.target.add(delta);
      this.last_follow_position.copy(this.robot_position);
    }
    let camera_changed;
    if (this.arrival) {
      if (this.arrival_opening.phase === 'complete') {
        this.arrival.update(seconds);
      } else {
        const previous_opacity = this.arrival_opening.opacity;
        this.arrival_opening.update(seconds);
        if (previous_opacity !== this.arrival_opening.opacity) this.on_arrival_reveal(this.arrival_opening.opacity);
      }
      if (this.arrival.level !== this.arrival_level && !this.arrival.done) {
        this.arrival_level = this.arrival.level;
        this.on_arrival_level({ index: this.arrival.level, label: ARRIVAL_LEVELS[this.arrival.level].label });
      }
      if (this.arrival.done) this.finish_arrival();
      camera_changed = true;
    } else {
      camera_changed = this.mode === 'shoulder'
        ? this.shoulder_camera.update(this.robot_position, this.robot_heading, seconds)
        : this.controls.update();
      const heading = this.movement_heading();
      const turn = heading - (this.last_movement_heading ?? heading);
      if (this.last_movement_heading === undefined || this.mode !== 'shoulder' ||
        Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) > 0.005) {
        this.last_movement_heading = heading;
        if (this.mode === 'shoulder') this.on_camera_change?.();
      }
    }
    if (document.hidden || (this.paused && !this.needs_render && !camera_changed)) return;
    if (this.arrival_map) this.arrival_map.render(this.renderer, this.scene, this.camera, this.arrival, this.reduced_motion ? 0 : seconds);
    else {
      const figures = this.appearance === 'character' ? [this.character.object] : this.robot_meshes;
      this.figure_focus.render(this.renderer, this.scene, this.camera, figures,
        figure_opacity(this.camera.position, this.robot_position, this.robot_rotation));
    }
    this.needs_render = false;
    this.render_count++;
    this.render_samples.push(performance.now() - started);
    if (time - this.last_fps_time > 700) {
      const samples = this.render_samples.sort((a, b) => a - b);
      this.metrics = {
        fps: Math.round(samples.length * 1000 / (time - this.last_fps_time)),
        render_ms: samples.reduce((sum, value) => sum + value, 0) / samples.length,
        p95_ms: samples[Math.floor(samples.length * 0.95)],
        triangles: this.renderer.info.render.triangles,
        draw_calls: this.renderer.info.render.calls,
        pixel_ratio: this.renderer.getPixelRatio(),
        arrival_handoff: this.arrival_handoff,
        camera_heading: this.movement_heading(),
        figure_opacity: figure_opacity(this.camera.position, this.robot_position, this.robot_rotation),
        render_count: this.render_count,
        render_suspended: false,
      };
      this.on_metrics(this.metrics);
      this.render_samples = [];
      this.last_fps_time = time;
    }
  }

  dispose() {
    this.disposed = true;
    this.furniture_abort.abort();
    this.character_abort.abort();
    this.arrival_abort.abort();
    this.arrival_map?.dispose();
    window.removeEventListener(THEME_EVENT, this.theme_handler);
    document.removeEventListener('visibilitychange', this.visibility_handler);
    this.resize_observer.disconnect();
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('wheel', this.wheel_handler);
    this.remove_picking();
    this.remove_shoulder_orbit();
    this.figure_focus.dispose();
    this.sunlight.shadow.map?.dispose();
    dispose_model(this.scene);
    this.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
