# Browser performance

## Expanded map, November 24, 2026

The proposed full-screen M map was measured in a production preview at 1280 × 720, Fast graphics,
Shoulder camera at reset, after loading and shader compilation. The playing view already held 60 FPS,
so this round targets work hidden by the map. These are short CPU submission samples, not GPU timings.

| Map open | Before | After |
| --- | ---: | ---: |
| 3D scene redraws per second | 60 | 0, suspended |
| CPU submission per 3D frame | 2.57 ms | No 3D submission |
| Physics real-time factor | 1.003× | 1.002× |

The frame counter stayed at 5,537 through map opening, the held map, and closing. It then advanced
to 10,722 with 60 FPS after returning to play. Physics and map markers continue updating while the
covered scene is frozen. Pause state, policy stepping, and worker frame acknowledgements are unchanged.
The static floor-plan geometry is memoized separately from the robot, route, and interaction markers.

The [raw samples](performance/2026-11-24-map.json) include playing, map-open, map-held, close, and
resumed states. To check this behavior, run a production preview with `?profile=1`, press M, and
watch `render_count` and `render_suspended`. Close M to confirm that rendering resumes.

## Hephaestus Tower / Lite Pro

The default V20 room was measured before and after the navigation, arrival, and
performance fixes in the same in-app browser at 1280 × 720, Fast graphics,
Shoulder camera near the reset position, after loading and shader compilation.
These are representative short samples, not GPU timings or cross-device promises.

| Measurement | Before | After |
| --- | ---: | ---: |
| CPU frame submission, mean | 6.18 ms | ~2.1 ms |
| CPU frame submission, p95 | 6.5 ms | ~2.3–2.8 ms |
| Submitted triangles, including extra passes | 6.03 million | 2.50 million |
| Draw calls | 435 | 324–325 |
| FPS | 60 | 60 |
| Browser physics real-time factor | 0.62× | ~1.00× |
| Pixel ratio | 1.0 | 1.0 |

Fast approximates physical glass with one alpha pass and renders double-sided
transparency once. Quality restores the source transmission and material flags.
Static transforms are frozen. All 330 plants retain their authored transforms,
using local 8 m instance batches indoors and shared overview batches in Building
view. The lower facade renders only in Building view. Fast Building view omits
interior furniture; Quality restores it. Room dimensions, colors, finishes,
collision surfaces, and the source Blender file are unchanged.

