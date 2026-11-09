import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SiteHeader } from './site_header.jsx';
import { Icon } from './icons.jsx';
import { SITE_BASE } from './asset_paths.js';
import { POLICY } from './policy_constants.js';
import { FLOOR_HEIGHT, STAIRS } from './building.js';
import './style.css';
import './how_it_works.css';

const REPORT = 'https://claude.ai/artifact/8nh5Z94mUcC7iCdg3cDGpo';
const SOURCE = 'https://github.com/berkeley-humanoids/instinctmj/tree/07396764422e274e4316719f9dfb1fd734e9a516';
const CHAPTERS = [['motion', 'The motion'], ['control', 'The control loop'], ['learning', 'The learning'],
  ['terrain', 'The stairs'], ['navigation', 'The route'], ['evidence', 'The evidence']];

function SectionHeading({ number, label, title, children }) {
  return <div className="ex-section-heading">
    <span className="ex-kicker"><span>{number}</span> {label}</span>
    <h2>{title}</h2><p>{children}</p>
  </div>;
}

function MotionPlayer({ motion_enabled }) {
  const container_ref = useRef(null);
  const depth_ref = useRef(null);
  const viewer_ref = useRef(null);
  const [direction, set_direction] = useState('up');
  const [playing, set_playing] = useState(false);
  const [frame, set_frame] = useState({ loading: true, time: 0, duration: 0 });
  const [error, set_error] = useState('');
  useEffect(() => {
    let active = true;
    let viewer;
    import('./motion_viewer.js').then(async ({ MotionViewer }) => {
      if (!active) return;
      viewer = new MotionViewer(container_ref.current, depth_ref.current,
        next => { if (active) set_frame(next); });
      viewer_ref.current = viewer;
      await viewer.load();
    }).catch(exception => { if (active) set_error(exception.message); });
    return () => { active = false; viewer?.dispose(); };
  }, []);
  useEffect(() => {
    if (!motion_enabled) { set_playing(false); viewer_ref.current?.set_playing(false); }
  }, [motion_enabled]);
  async function change_direction(value) {
    if (!viewer_ref.current?.manifest) return;
    set_direction(value);
    set_error('');
    try { await viewer_ref.current.select(value); }
    catch (exception) { if (exception.name !== 'AbortError') set_error(exception.message); }
  }
  function toggle_playback() {
    const next = !playing;
    set_playing(next);
    viewer_ref.current?.set_playing(next);
  }
  return <figure className="ex-motion" id="motion">
    <div className="ex-stage">
      <div className="ex-stage-canvas" ref={container_ref} />
      <div className="ex-stage-top"><span className="ex-recording"><i /> Actual policy recording</span>
        <div className="ex-segmented" role="group" aria-label="Recorded stair direction">
          <button aria-pressed={direction === 'up'} onClick={() => change_direction('up')} disabled={frame.loading}>Ascent ↗</button>
          <button aria-pressed={direction === 'down'} onClick={() => change_direction('down')} disabled={frame.loading}>Descent ↘</button>
        </div>
      </div>
      <div className="ex-stage-label"><span>BERKELEY HUMANOIDS</span><strong>Lite Pro</strong><small>S3 · iteration 20,000</small></div>
      <div className="ex-depth-card"><span>THE POLICY SEES</span>
        <canvas ref={depth_ref} width="32" height="18" aria-label="Recorded 18 by 32 grayscale depth image. Light pixels indicate farther surfaces." />
        <div><span>Near</span><i /><span>Far</span></div><small>18 × 32 · depth image</small>
      </div>
      <span className="ex-drag-hint">Drag the robot to rotate the view</span>
      {(frame.loading || error) && <div className="ex-motion-status" role="status">
        {error || 'Loading the recorded motion…'}
        {error && <span>Explore the diagrams below or open the playground.</span>}
      </div>}
    </div>
    <div className="ex-player-bar">
      <button className="ex-play" onClick={toggle_playback} disabled={frame.loading || !!error}
        aria-label={playing ? 'Pause recorded motion' : 'Play recorded motion'}><Icon name={playing ? 'pause' : 'play'} size={17} /></button>
      <label className="ex-scrub"><span className="ex-sr-only">Recorded motion time</span>
        <input type="range" aria-label="Recorded motion time" min="0" max={frame.duration || 1} step="0.1" value={frame.time}
          disabled={frame.loading || !!error} onChange={event => {
            set_playing(false); viewer_ref.current?.set_playing(false);
            viewer_ref.current?.seek(Number(event.target.value));
          }} /></label>
      <output className="ex-time">{frame.time.toFixed(1)} <span>/ {frame.duration.toFixed(1)} s</span></output>
    </div>
    <figcaption>Press play or drag the timeline. Both recordings use the playground’s S3 policy and physical contacts.<br />
      The 3D view isolates the stairs. The depth image includes the full scene.</figcaption>
  </figure>;
}

