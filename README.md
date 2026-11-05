# RoboPlay

RoboPlay is a React application for manual and automatic navigation of Berkeley
Lite Pro in a furnished, two-floor apartment. The S3 SuperMimic policy controls
34 body joints using velocity goals, body history, and a head depth camera.
MuJoCo simulates the robot, stairs, furniture, and elevator in the browser.

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
The first page load transfers approximately 40 MB of uncompressed robot and runtime assets.
The browser can cache these assets for later loads.

### How it works

Open `/how-it-works/`, or select **How it works** in the header. The page explains
the S3 control loop, depth input, training method, stair contacts, and navigation.
Use the recorded 3D motion player, command sliders, and diagrams to explore each step.
The player shows physical policy recordings with synchronized depth images.
It does not load MuJoCo or ONNX Runtime. Playback starts paused and stops outside the viewport.
The **Motion** control stops diagram animations. The page also respects the system preference for reduced motion.

To regenerate the two seeded stair recordings, run:

```bash
node scripts/record_explainer.js
```

The script checks that both routes finish without a fall. It writes poses, policy
depth images, and source metadata to `public/assets/explainer/`. The page loads
the ascent recording first and fetches the descent recording when you select it.

### Asset library

Open `/catalog/`, or select **Asset library** in the header. This React page uses
the catalog data and product photos from `IKEA_Furniture_and_Local_Catalog.zip`.
Import the archive once after `npm install`:

```bash
python3 scripts/import_ikea.py /path/to/IKEA_Furniture_and_Local_Catalog.zip
```

The import requires Python 3.9+ and about 11 GB of free disk space. It writes
models, photos, and catalog data to `local_assets/ikea/`. Git ignores this folder.
Vite serves these files in development and preview mode without copying the
collection into each build. Vite bundles the Draco decoder from Three.js.

The library contains 36,447 article models and 26,561 unique model files.
Search by series, type, variant, or article number. Filter by department,
subcategory, color, file size, dimensions, photos, and unique files. Each page
shows at most 24 cards. Opening a card loads its GLB into a single 3D viewer.
The viewer supports orbit, front, and top cameras, a grid, wireframe, and rotation.
Closing the preview releases its graphics resources.

Save assets with **+**, review **Saved**, then export a JSON selection manifest.
Selections persist in this browser. Exports retain article IDs, source URLs,
checksums, local paths, and product dimensions. Models use metres and Y up.
Exporting a selection does not insert it into the playground. Its apartment uses
the fixed IKEA placements in `src/furniture_layout.js`.

