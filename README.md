# Centoria

Centoria is a React application for manual and automatic navigation of Berkeley
Lite Pro in a furnished, two-floor apartment. Five learned policies from Fluctlight
control its 34 body joints: walking on flat ground, walking on stairs with an elevation
map, getting up from the back or the front, and sitting down on a seat and standing up.
A state machine switches between them, so Lite Pro gets up by itself after a fall and
can walk to compatible IKEA chairs, sit, and stand again.
MuJoCo simulates the robot, stairs, and furniture in the browser. The default
playground is the furnished Hephaestus Tower roof apartment and mezzanine,
exported from the calibrated V20 Blender project. The surrounding highrise is
visible in Building view. See [map integration](docs/HEPHAESTUS.md) for provenance,
dimensions, export details, and limits.

WASD keys send velocity commands to the policy.
The keyboard handler does not translate the robot or play a walking animation.

Select **Character** below the scene to display the same motion on a VRM character.
Select **Robot** to return to Lite Pro. The switch preserves the simulation, route,
pause state, and camera. The character loads once, on first selection.
Use the **+** and **−** buttons in the scene to inspect the figure at close range.

Character mode reads the measured pelvis pose and 34 joint angles from MuJoCo.
Each bone uses the corresponding robot joints in their chain order, as in
[Lite-Motions](https://huggingface.co/spaces/Berkeley-Humanoids/Lite-Motions).
The mode adds no IK, motion filtering, foot locking, or secondary animation.
The character keeps its original proportions, so its feet can slide or intersect
surfaces. The trained robot still supplies physics, contacts, and terrain sensing.

The public character is NAI by -T.K.-, from the Lite-Motions Space, with authorization for Centoria visitor use.
`src/character_asset.js` pins its source URL and hash. The app loads the original
file from its host and does not include a copy in the Pages artifact.

## Run locally

Use Node.js 24+ and npm. Use a recent desktop browser with WebGL 2 and
WebAssembly SIMD support, such as Chrome, Edge, or Firefox.

```bash
npm install
npm run dev
```

Vite prints the Local URL, normally `http://127.0.0.1:5173`. Open that URL.
The browser loads the robot, policy, fonts, and WebAssembly (WASM) engines from
the local server. The application runs without a Python server, API key, GPU,
external inference endpoint, or cross-origin isolation headers.
The first page load transfers approximately 50 MB of uncompressed robot and runtime assets (five policies, two chair
clips and the full lite-description meshes) plus 40 MB
of bundled room models and finish textures.
The browser can cache these assets for later loads.

### How it works

Open `/how-it-works/`, or select **How it works** in the header. The page explains
the control loop, the elevation map, training, fall recovery, stair contacts, and navigation.
Use the recorded 3D motion player, command sliders, and diagrams to explore each step.
The player shows physical policy recordings with the synchronized elevation map.
It does not load MuJoCo or ONNX Runtime. Playback starts paused and stops outside the viewport.
The **Motion** control stops diagram animations. The page also respects the system preference for reduced motion.

To regenerate the three seeded recordings (a stair descent, a get-up, and sitting down and standing up), run:

```bash
CENTORIA_MAP=demo node scripts/record_explainer.js
```

The script runs in the demo apartment, whose straight stair and seat the page shows, and checks
that the descent finishes without a fall, the get-up ends walking, and the robot sits, stands up and walks on.
It writes poses, elevation maps, the active policy, the stair and seat geometry, and source metadata to
`public/assets/explainer/`. The page loads the descent first and fetches the other clips
when you select them.

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
the fixed Hephaestus scene exported from Blender. The earlier demo placements
remain in `src/furniture_layout.js` for regression tests.

The Hephaestus playground includes its own optimized scene GLBs. The earlier
demo playground uses the imported collection in local development.
For static hosting, run `python3 scripts/prepare_huggingface.py` and serve the
prepared collection from `local_assets/huggingface/` at `assets/ikea/` under the
site base path, or use the public Hugging Face dataset described in the deployment guide.
Set `VITE_IKEA_BASE_URL` at build time to its pinned HTTPS base URL.
The collection and upload staging folder are excluded from Git and the app build.

```bash
npm run build
npm run preview
```

Vite writes the static website to `dist/`. Serve `dist/` over HTTP(S).
Set the JavaScript module and WASM MIME types (`application/wasm` for `.wasm`).
Enable compression on the host. Use Vite's `--base /repository-name/` option for
a project site. See [GitHub Pages deployment](docs/DEPLOYMENT.md) for the workflow,
asset hosting requirements, and repository settings.

## Controls

The site opens on a landing page. Select **Play** to enter the apartment.
The landing page preloads the Bay Area image, regional road lights, and aerial
renderer. It does not load the simulator or closer maps. Select Play to move the
page out to a solid white or dark screen. The map, clouds, and night lights then
fade in together. The remaining resources load while this first view is visible.
The camera descends through three aerial stops: the Bay Area, Santa Clara, and Building K at
2886 Scott Boulevard. Building K stays at the center of every aerial zoom. The
regional view uses 80% of the original scope within the available image bounds.
The camera then moves directly to the robot's Shoulder view in the apartment,
using its actual spawn heading and the loaded room's camera blockers.
Clouds share the map's world coordinates, so they pan and zoom together. Layered
wind curls their edges and makes them billow between dives. Santa Clara frames
the fully lit side-street area. Building K shows a
wider campus view and has no cloud overlay.
The loading screen shows only imagery and source credits. Escape cancels arrival.
Each aerial stop holds for at least 0.85 seconds. The first hold starts after the
reveal completes and extends until the closer maps, full road lights, furniture,
robot, policy, and compiled room shaders are ready. Loading time counts toward
this hold. Physics and movement inputs start after the last dive.
Reduced-motion settings keep the holds and replace the dives with cuts.
Select **Controls** in the game to open the navigation and telemetry panels.
Use **Exit to site** to return to the landing page and stop the simulation.
The sun/moon button switches the site theme. Light mode uses daytime imagery;
dark mode uses a blue night grade with stylized street lights following
OpenStreetMap roads. The initial theme follows the system; a manual choice is saved.
The arrival uses bundled NASA GIBS and USGS/USDA images, with no runtime map API key.
`python3 scripts/prepare_arrival_assets.py` downloads the images and prepares the
compact light geometry. Source URLs, coordinates, licenses, and hashes are in
`public/assets/arrival/manifest.json`.

Click open floor to walk there automatically. Select **Mezzanine** to choose an
upstairs destination. **Stairs · experimental** follows the original L stair;
this apartment has no elevator. Clicking a step selects a stair destination.
**Building** frames the full tower exterior. Orbit and Top-down cut away the
selected floor's walls for inspection. WASD or **Escape** cancels automatic navigation. Pause preserves the
route. A blue route with a white outline and destination ring stays visible
over carpets and glazing in every camera view. Stair routes are enabled with the
current policies: descents usually work, climbs stop at the first tall step, and a fall starts a get-up; press R to reset. Closed doors and solid furniture remain obstacles.
See [navigation](docs/NAVIGATION.md) for the planner, transfer stages, and limits.

| Input | Action |
| --- | --- |
| W / S or ↑ / ↓ | Move along the camera view in Shoulder; forward / backward in other views |
| A / D or ← / → | Move left / right in Shoulder; turn in other views |
| Q / E | Strafe left / right |
| Shift + movement key | Double movement and turning commands while held |
| M | Expand or close the map; Escape also closes it |
| Teleport | Drag the robot onto open floor in the map, or click a destination |
| F near a supported seat | Line up and sit; F again stands up. Clicking an armchair also routes to it |
| Space | Pause / resume physics |
| R | Reset robot, controller memory, trail, and session counters |
| V (or C) | Cycle shoulder / follow / orbit / top-down cameras |
| Hold Alt | Free the cursor while held; release Alt to capture it again. Escape also releases it |
| Mouse drag / right-drag / scroll | Look around / look around / zoom in Shoulder; orbit / pan / zoom in Follow and Orbit |
| Onscreen movement buttons | Hold for the same movement commands (also touch compatible) |

Play requests mouse capture. Move it to look around; hold Alt for menus and map clicks.
Release Alt to resume looking. Drag also works if the browser does not permit capture.
In Shoulder view, WASD moves relative to the camera; Q/E also move sideways. Diagonal input keeps the
same travel speed. The robot turns toward travel, and the camera keeps its world heading while it follows.
Drag to look around; scroll to zoom. Near the body, only the figure blurs and fades. It is hidden before
the lens enters its torso or head. The blur pass runs only within this close range.

Walking starts at 0.8 m/s; Shift requests 1.6 m/s. The speed slider sets movement speed from 0.2 to 0.8 m/s. In other camera views,
backward commands are capped at 0.4 m/s, lateral commands at 0.3 m/s, and turning at 0.7 rad/s.
Shift doubles manual travel speed and the turn limit. Pressing Shift alone does not cancel a route.
Press **M** to expand the bottom-left minimap. Click open floor to walk there. Enable **Teleport** and select a floor to move the robot directly, including to the mezzanine.
Drag the robot icon or its map marker onto an open spot. You can also click the map.
Teleport clears the route, velocity, and policy memory, preserves pause state, and rejects blocked floor or voids.
When you release a movement input, the controller requests zero velocity. Standing still, the walking
policy shuffles about 7 cm/s, so the robot then holds the place where it came to rest, with small corrective steps.

**Shoulder** is the default camera. It follows closely behind the figure's right
shoulder while the mouse sets its view direction. Position and heading ease smoothly; walls and
furniture shorten the camera distance. Scroll or use +/− to change its distance.
It works with both Robot and Character and follows stair travel.
Select Follow, Orbit, or Top-down for a wider view. Selecting another floor switches
to Orbit; selecting Shoulder returns to the figure's current floor.

When the window loses focus, the application clears held inputs.
When you hide the page, the application pauses physics.
Select Resume to continue.

## Scene and robot

- The nonrectangular apartment slab spans 37.68 × 18.06 m; the mezzanine is 3.60 m above it.
- Original V20 placements and metre scale: six blue sofas in two U arrangements,
  four LISTERBY tables, PAX wardrobes, workspaces, kitchen, and perimeter furnishings.
- IKEA-derived and existing Tripo assets retain their source materials, with
  portable PBR approximations and render LODs. Native oak and brick finishes are
  baked from the Blender material graphs. Plants use 330 authored instances.
- Physics keeps full-height construction, glazing barriers, stair solids, and
  compound furniture contacts. Orbit/Top-down only shorten the rendered walls.
- Berkeley Lite Pro: 34 controlled joints, including the waist, arms, and neck; fingers are fixed.
- The model, contacts, joint inertias, gains, and motor torque–speed envelopes match the upstream browser export.
- The L stair has twenty 18 cm risers, 29 cm going, a 90° turn, and a 1.30 m flight width.
- Live robot-frame commands, actual speed, world position, heading, base height,
  simulation time, distance, rendering FPS, and real-time factor.
- The walking policies handle flat ground and stairs. Theta* supplies the global route.
- After a fall, the get-up policy for the side Lite Pro lies on stands it up, and walking resumes.
  Getting up needs about 1.5 m of free floor; beside furniture or on stairs it can take several tries.
- Five real-scale **ULRIKSBERG** armchairs support sitting in Hephaestus: three downstairs and two on the mezzanine.
  The demo has one on each floor. The six blue main-lounge **KIVIK sofas** also offer F to sit and stand, with a short
  standing-pose alignment before the real sit policy. Other seating remains decorative. See [seating](docs/SEATING.md)
  for dimensions, validation, and the sofa approach limit.
- The HUD keeps the site's blue accents and rounded panels. Game references inform key badges, prompts, and layout.
  The local minimap stays at the bottom left; M expands it to nearly the full screen. Figure cards sit at the bottom right.

Clearance-aware Theta* routes and a velocity follower add click-to-go navigation.
Cross-floor routes attempt the original stair path. The asset library uses
the complete catalog hosted on Hugging Face. Challenge scores and history remain
future work.

### Furniture collisions

Furniture is fixed to the world. Each model uses compound convex collision
meshes generated with CoACD. MuJoCo uses convex shapes for mesh contacts; a single
object hull would fill gaps under desks and between legs.
See the [MuJoCo collision documentation](https://mujoco.readthedocs.io/en/stable/computation.html).

`src/hephaestus_physics.js` stores 4,216 source-derived convex bodies. Exact floor
triangles preserve the mezzanine void; 15 mm CoACD furniture decomposition keeps
leg gaps. Tiny hardware and nonstructural finish contacts are omitted; the
underlying construction remains. A recorded connected-component hull fallback
covers one failed ALEX template. These are fixed contact approximations, not
articulated furniture or a structural engineering model.

`src/hephaestus_data.js` stores source provenance, checksums, actual floor
footprints, stair routes, camera obstacles, and clearance-eroded navigation areas.
Rendering and physics share the same metric origin. The source Blender file is
unchanged. [Map integration](docs/HEPHAESTUS.md) describes regeneration and limits.

The earlier 19 × 14 m demo, its elevator, and its original collision preparation
remain available as a regression fixture. Run `VITE_PLAYGROUND_MAP=demo npm run dev`
to inspect it. Its export scripts and external IKEA host are unchanged.

## Performance

The page defaults to **Graphics → Fast**. The render-only Lite Pro mesh has
15,804 triangles and uses about 373 KiB, compared with 299,494 triangles in the
lite-description meshes. Rays and physics keep the full meshes and contacts.
**Quality** adds static shadows, restores physical glass transmission and distant
interior furniture, and increases the allowed render resolution.
Fast uses one-pass glass, local plant batches, and view-dependent tower context.
The unchanged collision geoms are grouped spatially to accelerate the elevation-map rays.

Physics and inference run in a worker. Poses are sent at most 50 times per second,
with one outstanding message and a reused transfer buffer. React updates telemetry
at 4 Hz. Hidden tabs pause simulation and rendering; paused views redraw when needed.
Repeated IKEA models share geometry and materials. Furniture collision decomposition
runs offline. No training code or GPU service runs in the website.

Add `?profile=1` for live render diagnostics. [Performance notes](docs/PERFORMANCE.md)
include the current Hephaestus/Lite Pro before-and-after measurements and benchmark
commands. The earlier G1 measurements remain separately labeled as historical.

## Policy and simulation

Five policies from Fluctlight (`tracker/ppo`, trained with PPO in mjlab) drive Lite Pro.
`src/robot_controller.js` picks one each control step:

| Policy | Drives | Reads |
| --- | --- | --- |
| `walk` (flat v3) | Flat ground; follows speed and turn commands | command, 5 frames of body history |
| `walk_stairs` (stairs v4) | Stairs, when its map shows a step ahead | the same, plus a 21 × 21 elevation map |
| `getup_supine`, `getup_prone` (v2) | After a fall, by the side it lies on | 5 frames of body history |
| `sit` (sit v6, head) | Sitting down on the seat, seated, standing up | a chair clip's frame, the seat's place, body state |

```text
WASD / route → vx, vy, yaw rate (ramped) and a 0.75 m root height
Body state → five frames of gravity, gyro, joints, and previous actions
Elevation map → 21 × 21 downward rays, 10 cm apart, walkable surfaces only
    ↓
state machine: walk ⇄ walk on stairs → fall → get up → walk; walk → sit down → seated → stand up → walk
    ↓
544 observations (+ map) → CNN + MLP → 34 joint targets, 50 Hz
    ↓
Per-joint PD + motor torque–speed limits + 5–10 ms command delay
    ↓
MuJoCo rigid-body dynamics and contacts, 200 Hz → Three.js poses
```

The robot model, the ONNX files, a contract per policy, and the sit policy's two chair clips come from Fluctlight's
`export-browser`. The runtime builds every input from the contract, and replays recorded
mjlab steps to prove it: observations, elevation maps and actions match to about 1e-5.
See [policy integration](docs/POLICY.md) for the contract, the switching rules, results,
and limits.

The original G1 policy is available in the earlier 3D-scene PR. It cannot control
Lite Pro: the joint layout and policy contract differ. The active app loads only Lite Pro.

## Verification

```bash
npm test                 # Original demo regressions plus Hephaestus assets/layout/navigation
npm run test:simulation  # Real bundled MuJoCo WASM + ONNX runtime; no Python needed
npm run build
```

The simulation regression uses the same controller as the browser worker. It first
replays the mjlab fixtures, then checks manual locomotion, wall and furniture contacts,
compound collision ray probes, pause, reset, getting up face up and face down,
invalid policy output, and walking to the seat, sitting down and standing up (in both maps). Automatic routes cover doorways, furniture avoidance, elevator
transfers, and holding after arrival; stair routes run and report their outcome. Those
transfer regressions run on the explicit demo fixture. The additional Hephaestus run
checks real floor/table/glazing rays, the mezzanine void, the elevation map with and
without spatial grouping, standing and walking on the carpet, automatic central-aisle
travel, pause, and reset. Physical completion of the 18 cm L stair has not been
established; it remains experimental.

## Repository layout

```text
src/main.jsx                  React controls, telemetry, and input
src/mini_map.jsx              Local/full map, cached floor geometry, and drag/drop
src/scene_view.js              Three.js scene and camera
src/scene_layout.js            Shared world geometry and MJCF generation
src/world.js                   Default map selection and explicit demo fallback
src/hephaestus_data.js         Generated source metadata, floor masks, and asset hashes
src/hephaestus_physics.js      Generated convex contacts, worker-only bundle
public/assets/hephaestus/      Optimized room/tower GLBs and native finish bakes
src/fluctlight_policy.js       Policy contracts: observations, elevation map, motors, contacts
src/robot_controller.js        State machine: walking, stairs, falls, get-ups, and sitting
src/seat.js                    Seat proximity, anchors, and the walk that lines up with a seat
src/seating_layout.js          Catalog seat profiles and per-floor sitting locations
src/seating_assets.js          Generated convex colliders for unscaled IKEA seating
src/game_hud.css               In-game HUD and furniture interaction pane
src/policy_constants.js        Generated constants from the Fluctlight bundle
src/locomotion.js              Timing, joint names, keyboard commands, and heading
src/simulation.js              Physical stepping, reset, and routing
src/simulation.worker.js       Runtime loading, clock, and worker messages
src/navigation.js             Route following and connector stages
src/path_planner.js            Clearance-aware Theta* maps
public/assets/lite_pro/        MJCF, meshes, policies (ONNX + contracts), and license
tests/fixtures/fluctlight/     mjlab rollouts that the runtime must reproduce
scripts/import_fluctlight.py   Import and verify a Fluctlight browser bundle
scripts/prepare_visual_assets.js Render-only mesh simplification
scripts/verify_policy_fixtures.js Replay the mjlab fixtures through the runtime
scripts/verify_simulation.js   Headless MuJoCo + ONNX physics checks
scripts/sit_check.js           Walk to the seat, sit, stand up: shared by both maps' checks
```

The bundled assets are ready to use. To swap in a newly trained checkpoint, export a
bundle with `uv run export-browser` in Fluctlight's `tracker/ppo` (see
[policy integration](docs/POLICY.md)), then:

```bash
python3 scripts/import_fluctlight.py /path/to/bundle
npm run assets:visuals
npm run test:simulation
```

See [THIRD_PARTY.md](THIRD_PARTY.md) for attribution and license locations.