const LOOP_STAGES = [
  { name: 'Goal', metric: '10 future frames', title: 'You set the direction.',
    text: 'Your keys set forward speed, sideways speed, and turn rate. A gradual command ramp fills ten goal frames, 0.1 seconds apart.',
    detail: 'The playground uses the velocity goal. The pelvis height goal stays at 0.73 m above the supporting ground.' },
  { name: 'Sense', metric: '2,798 input values', title: 'The robot reads its state.',
    text: 'The head camera casts 48 × 27 depth rays. Filters remove sharp contours, add range noise, and blur the image.',
    detail: 'A crop and resize produce an 18 × 32 image. Eight frames of joint and body history describe recent motion.' },
  { name: 'Infer', metric: '50 updates / second', title: 'The policy selects joint targets.',
    text: 'A convolutional neural network (CNN) encodes depth. A multilayer perceptron (MLP) combines depth, the goal, and body history.',
    detail: 'The unchanged ONNX file includes input normalization, goal selection, the depth encoder, and the actor. It returns 34 actions.' },
  { name: 'Act', metric: '34 joint targets', title: 'The motors apply torque.',
    text: 'Each action has a joint-specific scale and offset. A proportional–derivative (PD) controller converts the target error into torque.',
    detail: 'The motor model limits torque as speed increases. Commands include the trained delay of 5–10 milliseconds.' },
  { name: 'Step', metric: '200 physics steps / second', title: 'Contacts produce the next pose.',
    text: 'MuJoCo advances physics four times per policy update. Foot contacts support the robot against gravity.',
    detail: 'The next control cycle reads the resulting pose. Three.js displays that pose in the playground.' },
];

