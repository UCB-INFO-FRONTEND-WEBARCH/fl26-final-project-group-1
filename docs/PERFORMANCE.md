# Browser performance

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
  RoboPlay keeps physics in a dedicated worker and limits work per timer cycle.
- [meshoptimizer JavaScript API](https://github.com/zeux/meshoptimizer/tree/master/js):
  The API documentation explains offline mesh simplification, absolute-error
  targets, and compact indexed meshes.

RoboPlay applies these principles to its own scene and worker.
RoboPlay does not import either project's runtime.

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
