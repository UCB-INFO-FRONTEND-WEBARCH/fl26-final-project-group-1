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

- Seed: 6
- Code: commit `22ffd44` on `demo/qual-take-a-rest`
- Duration: 15.000 s (450 frames), 1920×1080, 30 fps, H.264 (`libx264 -crf 18 -pix_fmt yuv420p
  -movflags +faststart`), no audio
- Start: on the lounge rug at (1.6, 1.85) m, 1.1 m beside the staging point and 1.4 m from
  the sofa's front edge, facing along the sofa (sideways to it)
- On screen: the prompt panel at the bottom right (the prompt and S2's three sub-tasks), and
  S1's dashed route and plan ghost in the scene. The top center is clear for the deck's slide
  title.
- Takes: 2 recorded (seeds 6 and 11), none fell. Seed 6 had the least foot slip while it sat
  down. In Node, 12 of 12 screened seeds sat without a fall, at 12.6–13.2 s. The current file
  is seed 6 re-rendered with this overlay; the motion is the same as in the take at `ff2d16d`.

## What happens

1. 0–1 s: the robot stands. The prompt types out.
2. 1–1.8 s: S2 lists the sub-tasks. At 2.00 s it hands sub-task 1 down
   (`Simulation.request_sit('sofa_north')`).
3. Sub-task 1, walk to the sofa (about 2–4.5 s): S1 plans a Theta* route to a staging point
   85 cm in front of the sofa (dashed line, ghost at the staging pose). The walk policy
   follows it at 0.4 m/s.
4. Sub-task 2, turn around (about 4.5–11 s): S1 sets a pose target with the robot's back to
   the seat (ghost). The walk policy turns in place and backs up to it.
5. Sub-task 3, sit down (about 11–12.7 s): S1 plays the sit-down clip placed on the seat. The
   ghost leads the robot by 25 frames (0.5 s). The sit policy tracks the clip.
6. The robot stays seated until the video ends at 15.00 s.

The highlighted sub-task follows the simulation's phases (`route`, `align`, `sit_down`,
`seated`), not a clock.

## Reproduce

The run is deterministic for a seed: the same seed gives the same motion in Node and in
the browser.

```bash
npm install
npm run dev                                   # in another terminal
node scripts/demo_rest_takes.js 1 12          # screen seeds headless: falls, sit depth, foot slip
node scripts/record_demo_rest.js --seed 6     # writes demo/qual/take-a-rest.mp4
```

The recorder needs Google Chrome (set `CHROME` for another path) and ffmpeg. It steps
the page one video frame at a time, so the result does not depend on the machine's speed.
To watch the demo live, open `http://127.0.0.1:5173/?demo=rest&seed=6`.

## Notes

- Lining up and sitting down take about 8 s of the 15 s, and the sit flow (`seat.js`) is
  unchanged. From a start 2 m from the staging point, the robot sat after 13.5 s, so it
  starts 1.1 m from it.
- The start is on the lounge rug. The walk policy is blind and trips on the rug's 3 cm
  edge: a start off the rug fell in all 24 screened seeds.
- The route speed of 0.4 m/s is in the range of the playground's speed slider. The
  policies and the sit controller are unchanged.
- This branch never merges into `main` or `dev`.