function ControlLoop() {
  const [stage, set_stage] = useState(0);
  const [speed, set_speed] = useState(0.6);
  const [turn, set_turn] = useState(0);
  const selected = LOOP_STAGES[stage];
  const frames = Array.from({ length: 10 }, (_, index) => Math.min(speed, index * 0.1));
  return <section className="ex-section" id="control">
    <SectionHeading number="01" label="THE CONTROL LOOP" title={<>A goal becomes<br /><span>a physical step.</span></>}>
      You choose where to go. The policy controls the joints. Physics determines the motion.
    </SectionHeading>
    <div className="ex-loop" role="group" aria-label="Explore the control loop">
      {LOOP_STAGES.map((item, index) => <button key={item.name} aria-pressed={stage === index}
        onClick={() => set_stage(index)} className={stage === index ? 'active' : ''}>
        <span className="ex-loop-number">0{index + 1}</span><strong>{item.name}</strong><small>{item.metric}</small>
        {index < LOOP_STAGES.length - 1 && <span className="ex-loop-arrow" aria-hidden="true">→</span>}
      </button>)}
    </div>
    <div className="ex-loop-detail" aria-live="polite"><div><span className="ex-kicker">{selected.metric}</span>
      <h3>{selected.title}</h3><p>{selected.text}</p></div><p>{selected.detail}</p></div>
    <div className="ex-command-lab">
      <div className="ex-lab-copy"><span className="ex-kicker">TRY A VELOCITY GOAL</span><h3>Change the command.<br /> See the next second.</h3>
        <p>The preview shows the command ramp. It does not run the walking policy.</p>
        <label htmlFor="goal-speed">Forward speed <output>{speed.toFixed(1)} m/s</output></label>
        <input id="goal-speed" type="range" min="0" max="0.8" step="0.1" value={speed}
          onChange={event => set_speed(Number(event.target.value))} />
        <label htmlFor="goal-turn">Turn rate <output>{turn.toFixed(1)} rad/s</output></label>
        <input id="goal-turn" type="range" min="-0.7" max="0.7" step="0.1" value={turn}
          onChange={event => set_turn(Number(event.target.value))} />
      </div>
      <div className="ex-goal-visual">
        <svg viewBox="0 0 480 225" role="img" aria-label={`Ten future velocity goals. Forward speed rises toward ${speed.toFixed(1)} metres per second. Turn rate is ${turn.toFixed(1)} radians per second.`}>
          <defs><pattern id="goal-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#dce5f0" strokeWidth=".7" /></pattern></defs>
          <rect x="0" y="0" width="480" height="225" fill="url(#goal-grid)" />
          <path d={`M45 160 Q250 ${160 - turn * 110} 440 ${160 - turn * 180}`} fill="none" stroke="#9bbce2" strokeDasharray="4 6" />
          {frames.map((velocity, index) => {
            const x = 45 + index * 43;
            const y = 160 - turn * 180 * (index / 9) ** 2;
            return <g key={index} transform={`translate(${x} ${y}) rotate(${-turn * 35 * index / 9})`}>
              <circle r="3.5" fill="#0071e3" /><path d={`M0 0V${-15 - velocity * 85}m-4 6 4-6 4 6`}
                fill="none" stroke="#0071e3" strokeWidth="2" />
            </g>;
          })}
          <text x="32" y="210">NOW</text><text x="407" y="210">+0.9 s</text>
        </svg>
        <div className="ex-goal-frames">{frames.map((value, index) => <div key={index}><span>{(index / 10).toFixed(1)} s</span><b>{value.toFixed(1)}</b></div>)}</div>
        <div className="ex-caption-row"><span>Direction schematic · goal speeds in m/s</span><span>Height <strong>0.73 m</strong></span></div>
      </div>
    </div>
    <div className="ex-input-strip"><div><strong>576</strong><span>depth pixels</span></div><b>+</b>
      <div><strong>864</strong><span>body history values</span></div><b>+</b>
      <div><strong>1,358</strong><span>goal and mask values</span></div><b>=</b><div><strong>2,798</strong><span>total input values</span></div></div>
    <p className="ex-footnote">The input keeps space for all goal types. The velocity export masks reference-motion and body-point channels.</p>
  </section>;
}

const TRAINING_STAGES = [
  ['Collect', 'Start with motion and contacts.', 'Motion references describe joint and body movement. Simulator runs provide states, actions, and the next states.'],
  ['Model', 'Learn how actions change the robot.', 'SuperMimic trains a world model from simulator transitions. The model predicts the robot dynamics.'],
  ['Imagine', 'Improve through imagined motion.', 'The policy trains through 32-step rollouts of the world model. Gradients from the imagined return improve the policy.'],
  ['Export', 'Run the policy in the browser.', 'The browser loads the exported policy and runs real MuJoCo physics. The world model serves training only.'],
];
function Learning() {
  const [step, set_step] = useState(2);
  return <section className="ex-section ex-learning" id="learning">
    <SectionHeading number="02" label="THE LEARNING" title={<>Learn the dynamics.<br /><span>Then learn the motion.</span></>}>
      SuperMimic trains the policy with a learned world model. The browser runs the exported policy.
    </SectionHeading>
    <div className="ex-learning-panel">
      <div className="ex-training-tabs" role="group" aria-label="Training stages">
        {TRAINING_STAGES.map(([name], index) => <button key={name} aria-pressed={index === step} onClick={() => set_step(index)}>
          <span>0{index + 1}</span>{name}<b aria-hidden="true">↗</b></button>)}
      </div>
      <div className="ex-training-detail"><span className="ex-kicker">{step === 3 ? 'BROWSER · INFERENCE' : 'OFFLINE · TRAINING'}</span>
        <h3>{TRAINING_STAGES[step][1]}</h3><p>{TRAINING_STAGES[step][2]}</p>
        <div className={`ex-rollout stage-${step}`} aria-label={step === 2 ? '32 imagined steps in one rollout' : 'Diagram of simulator states and actions'}>
          <div className="ex-rollout-labels"><span>{step === 3 ? 'OBSERVATION' : 'STATE'}</span><span>{step === 3 ? '34 ACTIONS' : '32 IMAGINED STEPS'}</span></div>
          <div className="ex-rollout-dots">{Array.from({ length: 32 }, (_, index) => <i key={index}
            style={{ '--i': index, height: `${22 + Math.sin(index * 0.6) * 11 + index * 0.7}px` }} />)}</div>
          <div className="ex-rollout-line"><i /></div>
          <span className="ex-rollout-caption">{step === 3 ? 'Policy → motor model → MuJoCo → next observation' : 'Simulator transitions → world model → policy update'}</span>
        </div>
      </div>
    </div>
    <div className="ex-joint-section"><div><h3>One policy. 34 body joints.</h3>
      <p>Lite Pro controls its legs, waist, arms, and neck. The model fixes the fingers.</p></div>
      <div className="ex-joints">{[['Legs', 14], ['Waist', 3], ['Arms', 14], ['Neck', 3]].map(([name, count]) =>
        <div key={name}><span>{name} <b>{count}</b></span><div>{Array.from({ length: count }, (_, index) => <i key={index} />)}</div></div>)}</div>
    </div>
    <p className="ex-footnote">The report also describes earlier PPO policies and get-up skills. This playground uses the S3 velocity policy only.</p>
  </section>;
}

