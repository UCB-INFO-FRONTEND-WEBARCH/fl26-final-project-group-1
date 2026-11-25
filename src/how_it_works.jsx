import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SiteHeader } from './site_header.jsx';
import { Icon } from './icons.jsx';
import { SITE_BASE } from './asset_paths.js';
import { POLICY } from './policy_constants.js';
import { FLOOR_HEIGHT, STAIRS } from './building.js';
import { IS_HEPHAESTUS } from './world.js';
import './style.css';
import './how_it_works.css';

const POLICY_DOC = 'https://github.com/UCB-INFO-FRONTEND-WEBARCH/fl26-final-project-group-1/blob/main/docs/POLICY.md';
const MJLAB = 'https://github.com/mujocolab/mjlab';
const HOST = 'https://arxiv.org/abs/2502.08378';
const CHAPTERS = [['motion', 'The motion'], ['control', 'The control loop'], ['learning', 'The learning'],
  ['recovery', 'The recovery'], ['terrain', 'The stairs'], ['navigation', 'The route'], ['evidence', 'The evidence']];
const POLICY_LABELS = { walk: 'Walk · flat ground', walk_stairs: 'Walk · stairs', falling: 'Falling · motors hold',
  getup_supine: 'Get up · from the back', getup_prone: 'Get up · from the front',
  sit_down: 'Sit · chair clip, sitting down', seated: 'Sit · holding the seated frame', stand_up: 'Sit · chair clip, standing up' };

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
  const [direction, set_direction] = useState('down');
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
        <div className="ex-segmented" role="group" aria-label="Recorded clip">
          <button aria-pressed={direction === 'down'} onClick={() => change_direction('down')} disabled={frame.loading}>Stairs ↘</button>
          <button aria-pressed={direction === 'getup'} onClick={() => change_direction('getup')} disabled={frame.loading}>Get up ↑</button>
          <button aria-pressed={direction === 'sit'} onClick={() => change_direction('sit')} disabled={frame.loading}>Sit ↓</button>
        </div>
      </div>
      <div className="ex-stage-label"><span>BERKELEY HUMANOIDS</span><strong>Lite Pro</strong><small>{POLICY_LABELS[frame.policy] || 'Fluctlight PPO'}</small></div>
      <div className="ex-depth-card"><span>THE STAIRS POLICY SEES</span>
        <canvas ref={depth_ref} width="21" height="21" aria-label="Recorded 21 by 21 elevation map around the robot, forward up. Light cells are higher than the ground underfoot, dark cells lower." />
        <div><span>Lower</span><i /><span>Higher</span></div><small>21 × 21 · 2 m elevation map</small>
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
    <figcaption>Press play or drag the timeline. The recordings run the playground’s policies with physical contacts in the demo
      apartment: its straight stair (11 cm risers), its living-room floor, and the Lite Pro seat.<br />The 3D view shows the stairs, the seat and the ground floor only. The label names the policy in control.</figcaption>
  </figure>;
}

const LOOP_STAGES = [
  { name: 'Goal', metric: '4 command values', title: 'You set the direction.',
    text: 'Your keys set forward speed, sideways speed, and turn rate. A ramp of 1 m/s² and 2 rad/s² smooths every change.',
    detail: 'The fourth value is the root height to walk at, 0.75 m above the ground: the median of the human walks the policy learned from.' },
  { name: 'Sense', metric: '544 values + 441 map cells', title: 'The robot reads its state.',
    text: 'Gravity and the gyro in the pelvis frame, the 34 joint angles and speeds, and the last action, each over the last five updates.',
    detail: 'The stairs policy also reads a 21 × 21 elevation map: 441 downward rays, 10 cm apart, heights relative to the ground underfoot.' },
  { name: 'Infer', metric: '50 updates / second', title: 'The policy selects joint targets.',
    text: 'A convolutional neural network (CNN) encodes the map. A multilayer perceptron (MLP) combines it with the command and the history.',
    detail: 'Each ONNX file includes its input normalization. A controller picks the policy: flat walking, stairs, sitting, or getting up.' },
  { name: 'Act', metric: '34 joint targets', title: 'The motors apply torque.',
    text: 'Each action is an offset from the standing pose, with a joint-specific scale. A proportional–derivative (PD) controller converts the error into torque.',
    detail: 'The motor model limits torque as speed rises, as in training. Commands include the trained delay of 5–10 milliseconds.' },
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
        <div className="ex-caption-row"><span>Direction schematic · command speeds in m/s</span><span>Height <strong>0.75 m</strong></span></div>
      </div>
    </div>
    <div className="ex-input-strip"><div><strong>4</strong><span>command values</span></div><b>+</b>
      <div><strong>540</strong><span>body history values</span></div><b>+</b>
      <div><strong>441</strong><span>elevation map cells</span></div><b>=</b><div><strong>985</strong><span>total input values</span></div></div>
    <p className="ex-footnote">The flat-ground policy trained on a plane, so its map input is always zero. The stairs policy trained on stairs, slopes and boxes.</p>
  </section>;
}

