# Lite Pro policies and the controller

Berkeley Lite Pro runs four policies trained in Fluctlight (`tracker/ppo`, a private Berkeley Humanoids repository)
with PPO in [mjlab](https://github.com/mujocolab/mjlab). A small state machine in
`src/robot_controller.js` picks one each control step.

| Policy | Checkpoint | Task | Observation | Use |
| --- | --- | --- | --- | --- |
| `walk` | `velocity_flat_v3/model_7999` | `Lite-Pro-Velocity-Motion-Flat` | command, 5 frames of body history | Flat ground: follows speed and turn commands |
| `walk_stairs` | `velocity_stairs_v4/model_7999` | `Lite-Pro-Velocity-Motion` | the same, plus a 21 × 21 elevation map | Stairs: walks down; turns away from tall steps going up |
| `getup_supine` | `getup_supine_v2/model_9999` | `Lite-Pro-Getup-Supine-RandomMotors` | 5 frames of body history | Getting up from the back |
| `getup_prone` | `getup_prone_v2/model_9999` | `Lite-Pro-Getup-Prone-RandomMotors` | 5 frames of body history | Getting up from the front |

`public/assets/lite_pro/manifest.json` records every file's hash, the Fluctlight commit, and each checkpoint.

## The bundle

Fluctlight writes the bundle with `uv run export-browser`. `scripts/import_fluctlight.py` copies it here:

| File | Contents |
| --- | --- |
| `robot.xml`, `meshes/` | The Lite Pro that mjlab compiles for the walking task: lite-description 0.5.0 with the Fluctlight patches, actuators, IMU sensors and the elevation-map site, without the training scene |
| `policies/<name>.onnx` | The actor with its observation normalizer. Inputs `obs: float32[1, N]` and, for the walking policies, `actor_map: float32[1, 1, 21, 21]`; output `actions: float32[1, 34]` |
| `policies/<name>.json` | The runtime contract (below) |
| `tests/fixtures/fluctlight/` | mjlab play rollouts: the state, observation, map and action at every step, on a plane and on a tile of 12 cm stairs |

```bash
# In Fluctlight/tracker/ppo:
uv run export-browser --out /tmp/bundle --policies \
  walk=Lite-Pro-Velocity-Motion-Flat@<run>/model_7999.pt,\
  walk_stairs=Lite-Pro-Velocity-Motion@<run>/model_7999.pt@Lite-Pro-Velocity-Motion-Flat,\
  getup_supine=Lite-Pro-Getup-Supine-RandomMotors@<run>/model_9999.pt,\
  getup_prone=Lite-Pro-Getup-Prone-RandomMotors@<run>/model_9999.pt
# Here:
python3 scripts/import_fluctlight.py /tmp/bundle
npm run assets:visuals
```

The last field of a `walk_stairs` entry names the task its plane fixture comes from. Swapping a checkpoint is an
export and an import; nothing in `src/` names a checkpoint.

## The contract

`src/fluctlight_policy.js` builds every input from the contract alone:

- **Observation terms** in order, each with its size, history length and delay. History is oldest first, term by term,
  and the first value after a reset fills every slot, as mjlab's `CircularBuffer` does. The get-up policies' gyro and
  gravity terms carry the measured IMU lag of 0–1 control steps.

  | Term | Value |
  | --- | --- |
  | `velocity_command` | vx, vy (m/s, heading frame), yaw rate (rad/s), root height (0.75 m, the median of the training walks) |
  | `projected_gravity` | gravity's direction in the pelvis frame |
  | `base_ang_vel` | the `imu_ang_vel` gyro, at the pelvis |
  | `joint_pos`, `joint_vel` | relative to the standing pose, in the policy joint order |
  | `actions` | the previous network output |

- **Elevation map** (walking policies): a 2 m × 2 m grid of rays at 10 cm, cast straight down from 0.5 m above the
  pelvis and turned with its yaw. Rays run along x within a row, rows along y. Each height is the hit minus the mean
  hit within 0.2 m of the pelvis; a miss reads −1; heights clip to ±1 m. The rays see only geom group 4, the
  walkable surfaces (floors, stair treads, rugs and lift decks), because the training terrain held only ground.
  `walk` trained on a plane with the map switched off, so it receives zeros.
- **Actuators**: `target = default_pose + action_scale × action`, then a PD loop per joint behind mjlab's DC-motor
  clip: the torque falls linearly from the peak at standstill to zero at the no-load speed. The command reaches the
  motor 1–2 physics steps late (5–10 ms), redrawn each step unless held (probability 0.3).
- **Contacts**: the walking tasks let every robot geom touch the ground but only the legs touch each other; the
  get-up tasks let the whole body collide, with friction everywhere. The contract lists each collision geom's
  `contype`, `conaffinity`, `condim`, priority and friction, and the controller applies them when it switches.
- **Timing**: physics at 200 Hz, control at 50 Hz. Observations read the state after `mj_forward`, as mjlab's
  `forward()` before sensing does.

## The controller

```text
                 a step ahead in the map
  walk (flat) ◀──────────────────────────▶ walk (stairs)
        │        1 s of flat ground            │
        └────────────────┬─────────────────────┘
                       fall
                         ▼
                      falling ──at rest──▶ getup (supine | prone) ──standing──▶ walk
                         ▲                         │
                         └──── not standing at 6 s ┘
```

- **Walking.** Both walking policies observe every step, and each one's action history holds the applied actions, so
  either can take over mid-stride. `walk_stairs` takes over when its map shows a step of 6 cm or more ahead (0.1 to
  1 m forward, within 0.4 m sideways) while the command walks forward. It hands back after 1 s with the whole map flat
  (under 3 cm), or standing still on flat ground underfoot.
- **Fall.** The thresholds that ended a walking episode in training: the pelvis tilts more than 1 rad, or sinks 0.25 m
  below the commanded root height. The route and the command are dropped, and the motors hold the joints where they
  are, with the get-up gains and contacts.
- **Get up.** Once the body is at rest (or after 3 s), gravity in the pelvis frame picks the policy: along −x the robot
  lies face up, along +x face down, as in the get-up pose banks. A get-up that is not standing after 6 s, for example
  wedged against furniture, goes back to falling and starts again.
- **Stand.** The get-up task's test: pelvis above 90% of 0.77 m and upright above 0.9. After 1 s standing still, or 3 s
  standing, the walking policies start from fresh histories with a zero command.
- Commands ramp at 1 m/s² and 2 rad/s², since the training commands are stride averages that never jump.
- The simulation stops only if MuJoCo resets a diverged state; Reset is always available.

## Validation

```bash
npm test                 # contracts, hashes, observation layout, motor curve, scene and UI units
npm run test:simulation  # mjlab parity fixtures, then the demo and Hephaestus physics checks
```

`scripts/verify_policy_fixtures.js` replays every fixture: it sets the recorded state, builds the observation and the
map, and runs the ONNX file. Observations and maps match mjlab to about 1e-6, actions to about 1e-5, including the
map on a tile of 12 cm stairs.

The physics checks walk, turn and strafe, collide with walls and furniture, follow routes on each floor and through
the lift, get up face up and face down, pause and reset, and reject invalid actions. Stair routes are reported, not
asserted.

## Results and limits

From the Fluctlight evaluations (mjlab, held-out starts; see `docs/research/` there):

- `walk`: falls in 0.3%, 2.1% and 7.5% of 5 s windows below 0.5, 0.5–1 and 1–1.5 m/s; it makes 94–101% of the
  commanded speed below 1 m/s. In the browser it follows turn commands within 5%, and drifts about 0.05 rad/s in
  heading on a straight command.
- `walk_stairs`: crosses 93–100% of flights down at every riser height (2–18 cm); crosses none up at 11 cm and above,
  where it turns away. It barely follows turn commands, which is why it drives only on stairs.
- Get-up: 100% of held-out lying poses, standing in about 1 s, face up and face down. In the browser it needs about
  1.5 m of free floor; beside furniture or on stairs it can wedge and retry.

In the apartments:

- The demo stair (11 cm risers, 45 cm treads): the descent route arrives; the climb stops at the first step.
- The Hephaestus L stair (18 cm risers): the first flight down works; the turn at the landing usually ends in a fall,
  and the climb stops at the first step. Stair routes remain experimental.
- No policy has run on the physical robot yet. On hardware, the get-up policies still exceed the neck motor's speed
  limit; Fluctlight is training a version that respects it.

A newer stairs policy that keeps its heading on climbs (`Lite-Pro-Velocity-Motion-Heading`) and a sit-down/stand-up
policy are in training. The sit policy tracks chair clips from a dataset that cannot be published, so it is not part
of this bundle.

Policies and controller: Fluctlight, MIT-licensed code. The walking policies learned from LAFAN1 motions (Ubisoft La
Forge, CC BY-NC-ND 4.0). Robot description and meshes: MIT. See [THIRD_PARTY.md](../THIRD_PARTY.md).
