# Browser performance

## What was expensive

The initial implementation rendered all 503,229 triangles from Unitree's original
CAD/STL visual meshes. Rendering them again into a 2048² dynamic shadow map pushed
the frame to 1,007,784 triangles. Separate boxes and edge objects contributed to
179 draw calls. A pixel ratio of 1.75 also made the drawing buffer 3.06 times the
area of its CSS dimensions on a high-DPI screen.

The worker originally woke approximately every 4 ms, copied poses on each wake,
and ran full `mj_forward` only to obtain updated visual transforms. It sent frames
without waiting for the main thread. That could queue stale poses on a slow
renderer. React telemetry was updated at 10 Hz, and the trail repeatedly disposed
and recreated GPU buffers. Paused views still redrew the entire scene.

## References inspected

- [MicroDuck GameCanvas.jsx](https://huggingface.co/spaces/pollen-robotics/microduck-simulator/blob/main/app/src/scene/GameCanvas.jsx):
  an imperative game core owns the hot loop inside the R3F shell, and the Canvas
  uses simple lighting without enabling shadow-map rendering.
- [MicroDuck game.js](https://huggingface.co/spaces/pollen-robotics/microduck-simulator/blob/main/app/src/game/game.js):
  batches fixed physics substeps per control step, throttles telemetry/store writes
  to 4 Hz, and reuses working objects in per-frame camera code.
- [mjswan runtime.ts](https://github.com/ttktjmt/mjswan/blob/main/src/mjswan/template/src/core/engine/runtime.ts):
  its control loop batches fixed substeps and yields between control cycles;
  rendering reads cached simulation state.
- [mjswan yieldToBrowser.ts](https://github.com/ttktjmt/mjswan/blob/main/src/mjswan/template/src/core/engine/yieldToBrowser.ts):
  explains why overdue simulation work must still yield. This project retains a
  dedicated worker and a bounded timer cycle, rather than moving physics back
  onto the rendering thread.
- [meshoptimizer JavaScript API](https://github.com/zeux/meshoptimizer/tree/master/js):
  documents offline mesh simplification, absolute-error targeting, and compact
  indexed meshes.

The implementation applies these principles to RoboPlay's own scene and worker;
it does not import either project's runtime.

## Changes

1. Generate render-only LOD assets offline using `npm run assets:visuals`.
   Meshoptimizer targets 5% of original faces with a 4 mm geometric-error target.
   The result has 25,142 triangles and occupies 590 KiB including positions,
   normals, and indices. Normals are prepared offline. MuJoCo continues loading
   the original robot assets and the exact same pretrained policy.
2. Merge all static room boxes into one vertex-colored mesh and all their edges
   into one line mesh. Use Lambert lighting instead of per-fragment PBR materials.
3. Default to Fast graphics: 1× pixel ratio, a one-megapixel maximum framebuffer,
   no shadow-map pass, and a small radial contact shadow under the robot. Quality
   mode permits 1.5× pixel ratio and bakes the static room's 1024² shadow once.
   The animated robot is never redrawn into a shadow map.
4. Schedule simulation work in 20 ms batches while preserving every 2 ms physics
   step and every 50 Hz policy evaluation. Refresh visual poses with
   `mj_kinematics`, which does not rerun contacts and constraint solving.
5. Limit pose publication to 50 Hz and one frame in flight. The main thread
   acknowledges and returns the transferred buffer after copying transforms.
   A busy renderer cannot accumulate old pose messages. Cache WASM array views
   once per publication instead of reacquiring them for every geometry.
6. Throttle React telemetry to 4 Hz. Update a fixed-size trail buffer in place.
   Stop GPU rendering on hidden tabs and avoid unchanged draws while paused.

## Measurements and reproduction

These are representative warmed-up samples from the same in-app browser, same
viewport, and default follow camera. GPU submission timing is measured with
`performance.now()` around Three.js rendering; it is CPU time, not a GPU timer.
Triangle/draw counts come from `renderer.info.render` and include render passes.
Browser scheduling and other open applications can change FPS substantially.

| Measurement | Original | Optimized Fast |
| --- | ---: | ---: |
| G1 visual triangles | 503,229 | 25,142 |
| Triangles submitted per frame | 1,007,784 | 25,990 |
| Draw calls per frame | 179 | 40 |
| Pixel ratio in measured viewport | 1.75 | 1.0 |
| CPU render submission, representative mean | 1.19 ms | 0.49 ms |
| CPU render submission, representative p95 | 1.70 ms | 0.70 ms |
| FPS in warmed-up sample | 53 | 60 |
| Physics real-time factor | ~1.0 | ~1.0 |

Open `http://127.0.0.1:4173/?profile=1` after `npm run build` and
`npm run preview`. Allow shader compilation and model loading to finish before
recording numbers. Use W/A/S/D to include moving robot and camera work. The
diagnostic panel reports actual counts and timings; it does not change the engine.

The controller contract tests, indexed-geometry integrity checks, and all seven
WASM/ONNX physics regressions pass. Those scenarios include balancing, forward
and backward walking, turning, strafing, doorway crossing, and wall collisions.
