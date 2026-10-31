# RoboPlay

RoboPlay is a React application for manual control of a Unitree G1 in a three-room
indoor scene. A pretrained policy controls the robot's leg joints in MuJoCo physics.
The policy keeps memory between control steps.

WASD keys send velocity commands to the policy.
The keyboard handler does not translate the robot or play a walking animation.

## Run locally

Use Node.js 18.19+ and npm. Use a recent desktop browser with WebGL 2 and
WebAssembly SIMD support, such as Chrome, Edge, or Firefox.

```bash
npm install
npm run dev
```

Vite prints the Local URL, normally `http://127.0.0.1:5173`. Open that URL.
The browser loads the robot, policy, fonts, and WebAssembly (WASM) engines from
the local server. The application runs without a Python server, API key, GPU,
external inference endpoint, or cross-origin isolation headers.
The first page load transfers approximately 50 MB of uncompressed assets.
The browser can cache these assets for later loads.

```bash
npm run build
npm run preview
```

Vite writes the static website to `dist/`. Serve `dist/` over HTTP(S).
Set the JavaScript module and WASM MIME types (`application/wasm` for `.wasm`).
Enable compression on the host. The current build assumes hosting at `/`.

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

The speed slider sets forward and backward speed from 0.2 to 0.8 m/s.
The controller limits lateral commands to 0.35 m/s and turning commands to 0.7 rad/s.
When you release a movement input, the controller requests zero velocity.
The policy continues to balance the robot, which can still take small steps or drift.

When the window loses focus, the application clears held inputs.
When you hide the page or open the explanation dialog, the application pauses physics.
Select Resume to continue.

## Scene and robot

- A 14 × 12 m apartment with living room, kitchen, study, two doorways, and gray-box furniture.
- Rendering and physics use the same positions and dimensions for walls and furniture.
  The renderer shortens visible walls for a cutaway view. Physics retains their full 2.7 m collision height.
- Official Unitree G1 meshes, inertias, joints, contacts, and actuator limits.
- The walking checkpoint uses the **12-DoF G1 model**, with fixed arms and waist.
- Live robot-frame commands, actual speed, world position, heading, base height,
  simulation time, distance, rendering FPS, and real-time factor.
- The learned policy handles flat-ground locomotion. It does not plan paths, avoid
  obstacles, or recover from a fall. Falls stop the simulation and leave Reset available.

This implementation supports manual exploration. The proposal includes later work
for click-to-go navigation, challenge scores and history, detailed apartment assets,
and a Hugging Face metadata explorer.

## Performance

The page defaults to **Graphics → Fast**. Fast mode uses a 25,142-triangle G1 mesh
for rendering, with 95% fewer triangles than the original visual model.
Fast mode uses one merged room mesh, simple lighting, a contact shadow, and at most
1× device pixel ratio. **Quality** adds a static room shadow and permits up to
1.5× resolution, with a one-megapixel limit. Both modes use the original robot
collision geometry, inertias, timestep, and policy.

The worker sends poses at most 50 times per second. It permits one outstanding
message and reuses the transfer buffer. React updates telemetry at 4 Hz.
The worker updates kinematics for rendering instead of repeating full forward dynamics.
Hidden tabs pause simulation and stop rendering. Paused views redraw for camera
changes, a new pose, or a graphics setting change.

Local browser samples show 25,990 triangles per frame, compared with 1,007,784 before
the performance changes. Draw calls decreased from 179 to 40.
CPU render submission time decreased from approximately 1.19 to 0.49 ms.
The optimized page rendered at 60 frames per second (FPS).
Physics maintained a real-time factor near 1.0. These measurements describe this
test machine and do not guarantee the same frame rate on every device.

Add `?profile=1` to the URL for live render diagnostics.
See [docs/PERFORMANCE.md](docs/PERFORMANCE.md) for the profiling method and the
MicroDuck/mjswan source references used for this optimization.

## Policy and simulation

The application pins the model and checkpoint to
[`unitreerobotics/unitree_rl_gym`, commit `276801e46c5d433564f24658bac64f254b7d2d4b`](https://github.com/unitreerobotics/unitree_rl_gym/tree/276801e46c5d433564f24658bac64f254b7d2d4b).

The policy uses a long short-term memory (LSTM) network.
A proportional-derivative (PD) controller applies its joint targets.

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

The export preserves the official `motion.pt` weights. The ONNX export exposes the
LSTM hidden and cell states as `[1, 1, 64]` inputs and outputs. Reset clears both states.
Observation order, scaling, joint order, PD gains, the 0.8 s gait phase, and the 2 ms
timestep follow the bundled official reference files.

The simulation runs in a dedicated Web Worker. Three.js and React run on the main
thread. If a device cannot process every step in real time, simulation time advances
more slowly than wall time. The simulation does not skip physics steps.
The RTF readout shows the ratio of simulation time to wall time.

## Verification

```bash
npm test                 # Keyboard commands, observation/quaternion contract, PD gains
npm run test:simulation  # Real bundled MuJoCo WASM + ONNX runtime; no Python needed
npm run build
```

The simulation regression uses the same controller as the browser worker.
It covers 20 s idle balance, 9 s forward walking, backward walking, turning,
strafing, doorway crossing, and collision with a solid partition.
The free-walking cases maintain a base height above 0.7 m.
The collision case must produce a wall contact. The robot must remain on its
original side of that wall. Further checks cover pause, reset, fall detection,
and rejection of invalid policy output.

The ONNX exporter compares 200 stateful random steps with the original
TorchScript checkpoint. The maximum absolute action error was **6.8e-6** (limit 1e-4).
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
src/simulation.worker.js    MuJoCo/ONNX loading, clock, and worker messages
src/simulation.js           Shared controller, policy state, and physics steps
src/robot_assets.js         Shared model loading, model checks, and render geometry
public/assets/g1/           Pinned meshes, source checkpoint, ONNX export, licenses
scripts/fetch_assets.py     Re-fetch original upstream assets and record SHA-256s
scripts/export_policy.py    Reproduce the ONNX export and verify stateful parity
scripts/verify_simulation.js Headless WASM physics regression
scripts/prepare_visual_assets.js Offline render-only mesh simplification
tests/locomotion.test.js    Controller contract tests
tests/visual_assets.test.js Optimized asset integrity and size budget
```

The bundled assets are ready to use. To reproduce the export, use a temporary
Python 3.12 virtual environment. Install `torch==2.6.0`, `onnx==1.17.0`,
`onnxruntime==1.26.0`, and `numpy`. The CPU version of PyTorch is sufficient.
Run these commands:

```bash
python scripts/fetch_assets.py
python scripts/export_policy.py
npm run assets:visuals
```

See [THIRD_PARTY.md](THIRD_PARTY.md) for attribution and license locations.
