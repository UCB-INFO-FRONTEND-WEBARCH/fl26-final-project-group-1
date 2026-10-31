# Click-to-move navigation

Click open floor in the scene or the floor plan to choose a destination.
Use **Ground** and **Upper** to choose a floor, or **Building** to see both levels.
The route is blue; the destination turns green on arrival. **Follow** tracks the
robot and switches floors during elevator travel.

WASD, arrow keys, or the on-screen movement buttons take over immediately.
**Escape** or **Stop navigation** clears the route. Pause preserves it; reset
returns the robot and lift to the ground floor. A gentle velocity controller
holds the destination after arrival; **Clear route** releases this hold.

## Planner

The building has two floors, 3.3 metres apart, joined by physical stairs and an
actuated elevator. Navigation has two levels:

1. Theta* searches a 10 cm occupancy grid on each floor. Walls and the projections
   of the actual furniture collision hulls are inflated by a 42 cm robot radius,
   plus half a cell diagonal. Line-of-sight checks cover every crossed cell and
   reject diagonal corner cutting. Clicked points are not snapped through walls.
   Following allows 12 cm of tracking error within that planning reserve, while
   still checking a conservative 30 cm body footprint against obstacles.
2. A cross-floor route inserts elevator stages: walk to the landing, call and
   wait, board, ride, exit, and walk to the destination. This building has one
   usable inter-floor connector, so choosing it does not require another graph
   search. More connectors would call for a floor/portal graph with travel costs.

Planning runs in the physics worker. The map is built once at startup; rendering
does not run searches. The follower runs at the walking policy's 50 Hz control
rate and sends robot-frame forward, lateral, and yaw velocity commands. It never
sets the robot's position or joint angles. Automatic walking is capped at 0.6 m/s.
Routes stop if the robot leaves its safe corridor or makes no progress.

The elevator has a gravity-compensated slide joint and a separate position servo.
Travel is limited to 0.3 m/s with gradual acceleration. Landing gates close when
the deck is absent, and a cabin rail closes during travel. Manual movement is
interlocked while riding. Canceling a route during travel leaves the lift running
to its landing. Pausing freezes the entire physics simulation.

The deck and rail geometry collide with the robot. The lift body's contact with
the static world is excluded because its slide joint constrains it inside a
modeled shaft; this also prevents the ground plane from pushing up the deck.
Upper-floor slabs have actual stairwell and elevator openings.

## Stairs and policy capability

The stairs have solid risers and collision geometry. The current official G1
checkpoint was deployed for flat-floor walking and has not been validated for
stairs. Automatic navigation therefore excludes the stairwell and uses the lift.
Stair routing requires a stair-capable policy and validation of its step-height,
clearance, and stability limits. There is no scripted stair-climbing animation or
robot teleportation.

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
stairwell exclusion, and slab openings. `npm run test:simulation` exercises the
real MuJoCo model and learned policy: same-floor routes through doorways and
around furniture, lift travel in both directions, and holding after arrival.
It also retains manual locomotion, collision, pause/reset, and fall checks.
