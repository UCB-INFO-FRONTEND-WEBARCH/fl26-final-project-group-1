# Furniture seating

The runtime uses the existing Fluctlight sit and stand policy on real furniture colliders. Armchairs use a walking
approach. The six main-lounge KIVIK sofas use a short standing-pose alignment before the same policy takes over.
Models retain their original scale. No joint animation or invisible support block is added.

## Catalog match

The shipped sit and stand clips use seat heights of 35.89 and 35.99 cm. Their training contract permits a height
offset of −4 to +1 cm: both clips cover support heights from 31.99 to 36.89 cm.

The selected [ULRIKSBERG armchair, 904.343.10](https://www.ikea.com/gb/en/p/ulriksberg-armchair-rattan-anthracite-90434310/)
has a published 37 cm seat height and a 60 cm seat width. Measurements on the supplied GLB put the front support at
36.7 cm and support under the seated hips near 33.2 cm. Both lie within the contract's range. The model stays at its
original scale; renderer and physics share its ground origin, rotation, and placement.

SOTENÄS was rejected because its seat slopes below the supported range under the hips. GAMLEHULT met the height
requirement and supported sitting, but its stand-up checks fell. It is not enabled.

`src/seating_layout.js` defines five armchair locations in Hephaestus, including two upstairs, and two in the demo map.
`src/seating_assets.js` stores 32 convex hulls from the catalog mesh. The hulls preserve the leg, arm, and back
geometry. A source SHA-256 check prevents a visual asset from loading with different collision geometry.

Hephaestus also offers one sitting anchor on each of its six existing blue KIVIK sofas. Their measured support height
is about 48.5 cm, outside the clips' training range. Walking approaches stalled at the sofa fronts. These interactions
therefore align the robot to a standing pose 20 cm in front of the seat, with a maximum displacement of 70 cm, then
run the unchanged sit policy. This is a game interaction assist, not evidence of an autonomous sofa approach.
The native sofa collision meshes are reused without adding duplicate hulls. Other sofas and office chairs are not enabled.

## Interaction

The contextual pane offers **F · Sit down** when the robot is within 1.7 m of the seat front, in front of the chair,
on the same floor, and has a clear tracking path to the staging point. Only one nearby seat is selected. F cancels
an approach or stands up from the active seat. Sofa prompts use a shorter 80 cm reach and 45 cm lateral limit.
Clicks on supported armchairs can request a route from farther away.

Staging is 85 cm in front of the seat, outside the navigation clearance. The pose controller then backs up to the
clip start. Chair footprints remain obstacles; the robot uses real contact to sit and stand. Teleport and reset
clear the active seat. Pause preserves an approach. Sofa routes use the tighter tracking clearance to reach a staging
point 50 cm in front of the seat. Alignment is limited to the selected floor and preserves simulation time, elevator
state, pause state, and fall/get-up history.

The HUD uses game-style key badges, prompts, and placement with Centoria's blue accents and rounded panels.
The minimap sits at the bottom left; M expands it. Figure cards sit at the bottom right. Hold Alt to free the cursor; releasing
Alt requests capture again. Browsers that reject Pointer Lock retain free-cursor dragging.

## Validation and regeneration

`node scripts/verify_seating.js` checks every location in the selected world: clear staging, approach or assisted
alignment, seated contact with the selected furniture's actual hulls, stand-up, and walking away without a new fall.
Each sofa is checked with two random seeds and a four-second seated hold. Checks also verify that robot-only placement
preserves the world and recovery history. Set `CENTORIA_MAP=hephaestus SEAT_ID=sofa` to run only the six native sofas.
The full simulation workflow runs both maps, alongside the existing multi-seed walk-up and navigation regressions.

With the furniture preparation dependencies installed, run `python scripts/prepare_seating.py` to regenerate the
colliders from ignored `local_assets/ikea/raw/90434310/model.glb`. Catalog GLBs remain in the external asset library;
they are not added to the repository or Pages artifact.