function Terrain() {
  const [exact, set_exact] = useState(true);
  const [point, set_point] = useState(45);
  const width = 60;
  const rise = 25;
  const foot_x = 60 + point / 100 * 360;
  const step_index = Math.min(5, Math.floor((foot_x - 60) / width));
  const foot_y = exact ? 250 - (step_index + 1) * rise : Math.max(100, 225 - (foot_x - 60) * rise / width);
  return <section className="ex-section" id="terrain">
    <SectionHeading number="03" label="THE STAIRS" title={<>The shape you see<br /><span>must be the shape you touch.</span></>}>
      A smooth collider can hide the step edges. Separate boxes preserve each tread and riser.
    </SectionHeading>
    <div className="ex-terrain-layout"><div className="ex-terrain-demo">
      <div className="ex-segmented" role="group" aria-label="Collision geometry">
        <button aria-pressed={!exact} onClick={() => set_exact(false)}>Convex ramp</button>
        <button aria-pressed={exact} onClick={() => set_exact(true)}>Separate boxes</button>
      </div>
      <svg viewBox="0 0 480 290" role="img" aria-label={exact ? 'A foot rests on individual stair treads.' : 'A convex hull spans the stair edges. A foot contacts the slope above the visible treads.'}>
        <path d="M30 250H450" stroke="#d4dce7" />
        {Array.from({ length: 6 }, (_, index) => <rect key={index} x={60 + width * index} y={250 - rise * (index + 1)}
          width={width} height={rise * (index + 1)} fill={exact ? '#e2ecfa' : '#f1f3f6'} stroke={exact ? '#9abce6' : '#cbd1da'} />)}
        {!exact && <path d="M60 250V225L360 100H420V250Z" fill="#e8ad5033" stroke="#c48423" strokeWidth="2" />}
        <g transform={`translate(${foot_x} ${foot_y})`}>
          <path d="M-7-53 4-24 -3-8" stroke="#1d1d1f" fill="none" strokeWidth="5" strokeLinecap="round" />
          <rect x="-12" y="-8" width="29" height="7" rx="3" fill="#0071e3" />
          <circle r="5" fill="#0071e3" opacity=".25" /><circle r="2" fill="#0071e3" />
        </g>
        <text x="36" y="278">SIDE VIEW · SCHEMATIC</text><text x="290" y="40" fill={exact ? '#0071e3' : '#a46c1f'}>{exact ? 'CONTACT ON THE TREAD' : 'CONTACT ON THE SLOPE'}</text>
      </svg>
      <label htmlFor="contact-position">Move the foot contact <span aria-hidden="true">↔</span></label>
      <input id="contact-position" type="range" min="1" max="99" value={point} onChange={event => set_point(Number(event.target.value))} />
    </div><div className="ex-terrain-copy"><span className="ex-kicker">A FIX FROM THE REPORT</span>
      <h3>{exact ? 'Each step has a solid box.' : 'A hull can bridge several steps.'}</h3>
      <p>{exact ? 'RoboPlay gives every tread its own collision box. The head camera sees the same step geometry that supports the feet.'
        : 'The report found that convex parts spanned several treads. Earlier stair tests often measured motion on ramps.'}</p>
      <p>The playground uses 24 steps between two floors. Stair motion still depends on the approach, balance, and command.</p>
      <div className="ex-dimensions"><div><strong>{(FLOOR_HEIGHT / STAIRS.steps * 100).toFixed(0)}<small>cm</small></strong><span>riser</span></div>
        <div><strong>45<small>cm</small></strong><span>tread</span></div><div><strong>2.2<small>m</small></strong><span>width</span></div></div>
      <a className="ex-text-link" href={REPORT} target="_blank" rel="noreferrer">Read the geometry findings · §3.9 <Icon name="external" size={13} /></a>
    </div></div>
  </section>;
}

