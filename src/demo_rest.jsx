// The "take a rest" qual demo page, /?demo=rest[&seed=N][&record]: the playground scene with the game HUD replaced by
// the three-level overlay. `record` steps the simulation one video frame at a time through window.rest_demo, for
// scripts/record_demo_rest.js. See demo_rest.js for the scripted levels.
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import '@fontsource-variable/inter';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import { THEME_EVENT } from './theme.js';
import { REST_DEMO, SUBTASKS } from './demo_rest.js';
import { SEATS } from './seat.js';
import './demo_rest.css';

const FPS = 30;
const PROMPT = 'Take a rest.';
const ACCENT = '#a9b4e8';
const GROUND = '#121417';
const TYPE = [0.3, 1.5]; // s, the prompt types out
const REPLY = [2, 2.35, 2.7, 3.05]; // s, the S2 header and its three sub-tasks appear
const CASCADE_S = 0.4; // each level lights for this long when a sub-task starts, S2 then S1, before S0
// The 3/4 camera looks over the robot toward the sofa from the south-east, and closes in as the robot arrives.
const CAMERA = { azimuth: -0.75, elevation: 0.5, far: 6.3, near: 4.3, seat_weight: 0.4, smooth_s: 0.9 };
const STAGES = { route: 0, align: 1, sit_down: 2, seated: 2 };

const ease = (from, to, value) => THREE.MathUtils.clamp((value - from) / (to - from), 0, 1);

