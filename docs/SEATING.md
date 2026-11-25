# Furniture seating

The runtime uses the existing Fluctlight sit and stand policy. There is no pose teleport, joint animation, invisible
seat block, or model scaling. The robot walks to a measured front-edge anchor, aligns, backs up, and runs the policy.

## Catalog match

The shipped sit and stand clips use seat heights of 35.89 and 35.99 cm. Their training contract permits a height
offset of −4 to +1 cm: both clips cover support heights from 31.99 to 36.89 cm.

The selected [ULRIKSBERG armchair, 904.343.10](https://www.ikea.com/gb/en/p/ulriksberg-armchair-rattan-anthracite-90434310/)
has a published 37 cm seat height and a 60 cm seat width. Measurements on the supplied GLB put the front support at
36.7 cm and support under the seated hips near 33.2 cm. Both lie within the contract's range. The model stays at its
original scale; renderer and physics share its ground origin, rotation, and placement.

SOTENÄS was rejected because its seat slopes below the supported range under the hips. GAMLEHULT met the height
requirement and supported sitting, but its stand-up checks fell. It is not enabled. The original taller sofas and
office chairs do not offer F interactions.

`src/seating_layout.js` defines five locations in Hephaestus, including two upstairs, and two in the demo map.
`src/seating_assets.js` stores 32 convex hulls from the catalog mesh. The hulls preserve the leg, arm, and back
geometry. A source SHA-256 check prevents a visual asset from loading with different collision geometry.

## Interaction

The contextual pane offers **F · Sit down** when the robot is within 1.7 m of the seat front, in front of the chair,
on the same floor, and has a clear tracking path to the staging point. Only one nearby seat is selected. F cancels
an approach or stands up from the active chair. Clicks on a chair can request a route from farther away.

Staging is 85 cm in front of the seat, outside the navigation clearance. The pose controller then backs up to the
clip start. Chair footprints remain obstacles; the robot uses real contact to sit and stand. Teleport and reset
clear the active seat. Pause preserves an approach.

The HUD uses an Endfield-inspired layout with a local minimap, compact action icons, figure cards, and a translucent
interaction pane. The landing page and satellite arrival remain unchanged. Hold Alt to free the cursor; releasing
Alt requests capture again. Browsers that reject Pointer Lock retain free-cursor dragging.

## Validation and regeneration

`node scripts/verify_seating.js` checks every location in the selected world: clear staging, approach, seated
contact with the selected chair's actual hulls, stand-up, and walking away without a fall. The full simulation
workflow runs this for both maps, alongside the existing multi-seed walk-up and navigation regressions.

With the furniture preparation dependencies installed, run `python scripts/prepare_seating.py` to regenerate the
colliders from ignored `local_assets/ikea/raw/90434310/model.glb`. Catalog GLBs remain in the external asset library;
they are not added to the repository or Pages artifact.