The furnished playground uses the imported collection in local development.
For static hosting, run `python3 scripts/prepare_huggingface.py` and serve the
prepared collection from `local_assets/huggingface/` at `assets/ikea/` under the
site base path, or use the public [Hugging Face dataset](https://huggingface.co/datasets/T-K-233/ikea-furniture).
Set `VITE_IKEA_BASE_URL` at build time to its pinned HTTPS base URL.
The collection and upload staging folder are excluded from Git and the app build.

```bash
npm run build
npm run preview
```

Vite writes the static website to `dist/`. Serve `dist/` over HTTP(S).
Set the JavaScript module and WASM MIME types (`application/wasm` for `.wasm`).
Enable compression on the host. Use Vite's `--base /repository-name/` option for
a project site.

## Controls

Click open floor to walk there automatically. Select **Upper** to choose an
upstairs destination. Choose **Elevator** or **Stairs · experimental** for the
cross-floor route. Clicking a step selects a stair destination. **Building** shows
both floors. WASD or **Escape** cancels automatic navigation. Pause preserves the
route. Stair routes are enabled with the current walking policy and may fall or
stall; press R to reset. Stairs and the elevator have separate approaches.
See [navigation](docs/NAVIGATION.md) for the planner, transfer stages, and limits.

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
Backward commands are capped at 0.4 m/s, lateral commands at 0.3 m/s, and turning at 0.7 rad/s.
When you release a movement input, the controller requests zero velocity.
The policy continues to balance the robot, which can still take small steps or drift.

When the window loses focus, the application clears held inputs.
When you hide the page, the application pauses physics.
Select Resume to continue.

## Scene and robot

- Two 19 × 14 m floors, with living room, kitchen, study, a stairwell, and an elevator.
- Nineteen IKEA placements use twelve original models: KIVIK seating, LACK and
  TORNVIKEN tables, BESTÅ and HEMNES storage, KNOXHULT cabinets, a LAGAN refrigerator,
  a MICKE desk, a MARKUS chair, BILLY shelves, a TILLREDA cooktop, and an ELLOVEN stand.
- Models retain their original materials and metre scale. Rendering and physics
  share their floor position, orientation, and conversion from Y up to Z up.
  The renderer shortens visible walls for a cutaway view. Physics retains their full 2.7 m collision height.
- Berkeley Lite Pro: 34 controlled joints, including the waist, arms, and neck; fingers are fixed.
- The model, contacts, joint inertias, gains, and motor torque–speed envelopes match the upstream browser export.
- The floors are 2.64 m apart. Twenty-four solid treads have an 11 cm rise, 45 cm run, and 2.2 m width.
- Live robot-frame commands, actual speed, world position, heading, base height,
  simulation time, distance, rendering FPS, and real-time factor.
- The perceptive policy handles walking and stair motion. Theta* supplies the global route.
  Falls stop the simulation and leave Reset available; the policy does not perform get-up recovery.

Clearance-aware Theta* routes and a velocity follower add click-to-go navigation.
Cross-floor routes use the physical lift or attempt the stair path. The asset library uses
the complete catalog hosted on Hugging Face. Challenge scores and history remain
future work.

### Furniture collisions

Furniture is fixed to the world. Each model uses compound convex collision
meshes generated with CoACD. MuJoCo uses convex shapes for mesh contacts; a single
object hull would fill gaps under desks and between legs.
See the [MuJoCo collision documentation](https://mujoco.readthedocs.io/en/stable/computation.html).

`src/furniture_assets.js` stores the generated hull vertices, original model
dimensions, grounding origin, and source SHA-256 hashes. The preparation uses
a 10 mm concavity target and at most 32 hulls per model. This is an approximation
for navigation contacts, with separate surfaces for tabletops, legs, and shelves.
The renderer checks model dimensions before enabling movement. Physics stays
paused until all furniture visuals and the robot are ready.

The checked-in collision data lets headless physics checks run without the GLBs.
To regenerate it, use Python 3.12+ and Node.js:

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements-furniture.txt
.venv/bin/python scripts/prepare_furniture.py
```

The preparation reads the placements from `src/furniture_layout.js`. It caches
results in `local_assets/ikea/collisions/`, keyed by source hash and settings.
Add `?collisions=1` to the playground URL to inspect the hulls as blue wireframes.

## Performance

The page defaults to **Graphics → Fast**. The render-only Lite Pro mesh has
6,196 triangles and uses about 148 KiB, compared with 100,996 triangles in the
upstream model. Camera rays and physics keep the upstream meshes and contacts.
**Quality** adds static shadows and increases the allowed render resolution.

Physics and inference run in a worker. Poses are sent at most 50 times per second,
with one outstanding message and a reused transfer buffer. React updates telemetry
at 4 Hz. Hidden tabs pause simulation and rendering; paused views redraw when needed.
Repeated IKEA models share geometry and materials. Furniture collision decomposition
runs offline. No training code or GPU service runs in the website.

Add `?profile=1` for live render diagnostics. [Performance notes](docs/PERFORMANCE.md)
retain the earlier G1 optimization measurements; they are historical, not Lite Pro benchmarks.

## Policy and simulation

The application uses the S3 goal-mode Mix checkpoint at iteration 20,000 from
[InstinctMJ, `feat/lite-pro`](https://github.com/berkeley-humanoids/instinctmj/tree/07396764422e274e4316719f9dfb1fd734e9a516).
Its unchanged ONNX export includes normalization, the velocity goal mask, depth
encoder, and actor. The contract and hashes are in `public/assets/lite_pro/contract.json`.

```text
WASD / route → ten future velocity goals and a 0.73 m ground-relative pelvis height
Head camera → 48 × 27 rays → filtered, cropped 18 × 32 depth image
Body state → eight frames of gravity, angular velocity, joints, and previous actions
    ↓
2,798 observations → CNN + MLP → 34 joint targets, 50 Hz
    ↓
Per-joint PD + motor torque–speed limits + 5–10 ms command delay
    ↓
MuJoCo rigid-body dynamics and contacts, 200 Hz → Three.js poses
```

The shared policy implementation follows the upstream browser controller. Its depth
images, observations, actions, and physical poses match across a seeded 24-step
comparison, including depth noise and history rollover. See [policy integration](docs/POLICY.md)
for provenance, sensor groups, motor mapping, and validation limits.

The original G1 policy is available in the earlier 3D-scene PR. It cannot control
Lite Pro: the joint layout and policy contract differ. The active app loads only Lite Pro.

## Verification

```bash
npm test                 # Catalog, furniture layout, controller contract, and render assets
npm run test:simulation  # Real bundled MuJoCo WASM + ONNX runtime; no Python needed
npm run build
```

The simulation regression uses the same controller as the browser worker. It checks
manual locomotion, wall and furniture contacts, compound collision ray probes, pause,
reset, fall detection, and invalid policy output. Automatic routes cover doorways,
furniture avoidance, elevator transfers, stair ascent/descent, and holding after arrival.
The upstream comparison runs before those scenarios.

## Repository layout

```text
src/main.jsx                  React controls, telemetry, minimap, and input
src/scene_view.js              Three.js scene and camera
src/scene_layout.js            Shared apartment geometry and MJCF generation
src/lite_pro_policy.js         S3 depth, history, observation, and motor control
src/policy_constants.js        Generated constants from the pinned export
src/locomotion.js              Timing, joint names, keyboard commands, and heading
src/simulation.js              Physical stepping, reset, fall detection, and routing
src/simulation.worker.js       Runtime loading, clock, and worker messages
src/navigation.js             Route following and connector stages
src/path_planner.js            Clearance-aware Theta* maps
public/assets/lite_pro/        ONNX, MJCF, meshes, reference controller, and licenses
scripts/import_lite_pro.py     Re-fetch and verify the pinned policy/model export
scripts/prepare_visual_assets.js Render-only mesh simplification
scripts/verify_policy_parity.js Compare against the unchanged upstream controller
scripts/verify_simulation.js   Headless MuJoCo + ONNX physics checks
```

The bundled assets are ready to use. To reproduce the import and render meshes:

```bash
python3 scripts/import_lite_pro.py
npm run assets:visuals
```

Exporting a newly trained checkpoint requires the InstinctMJ training environment
and `scripts/lite_pro_browser_export.py` in that repository. Pin and validate its
constants, model, and controller together before changing the bundled checkpoint.

See [THIRD_PARTY.md](THIRD_PARTY.md) for attribution and license locations.