const TRAINING_STAGES = [
  ['Collect', 'Start with human walking.', 'LAFAN1 walks and runs, retargeted to Lite Pro. Each frame gets a command: the clip’s stride-averaged speed, turn rate and height.'],
  ['Reward', 'Pay for the command, in a human style.', 'The robot never sees the clip. Rewards pay for following the command and for moving like the hidden clip, and only falls end an episode.'],
  ['Curriculum', 'Raise the speed. Then the stairs.', 'The speed limit rises while episodes follow the command. On terrain, a robot that walks 2.5 m without a fall moves to taller steps.'],
  ['Export', 'Run the policy in the browser.', 'Training uses mjlab on MuJoCo Warp with PPO. The browser loads the ONNX actor and a contract, and replays recorded mjlab steps to check that it matches.'],
];
function Learning() {
  const [step, set_step] = useState(1);
  return <section className="ex-section ex-learning" id="learning">
    <SectionHeading number="02" label="THE LEARNING" title={<>Learn from human walking.<br /><span>Reward the outcome.</span></>}>
      Reinforcement learning (PPO) trains each policy in simulation. The browser runs the exported networks.
    </SectionHeading>
    <div className="ex-learning-panel">
      <div className="ex-training-tabs" role="group" aria-label="Training stages">
        {TRAINING_STAGES.map(([name], index) => <button key={name} aria-pressed={index === step} onClick={() => set_step(index)}>
          <span>0{index + 1}</span>{name}<b aria-hidden="true">↗</b></button>)}
      </div>
      <div className="ex-training-detail"><span className="ex-kicker">{step === 3 ? 'BROWSER · INFERENCE' : 'OFFLINE · TRAINING'}</span>
        <h3>{TRAINING_STAGES[step][1]}</h3><p>{TRAINING_STAGES[step][2]}</p>
        <div className={`ex-rollout stage-${step}`} aria-label={step === 3 ? 'Diagram of the browser control loop' : 'Diagram of simulated rollouts'}>
          <div className="ex-rollout-labels"><span>{step === 3 ? 'OBSERVATION' : 'STATE'}</span><span>{step === 3 ? '34 ACTIONS' : '4,096 ROBOTS IN PARALLEL'}</span></div>
          <div className="ex-rollout-dots">{Array.from({ length: 32 }, (_, index) => <i key={index}
            style={{ '--i': index, height: `${22 + Math.sin(index * 0.6) * 11 + index * 0.7}px` }} />)}</div>
          <div className="ex-rollout-line"><i /></div>
          <span className="ex-rollout-caption">{step === 3 ? 'Policy → motor model → MuJoCo → next observation' : 'Simulated steps → rewards → policy update'}</span>
        </div>
      </div>
    </div>
    <div className="ex-joint-section"><div><h3>Five policies. 34 body joints.</h3>
      <p>Each policy controls the legs, waist, arms, and neck. The model fixes the fingers.</p></div>
      <div className="ex-joints">{[['Legs', 14], ['Waist', 3], ['Arms', 14], ['Neck', 3]].map(([name, count]) =>
        <div key={name}><span>{name} <b>{count}</b></span><div>{Array.from({ length: count }, (_, index) => <i key={index} />)}</div></div>)}</div>
    </div>
    <p className="ex-footnote">The two get-up policies, face up and face down, follow <a href={HOST} target="_blank" rel="noreferrer">HoST</a>: they start from settled lying poses and earn rewards for an upright, high pelvis, then the standing pose.
      The sit policy tracks motion-captured chair clips (BONES-SEED, retargeted to Lite Pro) on a seat whose height, place, softness and friction change every episode, and it reads where the seat is as the robot would estimate it.</p>
  </section>;
}

