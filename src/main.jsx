import { HAS_ELEVATOR, DEFAULT_TRANSFER } from './world.js';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { command_from_keys, camera_motion_from_keys, DEFAULT_WALK_SPEED } from './locomotion.js';
import { SPAWN } from './scene_layout.js';
import { Icon } from './icons.jsx';
import { SiteHeader } from './site_header.jsx';
import { IDLE_NAVIGATION } from './navigation.js';
import { MiniMap } from './mini_map.jsx';
import { FLOOR_NAMES, FLOOR_HEIGHT, on_stairs } from './building.js';
import { SITE_BASE } from './asset_paths.js';
import { ThemeToggle } from './theme_toggle.jsx';
import { ARRIVAL_LEVELS } from './arrival_levels.js';
import './style.css';
import './entry.css';
import './game_hud.css';

const INITIAL_TELEMETRY = {
  position: SPAWN,
  heading: 0,
  speed: 0,
  time: 0,
  distance: 0,
  command: [0, 0, 0],
  paused: false,
  fallen: false,
  mode: 'walk',
  policy: 'walk',
  falls: 0,
  getups: 0,
  teleports: 0,
  inference_ms: 0,
  simulation_rate: 1,
  floor: 0,
  navigation: IDLE_NAVIGATION,
  elevator: { height: 0, open_floor: 0, moving: false, target_floor: 0 },
  seat: { available: false, can_sit: false, can_stand: false, approach: null, message: null },
};
const POLICY_LABELS = { walk: 'Walk', walk_stairs: 'Stairs', getup_supine: 'Get up (back)', getup_prone: 'Get up (front)', sit: 'Sit (chair clip)' };
const SEAT_STATUS = { sit_down: 'Sitting down', seated: 'Seated', stand_up: 'Standing up' };
const SEAT_MESSAGES = {
  sit_down: 'Sitting down: the policy tracks a chair clip placed on the seat.',
  seated: 'Seated. Press F to stand up.',
  stand_up: 'Standing up. Walking resumes once it stands still.',
};
const CONTROL_KEYS = [
  [['KeyQ', 'Strafe left'], ['KeyW', 'Walk forward'], ['KeyE', 'Strafe right']],
  [['KeyA', 'Turn left'], ['KeyS', 'Walk backward'], ['KeyD', 'Turn right']],
];
const MOVEMENT_KEYS = new Set([
  ...CONTROL_KEYS.flat().map(([code]) => code),
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
const CAMERA_MODES = ['shoulder', 'follow', 'orbit', 'top'];

function capture_cursor() {
  if (document.pointerLockElement) return;
  const rejected = error => console.warn('Mouse capture unavailable:', error.message);
  try { document.body.requestPointerLock?.()?.catch(rejected); }
  catch (error) { rejected(error); }
}

function Playground({ on_exit, entry_complete, arrival_promise }) {
  const shell_ref = useRef(null);
  const viewport_ref = useRef(null);
  const view_ref = useRef(null);
  const preview_ref = useRef(null);
  const worker_ref = useRef(null);
  const keys_ref = useRef(new Set());
  const alt_held_ref = useRef(false);
  const shift_ref = useRef(false);
  const telemetry_ref = useRef(INITIAL_TELEMETRY);
  const speed_ref = useRef(DEFAULT_WALK_SPEED);
  const expanded_map_ref = useRef(false);
  const transfer_ref = useRef(DEFAULT_TRANSFER);
  const ready_ref = useRef(false);
  const phase_ref = useRef('intro');
  const entry_complete_ref = useRef(entry_complete);
  const figure_request = useRef(0);
  const [telemetry, set_telemetry] = useState(INITIAL_TELEMETRY);
  const [ready, set_ready] = useState(false);
  const [error, set_error] = useState('');
  const [performance_stats, set_performance_stats] = useState(null);
  const [camera, set_camera] = useState('shoulder');
  const [render_quality, set_render_quality] = useState('performance');
  const [speed, set_speed] = useState(DEFAULT_WALK_SPEED);
  const [pressed, set_pressed] = useState(new Set());
  const [viewed_floor, set_viewed_floor] = useState(0);
  const [transfer, set_transfer] = useState(DEFAULT_TRANSFER);
  const [figure, set_figure] = useState('robot');
  const [character_loading, set_character_loading] = useState(false);
  const [character_error, set_character_error] = useState('');
  const [phase, set_phase] = useState('intro');
  const [controls_open, set_controls_open] = useState(false);
  const [cursor_locked, set_cursor_locked] = useState(Boolean(document.pointerLockElement));
  const [teleport_open, set_teleport_open] = useState(false);
  const [map_open, set_map_open] = useState(false);
  const [teleport_floor, set_teleport_floor] = useState(0);
  const [teleport_message, set_teleport_message] = useState('Drag the robot onto open floor, or click a spot.');
  const [arrival_level, set_arrival_level] = useState({ index: 0, label: ARRIVAL_LEVELS[0].label });
  const expanded_map = map_open || teleport_open;
  expanded_map_ref.current = expanded_map;
  useEffect(() => { view_ref.current?.set_map_open(expanded_map); }, [expanded_map]);

  async function change_figure(value) {
    const request = ++figure_request.current;
    const view = view_ref.current;
    if (!view || !ready_ref.current) return;
    set_character_error('');
    set_character_loading(value === 'character' && !view.character);
    try {
      const applied = await view.set_appearance(value);
      if (request !== figure_request.current) return;
      if (applied) set_figure(value);
    } catch (exception) {
      if (request !== figure_request.current || exception.name === 'AbortError') return;
      set_character_error(`${exception.message} Select Character to retry.`);
    } finally {
      if (request === figure_request.current) set_character_loading(false);
    }
  }

  function send_command() {
    if (!ready_ref.current) return;
    const view = view_ref.current;
    worker_ref.current?.postMessage(view?.mode === 'shoulder' ? {
      type: 'camera_command',
      motion: camera_motion_from_keys(keys_ref.current, view.movement_heading(), speed_ref.current, shift_ref.current),
    } : {
      type: 'command',
      command: command_from_keys(keys_ref.current, speed_ref.current, shift_ref.current),
    });
    set_pressed(new Set(keys_ref.current));
  }

  function release_keys() {
    const held = keys_ref.current.size > 0;
    keys_ref.current.clear();
    shift_ref.current = false;
    if (held) send_command();
    else set_pressed(new Set());
  }

  function change_shift(held) {
    if (shift_ref.current === held) return;
    shift_ref.current = held;
    if (keys_ref.current.size) send_command();
  }

  function resume_cursor() {
    if (alt_held_ref.current) return;
    release_keys();
    capture_cursor();
  }

  function navigate(goal) {
    if (!ready_ref.current || telemetry_ref.current.fallen || telemetry_ref.current.mode !== 'walk') return;
    release_keys();
    if (goal.length === 4 || on_stairs(goal)) change_transfer('stairs');
    worker_ref.current?.postMessage({ type: 'goal', goal });
    if (expanded_map_ref.current) close_map();
  }

  function change_transfer(value) {
    transfer_ref.current = value;
    set_transfer(value);
    worker_ref.current?.postMessage({ type: 'transfer', transfer: value });
  }

  function cancel_navigation() {
    set_map_open(false);
    set_teleport_open(false);
    worker_ref.current?.postMessage({ type: 'cancel_navigation' });
  }

  function teleport(goal) {
    if (!ready_ref.current) return;
    release_keys();
    set_teleport_floor(goal[2]);
    set_controls_open(false);
    set_teleport_message('Placing robot…');
    worker_ref.current?.postMessage({ type: 'teleport', goal });
  }

  function close_map() {
    set_map_open(false);
    set_teleport_open(false);
    resume_cursor();
    viewport_ref.current?.querySelector('canvas')?.focus({ preventScroll: true });
  }

  function toggle_map() {
    if (expanded_map_ref.current) { close_map(); return; }
    release_keys();
    set_teleport_floor(telemetry_ref.current.floor);
    set_teleport_message('Click open floor, or drag the robot.');
    set_controls_open(false);
    set_map_open(true);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Walk to the Lite Pro seat and sit, or stand up from it. */
  function toggle_seat(id) {
    const current = telemetry_ref.current;
    const seat_id = typeof id === 'string' ? id : current.seat?.nearby?.id;
    if (!ready_ref.current || current.fallen || current.paused) return;
    if (current.seat?.can_stand) {
      worker_ref.current?.postMessage({ type: 'stand' });
    } else if (current.seat?.approach) {
      cancel_navigation();
    } else if (seat_id && current.seat?.available && current.mode === 'walk') {
      release_keys();
      worker_ref.current?.postMessage({ type: 'sit', seat_id });
    }
  }

  function change_floor(floor) {
    if (['follow', 'shoulder'].includes(view_ref.current?.mode)) change_camera('orbit');
    view_ref.current?.set_floor(floor);
    set_viewed_floor(floor);
  }

  function toggle_pause() {
    if (!ready_ref.current || telemetry_ref.current.fallen) return;
    release_keys();
    const paused = !telemetry_ref.current.paused;
    telemetry_ref.current = { ...telemetry_ref.current, paused };
    set_telemetry(telemetry_ref.current);
    worker_ref.current?.postMessage({ type: 'pause', paused });
  }

  function reset() {
    set_map_open(false);
    release_keys();
    set_teleport_open(false);
    worker_ref.current?.postMessage({ type: 'reset' });
    viewport_ref.current?.querySelector('canvas')?.focus();
  }

  function change_camera(mode) {
    if (['follow', 'shoulder'].includes(mode)) {
      view_ref.current?.set_floor(telemetry_ref.current.floor);
      set_viewed_floor(telemetry_ref.current.floor);
    }
    view_ref.current?.set_camera(mode);
    set_camera(mode);
    if (keys_ref.current.size) send_command();
  }

  function cycle_camera() {
    if (!ready_ref.current) return;
    const current = view_ref.current?.mode || 'shoulder';
    change_camera(CAMERA_MODES[(CAMERA_MODES.indexOf(current) + 1) % CAMERA_MODES.length]);
  }

  useEffect(() => {
    entry_complete_ref.current = entry_complete;
    if (preview_ref.current) preview_ref.current.opening.entry_complete = entry_complete;
    if (view_ref.current?.arrival_opening) view_ref.current.arrival_opening.entry_complete = entry_complete;
  }, [entry_complete]);

  useEffect(() => {
    let view;
    let preview;
    let worker;
    let last_ui_time = 0;
    let active = true;
    let robot_ready = false;
    let furniture_ready = false;
    let world_ready = false;
    const previous_overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function report_error(message) {
      if (!active) return;
      active = false;
      worker?.terminate();
      if (view) view.paused = true;
      set_error(message);
      ready_ref.current = false;
      set_ready(false);
    }

    function finish_loading() {
      if (!active || !robot_ready || !furniture_ready || world_ready) return;
      world_ready = true;
      set_ready(true);
      view.set_arrival_ready().catch(exception=>report_error(`Could not prepare the room. ${exception.message}`));
      worker.postMessage({ type: 'speed', speed: speed_ref.current });
      worker.postMessage({ type: 'transfer', transfer: transfer_ref.current });
    }

    function reveal_arrival(opacity) {
      shell_ref.current?.style.setProperty('--arrival-reveal', String(opacity));
    }

    async function initialize_world() {
      try {
        const { SceneView } = await import('./scene_view.js');
        if (!active) return;
        const arrival = preview.release();
        view = new SceneView(viewport_ref.current, set_performance_stats, navigate, arrival.renderer, () => {
          if (keys_ref.current.size) send_command();
        });
        view.on_seat = id => toggle_seat(id);
        view_ref.current = view;
        view.start_arrival(arrival, set_arrival_level, () => {
          if (!active) return;
          phase_ref.current = 'playing';
          ready_ref.current = true;
          set_phase('playing');
          worker.postMessage({ type: 'pause', paused: document.hidden });
          requestAnimationFrame(() => {
            if (active) view.renderer.domElement.focus({ preventScroll: true });
          });
        }, reveal_arrival);
        view.arrival_opening.entry_complete = entry_complete_ref.current;
        view.load_arrival_assets().catch(exception => report_error(`Could not load the satellite arrival. ${exception.message}`));
        view.load_furniture().then(() => {
          furniture_ready = true;
          finish_loading();
        }).catch((exception) => report_error(`Could not load the IKEA furniture. ${exception.message}`));
        worker = new Worker(new URL('./simulation.worker.js', import.meta.url), { type: 'module' });
        worker_ref.current = worker;
        worker.onmessage = (event) => {
          if (!active) return;
          const message = event.data;
          switch (message.type) {
            case 'teleport_result':
              if (message.ok) {
                close_map();
                set_viewed_floor(message.floor);
                set_teleport_message('Robot placed.');
              } else {
                set_teleport_open(true);
                set_teleport_message('That spot is blocked. Choose open floor.');
              }
              break;
            case 'error':
              report_error(message.message);
              break;
            case 'ready':
              view.load_robot(message.geometries, message.character_rig);
              robot_ready = true;
              finish_loading();
              break;
            case 'frame': {
              view.update_frame(message.transforms, message.telemetry);
              worker.postMessage({ type: 'frame_received', buffer: message.transforms.buffer }, [
                message.transforms.buffer,
              ]);
              // A paused state can be the last worker frame. Publish it without throttling.
              const urgent =
                message.telemetry.navigation?.version !== telemetry_ref.current.navigation?.version ||
                message.telemetry.paused ||
                message.telemetry.fallen ||
                message.telemetry.time < telemetry_ref.current.time ||
                message.telemetry.fallen !== telemetry_ref.current.fallen ||
                message.telemetry.mode !== telemetry_ref.current.mode ||
                message.telemetry.policy !== telemetry_ref.current.policy ||
                message.telemetry.teleports !== telemetry_ref.current.teleports ||
                message.telemetry.seat?.approach?.phase !== telemetry_ref.current.seat?.approach?.phase ||
                message.telemetry.seat?.message !== telemetry_ref.current.seat?.message ||
                message.telemetry.seat?.can_sit !== telemetry_ref.current.seat?.can_sit ||
                message.telemetry.seat?.can_stand !== telemetry_ref.current.seat?.can_stand ||
                message.telemetry.seat?.nearby?.id !== telemetry_ref.current.seat?.nearby?.id ||
                message.telemetry.paused !== telemetry_ref.current.paused;
              telemetry_ref.current = message.telemetry;
              const now = performance.now();
              if (now - last_ui_time > 250 || urgent) {
                set_telemetry(message.telemetry);
                set_viewed_floor(view.viewed_floor);
                last_ui_time = now;
              }
              break;
            }
          }
        };
        worker.onerror = (event) => {
          report_error(event.message || 'The physics worker could not start.');
        };
      } catch (exception) {
        report_error(`Could not create the 3D view. ${exception.message}`);
      }
    }
    async function initialize_preview() {
      try {
        preview = await arrival_promise;
        if (!active) { preview.dispose(); return; }
        preview_ref.current = preview;
        preview.opening.entry_complete = entry_complete_ref.current;
        preview.start(viewport_ref.current, reveal_arrival, () => { if (active) initialize_world(); });
        await preview.loaded;
      } catch (exception) {
        report_error(`Could not load the satellite arrival. ${exception.message}`);
      }
    }
    initialize_preview();

    const key_down = (event) => {
      if (phase_ref.current === 'intro' && event.code === 'Escape') {
        event.preventDefault();
        on_exit();
        return;
      }
      if (event.key === 'Alt') {
        event.preventDefault();
        if (!alt_held_ref.current) {
          alt_held_ref.current = true;
          release_keys();
          if (document.pointerLockElement) document.exitPointerLock();
        }
        return;
      }
      if (phase_ref.current !== 'playing') return;
      if (event.code === 'KeyM' && !event.repeat) {
        event.preventDefault();
        toggle_map();
        return;
      }
      if (expanded_map_ref.current) {
        if (event.code === 'Escape') { event.preventDefault(); close_map(); }
        return;
      }
      if (event.target.closest?.('[role="dialog"]')) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target.isContentEditable
      )
        return;
      if (event.key === 'Shift') {
        change_shift(event.shiftKey);
        return;
      }
      if (MOVEMENT_KEYS.has(event.code)) {
        event.preventDefault();
        if (keys_ref.current.has(event.code)) return;
        shift_ref.current = event.shiftKey;
        keys_ref.current.add(event.code);
        send_command();
      }
      if (event.repeat) return;
      if (event.code === 'Escape') cancel_navigation();
      if (event.code === 'Space') {
        event.preventDefault();
        toggle_pause();
      }
      if (event.code === 'KeyR') reset();
      if (event.code === 'KeyF') toggle_seat();
      if (event.code === 'KeyV' || event.code === 'KeyC') cycle_camera();
    };
    const key_up = (event) => {
      if (event.key === 'Alt') {
        event.preventDefault();
        if (alt_held_ref.current) {
          alt_held_ref.current = false;
          if (!document.hidden && !expanded_map_ref.current) capture_cursor();
        }
        return;
      }
      if (event.key === 'Shift') {
        change_shift(event.shiftKey);
        return;
      }
      if (MOVEMENT_KEYS.has(event.code) && keys_ref.current.delete(event.code)) {
        event.preventDefault();
        shift_ref.current = event.shiftKey;
        send_command();
      }
    };
    const lose_focus = () => { alt_held_ref.current = false; release_keys(); };
    const cursor_change = () => {
      set_cursor_locked(Boolean(document.pointerLockElement));
      if (!document.pointerLockElement) release_keys();
    };
    const visibility_change = () => {
      if (document.hidden) {
        release_keys();
        if (ready_ref.current && !telemetry_ref.current.paused) toggle_pause();
      }
    };
    window.addEventListener('keydown', key_down);
    window.addEventListener('keyup', key_up);
    window.addEventListener('blur', lose_focus);
    document.addEventListener('visibilitychange', visibility_change);
    document.addEventListener('pointerlockchange', cursor_change);
    return () => {
      active = false;
      ready_ref.current = false;
      document.body.style.overflow = previous_overflow;
      figure_request.current++;
      window.removeEventListener('keydown', key_down);
      window.removeEventListener('keyup', key_up);
      window.removeEventListener('blur', lose_focus);
      document.removeEventListener('visibilitychange', visibility_change);
      document.removeEventListener('pointerlockchange', cursor_change);
      if (document.pointerLockElement) document.exitPointerLock();
      worker?.terminate();
      view?.dispose();
      preview?.dispose();
    };
  }, []);

  function control_key(code, down, event) {
    event.preventDefault();
    if (down) {
      shift_ref.current = event.shiftKey;
      event.currentTarget.setPointerCapture(event.pointerId);
      keys_ref.current.add(code);
    } else keys_ref.current.delete(code);
    send_command();
  }

  const status = error
    ? 'Unavailable'
    : !ready
      ? 'Initializing'
      : telemetry.fallen
        ? 'Simulation stopped'
        : SEAT_STATUS[telemetry.mode]
          ? SEAT_STATUS[telemetry.mode]
          : telemetry.mode !== 'walk'
          ? 'Getting up'
          : telemetry.seat?.approach
          ? 'Walking to the seat'
          : telemetry.seat?.message
          ? 'Could not reach the seat'
          : telemetry.paused
          ? 'Paused'
          : 'Simulation live';
  const heading = ((((telemetry.heading * 180) / Math.PI) % 360) + 360) % 360;
  const interaction_seat = telemetry.seat?.can_stand || telemetry.seat?.approach
    ? telemetry.seat.active : telemetry.seat?.nearby;
  const interaction_action = telemetry.seat?.can_stand ? 'Stand up'
    : telemetry.seat?.approach ? 'Cancel' : telemetry.seat?.can_sit ? 'Sit down' : null;
  const minutes = Math.floor(telemetry.time / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(telemetry.time % 60)
    .toString()
    .padStart(2, '0');

  return (
    <div ref={shell_ref} className={`game-shell ${phase} ${controls_open ? 'controls-open' : ''} ${expanded_map ? 'map-open' : ''}`}>
      <div className="workspace" id="playground" inert={phase === 'intro'}>
        <main className="main-panel">
          <section className="scene-shell" aria-label="Indoor navigation simulation">
            <div className="viewport" ref={viewport_ref} />
            <div className="scene-topline">
              <div className="scene-tag">
                <Icon name="grid" size={15} />
                <strong>The apartment</strong>
                <span>01</span>
              </div>
              <div className="fps">
                <i />
                {performance_stats?.fps || '—'} FPS
              </div>
            </div>
            <div className="floor-switch" role="group" aria-label="Floor view">
              {[0, 1, 'all'].map(floor => <button key={floor} aria-pressed={viewed_floor === floor}
                className={viewed_floor === floor ? 'selected' : ''} onClick={() => change_floor(floor)}>
                {floor === 'all' ? 'Building' : FLOOR_NAMES[floor]}
              </button>)}
            </div>
            <div className="camera-switch" role="group" aria-label="Camera view">
              {CAMERA_MODES.map((mode) => (
                <button
                  key={mode}
                  className={camera === mode ? 'selected' : ''}
                  aria-pressed={camera === mode}
                  title={mode === 'shoulder' ? 'Drag to look around · move relative to the camera' : undefined}
                  onClick={() => change_camera(mode)}
                >
                  {mode === 'follow' && <Icon name="camera" size={15} />}{' '}
                  {mode === 'top' ? 'Top-down' : mode[0].toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            <label className="render-quality">
              Graphics
              <select
                aria-label="Graphics quality"
                value={render_quality}
                onChange={(event) => {
                  set_render_quality(event.target.value);
                  view_ref.current?.set_quality(event.target.value);
                }}
              >
                <option value="performance">Fast</option>
                <option value="quality">Quality</option>
              </select>
            </label>
            {phase === 'playing' && new URLSearchParams(window.location.search).has('profile') && performance_stats && (
              <output className="performance-diagnostics" aria-label="Performance diagnostics">
                {JSON.stringify(
                  {
                    ...performance_stats,
                    rtf: telemetry.simulation_rate,
                    inference_ms: telemetry.inference_ms,
                  },
                  null,
                  2,
                )}
              </output>
            )}
            {expanded_map && <div className="map-backdrop" onClick={close_map} />}
            {ready && <MiniMap telemetry={telemetry} local_view={!expanded_map}
              floor={expanded_map ? teleport_floor : viewed_floor === 'all' ? telemetry.floor : viewed_floor}
              on_destination={teleport_open ? teleport : navigate} on_teleport={teleport}
              on_expand={toggle_map} teleport_mode={teleport_open}>
              {expanded_map && <div className="map-tools">
                <div className="teleport-floor-switch" role="group" aria-label="Map floor">
                  {FLOOR_NAMES.map((name, floor) => <button key={floor} aria-pressed={teleport_floor === floor}
                    onClick={() => set_teleport_floor(floor)}>{name}</button>)}
                </div>
                <p role="status">{teleport_open ? teleport_message : 'Click to walk. Drag the robot to teleport.'}</p>
                <button className="map-teleport-toggle" aria-pressed={teleport_open}
                  onClick={() => set_teleport_open(value => !value)}>Teleport</button>
                <button className="map-close" aria-label="Close map" onClick={close_map}><kbd>M</kbd><Icon name="close" size={15} /></button>
              </div>}
            </MiniMap>}
            <div className="viewport-caption">
              <span className="axis-label">
                <b>X</b>
                <b>Y</b>
                <b>Z</b>
              </span>
              Click a floor to walk there <span className="mouse-hint">
                Drag to orbit · scroll to zoom
              </span>
            </div>
            <div className="scene-zoom" role="group" aria-label="Scene zoom">
              <button aria-label="Zoom out" title="Zoom out" onClick={() => view_ref.current?.zoom(1.4)}>−</button>
              <button aria-label="Zoom in" title="Zoom in" onClick={() => view_ref.current?.zoom(1 / 1.4)}>+</button>
            </div>

            {phase === 'playing' && ready && telemetry.paused && !telemetry.fallen && (
              <div className="paused-label">
                <Icon name="pause" size={15} /> Simulation paused
              </div>
            )}
          </section>

          <div className="session-toolbar">
            <div className="session-controls">
              <button className="primary-button" disabled={!ready || telemetry.fallen} onClick={toggle_pause}>
                <Icon name={telemetry.paused ? 'play' : 'pause'} size={16} />
                {telemetry.paused ? 'Resume' : 'Pause'}
                <kbd>SPACE</kbd>
              </button>
              <button className="secondary-button" disabled={!ready} onClick={reset}>
                <Icon name="reset" size={16} />
                Reset<kbd>R</kbd>
              </button>
              {telemetry.seat?.available && <button className="secondary-button"
                disabled={!ready || telemetry.fallen || telemetry.paused || !(telemetry.seat.can_sit || telemetry.seat.can_stand || telemetry.seat.approach)}
                onClick={toggle_seat}>
                {telemetry.seat.can_stand ? 'Stand up' : telemetry.seat.approach ? 'Cancel sit' : 'Sit'}<kbd>F</kbd>
              </button>}
            </div>
            <div className="session-stats">
              <span>
                SESSION{' '}
                <strong>
                  {minutes}:{seconds}
                </strong>
              </span>
              <span>
                DISTANCE{' '}
                <strong>
                  {telemetry.distance.toFixed(1)} <small>m</small>
                </strong>
              </span>
            </div>
          </div>
          <div className="character-status" role="status" aria-live="polite">
            {character_loading ? 'Loading character…' : character_error}
          </div>
          <div className="workspace-note">
            <span>
              <i /> Real physics. Learned locomotion.
            </span>
            <span>
              Click to go · WASD to take over <span className="note-divider">·</span> Space to pause{' '}
              <span className="note-divider">·</span> R to reset
            </span>
          </div>
        </main>

        <aside className="sidebar" id="game-controls" aria-label="Robot controls and telemetry">
          <div className="sidebar-heading">
            <span>Controls</span>
            <span className="connection-dot" />
          </div>

          <section className="navigation-section">
            <div className="section-title"><h3>Navigate</h3><span>Click the floor</span></div>
            {HAS_ELEVATOR && <label className="transfer-choice">Between floors
              <select aria-label="Cross-floor route" value={transfer} onChange={event => change_transfer(event.target.value)}>
                <option value="elevator">Elevator</option>
                <option value="stairs">Stairs · experimental</option>
              </select>
            </label>}
            <div className={`navigation-status ${telemetry.navigation?.status || 'idle'}`} role="status" aria-label="Navigation status">
              {telemetry.paused && ['walking', 'waiting', 'riding'].includes(telemetry.navigation?.status) ? 'Paused · route saved'
                : SEAT_MESSAGES[telemetry.mode] ?? telemetry.seat?.approach?.message ?? telemetry.seat?.message ?? (telemetry.navigation?.message || IDLE_NAVIGATION.message)}
              {telemetry.navigation?.remaining > 0 && <span>{telemetry.navigation.remaining.toFixed(1)} m remaining</span>}
            </div>
            <button className="stop-navigation" onClick={cancel_navigation}
              disabled={!['walking', 'waiting', 'riding', 'arrived'].includes(telemetry.navigation?.status)}>
              {telemetry.navigation?.status === 'arrived' ? 'Clear route' : 'Stop'} <kbd>ESC</kbd></button>
          </section>

          <section className="control-section">
            <div className="section-title">
              <h3>Move</h3>
              <span><kbd>Shift</kbd> 2× speed</span>
            </div>
            <div className="keyboard" aria-label="Movement controls">
              {CONTROL_KEYS.map((row, index) => (
                <div className="key-row" key={index}>
                  {row.map(([code, title]) => (
                    <ControlKey
                      key={code}
                      code={code}
                      title={camera === 'shoulder' && ['KeyA', 'KeyD'].includes(code)
                        ? code === 'KeyA' ? 'Move left' : 'Move right' : title}
                      pressed={pressed}
                      on_control={control_key}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="key-explanations">
              <span>
                <kbd>W</kbd>
                <kbd>S</kbd> Move
              </span>
              <span>
                <kbd>A</kbd>
                <kbd>D</kbd> {camera === 'shoulder' ? 'Move' : 'Turn'}
              </span>
              <span>
                <kbd>Q</kbd>
                <kbd>E</kbd> Strafe
              </span>
            </div>
            <div className="speed-label">
              <label htmlFor="walking-speed">Speed</label>
              <output htmlFor="walking-speed">
                {speed.toFixed(2)} <span>m/s</span>
              </output>
            </div>
            <input
              id="walking-speed"
              type="range"
              min="0.2"
              max="0.8"
              step="0.05"
              value={speed}
              onChange={(event) => {
                const value = Number(event.target.value);
                speed_ref.current = value;
                set_speed(value);
                worker_ref.current?.postMessage({ type: 'speed', speed: value });
                if (keys_ref.current.size) send_command();
              }}
            />
          </section>

          <details className="telemetry-section">
            <summary>Telemetry</summary>
            <div className="telemetry-rows">
              <div>
                <span>Speed</span>
                <output aria-label="Actual robot speed">{telemetry.speed.toFixed(2)} <small>m/s</small></output>
              </div>
              <div>
                <span>
                  Position <small>X / Y</small>
                </span>
                <output aria-label="Robot position">
                  {telemetry.position[0].toFixed(2)} / {telemetry.position[1].toFixed(2)} <small>m</small>
                </output>
              </div>
              <div>
                <span>Heading</span>
                <output aria-label="Robot heading">
                  {heading.toFixed(0)}
                  <small>°</small>
                </output>
              </div>
              <div>
                <span>Base height</span>
                <output>
                  {telemetry.position[2].toFixed(2)} <small>m</small>
                </output>
              </div>
              <div>
                <span>Policy <small>{telemetry.getups} get-ups</small></span>
                <output aria-label="Active policy">{POLICY_LABELS[telemetry.policy] ?? 'Holding still'}</output>
              </div>
            </div>
            <div className="command-heading">Command · robot frame</div>
            <div className="command-readout">
              {['vₓ', 'vᵧ', 'ω'].map((label, index) => (
                <div key={label}>
                  <span>{label}</span>
                  <output>{telemetry.command[index].toFixed(2)}</output>
                  <small>{index === 2 ? 'rad/s' : 'm/s'}</small>
                </div>
              ))}
            </div>
          </details>

          <a className="text-button" href={`${SITE_BASE}how-it-works/`}>
            How it works <span>↗</span>
          </a>
        </aside>
      </div>
      {phase === 'intro' ? <>
        <span className="arrival-announcement" role="status" aria-live="polite">{arrival_level.label}</span>
        {error && <div className="arrival-status has-error" role="alert">
          <h1>We could not open the world.</h1>
          <p>{error}</p>
          <button onClick={on_exit}>Back to site <span>↗</span></button>
        </div>}
        <div className="arrival-credit">
          <a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless</a><span> by </span>
          <a href="https://eox.at" target="_blank" rel="noreferrer">EOX</a><span> · modified Copernicus Sentinel 2016 &amp; 2017</span>
          <span> / </span><a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noreferrer">USGS · USDA</a>
          <span> / </span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
        </div>
      </> : <>
        <div className="game-bar">
          <button className="game-camera" onClick={cycle_camera} aria-label="Cycle camera view">
            <kbd>V</kbd> {camera === 'top' ? 'Top-down' : camera[0].toUpperCase() + camera.slice(1)}
          </button>
          <div className="game-menu">
            <span className="game-status">{status}</span>
            <ThemeToggle />
            <button aria-label={telemetry.paused ? 'Resume simulation' : 'Pause simulation'} title="Space · Pause"
              disabled={!ready || telemetry.fallen} onClick={toggle_pause}>
              <Icon name={telemetry.paused ? 'play' : 'pause'} size={18} /></button>
            <button aria-label="Reset robot" title="R · Reset" disabled={!ready} onClick={reset}><Icon name="reset" size={18} /></button>
            <button className="game-map-button" aria-label="Open map" aria-expanded={expanded_map} title="M · Map"
              aria-keyshortcuts="M" onClick={toggle_map}><kbd>M</kbd><Icon name="teleport" size={18} /></button>
            <button aria-expanded={controls_open} aria-controls="game-controls"
              aria-label={controls_open ? 'Close controls' : 'Controls'} title="Controls"
              onClick={() => set_controls_open(!controls_open)}><Icon name="controls" size={18} /></button>
            <button onClick={on_exit} aria-label="Exit to site"><Icon name="close" size={18} /></button>
          </div>
        </div>
        <div className="figure-switch game-figure-switch" role="group" aria-label="Figure appearance">
          {['robot', 'character'].map(value => <button key={value} aria-pressed={figure === value}
            disabled={!ready || (value === 'character' && character_loading)} onClick={() => change_figure(value)}>
            <Icon name={value === 'robot' ? 'robot' : 'person'} size={23} />
            <span>{value === 'robot' ? 'Robot' : 'Character'}</span>
          </button>)}
        </div>
        {interaction_seat && interaction_action && !expanded_map && <div className="interaction-pane" role="group" aria-label="Furniture interaction">
          <div className="interaction-name"><span className="interaction-symbol"><Icon name="seat" size={20} /></span>
            <span>{interaction_seat.name}<small>{interaction_seat.kind}</small></span></div>
          <button onClick={() => toggle_seat(interaction_seat.id)} disabled={telemetry.paused}
            aria-label={`${interaction_action} · ${interaction_seat.name}`} aria-keyshortcuts="F">
            <kbd>F</kbd><Icon name="seat" size={18} /><strong>{interaction_action}</strong><span>›</span>
          </button>
        </div>}
        <div className="game-key-hint">
          {!controls_open && <><span><kbd>WASD</kbd> Move</span><span><kbd>SHIFT</kbd> 2× speed</span>
            <span><kbd>V</kbd> View</span><span><kbd>SPACE</kbd> Pause</span></>}
          <button onClick={resume_cursor} aria-pressed={cursor_locked} title="Hold Alt for the cursor; release to look">
            <kbd>ALT</kbd> {cursor_locked ? 'Hold for cursor' : 'Look'}</button>
        </div>
      </>}
    </div>
  );
}

function ControlKey({ code, title, pressed, on_control }) {
  return (
    <button
      className={`control-key ${pressed.has(code) ? 'pressed' : ''} ${code === 'KeyQ' || code === 'KeyE' ? 'auxiliary' : ''}`}
      aria-label={title}
      title={title}
      onPointerDown={(event) => on_control(code, true, event)}
      onPointerUp={(event) => on_control(code, false, event)}
      onPointerCancel={(event) => on_control(code, false, event)}
      onLostPointerCapture={(event) => on_control(code, false, event)}
    >
      {code.slice(3)}
    </button>
  );
}

function Landing({ leaving, on_play, on_left }) {
  return <div className={`entry-page ${leaving ? 'departing' : ''}`} id="top" inert={leaving}
    onAnimationEnd={event => { if (event.target === event.currentTarget && leaving) on_left(); }}>
    <SiteHeader current="playground">
      <button className="nav-cta" onClick={on_play}>Play <span aria-hidden="true">↗</span></button>
    </SiteHeader>
    <main className="entry-content" id="playground">
      <div className="entry-copy">
        <div className="eyebrow">THE INTERACTIVE ROBOTICS PLAYGROUND</div>
        <h1>Step into<br /><span>your world.</span></h1>
        <p>A real walking policy. A world to explore.<br />All in your browser.</p>
        <button className="entry-play" onClick={on_play}><Icon name="play" size={19} /> Play <span>↗</span></button>
        <div className="entry-keys"><span>WASD to move</span><i /> <span>V to change view</span></div>
      </div>
    </main>
    <footer className="entry-footer"><span>Real physics. Learned locomotion.</span><a href={`${SITE_BASE}how-it-works/`}>See how it works <span>↗</span></a></footer>
  </div>;
}

function App() {
  const arrival_ref = useRef(null);
  const [entered, set_entered] = useState(false);
  const [landing_visible, set_landing_visible] = useState(true);
  function preload_arrival() {
    if (!arrival_ref.current) {
      arrival_ref.current = import('./arrival_preview.js').then(({ ArrivalPreview }) => new ArrivalPreview());
      arrival_ref.current.catch(() => {});
    }
    return arrival_ref.current;
  }
  useEffect(() => {
    preload_arrival();
    return () => { arrival_ref.current?.then(preview => preview.dispose()).catch(() => {}); };
  }, []);
  function exit() {
    if (document.pointerLockElement) document.exitPointerLock();
    set_entered(false);
    set_landing_visible(true);
    arrival_ref.current = null;
    preload_arrival();
  }
  function play() {
    capture_cursor();
    preload_arrival();
    set_entered(true);
  }
  return <>
    {entered && <Playground on_exit={exit} entry_complete={!landing_visible} arrival_promise={arrival_ref.current} />}
    {landing_visible && <Landing leaving={entered} on_play={play} on_left={() => set_landing_visible(false)} />}
  </>;
}

const root = createRoot(document.getElementById('root'));
const search = new URLSearchParams(window.location.search);
if (search.get('demo') === 'rest') {
  import('./demo_rest.jsx').then(({ RestDemoPage }) => root.render(
    <RestDemoPage seed={Number(search.get('seed') ?? 1)} record={search.has('record')} />));
} else root.render(<App />);
