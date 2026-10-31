import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SceneView } from './scene_view.js';
import { command_from_keys } from './locomotion.js';
import { SCENE_WALLS, SCENE_FURNITURE, FURNITURE_ASSETS, ROOM_LABELS, SPAWN } from './scene_layout.js';
import { Icon } from './icons.jsx';
import { SiteHeader } from './site_header.jsx';
import { IDLE_NAVIGATION } from './navigation.js';
import { FLOOR_HEIGHT, ELEVATOR, STAIRS } from './building.js';
import './style.css';

const INITIAL_TELEMETRY = {
  position: SPAWN,
  heading: 0,
  speed: 0,
  time: 0,
  distance: 0,
  command: [0, 0, 0],
  paused: false,
  fallen: false,
  inference_ms: 0,
  simulation_rate: 1,
  floor: 0,
  navigation: IDLE_NAVIGATION,
  elevator: { height: 0, open_floor: 0, moving: false, target_floor: 0 },
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
const CAMERA_MODES = ['follow', 'orbit', 'top'];

function MiniMap({ telemetry, floor, on_destination }) {
  return (
    <div className="minimap">
      <div className="map-heading">
        <span>
          <span className="tiny-square" /> Floor plan
        </span>
        <span>{floor === 0 ? 'Ground' : 'Upper'} · 17 × 12 m</span>
      </div>
      <svg viewBox="-10.5 -6.5 18 13" aria-label="Floor plan: click an open spot to set a destination" role="img"
        onClick={event => {
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(event.currentTarget.getScreenCTM().inverse());
          on_destination([point.x, -point.y, floor]);
        }}>
        <rect x="-10" y="-6" width="17" height="12" rx="0.1" fill="#f3f4f6" />
        <g transform="scale(1,-1)">
          {SCENE_WALLS.map((box) => (
            <rect
              key={box.name}
              x={box.center[0] - box.size[0] / 2}
              y={box.center[1] - box.size[1] / 2}
              width={box.size[0]}
              height={box.size[1]}
              fill="#92959d"
            />
          ))}
          <rect x={STAIRS.opening[0]} y={STAIRS.opening[2]} width="1.8" height="5.4" fill="#b7bdc6" />
          <rect x={ELEVATOR.center[0] - 0.85} y={ELEVATOR.center[1] - 0.85} width="1.7" height="1.7" fill="#b1ccec" />
          {SCENE_FURNITURE.filter(item => Math.floor((item.position[2] + 0.01) / FLOOR_HEIGHT) === floor).map((item) => (
            <rect key={item.name}
              transform={`translate(${item.position[0]},${item.position[1]}) rotate(${item.yaw * 180 / Math.PI})`}
              x={-FURNITURE_ASSETS[item.article].size[0] / 2} y={-FURNITURE_ASSETS[item.article].size[1] / 2}
              width={FURNITURE_ASSETS[item.article].size[0]} height={FURNITURE_ASSETS[item.article].size[1]}
              fill="#cbd1da" rx="0.03" />
          ))}
          <circle cx={SPAWN[0]} cy={SPAWN[1]} r="0.27" fill="none" stroke="#9bbce9" strokeWidth="0.06" />
          {(telemetry.navigation?.path || []).slice(1).map((point, index) => {
            const previous = telemetry.navigation.path[index];
            return point[2] === floor * FLOOR_HEIGHT && previous[2] === point[2]
              ? <line key={index} x1={previous[0]} y1={previous[1]} x2={point[0]} y2={point[1]} stroke="#0071e3" strokeWidth="0.08" /> : null;
          })}
          {telemetry.navigation?.goal?.[2] === floor && <circle cx={telemetry.navigation.goal[0]} cy={telemetry.navigation.goal[1]} r="0.2" fill="#0071e3" />}
          <g opacity={telemetry.floor === floor ? 1 : 0.2}
            transform={`translate(${telemetry.position[0]},${telemetry.position[1]}) rotate(${(telemetry.heading * 180) / Math.PI})`}
          >
            <circle r="0.4" fill="#dcecff" stroke="#0071e3" strokeWidth="0.07" />
            <path d="M.65 0 .07 .22 .07 -.22Z" fill="#0071e3" />
          </g>
        </g>
        {ROOM_LABELS.map((room) => (
          <text
            key={room.name}
            x={room.position[0]}
            y={-room.position[1] + 0.22}
            fontSize="0.34"
            textAnchor="middle"
            fill="#86868b"
            fontFamily="monospace"
          >
            {room.number}
          </text>
        ))}
      </svg>
      <div className="map-legend">
        <i /> Unitree G1 <span>Click to go</span>
      </div>
    </div>
  );
}

function App() {
  const viewport_ref = useRef(null);
  const view_ref = useRef(null);
  const worker_ref = useRef(null);
  const keys_ref = useRef(new Set());
  const telemetry_ref = useRef(INITIAL_TELEMETRY);
  const speed_ref = useRef(0.5);
  const ready_ref = useRef(false);
  const [telemetry, set_telemetry] = useState(INITIAL_TELEMETRY);
  const [loading, set_loading] = useState('Starting the navigation lab');
  const [ready, set_ready] = useState(false);
  const [error, set_error] = useState('');
  const [performance_stats, set_performance_stats] = useState(null);
  const [camera, set_camera] = useState('follow');
  const [render_quality, set_render_quality] = useState('performance');
  const [speed, set_speed] = useState(0.5);
  const [pressed, set_pressed] = useState(new Set());
  const [show_info, set_show_info] = useState(false);
  const [viewed_floor, set_viewed_floor] = useState(0);

  function send_command() {
    if (!ready_ref.current) return;
    worker_ref.current?.postMessage({
      type: 'command',
      command: command_from_keys(keys_ref.current, speed_ref.current),
    });
    set_pressed(new Set(keys_ref.current));
  }

  function release_keys() {
    const held = keys_ref.current.size > 0;
    keys_ref.current.clear();
    if (held) send_command();
    else set_pressed(new Set());
  }

  function navigate(goal) {
    if (!ready_ref.current || telemetry_ref.current.fallen) return;
    release_keys();
    worker_ref.current?.postMessage({ type: 'goal', goal });
  }

  function cancel_navigation() {
    worker_ref.current?.postMessage({ type: 'cancel_navigation' });
  }

  function change_floor(floor) {
    if (view_ref.current?.mode === 'follow') change_camera('orbit');
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
    release_keys();
    worker_ref.current?.postMessage({ type: 'reset' });
    viewport_ref.current?.querySelector('canvas')?.focus();
  }

  function change_camera(mode) {
    if (mode === 'follow') {
      view_ref.current?.set_floor(telemetry_ref.current.floor);
      set_viewed_floor(telemetry_ref.current.floor);
    }
    view_ref.current?.set_camera(mode);
    set_camera(mode);
  }

  useEffect(() => {
    let view;
    let worker;
    let last_ui_time = 0;
    let active = true;
    let robot_ready = false;
    let furniture_ready = false;

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
      if (!active || !robot_ready || !furniture_ready) return;
      ready_ref.current = true;
      set_ready(true);
      worker.postMessage({ type: 'pause', paused: document.hidden });
      worker.postMessage({ type: 'speed', speed: speed_ref.current });
    }

    try {
      view = new SceneView(viewport_ref.current, set_performance_stats, navigate);
      view_ref.current = view;
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
          case 'loading':
            set_loading(message.message);
            break;
          case 'error':
            report_error(message.message);
            break;
          case 'ready':
            view.load_robot(message.geometries);
            robot_ready = true;
            if (!furniture_ready) set_loading('Loading the IKEA apartment furniture');
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

    const key_down = (event) => {
      if (event.target.closest?.('[role="dialog"]')) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target.isContentEditable
      )
        return;
      if (MOVEMENT_KEYS.has(event.code)) {
        event.preventDefault();
        if (keys_ref.current.has(event.code)) return;
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
      if (event.code === 'KeyC') {
        const current = view_ref.current?.mode || 'follow';
        change_camera(CAMERA_MODES[(CAMERA_MODES.indexOf(current) + 1) % CAMERA_MODES.length]);
      }
    };
    const key_up = (event) => {
      if (MOVEMENT_KEYS.has(event.code) && keys_ref.current.delete(event.code)) {
        event.preventDefault();
        send_command();
      }
    };
    const lose_focus = () => release_keys();
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
    return () => {
      active = false;
      window.removeEventListener('keydown', key_down);
      window.removeEventListener('keyup', key_up);
      window.removeEventListener('blur', lose_focus);
      document.removeEventListener('visibilitychange', visibility_change);
      worker?.terminate();
      view?.dispose();
    };
  }, []);

  useEffect(() => {
    if (show_info) {
      release_keys();
      if (ready_ref.current && !telemetry_ref.current.paused && !telemetry_ref.current.fallen) toggle_pause();
    }
  }, [show_info]);

  function control_key(code, down, event) {
    event.preventDefault();
    if (down) {
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
        ? 'Robot fallen'
        : telemetry.paused
          ? 'Paused'
          : 'Simulation live';
  const heading = ((((telemetry.heading * 180) / Math.PI) % 360) + 360) % 360;
  const minutes = Math.floor(telemetry.time / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(telemetry.time % 60)
    .toString()
    .padStart(2, '0');

  return (
    <div className="app-shell" id="top">
      <SiteHeader current="playground">
        <button className="header-info" onClick={() => set_show_info(true)}>How it works</button>
        <div className={`live-status ${telemetry.paused || telemetry.fallen || error ? 'inactive' : ''}`}>
          <i />
          {status}
        </div>
        <a
          className="nav-cta"
          href="#playground"
          onClick={() => viewport_ref.current?.querySelector('canvas')?.focus({ preventScroll: true })}
        >
          Try it <span aria-hidden="true">↗</span>
        </a>
      </SiteHeader>

      <section className="workspace-title" aria-labelledby="page-title">
        <div className="eyebrow">The interactive robotics playground.</div>
        <h1 id="page-title">
          Robotics. <span>In your hands.</span>
        </h1>
        <p>A real walking policy. A world to explore. All in your browser.</p>
      </section>

      <div className="workspace" id="playground">
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
                {floor === 'all' ? 'Building' : floor === 0 ? 'Ground' : 'Upper'}
              </button>)}
            </div>
            <div className="camera-switch" role="group" aria-label="Camera view">
              {CAMERA_MODES.map((mode) => (
                <button
                  key={mode}
                  className={camera === mode ? 'selected' : ''}
                  aria-pressed={camera === mode}
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
            {new URLSearchParams(window.location.search).has('profile') && performance_stats && (
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
            {ready && <MiniMap telemetry={telemetry} floor={viewed_floor === 'all' ? telemetry.floor : viewed_floor} on_destination={navigate} />}
            <div className="viewport-caption">
              <span className="axis-label">
                <b>X</b>
                <b>Y</b>
                <b>Z</b>
              </span>
              Click a floor to walk there <span className="mouse-hint">Drag to orbit · scroll to zoom</span>
            </div>

            {!ready && (
              <div className="loading-overlay" role="status">
                <div className="loading-card">
                  {error ? <Icon name="info" size={28} /> : <span className="loader" />}
                  <h2>{error ? 'The lab could not start' : 'Getting the G1 ready'}</h2>
                  <p>{error || loading}</p>
                  {error ? (
                    <button className="primary-button" onClick={() => window.location.reload()}>
                      Try again
                    </button>
                  ) : (
                    <span className="loading-footnote">
                      Physics + neural inference, running in your browser.
                    </span>
                  )}
                </div>
              </div>
            )}
            {ready && telemetry.fallen && (
              <div className="fallen-banner" role="alert">
                <Icon name="info" />
                <span>The G1 lost its balance. Reset to try again.</span>
                <button onClick={reset}>
                  Reset robot <kbd>R</kbd>
                </button>
              </div>
            )}
            {ready && telemetry.paused && !telemetry.fallen && (
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

        <aside className="sidebar" aria-label="Robot controls and telemetry">
          <div className="sidebar-heading">
            <span>Meet your robot</span>
            <span className="connection-dot" />
          </div>
          <div className="robot-card">
            <div className="robot-icon">
              <Icon name="robot" size={34} />
            </div>
            <div>
              <span className="eyebrow">Unitree Robotics</span>
              <h2>
                G1 <span>Humanoid</span>
              </h2>
              <p>12 actuated leg joints</p>
            </div>
          </div>
          <div className="policy-tag">
            <i />
            {ready ? 'Learned locomotion' : 'Loading locomotion'}
            <span>PPO / LSTM</span>
          </div>

          <section className="navigation-section">
            <div className="section-title"><h3>Click. Go explore.</h3><span>Automatic</span></div>
            <p className="section-description">Choose open floor in the scene or floor plan. Select Upper to go upstairs.</p>
            <div className={`navigation-status ${telemetry.navigation?.status || 'idle'}`} role="status" aria-label="Navigation status">
              {telemetry.paused && ['walking', 'waiting', 'riding'].includes(telemetry.navigation?.status) ? 'Paused · route saved. Resume to continue.' : telemetry.navigation?.message || IDLE_NAVIGATION.message}
              {telemetry.navigation?.remaining > 0 && <span>{telemetry.navigation.remaining.toFixed(1)} m to walk</span>}
            </div>
            <button className="stop-navigation" onClick={cancel_navigation}
              disabled={!['walking', 'waiting', 'riding', 'arrived'].includes(telemetry.navigation?.status)}>
              {telemetry.navigation?.status === 'arrived' ? 'Clear route' : 'Stop navigation'} <kbd>ESC</kbd></button>
            <p className="navigation-footnote">Cross-floor routes use the elevator. Stairs need a climbing policy.</p>
          </section>

          <section className="control-section">
            <div className="section-title">
              <h3>Make your move.</h3>
              <span>Manual</span>
            </div>
            <p className="section-description">Hold a key to move. Release to stand.</p>
            <div className="keyboard" aria-label="Movement controls">
              {CONTROL_KEYS.map((row, index) => (
                <div className="key-row" key={index}>
                  {row.map(([code, title]) => (
                    <ControlKey
                      key={code}
                      code={code}
                      title={title}
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
                <kbd>S</kbd> Forward / back
              </span>
              <span>
                <kbd>A</kbd>
                <kbd>D</kbd> Turn left / right
              </span>
              <span>
                <kbd>Q</kbd>
                <kbd>E</kbd> Strafe left / right
              </span>
            </div>
            <div className="speed-label">
              <label htmlFor="walking-speed">Walking speed</label>
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
            <div className="range-labels">
              <span>Careful</span>
              <span>Brisk</span>
            </div>
          </section>

          <section className="telemetry-section">
            <div className="section-title">
              <h3>Live telemetry</h3>
              <span className="telemetry-pulse">●</span>
            </div>
            <div className="speed-readout">
              <output aria-label="Actual robot speed">{telemetry.speed.toFixed(2)}</output>
              <span>
                m/s<small>ACTUAL SPEED</small>
              </span>
              <div className="speed-spark">
                <span style={{ height: `${12 + Math.min(telemetry.speed, 1) * 30}px` }} />
                <span style={{ height: `${18 + Math.min(telemetry.speed, 1) * 21}px` }} />
                <span style={{ height: `${9 + Math.min(telemetry.speed, 1) * 34}px` }} />
                <span style={{ height: `${22 + Math.min(telemetry.speed, 1) * 16}px` }} />
              </div>
            </div>
            <div className="telemetry-rows">
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
            </div>
            <div className="command-heading">
              VELOCITY COMMAND <span>ROBOT FRAME</span>
            </div>
            <div className="command-readout">
              {['vₓ', 'vᵧ', 'ω'].map((label, index) => (
                <div key={label}>
                  <span>{label}</span>
                  <output>{telemetry.command[index].toFixed(2)}</output>
                  <small>{index === 2 ? 'rad/s' : 'm/s'}</small>
                </div>
              ))}
            </div>
          </section>

          <div className="policy-summary">
            <div>
              <Icon name="info" size={16} />
              <strong>You lead. It finds its footing.</strong>
            </div>
            <p>Pick a destination or use your keys. A neural network handles balance and every step.</p>
            <div className="policy-flow">
              <span>47 obs</span>
              <span>→</span>
              <strong>LSTM</strong>
              <span>→</span>
              <span>12 actions</span>
            </div>
            <button className="text-button" onClick={() => set_show_info(true)}>
              How it works <span>↗</span>
            </button>
          </div>
          <div className="runtime-meta">
            <span>
              POLICY <b>50 Hz</b>
            </span>
            <span>
              PHYSICS <b>500 Hz</b>
            </span>
            <span>
              RTF <b>{telemetry.simulation_rate.toFixed(2)}×</b>
            </span>
          </div>
        </aside>
      </div>
      {show_info && (
        <div className="modal-backdrop" onClick={() => set_show_info(false)}>
          <section
            className="info-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="info-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') set_show_info(false);
              if (event.key === 'Tab') {
                const controls = event.currentTarget.querySelectorAll('button, a[href]');
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                }
                if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <button
              className="icon-button modal-close"
              onClick={() => set_show_info(false)}
              aria-label="Close information"
              autoFocus
            >
              <Icon name="close" />
            </button>
            <span className="eyebrow">UNDER THE HOOD</span>
            <h2 id="info-title">From a goal to a footstep.</h2>
            <p>
              Click a floor to plan a route around walls and furniture, including elevator transfers between
              floors. WASD takes over with forward velocity and turning commands. Q/E adds sideways velocity. The official
              Unitree G1 recurrent PPO policy receives these commands alongside the simulated joint states,
              gravity direction, angular velocity, previous actions, and gait phase.
            </p>
            <div className="info-flow">
              Keyboard → 47 observations → LSTM → 12 joint targets → PD torques → MuJoCo
            </div>
            <p>
              The unchanged pretrained weights run at 50 Hz using ONNX Runtime Web. A PD controller applies
              joint torques every 2 ms in MuJoCo WASM. Three.js renders lightweight meshes derived from the
              official G1 model, using the resulting physics state.
            </p>
            <p>
              The G1 has 12 active leg joints; its arms and waist are fixed in this model. Walls and furniture
              have solid collision geometry. The visible walls are shortened for a cutaway view. Colliding can
              make the robot fall; press R to reset. A clearance-aware Theta* planner routes around furniture
              on each floor. The elevator physically carries the robot between floors. This walking policy
              cannot climb stairs, so automatic routes use the elevator. WASD or Escape cancels the route.
            </p>
            <p>
              Camera: drag to orbit, right-drag to pan, scroll to zoom, or press C to cycle views. Arrow keys
              also drive the robot. Input clears when the window loses focus; switching tabs pauses the
              simulation.
            </p>
            <a
              href="https://github.com/unitreerobotics/unitree_rl_gym/tree/276801e46c5d433564f24658bac64f254b7d2d4b"
              target="_blank"
              rel="noreferrer"
            >
              Official model & policy · BSD-3-Clause <Icon name="external" size={14} />
            </a>
          </section>
        </div>
      )}
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

createRoot(document.getElementById('root')).render(<App />);
