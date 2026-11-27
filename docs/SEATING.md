# Furniture seating

The robot walks to a measured seat anchor, turns, backs up, and runs the Fluctlight sit policy. F stands it up.
Sitting does not reset or teleport the robot. Furniture uses colliders generated from the same catalog meshes as
the renderer, with identical runtime scale and placement. No invisible support blocks or joint animation are added.

## Compatible furniture

The shipped sit and stand clips use seat heights of 35.89 and 35.99 cm. Their common training range is
31.99–36.89 cm. The selected furniture supports the seated hips inside that range:

| Furniture | Measured support | Placement |
| --- | --- | --- |
| ULRIKSBERG armchair, 904.343.10 | 36.7 cm at the front, 33.2 cm under the hips | Five locations in Hephaestus, including two upstairs; two in the demo |
| KIVIK sofa, 694.997.04, Gunnared blue | About 35 cm at the anchor and under the hips at 80% uniform scale | Two main-lounge sofas in Hephaestus |

The upholstered KIVIK replaces the bench-like BONDHOLMEN assembly. Its 80% uniform scale keeps its proportions
and lowers the seat into the policy range. ULRIKSBERG chairs keep their original scale. Sofa feet rest on the
source carpet, 28.8 mm above the slab; the policy reference uses that same floor height.
Each source model has 32 convex hulls. Visuals, contacts, and navigation footprints share the scale and placement.
Source SHA-256 checks reject a downloaded model that differs from its prepared colliders.

The six original tall sofas and their side returns remain removed. Their seat height was outside the policy range;
the earlier alignment assist caused a visible position jump. The lounge now has two sofas and two coffee tables.
Removed furniture, books, and cushions are omitted from the render mesh, contacts, navigation, and camera blockers.

## Interaction and policy handoff

The F pane selects one seat within 1.7 m, on the robot's floor, with the robot in front and a clear tracking path
to its staging point. The robot walks to a point 85 cm in front of the seat, then uses the walking policy to align
with the clip start. F cancels an approach or stands up from the active seat. Clicking supported seating can also
request a route from farther away. Pause preserves an approach; teleport and reset clear it.

The stand clip can keep driving forward after the robot is upright. Waiting for its final frame caused falls on
open seating. The controller now transfers to walking after 60% of the clip, once the robot is upright at standing
height, has low vertical speed, and both feet stay on walkable ground for 0.14 s. The walking command starts from
the measured body velocity and brakes through its existing rate limit. Policy weights and motion clips are unchanged.

The HUD uses blue key badges and rounded panels. M expands the bottom-left minimap. Hold Alt to free the cursor;
releasing it requests capture again. Browsers that reject Pointer Lock retain free-cursor dragging.

## Validation and regeneration

`node scripts/verify_seating.js` checks every location in the selected world: walking approach, continuous root
position, contact on the actual furniture, stand-up, two seconds standing without input, and walking over one metre
clear without a fall. Each sofa uses four seeds and a ten-second seated hold. Set
`CENTORIA_MAP=hephaestus SEAT_ID=sofa` to run only the lounge sofas.

`python scripts/prepare_seating.py` regenerates the two catalog collider sets from ignored
`local_assets/ikea/raw/<article>/model.glb`. Models stay in the external asset library.
See [map preparation](HEPHAESTUS.md) for the matching lounge render and navigation update.