function NavigationExplanation() {
  const [connector, set_connector] = useState('stairs');
  const [phase, set_phase] = useState(0);
  const phases = connector === 'stairs' ? ['Approach', 'Climb', 'Continue'] : ['Approach', 'Wait', 'Board', 'Ride', 'Exit'];
  return <section className="ex-section ex-navigation" id="navigation">
    <SectionHeading number="04" label="THE ROUTE" title={<>Plan the route.<br /><span>Let the policy walk it.</span></>}>
      A destination needs two systems: a route planner for free space and a policy for balance.
    </SectionHeading>
    <div className="ex-route-panel"><div className="ex-route-copy"><span className="ex-kicker">TWO FLOORS · TWO CONNECTORS</span>
      <h3>Choose how to change floors.</h3><p>Theta* finds routes around walls and furniture on each floor. It checks straight paths across a 10 cm grid.</p>
      <p>The route follower sends velocity commands at 50 Hz. The walking policy handles every foot contact.</p>
      <div className="ex-segmented" role="group" aria-label="Explain cross-floor route">
        {['stairs', 'elevator'].map(value => <button key={value} aria-pressed={connector === value}
          onClick={() => { set_connector(value); set_phase(0); }}>{value === 'stairs' ? 'Stairs' : 'Elevator'}</button>)}
      </div>
      <p className="ex-route-note">{connector === 'stairs' ? 'The follower keeps a steady heading along the stair center. Stair mode remains experimental.'
        : 'The lift carries the robot through physical contact. Gates close during travel, and a velocity command holds the cabin center.'}</p>
    </div><div className="ex-route-visual">
      <svg viewBox="0 0 480 285" role="img" aria-label={`Cross-floor route with the ${connector}. Highlighted phase: ${phases[phase]}. This diagram explains the route stages.`}>
        <defs><pattern id="route-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="#d8e3ef" strokeWidth=".5" /></pattern></defs>
        <path d="M35 245H310L445 185H170Z" fill="url(#route-grid)" stroke="#c6d6e8" />
        <path d="M35 125H310L445 65H170Z" fill="#f3f7fc" fillOpacity=".8" stroke="#c6d6e8" />
        <text x="36" y="271">GROUND FLOOR</text><text x="36" y="105">UPPER FLOOR · 2.64 m</text>
        {connector === 'stairs' ? Array.from({ length: 8 }, (_, index) => <path key={index}
          d={`M${215 + index * 14} ${219 - index * 17}h44v-17h-30`} fill="#d9e7f7" stroke="#8aaed8" />)
          : <><path d="M280 73v147h70V73" fill="#dce8f5" fillOpacity=".45" stroke="#a1bad7" strokeDasharray="4 4" />
            <g className="ex-elevator-cabin" style={{ transform: `translateY(${phase >= 3 ? -120 : 0}px)` }}>
              <path d="M282 187h65v33h-65Z" fill="#b8d5f8" stroke="#0071e3" /><path d="M314 187v33" stroke="#0071e3" />
            </g></>}
        <path d="M90 229H215" fill="none" stroke={phase === 0 ? '#0071e3' : '#a8c4e5'} strokeWidth="3" strokeDasharray="5 5" className={phase === 0 ? 'ex-route-active' : ''} />
        <path d={connector === 'stairs' ? 'M218 220 330 80' : 'M315 220V100'} fill="none" stroke={phase > 0 && phase < phases.length - 1 ? '#0071e3' : '#a8c4e5'} strokeWidth="3" strokeDasharray="5 5" className={phase > 0 && phase < phases.length - 1 ? 'ex-route-active' : ''} />
        <path d="M330 100H190" fill="none" stroke={phase === phases.length - 1 ? '#0071e3' : '#a8c4e5'} strokeWidth="3" strokeDasharray="5 5" className={phase === phases.length - 1 ? 'ex-route-active' : ''} />
        <circle cx="90" cy="229" r="7" fill="#0071e3" /><circle cx="190" cy="100" r="7" fill="#30a46c" />
        <text x="78" y="211">START</text><text x="165" y="83">GOAL</text>
      </svg>
      <div className="ex-route-phases" role="group" aria-label="Route stages">{phases.map((name, index) => <button key={name}
        aria-pressed={phase === index} onClick={() => set_phase(index)}><span>0{index + 1}</span>{name}</button>)}</div>
      <span className="ex-footnote">Select a stage to trace the route. Diagram only.</span>
    </div></div>
  </section>;
}

