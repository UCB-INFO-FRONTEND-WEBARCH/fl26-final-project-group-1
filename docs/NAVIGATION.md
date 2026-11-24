# Click-to-move navigation

The default map is now Hephaestus Tower. **Apartment** and **Mezzanine** select
the two playable levels, 3.60 m apart; **Building** shows the tower exterior.
There is no apartment elevator. The original L stair uses twenty 18 cm risers,
29 cm going, a 90° turn, and a 1.30 m flight width. Its learned-policy traversal
remains experimental; physical completion has not been validated.

The planner uses the actual nonrectangular floor triangles and mezzanine void,
eroded by the same planning/tracking clearance radii described below. Source
furniture and closed doors remain obstacles. Cross-floor routes follow the
three-dimensional stair polyline in both directions, including its turn.
The velocity follower still drives the unchanged walking policy.

New-map tests cover valid floor masks, aisle and reading-nook reachability,
furniture rejection, upper-floor voids, stair route construction, and no lift.
Real MuJoCo/ONNX tests cover supporting surfaces, standing, manual walking,
automatic aisle travel, pause, and reset. See [map integration](HEPHAESTUS.md).

## Earlier demo fixture

The remaining details and the complete stair/lift transfer regression describe
the earlier demo selected with `VITE_PLAYGROUND_MAP=demo`. They are retained
to document and test the original controller and connector behavior.


Click open floor in the scene or the floor plan to choose a destination.
Use **Ground** and **Upper** to choose a floor, or **Building** to see both levels.
Choose **Elevator** or **Stairs · experimental** under **Cross-floor route**.
Clicking a step selects stair mode and routes to that step along the stair centre.
The route is blue; the destination turns green on arrival. **Follow** tracks the
robot and switches floors during elevator travel.

WASD, arrow keys, or the on-screen movement buttons take over immediately.
**Escape** or **Stop navigation** clears the route. Pause preserves it; reset
returns the robot and lift to the ground floor. A gentle velocity controller
holds the destination after arrival; **Clear route** releases this hold.

## Planner

The building has two floors, 2.64 metres apart, joined by physical stairs and an
actuated elevator. Navigation has two levels:

1. Theta* searches a 10 cm occupancy grid on each floor. Walls and the projections
   of the actual furniture collision hulls are inflated by a 52 cm planning radius,
   plus half a cell diagonal. Line-of-sight checks cover every crossed cell and
   reject diagonal corner cutting. Clicked points are not snapped through walls.
   Following allows 22 cm of tracking error within that planning reserve, while
   still checking a conservative 30 cm body footprint against obstacles.
2. Cross-floor routes use the selected connector. Elevator routes walk to the
   landing, call and wait, board, ride, exit, and walk to the destination. Stair
   routes walk to a separate stair landing, follow the three-dimensional step
   path, then continue on the destination floor. The connector is chosen by the
   user; additional automatic choices could use a portal graph with travel costs.

Planning runs in the physics worker. The map is built once at startup; rendering
does not run searches. The follower runs at the walking policy's 50 Hz control
rate and sends robot-frame forward, lateral, and yaw velocity commands. It never
sets the robot's position or joint angles. Automatic walking is capped at 0.6 m/s.
When a segment becomes obstructed but the robot still has planning clearance,
the follower can replan from its current position up to four times. It turns
before advancing through a sharp heading change. Routes stop if no safe recovery
exists or the robot makes no progress.

The elevator has a gravity-compensated slide joint and a separate position servo.
Travel is limited to 0.3 m/s with gradual acceleration. Landing gates close when
the deck is absent, and a cabin rail closes during travel. Manual movement is
interlocked while riding; velocity feedback holds the cabin centre and turns the robot toward the exit. Canceling a route during travel leaves the lift running
to its landing. Pausing freezes the entire physics simulation.

The deck and rail geometry collide with the robot. The lift body's contact with
the static world is excluded because its slide joint constrains it inside a
modeled shaft; this also prevents the ground plane from pushing up the deck.
Upper-floor slabs have actual stairwell and elevator openings. The stairs and
lift sit beside each other in a 5 m-wide annex, with separate access doors and
clear lower and upper stair landings.

## Stairs and policy capability

The stairs have 24 solid box treads, each 11 cm high, 45 cm deep, and 2.2 m wide.
On the stairs, the controller hands the robot to the stairs policy, which reads a
21 × 21 elevation map and body history. Stair mode follows the step path at up to
0.6 m/s with a steady heading and cadence. Descents usually arrive; climbs stop at the
first tall step, where the stairs policy turns away, and the follower reports the route
as blocked. A fall cancels the route and starts a get-up. Reset with R to start over.
Arrival requires reaching both the horizontal target and its actual step height;
fall detection and camera tracking use the stair surface height.
There is no scripted climbing animation, pose correction, or robot teleportation.
See [policy integration](POLICY.md) for the checkpoints, the switching rules, and the sensor/motor contract.

## Algorithm choices

| Algorithm | Useful when |
| --- | --- |
| A* | A reliable baseline for a small known map. Grid routes can be smoothed afterward. |
| Theta* | Short any-angle routes on a grid; used here. It does not guarantee the true continuous shortest path. |
| Jump Point Search | Faster search on suitable uniform-cost grids; retains the grid's path constraints. |
| Navmesh + funnel | Large static walkable spaces where a compact polygon graph is preferable to a dense grid. |
| D* Lite | Reusing search work as an initially unknown or changing map is updated. |
| Hybrid A* / state lattice | Planning with heading, turning-radius, or other motion constraints. |
| RRT* / PRM* | Higher-dimensional configuration spaces, such as whole-body or arm motion. |

There is no universal improvement over A*: the representation, motion model,
clearance, and controller determine which planner is appropriate.

References: [Theta*](https://arxiv.org/abs/1401.3843),
[Jump Point Search](https://www.movingai.com/jps.html),
[Recast/Detour navmeshes](https://github.com/recastnavigation/recastnavigation),
[Nav2 planner guidance](https://docs.nav2.org/rolling/configuration_and_development/first_time_robot_setup_guide/navigation_plugins/setup_navigation_plugins/),
[D* Lite](https://publications.ri.cmu.edu/d-lite),
[sampling-based optimal planning](https://arxiv.org/abs/1105.1186).

## Verification

`npm test` checks routing, clearance, unreachable goals, numerical cell boundaries,
separate stair/lift approaches, 3D stair routes, and slab openings. Floor-only
paths exclude the stairwell; explicit stair segments handle it.
`npm run test:simulation` exercises the
real MuJoCo model and learned policy: same-floor routes through doorways and
around furniture, lift travel in both directions, and holding after arrival.
It also checks reaching the stair entry and completing physical ascent and descent,
including a route from the apartment spawn to the upper landing.
Manual locomotion, collision, pause/reset, and fall checks remain in place.