const RECOVERY_STATES = [
  ['Walk', 'Flat ground or stairs', 'The flat-ground policy follows speed and turn commands closely. When the stairs policy’s map shows a step ahead, it takes over, and it hands back after a second of flat ground.'],
  ['Fall', 'Tilt over 57° or the pelvis 0.25 m low', 'The thresholds that ended a walking episode in training. The motors hold the joints where they are until the body comes to rest.'],
  ['Get up', 'Face up or face down', 'Gravity in the pelvis frame tells the side. That get-up policy stands the robot in about a second; a wedged attempt retries after 6 s.'],
  ['Stand', 'Pelvis above 0.69 m and upright', 'After a second standing still, or three seconds standing, walking resumes with a zero command and a fresh history.'],
  ['Sit', 'On the Lite Pro seat', 'The robot walks to the seat, turns its back to it and backs up. One tracking policy then plays a sit-down clip placed on the seat, holds its last frame, and plays a stand-up clip when asked.'],
];
function Recovery() {
  const [state, set_state] = useState(1);
  return <section className="ex-section" id="recovery">
    <SectionHeading number="03" label="THE RECOVERY" title={<>A fall is not the end.<br /><span>It is another policy.</span></>}>
      A small state machine picks the policy for the moment. No episode ends in the playground.
    </SectionHeading>
    <div className="ex-loop" role="group" aria-label="Explore the recovery states">
      {RECOVERY_STATES.map(([name, metric], index) => <button key={name} aria-pressed={state === index}
        onClick={() => set_state(index)} className={state === index ? 'active' : ''}>
        <span className="ex-loop-number">0{index + 1}</span><strong>{name}</strong><small>{metric}</small>
        {index < RECOVERY_STATES.length - 1 && <span className="ex-loop-arrow" aria-hidden="true">→</span>}
      </button>)}
    </div>
    <div className="ex-loop-detail" aria-live="polite"><div><span className="ex-kicker">{RECOVERY_STATES[state][1]}</span>
      <h3>{RECOVERY_STATES[state][0]}</h3><p>{RECOVERY_STATES[state][2]}</p></div>
      <p>Switching keeps the motors and the physics running. Each walking policy keeps its history warm, so a handover between them needs no reset.</p></div>
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
    <SectionHeading number="04" label="THE STAIRS" title={<>The shape you see<br /><span>must be the shape you touch.</span></>}>
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
    </div><div className="ex-terrain-copy"><span className="ex-kicker">WHY BOXES</span>
      <h3>{exact ? 'Each step has a solid box.' : 'A hull can bridge several steps.'}</h3>
      <p>{exact ? 'Centoria gives every tread its own collision box. The elevation map reads the same step geometry that supports the feet.'
        : 'Convex parts that span several treads turn a stair into a ramp, for the feet and for the map.'}</p>
      <p>The playground uses {STAIRS.steps} steps between two floors. The stairs policy walks down them; walking up remains experimental.</p>
      <div className="ex-dimensions"><div><strong>{(FLOOR_HEIGHT / STAIRS.steps * 100).toFixed(0)}<small>cm</small></strong><span>riser</span></div>
        <div><strong>{IS_HEPHAESTUS ? 29 : 45}<small>cm</small></strong><span>tread</span></div><div><strong>{IS_HEPHAESTUS ? '1.3' : '2.2'}<small>m</small></strong><span>width</span></div></div>
    </div></div>
  </section>;
}