These measurements were taken with the earlier S3 policy and its head depth camera.
The dominant worker cost was depth ray casting against 4,216 world-body geoms.
Grouping the same geoms into fixed 4 m bodies gives MuJoCo useful body bounds;
its ray implementation rejects bodies outside the ray before testing their
geoms. See the [MuJoCo ray implementation](https://github.com/google-deepmind/mujoco/blob/main/src/engine/engine_ray.c).
There are still 4,326 total geoms, including the robot. All 1,296 raw sensor rays
match the flat reference exactly at twelve test poses. Seeded benchmark final
poses also match before and after.

The standalone benchmark uses Node 24.22.1, one WASM inference thread, seed 7,
warm-up, and 200 control cycles per scenario. It runs uncapped, without rendering:

| Headless measurement | Before | After |
| --- | ---: | ---: |
| Idle control cycle | 29.95 ms | 13.96 ms |
| Idle depth sensing | 26.85 ms | 10.49 ms |
| Walking control cycle | 30.34 ms | 14.62 ms |
| Walking depth sensing | 27.52 ms | 11.42 ms |
| Walking real-time factor | 0.66× | 1.37× |

With the Fluctlight policies, the elevation map casts 441 downward rays per control
cycle against the walkable group only. With the same benchmark (Node 24, seed 7, 200 cycles), on a different machine:

| Headless measurement (Fluctlight policies) | Mean |
| --- | ---: |
| Idle control cycle | 5.8 ms |
| Idle elevation map | 4.4 ms |
| Walking control cycle | 5.5 ms |
| Walking elevation map | 4.2 ms |
| Policy inference | 0.15 ms |
| Walking real-time factor | 3.6× |

To reproduce, stop other simulations and run:

```bash
node scripts/profile_hephaestus.js --output=local_assets/hephaestus/profile-after.json
# Recreate the old flat static hierarchy from the same source data:
node --input-type=module -e "import {writeFileSync} from 'node:fs'; import {make_scene_xml} from './src/scene_layout.js'; writeFileSync('local_assets/hephaestus/flat.xml', make_scene_xml({spatial_cells:false}));"
node scripts/profile_hephaestus.js --xml=local_assets/hephaestus/flat.xml --output=local_assets/hephaestus/profile-before.json
```

The browser caps simulation at real time. Its `?profile=1` panel measures CPU
camera/update/render submission with `performance.now()`, not GPU execution.
Paused views redraw only when needed, so their displayed FPS is not comparable.
The panel also reports the measured final arrival handoff position and angle.
The tested handoff error is below 10⁻⁹ m and 0.000003°.

## Historical G1 measurements

These are historical measurements of the earlier Unitree G1 implementation. The
active Lite Pro renderer uses 15,804 triangles (about 373 KiB); its elevation map and
physics use the full lite-description model. Policy details are in [POLICY.md](POLICY.md).

## What was expensive

The initial renderer used all 503,229 triangles from Unitree's original CAD/STL
visual meshes. A second pass for a 2048² dynamic shadow map increased the total
to 1,007,784 triangles per frame. Separate boxes and edge objects produced
179 draw calls. A pixel ratio of 1.75 made the drawing buffer 3.06 times the area
of its CSS dimensions on a high-DPI screen.

The initial worker ran approximately every 4 ms and copied poses each time.
It called full `mj_forward` to update visual transforms. It sent frames without
waiting for the main thread, which could queue stale poses on a slow renderer.
React updated telemetry at 10 Hz. The trail repeatedly deleted and recreated GPU
buffers. Paused views still rendered the entire scene.

## References inspected

- [MicroDuck GameCanvas.jsx](https://huggingface.co/spaces/pollen-robotics/microduck-simulator/blob/main/app/src/scene/GameCanvas.jsx):
  React Three Fiber (R3F) calls the game core once per frame.
  The Canvas uses simple lighting without shadow maps.
- [MicroDuck game.js](https://huggingface.co/spaces/pollen-robotics/microduck-simulator/blob/main/app/src/game/game.js):
  The game groups fixed physics substeps into each control step.
  It limits telemetry updates to 4 Hz and reuses objects in the camera code.
- [mjswan runtime.ts](https://github.com/ttktjmt/mjswan/blob/main/src/mjswan/template/src/core/engine/runtime.ts):
  The control loop groups fixed substeps and yields between control cycles.
  The renderer reads cached simulation state.
- [mjswan yieldToBrowser.ts](https://github.com/ttktjmt/mjswan/blob/main/src/mjswan/template/src/core/engine/yieldToBrowser.ts):
  The source explains why overdue simulation work must still yield.
  Centoria keeps physics in a dedicated worker and limits work per timer cycle.
- [meshoptimizer JavaScript API](https://github.com/zeux/meshoptimizer/tree/master/js):
  The API documentation explains offline mesh simplification, absolute-error
  targets, and compact indexed meshes.

Centoria applies these principles to its own scene and worker.
Centoria does not import either project's runtime.

## Changes

1. `npm run assets:visuals` generates simplified meshes for rendering offline.
   Meshoptimizer targets 5% of the original faces and a 4 mm geometric error.
   The result has 25,142 triangles. Positions, normals, and indices occupy 590 KiB.
   The script computes normals offline. MuJoCo uses the original robot assets
   and the same pretrained policy.
2. The renderer merges static room boxes into one vertex-colored mesh.
   It merges their edges into one line mesh. Lambert lighting replaces
   per-fragment physically based rendering (PBR) materials.
3. Fast graphics uses a 1× pixel ratio, a one-megapixel framebuffer limit,
   no shadow-map pass, and a radial contact shadow under the robot.
   Quality mode permits a 1.5× pixel ratio. It computes the static room's 1024²
   shadow once. The renderer does not draw the animated robot into a shadow map.
4. The worker groups simulation work into 20 ms cycles. It preserves every
   2 ms physics step and every 50 Hz policy evaluation. It updates visual poses
   with `mj_kinematics`, which does not repeat contact detection or constraint solving.
5. The worker sends poses at 50 Hz, with at most one outstanding frame.
   The main thread copies transforms, acknowledges the frame, and returns its buffer.
   This limit prevents a queue of stale poses. Each frame reads WASM array views
   once instead of reading them again for each geometry.
6. React updates telemetry at 4 Hz. The trail uses one fixed-size buffer.
   Hidden tabs stop GPU rendering. Paused views render only after a pose, camera,
   or graphics setting changes.

## Measurements and reproduction

The table shows samples from the same in-app browser, viewport, and default follow
camera after model and shader loading. `performance.now()` measures CPU time around
the Three.js render call. It does not measure GPU execution time.
`renderer.info.render` reports triangle counts and draw calls across render passes.
The p95 value is the 95th percentile of the recorded CPU times.
Browser scheduling and other open applications can change frames per second (FPS).

| Measurement | Original | Optimized gray-box scene | Furnished Fast |
| --- | ---: | ---: | ---: |
| G1 visual triangles | 503,229 | 25,142 | 25,142 |
| Triangles submitted per frame | 1,007,784 | 25,990 | 112,674 |
| Draw calls per frame | 179 | 40 | 58 |
| Pixel ratio in measured viewport | 1.75 | 1.0 | 1.0 |
| CPU render submission, representative mean | 1.19 ms | 0.49 ms | 0.81 ms |
| CPU render submission, representative p95 | 1.70 ms | 0.70 ms | 1.30 ms |
| FPS in warmed-up sample | 53 | 60 | 60 |
| Physics real-time factor | ~1.0 | ~1.0 | ~1.0 |

The furnished scene uses twelve local IKEA GLBs, totaling 1.93 MB, in fourteen
placements. Repeated models share geometry and materials. Fast mode adds one
merged contact-shadow mesh. Quality mode includes the furniture in its static
shadow bake. The robot still uses its contact shadow.

CoACD generates collision meshes offline. The application loads 367 unique convex
hulls and reuses them for repeated placements. It does not decompose meshes during
page startup or physics stepping. The physics worker remains paused until the
furniture visuals and robot are ready. Add `?collisions=1` to inspect the hulls;
this diagnostic overlay adds draw calls and is excluded from the measurements.

To measure the page:

1. Run `npm run build`. Vite writes the website to `dist/`.
2. Start the preview with `npm run preview`. Vite prints the Local URL.
3. Open `http://127.0.0.1:4173/?profile=1`.
4. Wait for the model and shaders to load. The page shows the robot and live telemetry.
5. Use W/A/S/D to measure the robot and camera while they move.

The diagnostic panel reports counts and timings. It does not change the engine.

The controller contract tests, indexed-geometry checks, and eight WASM/ONNX physics
regressions pass. The physics scenarios cover balance, forward and backward walking,
turning, strafing, doorway crossing, wall collisions, and IKEA furniture contact.
Further probes check openings, table legs, tabletop height, and a physical drop
onto the coffee table.
