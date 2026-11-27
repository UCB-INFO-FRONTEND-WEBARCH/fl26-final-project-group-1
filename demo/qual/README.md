# Qual demo: "Take a rest"

`take-a-rest.mp4` is a concept video of a three-level control stack on Lite Pro in the
Hephaestus apartment. The user says "Take a rest." The robot walks to a sofa, turns
around, and sits down.

| Level | In this video | Input → output |
| --- | --- | --- |
| S2 · task planner | Scripted | User prompt → three sub-task labels |
| S1 · trajectory generator | Scripted | Sub-task label → route or pose trajectory |
| S0 · motion tracker | Learned Fluctlight walk and sit policies in MuJoCo | Pose targets → joint setpoints at 50 Hz |

S2 and S1 are scripted, not trained models. The video does not say this on screen. S0 is
the unchanged Fluctlight walk and sit policies. The robot's motion is the physical simulation, with no
pose corrections.

## Take

- Seed: 11
- Code: commit `b2476d5` on `demo/qual-take-a-rest`. It differs from the first take
  (`d4acf5c`) only in the overlay labels; the motion is the same.
- Duration: 30.33 s (910 frames), 1920×1080, 30 fps, H.264 (`libx264 -crf 18 -pix_fmt yuv420p
  -movflags +faststart`), no audio
- Takes: 4 recorded (seeds 3, 5, 11 and 12), none fell. Seed 11 had the least foot slip
  while it sat down. In Node, 12 of 12 screened seeds sat without a fall.

## What happens

1. 0–2 s: the robot stands. The prompt types out.
2. 2–4 s: S2 lists the sub-tasks. At 4.00 s it hands sub-task 1 down
   (`Simulation.request_sit('sofa_north')`).
3. Sub-task 1, walk to the sofa: S1 plans a Theta* route to a staging point 85 cm in front
   of the sofa (dashed line, ghost at the staging pose). The walk policy follows it at 0.4 m/s.
4. Sub-task 2, turn around: S1 sets a pose target with the robot's back to the seat (ghost).
   The walk policy turns in place and backs up to it.
5. Sub-task 3, sit down: S1 plays the sit-down clip placed on the seat. The ghost leads
   the robot by 25 frames (0.5 s). The sit policy tracks the clip.
6. The robot holds the seated pose for 3 s. The video ends.

The highlighted sub-task follows the simulation's phases (`route`, `align`, `sit_down`,
`seated`), not a clock.

## Reproduce

The run is deterministic for a seed: the same seed gives the same motion in Node and in
the browser.

```bash
npm install
npm run dev                                   # in another terminal
node scripts/demo_rest_takes.js 1 12          # screen seeds headless: falls, sit depth, foot slip
node scripts/record_demo_rest.js --seed 11    # writes demo/qual/take-a-rest.mp4
```

The recorder needs Google Chrome (set `CHROME` for another path) and ffmpeg. It steps
the page one video frame at a time, so the result does not depend on the machine's speed.
To watch the demo live, open `http://127.0.0.1:5173/?demo=rest&seed=11`.

## Notes

- The robot starts on the lounge rug, 5 m from the sofa, facing away from it. The walk
  policy is blind and trips on the rug's 3 cm edge. A start off the rug fell in all 24
  screened seeds.
- The route speed of 0.4 m/s is in the range of the playground's speed slider. The
  policies and the sit controller are unchanged.
- This branch never merges into `main` or `dev`.