function NavigationExplanation() {
  const [connector, set_connector] = useState('stairs');
  const [phase, set_phase] = useState(0);
  const phases = connector === 'stairs' ? ['Approach', 'Climb', 'Continue'] : ['Approach', 'Wait', 'Board', 'Ride', 'Exit'];
  return <section className="ex-section ex-navigation" id="navigation">
    <SectionHeading number="05" label="THE ROUTE" title={<>Plan the route.<br /><span>Let the policy walk it.</span></>}>
      A destination needs two systems: a route planner for free space and a policy for balance.
    </SectionHeading>
    <div className="ex-route-panel"><div className="ex-route-copy"><span className="ex-kicker">TWO FLOORS · TWO CONNECTORS</span>
      <h3>Choose how to change floors.</h3><p>Theta* finds routes around walls and furniture on each floor. It checks straight paths across a 10 cm grid.</p>
      <p>The route follower sends velocity commands at 50 Hz. The walking policy handles every foot contact.</p>
      <div className="ex-segmented" role="group" aria-label="Explain cross-floor route">
        {['stairs', 'elevator'].map(value => <button key={value} aria-pressed={connector === value}
          onClick={() => { set_connector(value); set_phase(0); }}>{value === 'stairs' ? 'Stairs' : 'Elevator'}</button>)}
      </div>
      <p className="ex-route-note">{connector === 'stairs' ? 'The follower keeps a steady heading along the stair center. The stairs policy descends; climbs and turning landings remain experimental.'
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
    <SectionHeading number="06" label="THE EVIDENCE" title={<>Tested in simulation.<br /><span>Still research policies.</span></>}>
      Results depend on the checkpoint, terrain, command, and test. The playground does not establish a general success rate.
    </SectionHeading>
    <div className="ex-evidence-grid"><div className="ex-report-card"><span className="ex-kicker">MJLAB EVALUATION · HELD-OUT STARTS</span>
      <h3>The five checkpoints</h3><p>Batch tests in the training simulator, from starts the policies did not train on.</p>
      <div className="ex-result-bar"><div><span>Flat walk below 1 m/s, no fall in 5 s</span><strong>98%</strong></div><i><b style={{ width: '98%' }} /></i></div>
      <div className="ex-result-bar"><div><span>Stairs down, 2–18 cm, crossed</span><strong>93–100%</strong></div><i><b style={{ width: '96%' }} /></i></div>
      <div className="ex-result-bar"><div><span>Stairs up, 11 cm and taller, crossed</span><strong>0%</strong></div><i><b style={{ width: '0%' }} /></i></div>
      <div className="ex-result-bar"><div><span>Get up from held-out lying poses</span><strong>100%</strong></div><i><b style={{ width: '100%' }} /></i></div>
      <div className="ex-result-bar"><div><span>Sit down on a chair clip’s seat</span><strong>85%</strong></div><i><b style={{ width: '85%' }} /></i></div>
      <div className="ex-result-bar"><div><span>Stand up from it</span><strong>86%</strong></div><i><b style={{ width: '86%' }} /></i></div>
      <p className="ex-footnote">These are not success rates for this apartment. A newer stairs policy that keeps its heading on a climb is in training.</p>
    </div><div className="ex-checks-card"><span className="ex-kicker">THIS PLAYGROUND</span><h3>What we check</h3>
      <ul><li><span>01</span><div><strong>Training agreement</strong><p>Recorded mjlab steps replay in the browser runtime: observations, elevation maps and actions match to 1e-5.</p></div></li>
        <li><span>02</span><div><strong>Physical routes</strong><p>Seeded tests cover routes on each floor, elevator rides, walls and furniture, getting up face up and face down, and sitting down on the seat and standing up in both apartments.</p></div></li>
        <li><span>03</span><div><strong>Known limits</strong><p>The stairs policy turns away from tall steps. Get-ups need about 1.5 m of free floor. Straight walks drift slowly in heading. The sit policy needs a seat of its trained kind: the apartments’ sofas are too high.</p></div></li></ul>
      <p className="ex-footnote">All results are from simulation. None of these policies has run on the physical robot.</p>
    </div></div>
    <div className="ex-reference-row"><span>GO DEEPER</span>
      <a href={POLICY_DOC} target="_blank" rel="noreferrer">Policy integration <Icon name="external" size={14} /></a>
      <a href={MJLAB} target="_blank" rel="noreferrer">mjlab <Icon name="external" size={14} /></a>
      <a href={`${SITE_BASE}assets/lite_pro/policies/walk.json`} target="_blank" rel="noreferrer">Policy contract <Icon name="external" size={14} /></a>
    </div>
  </section>;
}

function PlaygroundControls() {
  return <details className="ex-controls">
    <summary>Playground controls and recovery <span aria-hidden="true">+</span></summary>
    <div><dl>
      <div><dt>Choose a goal</dt><dd>Click open floor in the scene or floor plan. Select Upper to choose an upstairs goal.</dd></div>
      <div><dt>Move manually</dt><dd>In Shoulder, WASD moves relative to the camera. Q/E also move sideways. The robot turns toward travel. In other views, A/D turns. Hold Shift for twice the speed.</dd></div>
      <div><dt>Change the figure</dt><dd>Select Character below the scene to show the robot’s motion on a character. The robot still supplies physics and contacts.</dd></div>
      <div><dt>Stop a route</dt><dd>Press Escape to cancel navigation. Movement keys take control immediately.</dd></div>
      <div><dt>Sit down</dt><dd>Walk near a supported IKEA chair. The F pane appears. Press F to line up and sit, then F to stand. You can also click a chair to walk to it.</dd></div>
      <div><dt>Pause or reset</dt><dd>Press Space to pause or resume. After a fall, Lite Pro gets up by itself; press R to reset it at the start. Reset clears the route.</dd></div>
      <div><dt>Enter the world</dt><dd>Select Play. Satellite views zoom from the Bay Area to NVIDIA Building K, then open the apartment. Light and dark themes select day and night. Select Controls to open the panels.</dd></div>
      <div><dt>Change the camera</dt><dd>Move the mouse to look around. Hold Alt for the cursor; release it to look again. Drag also works while the cursor is free. Scroll to zoom. Press V to cycle views.</dd></div>
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
        <p>A goal. An elevation map. Learned policies that walk, sit and get up.<br />Explore what turns your input into a step.</p>
        <a className="ex-hero-link" href="#motion">Explore the motion <span aria-hidden="true">↓</span></a>
      </section>
      <div className="ex-content"><MotionPlayer motion_enabled={motion_enabled} />
        <div className="ex-quick-facts"><div><strong>{POLICY.joint_names.length}</strong><span>body joints</span></div>
          <div><strong>50<small>Hz</small></strong><span>policy updates</span></div><div><strong>200<small>Hz</small></strong><span>physics steps</span></div>
          <div><strong>21 × 21</strong><span>elevation map</span></div></div>
      </div>
      <nav className="ex-chapter-nav" aria-label="Page chapters"><div>{CHAPTERS.map(([id, name], index) =>
        <a key={id} href={`#${id}`} aria-current={chapter === id ? 'location' : undefined}><span>0{index}</span>{name}</a>)}</div>
        <button aria-pressed={motion_enabled} onClick={() => set_motion_enabled(!motion_enabled)}>
          <Icon name={motion_enabled ? 'pause' : 'play'} size={12} /> Motion {motion_enabled ? 'on' : 'off'}</button>
      </nav>
      <div className="ex-content"><ControlLoop /><Learning /><Recovery /><Terrain /><NavigationExplanation /><Evidence />
        <PlaygroundControls />
        <section className="ex-end"><span className="ex-kicker">YOUR TURN</span><h2>Give it a direction.</h2>
          <p>Click an open floor to set a goal. Use WASD to take control.</p>
          <a className="nav-cta" href={`${SITE_BASE}#playground`}>Open the playground <span aria-hidden="true">↗</span></a>
        </section>
      </div>
    </main>
    <footer className="ex-footer"><a className="brand" href={SITE_BASE}><Icon name="robot" size={20} />Centoria</a>
      <span>Lite Pro · Fluctlight PPO · MuJoCo</span><span>Policies: Fluctlight, trained on LAFAN1 (CC BY-NC-ND 4.0) and BONES-SEED chair clips · Robot: <a href={`${SITE_BASE}assets/lite_pro/ROBOT_LICENSE`}>MIT</a></span>
    </footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<HowItWorks />);
