# Lite Pro perceptive locomotion

The active robot is Berkeley Lite Pro with 34 controlled joints. The checkpoint
is the S3 goal-mode Mix run at iteration 20,000, in velocity mode, from the
[published report](https://claude.ai/artifact/8nh5Z94mUcC7iCdg3cDGpo), section 3.10.
The matching code is [InstinctMJ at `07396764422e`](https://github.com/berkeley-humanoids/instinctmj/tree/07396764422e274e4316719f9dfb1fd734e9a516).

## Pinned export

`public/assets/lite_pro/contract.json` records the source, snapshot URL, and hashes.
The ONNX SHA-256 is:

```text
f0ff3ef686b6fae8690ffc5a9a8003c8e45c74830c2287fd90f25258563c7a28
```

The ONNX file is unchanged. It includes the observation normalizer, velocity goal
mask, depth encoder, and actor. It takes `obs: float32[1, 2798]` and returns
`action: float32[1, 34]`. It uses eight frames of observation history rather than
the previous G1 checkpoint's LSTM hidden/cell state.

`scripts/import_lite_pro.py` verifies the pinned source bytes, unpacks the browser
meshes, removes the demo's world geometry, and writes the robot MJCF and generated
runtime constants. `--source-dir` accepts a previously downloaded, decoded export.
The full imported robot stays unchanged: joint order, inertia, armature, damping,
joint limits, collision geometry, and actuator mapping. Only the apartment terrain
and a separate lift actuator are added. Motors are looked up by name because
actuator order differs from policy joint order.

## Observations and actuation

| Input | Layout |
| --- | --- |
| Future goal | Ten frames, 0.1 s apart; heading-frame forward/lateral velocity, yaw rate, and 0.73 m pelvis height above the supporting ground |
| Goal selection | Velocity channel active; reference-motion and body-keypoint channels masked |
| Proprioception | Eight term-major frames of projected gravity, body angular velocity, relative joint positions, joint velocities, and previous actions |
| Depth | 48 × 27 head-camera rays; contour filtering, stereo range noise, Gaussian blur, range normalization, crop, bilinear resize to 18 × 32 |

The camera uses the exported mount transform and geom groups 0 and 2. Apartment
floors, individual stair boxes, rails, walls, and furniture collision hulls are in
group 0; robot visual meshes are in group 2. Open lift gates and the open cabin
rail move to excluded group 5, alongside their disabled collision masks. Closed
gates remain visible to the sensor. Rendering reads physics transforms without
changing the state used by the camera pipeline.

Each action is scaled and offset per joint. A PD controller applies the exported
gains behind each motor's torque–speed envelope, with the exported 1–2 physics-step
command delay and 0.3 delay-hold probability. Physics runs at 200 Hz, control and
inference at 50 Hz. The robot is positioned directly only during an explicit reset;
walking, stairs, and lift transfers use forces and contacts.

## Apartment integration

The previous 16.5 cm risers and 27 cm treads exceeded the reference demo's tested
geometry. The replacement flight has 24 box treads, each 11 cm high and 45 cm deep,
and is 2.2 m wide. Floors are 2.64 m apart. The building is 19 × 14 m to leave room
for clear lower and upper landings. The elevator has a separate approach.

Flat routes reserve 52 cm around obstacles while checking a 30 cm tracking footprint.
The follower turns before advancing and can replan up to four
times from a still-clear position. It never bypasses collision clearance checks.
On stairs it keeps a steady cadence, follows heading and lateral error, and
advances intermediate waypoints by horizontal progress; pelvis height varies
through a step. Arrival still requires the target's horizontal position and
support height. While the lift moves, manual drive input is blocked and a small
velocity feedback command keeps the robot near the cabin centre and facing the exit.

## Validation and limits

```bash
npm test
npm run test:simulation
npm run build
```

The simulation command first compares the port against the unchanged upstream
browser controller for 24 seeded noisy steps. Depth, images, observations,
actions, and physical poses agree to a maximum absolute error of zero on the
tested runtime. It then exercises the actual apartment model and ONNX checkpoint,
including wall/furniture contacts, pause/reset, invalid action rejection, routes,
and destination holding. The regression uses a fixed random seed for repeatability.

The upstream report evaluates 8–14 cm steps and reports occasional failures,
especially on longer approaches and after stops. This integration does not retrain
the policy or establish a success rate on arbitrary stairs. Stair mode remains
experimental, and falls stop the simulation with Reset available. Physics and
camera meshes retain the upstream geometry; the 6,196-triangle render mesh is a
separate visual optimization.

Policy/controller: CC BY-NC 4.0. Robot description/meshes: MIT. Full notices are in
[THIRD_PARTY.md](../THIRD_PARTY.md) and the asset directory.
