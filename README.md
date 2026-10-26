# RoboPlay

A React webpage where you drive a Unitree G1 around a three-room indoor sandbox.
The official pretrained recurrent walking policy controls the leg joints in MuJoCo
physics. WASD supplies velocity commands to that policy. The robot's position is
never translated by the keyboard handler and there is no canned walking animation.

## Run locally

Requires Node.js 18.19+ and npm. A recent desktop browser with WebGL 2 and
WebAssembly SIMD support is recommended (Chrome/Edge/Firefox).

```bash
npm install
npm run dev
```

Open the Local URL printed by Vite, normally `http://127.0.0.1:5173`.
The robot, policy, fonts, and WASM engines are served locally. No Python server,
API key, GPU, external inference endpoint, or cross-origin isolation headers are
required. The first page load transfers approximately 50 MB of uncompressed
assets; subsequent loads can use the browser cache.

```bash
npm run build
npm run preview
```

The production build is a static website in `dist/`. Serve it over HTTP(S) with
JavaScript module and WASM MIME types (`application/wasm` for `.wasm`). Enable
compression on the host when deploying. The current build assumes hosting at `/`.

## Controls

| Input | Action |
| --- | --- |
| W / S or ↑ / ↓ | Walk forward / backward |
| A / D or ← / → | Turn left / right |
| Q / E | Strafe left / right |
| Space | Pause / resume physics |
| R | Reset robot, controller memory, trail, and session counters |
| C | Cycle follow / orbit / top-down cameras |
| Mouse drag / right-drag / scroll | Orbit / pan / zoom |
| Onscreen movement buttons | Hold for the same movement commands (also touch compatible) |

The speed slider sets forward/backward speed from 0.2 to 0.8 m/s; lateral commands
are capped at 0.35 m/s and turning at 0.7 rad/s. Releasing movement inputs requests
zero velocity. The learned controller continues balancing and may step/drift a
little. Losing window focus clears held inputs; hiding the page pauses physics.
Opening the explanation dialog also pauses physics. Use Resume to continue.

## Scene and robot

- A 14 × 12 m apartment with living room, kitchen, study, two doorways, and gray-box furniture.
- Walls and furniture share their positions/dimensions between rendering and physics.
  Walls are rendered as a cutaway but retain their full 2.7 m collision height.
- Official Unitree G1 meshes, inertias, joints, contacts, and actuator limits.
- The walking checkpoint uses the **12-DoF G1 model**, with fixed arms and waist.
- Live robot-frame commands, actual speed, world position, heading, base height,
  simulation time, distance, rendering FPS, and real-time factor.
- The learned policy handles flat-ground locomotion. It does not plan paths, avoid
  obstacles, or recover from a fall. Falls stop the simulation and expose Reset.

This first implementation is manual exploration. Click-to-go navigation, challenge
scoring/history, richer apartment assets, and the Hugging Face metadata explorer
remain subsequent milestones from the proposal.

## Performance

The page defaults to **Graphics → Fast**. It uses a 25,142-triangle render-only
G1 mesh (95% fewer triangles), one merged room mesh, simpler lighting, a contact
shadow, and a render resolution capped at 1× device pixel ratio. **Quality** adds
a static room shadow and allows up to 1.5× resolution (capped at one megapixel).
The original robot collision geometry, inertias, timestep, and learned policy are
preserved in both modes.

Poses are sent at most 50 times per second with one outstanding message and a
recycled transfer buffer. React telemetry updates at 4 Hz. A lightweight kinematics
refresh replaces repeated full forward-dynamics calls for drawing. Hidden tabs
pause simulation and stop rendering; paused views redraw only for camera changes.

In representative local browser samples, rendering changed from 1,007,784 to
25,990 triangles per frame, 179 to 40 draw calls, and about 1.19 to 0.49 ms of CPU
render submission time. The optimized page rendered at 60 FPS while the physics
maintained a real-time factor near 1.0. These are measurements from this machine,
not frame-rate guarantees for every device.

Add `?profile=1` to the URL for live render diagnostics.
See [docs/PERFORMANCE.md](docs/PERFORMANCE.md) for the profiling method and the
MicroDuck/mjswan source references used for this optimization.

## Policy and simulation

The model and checkpoint are pinned to
[`unitreerobotics/unitree_rl_gym`, commit `276801e46c5d433564f24658bac64f254b7d2d4b`](https://github.com/unitreerobotics/unitree_rl_gym/tree/276801e46c5d433564f24658bac64f254b7d2d4b).

```text
Keyboard: [forward m/s, lateral m/s, yaw rad/s]
    ↓
47 observations: body angular velocity, projected gravity, command,
                joint positions/velocities, previous actions, gait phase
    ↓
LSTM (64 hidden units) → MLP (32 hidden units) → 12 actions, 50 Hz
    ↓
Joint target = default angle + action × 0.25
    ↓
PD torques at 500 Hz → MuJoCo contacts and rigid-body dynamics
    ↓
Physics state → Three.js rendering + next observation
```

The official `motion.pt` weights are unchanged. The ONNX export exposes the LSTM
hidden/cell state explicitly as `[1, 1, 64]` inputs and outputs. Both are cleared
on Reset. The deployment observation ordering, scaling, joint order, PD gains,
0.8 s gait phase, and 2 ms timestep follow the bundled official reference files.
The simulation runs in a dedicated Web Worker; Three.js and React run on the main
thread. If a device cannot keep up, simulation time advances slower than wall time
instead of skipping physics steps. The RTF readout shows that ratio.

## Verification

```bash
npm test                 # Keyboard commands, observation/quaternion contract, PD gains
npm run test:simulation  # Real bundled MuJoCo WASM + ONNX runtime; no Python needed
npm run build
```

The simulation regression covers 20 s idle balance, 9 s forward walking, backward
walking, turning, strafing, crossing the living-room doorway, and collision with a
solid partition. The free-walking cases maintain a base height above 0.7 m. A wall
contact must occur and the robot must remain on its original side of that wall.

The ONNX exporter also compares 200 stateful random steps against the original
TorchScript checkpoint. Maximum absolute action error was **6.8e-6** (limit 1e-4).
The exact hash and export contract are in `public/assets/g1/contract.json`.
Browser checks verified loading, W movement, turning/strafe commands, pause/reset,
camera switching, and the production bundle.

## Repository layout

```text
src/main.jsx                React controls, telemetry, minimap, input handling
src/style.css               Responsive interface
src/scene_view.js           Three.js scene and camera
src/scene_layout.js         Shared apartment geometry and MJCF generation
src/locomotion.js           Official observation/PD contract and keyboard mapping
src/simulation.worker.js    MuJoCo, ONNX inference, fixed-timestep loop
public/assets/g1/           Pinned meshes, source checkpoint, ONNX export, licenses
scripts/fetch_assets.py     Re-fetch original upstream assets and record SHA-256s
scripts/export_policy.py    Reproduce the ONNX export and verify stateful parity
scripts/verify_simulation.js Headless WASM physics regression
scripts/prepare_visual_assets.js Offline render-only mesh simplification
tests/locomotion.test.js    Controller contract tests
tests/visual_assets.test.js Optimized asset integrity and size budget
```

The bundled assets are ready to use. To reproduce the export, use a temporary
Python 3.12 virtual environment with `torch==2.6.0` (CPU is sufficient),
`onnx==1.17.0`, `onnxruntime==1.26.0`, and `numpy`, then run:

```bash
python scripts/fetch_assets.py
python scripts/export_policy.py
npm run assets:visuals
```

See [THIRD_PARTY.md](THIRD_PARTY.md) for attribution and license locations.