function Evidence() {
  return <section className="ex-section" id="evidence">
    <SectionHeading number="05" label="THE EVIDENCE" title={<>Tested in simulation.<br /><span>Still a research policy.</span></>}>
      Results depend on the checkpoint, terrain, goal, and test. The playground does not establish a general success rate.
    </SectionHeading>
    <div className="ex-evidence-grid"><div className="ex-report-card"><span className="ex-kicker">UPSTREAM REPORT · §2.4 / §3.9</span>
      <h3>S3 goal-mode run</h3><p>The report gives these results with the velocity goal. These values describe the report’s simulation tests.</p>
      <div className="ex-result-bar"><div><span>Ascent</span><strong>100%</strong></div><i><b style={{ width: '100%' }} /></i></div>
      <div className="ex-result-bar"><div><span>Descent</span><strong>82%</strong></div><i><b style={{ width: '82%' }} /></i></div>
      <p className="ex-footnote">These are not success rates for this apartment. The browser export uses iteration 20,000, selected with separate browser tests (§3.10).</p>
    </div><div className="ex-checks-card"><span className="ex-kicker">THIS PLAYGROUND</span><h3>What we check</h3>
      <ul><li><span>01</span><div><strong>Controller agreement</strong><p>A regression compares depth, observations, actions, and poses against the upstream browser controller.</p></div></li>
        <li><span>02</span><div><strong>Physical routes</strong><p>Seeded tests cover stair ascent and descent, elevator transfers, and contact with walls and furniture.</p></div></li>
        <li><span>03</span><div><strong>Known limits</strong><p>Live stair runs can fall, including descents after a stop. A fall stops the simulation. Press R to reset.</p></div></li></ul>
      <p className="ex-footnote">All results are from simulation. The source report does not claim a test on the physical robot.</p>
    </div></div>
    <div className="ex-reference-row"><span>GO DEEPER</span>
      <a href={REPORT} target="_blank" rel="noreferrer">Motion tracking report <Icon name="external" size={14} /></a>
      <a href={SOURCE} target="_blank" rel="noreferrer">InstinctMJ source <Icon name="external" size={14} /></a>
      <a href={`${SITE_BASE}assets/lite_pro/contract.json`} target="_blank" rel="noreferrer">Policy contract <Icon name="external" size={14} /></a>
    </div>
  </section>;
}

function PlaygroundControls() {
  return <details className="ex-controls">
    <summary>Playground controls and recovery <span aria-hidden="true">+</span></summary>
    <div><dl>
      <div><dt>Choose a goal</dt><dd>Click open floor in the scene or floor plan. Select Upper to choose an upstairs goal.</dd></div>
      <div><dt>Move manually</dt><dd>Hold W/S to move forward or backward. Hold A/D to turn. Hold Q/E to move sideways. Arrow keys also drive.</dd></div>
      <div><dt>Change the figure</dt><dd>Select Character below the scene to show the robot’s motion on a character. The robot still supplies physics and contacts.</dd></div>
      <div><dt>Stop a route</dt><dd>Press Escape to cancel navigation. Movement keys take control immediately.</dd></div>
      <div><dt>Pause or reset</dt><dd>Press Space to pause or resume. Press R to reset after a fall. Reset clears the route.</dd></div>
      <div><dt>Change the camera</dt><dd>Drag to orbit. Drag with the right button to pan. Scroll or use +/− to zoom. Press C to cycle camera views.</dd></div>
    </dl><p>The playground clears held keys when the window loses focus. It pauses physics when you hide the page.</p></div>
  </details>;
}