/** The part of `path` still ahead of `position`: from the nearest point on it to the end. */
function ahead(path, position) {
  let best = { distance: Infinity, index: 0, point: path[0] };
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = THREE.MathUtils.clamp(((position[0] - a[0]) * dx + (position[1] - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const point = [a[0] + t * dx, a[1] + t * dy, a[2] + t * (b[2] - a[2])];
    const distance = Math.hypot(point[0] - position[0], point[1] - position[1]);
    if (distance < best.distance) best = { distance, index: i, point };
  }
  return [best.point, ...path.slice(best.index)];
}

function set_matrix(mesh, t) {
  mesh.matrix.set(t[3], t[4], t[5], t[0], t[6], t[7], t[8], t[1], t[9], t[10], t[11], t[2], 0, 0, 0, 1);
  mesh.matrixWorldNeedsUpdate = true;
}

/** The plan S1 hands S0, drawn in the scene: a dashed route, and a translucent robot at the planned pose. */
class PlanOverlay {
  constructor(view) {
    this.route = new Line2(new LineGeometry(), new LineMaterial({ color: ACCENT, linewidth: 4, dashed: true,
      dashSize: 0.14, gapSize: 0.09, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.route.renderOrder = 10001;
    this.route.frustumCulled = false;
    this.route.visible = false;
    view.scene.add(this.route);
    // A depth-only pass first, so the colour pass draws only the ghost's nearest surface: an accent rim that fades
    // toward the middle of each part, so the robot behind or inside it stays visible.
    const depth = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true });
    this.material = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(ACCENT) }, opacity: { value: 1 } },
      vertexShader: `varying vec3 view_normal; varying vec3 view_direction;
        void main() {
          vec4 position_view = modelViewMatrix * vec4(position, 1.0);
          view_normal = normalMatrix * normal;
          view_direction = -position_view.xyz;
          gl_Position = projectionMatrix * position_view;
        }`,
      fragmentShader: `uniform vec3 color; uniform float opacity; varying vec3 view_normal; varying vec3 view_direction;
        void main() {
          float rim = 1.0 - abs(dot(normalize(view_normal), normalize(view_direction)));
          gl_FragColor = vec4(color, opacity * (0.18 + 0.75 * pow(rim, 1.6)));
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, toneMapped: false });
    this.ghost = view.robot_meshes.flatMap(mesh => [[depth, 20], [this.material, 21]].map(([material, order]) => {
      const ghost = new THREE.Mesh(mesh.geometry, material);
      ghost.matrixAutoUpdate = false;
      ghost.renderOrder = order;
      ghost.visible = false;
      view.scene.add(ghost);
      return ghost;
    }));
  }

  update(report, ghost, route_opacity, position) {
    if (report?.route?.path?.length > 1) this.path = report.route.path;
    if (this.path && report?.stage === 'route') {
      // Only the route ahead of the robot; the dashes are counted from its end, so they stay put on the floor.
      const remaining = ahead(this.path, position);
      this.route.geometry.dispose();
      this.route.geometry = new LineGeometry().setPositions(remaining.flatMap(([x, y, z]) => [x, y, z + 0.06]));
      this.route.computeLineDistances();
      const end = this.route.geometry.attributes.instanceDistanceEnd.array;
      this.route.material.dashOffset = -(end.at(-1) ?? 0);
    }
    this.route.visible = Boolean(this.path) && route_opacity > 0;
    this.route.material.opacity = route_opacity;
    for (let index = 0; index < this.ghost.length; index++) {
      this.ghost[index].visible = Boolean(ghost);
      if (ghost) set_matrix(this.ghost[index], ghost.subarray((index >> 1) * 12, (index >> 1) * 12 + 12));
    }
  }
}

/** A 3/4 follow camera, smoothed in simulation time so a stepped recording frames the same way every take. */
class DemoCamera {
  constructor(view) {
    this.view = view;
    this.seat = SEATS.find(seat => seat.id === REST_DEMO.seat);
    this.focus = null;
  }

  update(position, time) {
    const seat = this.seat.front;
    const remaining = Math.hypot(seat[0] - position[0], seat[1] - position[1]);
    const goal = new THREE.Vector3(
      THREE.MathUtils.lerp(position[0], seat[0], CAMERA.seat_weight),
      THREE.MathUtils.lerp(position[1], seat[1], CAMERA.seat_weight), 0.55);
    const distance = THREE.MathUtils.lerp(CAMERA.near, CAMERA.far, ease(1, 5, remaining));
    const dt = this.time === undefined ? Infinity : Math.max(0, time - this.time);
    this.time = time;
    const blend = 1 - Math.exp(-dt / CAMERA.smooth_s);
    if (!this.focus) [this.focus, this.distance] = [goal, distance];
    this.focus.lerp(goal, blend);
    this.distance += (distance - this.distance) * blend;
    const { camera, controls } = this.view;
    const c = Math.cos(CAMERA.elevation);
    camera.position.set(this.focus.x + this.distance * c * Math.cos(CAMERA.azimuth),
      this.focus.y + this.distance * c * Math.sin(CAMERA.azimuth), this.focus.z + this.distance * Math.sin(CAMERA.elevation));
    controls.target.copy(this.focus);
    camera.lookAt(this.focus);
  }
}

/** The level that just acted: the request flows S2 → S1 → S0 when each sub-task starts, then S0 tracks. */
function active_level(time, stage, stage_time) {
  if (time < REPLY[0]) return null;
  if (stage === 'ask') return 2;
  if (stage === 'failed') return null;
  const since = time - stage_time;
  if (stage === 'seated') return 0;
  if (since < (stage === 'route' ? 0 : CASCADE_S)) return 2;
  if (since < (stage === 'route' ? CASCADE_S : 2 * CASCADE_S)) return 1;
  return 0;
}

const number = (value, digits = 2) => value.toFixed(digits).replace(/^-/, '−').replace(/^−(0\.0*)$/, '$1');

function level_values(state) {
  const { report, telemetry, path_length } = state;
  const stage = report?.stage ?? 'ask';
  const subtask = STAGES[stage];
  const s2 = subtask === undefined ? (state.time < REPLY[0] ? 'Listening' : 'Splitting the request')
    : `${subtask + 1} / 3 · ${SUBTASKS[subtask].label}`;
  let s1 = 'Waiting for a sub-task';
  if (stage === 'route') s1 = `Route · ${number(path_length, 1)} m to the staging pose`;
  if (stage === 'align') s1 = `Pose target · back to the seat · ${number(report.target.distance)} m`;
  if (stage === 'sit_down') s1 = `Pose trajectory · sit-down clip · frame ${report.clip.lead} / ${report.clip.last_frame}`;
  if (stage === 'seated') s1 = `Pose trajectory · holding frame ${report.clip.last_frame}`;
  const [vx, vy, wz] = telemetry?.command ?? [0, 0, 0];
  const s0 = telemetry?.policy === 'sit'
    ? `Sit policy · tracking frame ${report?.clip?.frame ?? 0}`
    : `Walk policy · v ${number(Math.hypot(vx, vy))} m/s · ω ${number(wz)} rad/s`;
  return [s0, s1, s2];
}

function Check({ done }) {
  return <svg className="subtask-mark" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="8.5" />
    {done && <path d="M6 10.4l2.7 2.6L14 7.6" />}
  </svg>;
}

function Overlay({ state }) {
  const { time, report } = state;
  const stage = report?.stage ?? 'ask';
  const typed = PROMPT.slice(0, Math.round(PROMPT.length * ease(TYPE[0], TYPE[1], time)));
  const current = STAGES[stage];
  const level = active_level(time, stage, state.stage_time);
  const values = level_values(state);
  const rows = [
    ['S2', 'Task planner', 'scripted'],
    ['S1', 'Trajectory generator', 'scripted'],
    ['S0', 'Fluctlight tracker', '50 Hz'],
  ];
  return <div className="demo-overlay">
    <section className="demo-chat" aria-label="Request">
      <div className="chat-user">
        <span className="chat-who">User</span>
        <p className="chat-bubble">{typed}{time < TYPE[1] + 0.4 && <i className="chat-caret" />}</p>
      </div>
      {time >= REPLY[0] && <div className="chat-reply">
        <span className="chat-who">S2 · task planner · scripted</span>
        <ol>
          {SUBTASKS.map((subtask, index) => time >= REPLY[index + 1] && <li key={subtask.label}
            className={index < (report?.done ?? 0) ? 'done' : index === current ? 'active' : ''}>
            <Check done={index < (report?.done ?? 0)} />
            <span className="subtask-number">{index + 1}</span>{subtask.label}
          </li>)}
        </ol>
      </div>}
    </section>

    <section className="demo-levels" aria-label="Control levels">
      {rows.map(([name, title, note], index) => <div key={name} className={`level-row ${2 - index === level ? 'current' : ''}`}>
        <span className="level-name">{name}</span>
        <span className="level-title">{title} <small>{note}</small></span>
        <span className="level-value">{values[2 - index]}</span>
      </div>)}
      <p className="level-footer">S2 and S1 scripted · S0 learned policies in MuJoCo</p>
    </section>

    <section className="demo-legend" aria-label="Legend">
      <span><svg viewBox="0 0 40 12" aria-hidden="true"><path className="legend-plan" d="M2 6h36" /></svg>Plan · S1</span>
      <span><svg viewBox="0 0 40 12" aria-hidden="true"><path className="legend-executed" d="M2 6h36" /></svg>Executed · S0</span>
    </section>
    {stage === 'failed' && <p className="demo-failed">The robot fell. Reload for another take.</p>}
  </div>;
}

export function RestDemoPage({ seed, record }) {
  const viewport_ref = useRef(null);
  const [state, set_state] = useState({ time: 0, report: null, telemetry: null, stage_time: 0, path_length: 0 });
  const [error, set_error] = useState('');

  useEffect(() => {
    let active = true, view, worker, plan, camera, frame_waiter = null, stage = 'ask', stage_time = 0, path_length = 0;
    let robot_ready = false, scene_ready = false, running = false;
    document.documentElement.dataset.theme = 'dark';
    window.dispatchEvent(new Event(THEME_EVENT));
    document.body.classList.add('rest-demo-body');

    function fail(message) {
      if (!active) return;
      set_error(message);
      worker?.terminate();
    }

    async function start() {
      if (!robot_ready || !scene_ready) return;
      plan = new PlanOverlay(view);
      camera = new DemoCamera(view);
      await view.renderer.compileAsync(view.scene, view.camera);
      worker.postMessage({ type: 'demo', seed, stepped: record });
      if (!record) worker.postMessage({ type: 'pause', paused: false });
    }

    async function initialize() {
      const { SceneView } = await import('./scene_view.js');
      if (!active) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      view = new SceneView(viewport_ref.current, () => {}, () => {}, renderer, () => {});
      view.scene.background.set(GROUND);
      view.scene.fog.color.set(GROUND);
      // The game's markers are blue; the demo draws only the plan, in the accent colour.
      view.trail.visible = view.navigation_overlay.visible = false;
      view.robot_marker.material.visible = false;
      view.set_camera('orbit');
      view.controls.enabled = false;
      const resize = view.resize.bind(view);
      view.resize = () => { resize(); renderer.setPixelRatio(record ? 2 : Math.min(window.devicePixelRatio, 2)); };
      view.set_quality('quality');
      view.load_furniture().then(() => { scene_ready = true; start(); })
        .catch(exception => fail(`Could not load the room. ${exception.message}`));
      worker = new Worker(new URL('./simulation.worker.js', import.meta.url), { type: 'module' });
      worker.onerror = event => fail(event.message || 'The physics worker could not start.');
      worker.onmessage = event => {
        const message = event.data;
        if (message.type === 'error') fail(message.message);
        if (message.type === 'ready') {
          view.load_robot(message.geometries, message.character_rig);
          robot_ready = true;
          start();
        }
        if (message.type !== 'frame') return;
        view.update_frame(message.transforms, message.telemetry);
        worker.postMessage({ type: 'frame_received', buffer: message.transforms.buffer }, [message.transforms.buffer]);
        const { telemetry } = message, report = telemetry.demo;
        if (!report || !plan) return;
        running = true;
        if (report.stage !== stage) [stage, stage_time] = [report.stage, report.time];
        const path = report.route?.path;
        if (path && !path_length) path_length = path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);
        const route_opacity = stage === 'route' ? 1 : stage === 'align' ? 1 - ease(0, 0.8, report.time - stage_time) : 0;
        plan.update(report, message.ghost, route_opacity, telemetry.position);
        plan.material.uniforms.opacity.value = stage === 'seated' ? 1 - ease(0.3, 1.3, report.time - stage_time) : 1;
        camera.update(telemetry.position, report.time);
        set_state({ time: report.time, report, telemetry, stage_time, path_length });
        frame_waiter?.(report);
      };
    }

    // The recorder's hook: advance to video frame `index`, wait for the overlay and the scene to draw it.
    window.rest_demo = {
      fps: FPS,
      ready: () => running,
      frame: index => new Promise(resolve => {
        frame_waiter = report => {
          frame_waiter = null;
          requestAnimationFrame(() => requestAnimationFrame(() => resolve({ ...report, route: undefined })));
        };
        worker.postMessage({ type: 'step', time: index / FPS });
      }),
    };
    initialize().catch(exception => fail(`Could not create the 3D view. ${exception.message}`));
    return () => {
      active = false;
      worker?.terminate();
      view?.dispose();
      delete window.rest_demo;
      document.body.classList.remove('rest-demo-body');
    };
  }, [seed, record]);

  return <div className={`rest-demo ${state.report ? 'running' : ''}`}>
    <div className="demo-viewport" ref={viewport_ref} />
    {state.report && <Overlay state={state} />}
    {!state.report && !error && <p className="demo-loading">Loading Lite Pro, the policies and the apartment…</p>}
    {error && <p className="demo-loading" role="alert">{error}</p>}
  </div>;
}
