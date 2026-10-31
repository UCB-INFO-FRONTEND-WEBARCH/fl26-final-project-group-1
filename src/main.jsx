import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SceneView } from './scene_view.js';
import { command_from_keys } from './locomotion.js';
import { SCENE_BOXES, ROOM_LABELS, SPAWN } from './scene_layout.js';
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
};
const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
const CAMERA_MODES = ['follow', 'orbit', 'top'];

function Icon({ name, size = 18 }) {
  const paths = {
    reset: (
      <>
        <path d="M3 10a9 9 0 1 1 2.5 8.2" />
        <path d="M3 4v6h6" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: (
      <>
        <path d="M9 5v14M15 5v14" />
      </>
    ),
    camera: (
      <>
        <rect x="3" y="6" width="18" height="14" rx="3" />
        <path d="m8 6 2-3h4l2 3" />
        <circle cx="12" cy="13" r="3" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M3 9h18M9 3v18M15 3v18M3 15h18" />
      </>
    ),
    robot: (
      <>
        <rect x="4" y="7" width="16" height="13" rx="4" />
        <path d="M12 7V3M9 3h6M1 12v4m22-4v4M8 16h8" />
        <path d="M8 11v1m8-1v1" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10v1" />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7m0-7L10 14" />
        <path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function MiniMap({ telemetry }) {
  return (
    <div className="minimap">
      <div className="map-heading">
        <span>
          <span className="tiny-square" /> Floor plan
        </span>
        <span>14 × 12 m</span>
      </div>
      <svg viewBox="-7.5 -6.5 15 13" aria-label="Apartment floor plan and live robot position" role="img">
        <rect x="-7" y="-6" width="14" height="12" rx="0.1" fill="#f3f4f6" />
        <g transform="scale(1,-1)">
          {SCENE_BOXES.map((box) => (
            <rect
              key={box.name}
              x={box.center[0] - box.size[0] / 2}
              y={box.center[1] - box.size[1] / 2}
              width={box.size[0]}
              height={box.size[1]}
              fill={box.kind === 'wall' ? '#92959d' : '#d3d5da'}
              rx={box.kind === 'wall' ? 0 : 0.08}
            />
          ))}
          <circle cx={SPAWN[0]} cy={SPAWN[1]} r="0.27" fill="none" stroke="#9bbce9" strokeWidth="0.06" />
          <g
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
        <i /> Unitree G1 <span>1 m grid</span>
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
  const [fps, set_fps] = useState(0);
  const [performance_stats, set_performance_stats] = useState(null);
  const [camera, set_camera] = useState('follow');
  const [render_quality, set_render_quality] = useState('performance');
  const [speed, set_speed] = useState(0.5);
  const [pressed, set_pressed] = useState(new Set());
  const [show_info, set_show_info] = useState(false);

  function report_error(message) {
    set_error(message);
    ready_ref.current = false;
    set_ready(false);
  }

  function send_command() {
    if (!ready_ref.current) return;
    worker_ref.current?.postMessage({
      type: 'command',
      command: command_from_keys(keys_ref.current, speed_ref.current),
    });
    set_pressed(new Set(keys_ref.current));
  }

  function release_keys() {
    keys_ref.current.clear();
    send_command();
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
    view_ref.current?.set_camera(mode);
    set_camera(mode);
  }

  useEffect(() => {
    let view;
    let worker;
    let last_ui_time = 0;
    try {
      view = new SceneView(viewport_ref.current, set_fps, set_performance_stats);
      view_ref.current = view;
      worker = new Worker(new URL('./simulation.worker.js', import.meta.url), { type: 'module' });
      worker_ref.current = worker;
      worker.onmessage = (event) => {
        const message = event.data;
        if (message.type === 'loading') set_loading(message.message);
        if (message.type === 'error') {
          report_error(message.message);
        }
        if (message.type === 'ready') {
          view.load_robot(message.geometries);
          ready_ref.current = true;
          set_ready(true);
          if (document.hidden) worker.postMessage({ type: 'pause', paused: true });
        }
        if (message.type === 'frame') {
          view.update_frame(message.transforms, message.telemetry);
          worker.postMessage({ type: 'frame_received', buffer: message.transforms.buffer }, [
            message.transforms.buffer,
          ]);
          // A paused state can be the last worker frame. Publish it without throttling.
          const urgent =
            message.telemetry.paused ||
            message.telemetry.fallen ||
            message.telemetry.time < telemetry_ref.current.time ||
            message.telemetry.fallen !== telemetry_ref.current.fallen ||
            message.telemetry.paused !== telemetry_ref.current.paused;
          telemetry_ref.current = message.telemetry;
          const now = performance.now();
          if (now - last_ui_time > 250 || urgent) {
            set_telemetry(message.telemetry);
            last_ui_time = now;
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
      <header className="app-header">
        <a className="brand" href="#top" aria-label="RoboPlay home">
          <span className="brand-symbol">
            <Icon name="robot" size={23} />
          </span>
          RoboPlay
        </a>
        <nav className="header-nav" aria-label="Main navigation">
          <a href="#playground">Playground</a>
          <button onClick={() => set_show_info(true)}>How it works</button>
        </nav>
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
      </header>

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
                {fps || '—'} FPS
              </div>
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
                    fps,
                    ...performance_stats,
                    rtf: telemetry.simulation_rate,
                    inference_ms: telemetry.inference_ms,
                  },
                  null,
                  2,
                )}
              </output>
            )}
            {ready && <MiniMap telemetry={telemetry} />}
            <div className="viewport-caption">
              <span className="axis-label">
                <b>X</b>
                <b>Y</b>
                <b>Z</b>
              </span>
              Metres · cutaway walls <span className="mouse-hint">Drag to orbit · scroll to zoom</span>
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
              WASD to move <span className="note-divider">·</span> Space to pause{' '}
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

          <section className="control-section">
            <div className="section-title">
              <h3>Make your move.</h3>
              <span>Manual</span>
            </div>
            <p className="section-description">Hold a key to move. Release to stand.</p>
            <div className="keyboard" aria-label="Movement controls">
              <div className="key-row">
                <ControlKey
                  code="KeyQ"
                  label="Q"
                  title="Strafe left"
                  pressed={pressed}
                  on_control={control_key}
                />
                <ControlKey
                  code="KeyW"
                  label="W"
                  title="Walk forward"
                  pressed={pressed}
                  on_control={control_key}
                />
                <ControlKey
                  code="KeyE"
                  label="E"
                  title="Strafe right"
                  pressed={pressed}
                  on_control={control_key}
                />
              </div>
              <div className="key-row">
                <ControlKey
                  code="KeyA"
                  label="A"
                  title="Turn left"
                  pressed={pressed}
                  on_control={control_key}
                />
                <ControlKey
                  code="KeyS"
                  label="S"
                  title="Walk backward"
                  pressed={pressed}
                  on_control={control_key}
                />
                <ControlKey
                  code="KeyD"
                  label="D"
                  title="Turn right"
                  pressed={pressed}
                  on_control={control_key}
                />
              </div>
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
                send_command();
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
            <p>Your keys set the direction. A neural network handles balance and every step.</p>
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
            <h2 id="info-title">From a key to a footstep.</h2>
            <p>
              WASD sends forward velocity and turning commands. Q/E adds sideways velocity. The official
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
              make the robot fall; press R to reset. This policy walks on flat floors and does not plan routes
              or avoid obstacles.
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

function ControlKey({ code, label, title, pressed, on_control }) {
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
      {label}
    </button>
  );
}

createRoot(document.getElementById('root')).render(<App />);