function HowItWorks() {
  const [motion_enabled, set_motion_enabled] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [chapter, set_chapter] = useState('motion');
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = event => set_motion_enabled(!event.matches);
    preference.addEventListener('change', change);
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) set_chapter(entry.target.id);
    }, { rootMargin: '-20% 0px -60% 0px' });
    for (const [id] of CHAPTERS) { const section = document.getElementById(id); if (section) observer.observe(section); }
    const motion_observer = new IntersectionObserver(entries => {
      for (const entry of entries) entry.target.dataset.visible = String(entry.isIntersecting);
    });
    document.querySelectorAll('.ex-section').forEach(section => motion_observer.observe(section));
    return () => {
      observer.disconnect(); motion_observer.disconnect(); preference.removeEventListener('change', change);
    };
  }, []);
  return <div className={`app-shell explainer-shell ${motion_enabled ? '' : 'ex-motion-off'}`} id="top">
    <a className="ex-skip" href="#ex-content">Skip to content</a>
    <SiteHeader current="how-it-works"><a className="nav-cta" href={`${SITE_BASE}#playground`}>Try it <span aria-hidden="true">↗</span></a></SiteHeader>
    <main id="ex-content">
      <section className="ex-hero"><span className="ex-kicker"><i /> A GUIDE TO THE PLAYGROUND</span>
        <h1>How Lite Pro<br /><span>finds its footing.</span></h1>
        <p>A goal. A depth image. A learned policy.<br />Explore what turns your input into a step.</p>
        <a className="ex-hero-link" href="#motion">Explore the motion <span aria-hidden="true">↓</span></a>
      </section>
      <div className="ex-content"><MotionPlayer motion_enabled={motion_enabled} />
        <div className="ex-quick-facts"><div><strong>{POLICY.joint_names.length}</strong><span>body joints</span></div>
          <div><strong>50<small>Hz</small></strong><span>policy updates</span></div><div><strong>200<small>Hz</small></strong><span>physics steps</span></div>
          <div><strong>18 × 32</strong><span>depth image</span></div></div>
      </div>
      <nav className="ex-chapter-nav" aria-label="Page chapters"><div>{CHAPTERS.map(([id, name], index) =>
        <a key={id} href={`#${id}`} aria-current={chapter === id ? 'location' : undefined}><span>0{index}</span>{name}</a>)}</div>
        <button aria-pressed={motion_enabled} onClick={() => set_motion_enabled(!motion_enabled)}>
          <Icon name={motion_enabled ? 'pause' : 'play'} size={12} /> Motion {motion_enabled ? 'on' : 'off'}</button>
      </nav>
      <div className="ex-content"><ControlLoop /><Learning /><Terrain /><NavigationExplanation /><Evidence />
        <PlaygroundControls />
        <section className="ex-end"><span className="ex-kicker">YOUR TURN</span><h2>Give it a direction.</h2>
          <p>Click an open floor to set a goal. Use WASD to take control.</p>
          <a className="nav-cta" href={`${SITE_BASE}#playground`}>Open the playground <span aria-hidden="true">↗</span></a>
        </section>
      </div>
    </main>
    <footer className="ex-footer"><a className="brand" href={SITE_BASE}><Icon name="robot" size={20} />RoboPlay</a>
      <span>Lite Pro · SuperMimic · MuJoCo</span><span>Policy and controller: <a href={`${SITE_BASE}assets/lite_pro/LICENSE`}>CC BY-NC 4.0</a> · Robot: <a href={`${SITE_BASE}assets/lite_pro/ROBOT_LICENSE`}>MIT</a></span>
    </footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<HowItWorks />);
