# Hephaestus Tower map

The default playground replaces the temporary apartment with the calibrated V20
Hephaestus scene. Its GLBs, native finish bakes, navigation masks, and collision
data are bundled. Compatible armchairs, the replacement lounge sofas, the Asset library, and the earlier demo use
the external IKEA asset host.

## Source and scale

Source: `output/CHU2_Hephaestus_Tower_main_room_v20.blend` in the owner's
Hephaestus-Tower-Map workspace. SHA-256:
`884a527e1530fcbd9d5fb5b65fd26ab2838131fdf682cf8d7d32bfc4f4856848`.
The 344 MB authoring file is external to this web repository. Export scripts
operate on unsaved copies and check that its hash does not change.

Dimensions stay in metres. The adapter subtracts Blender XYZ
`[-2.8, 13.935, 3.03]` once. The glTF loader restores Y-up exports to the runtime's
Z-up frame once. The room keeps its original scale. The replacement catalog sofas use the explicit uniform scale below.

| Measurement | Source value |
| --- | --- |
| Apartment slab bounding rectangle | 37.68 × 18.06 m; actual footprint is nonrectangular |
| Mezzanine elevation above apartment | 3.60 m |
| Main room ceiling above apartment | 6.60 m |
| Source V20 sofa aisle | approximately 1.50 m before the lounge edit |
| Runtime KIVIK sofas | two upholstered sofas, approximately 1.826 × 0.766 × 0.686 m each at 80% uniform scale |
| Runtime main-lounge LISTERBY tables | two, approximately 1.400 × 0.600 × 0.365 m each |
| Shared carpet | 8.20 × 9.50 m |
| L stair | twenty 0.18 m risers, 0.29 m going, 1.30 m flight width |

The runtime lounge replaces the six tall KIVIK-inspired sofas with two upholstered KIVIK sofas at 80% uniform scale.
Two coffee tables and their loose decorations are removed. Warm finishes, wardrobes, workspaces,
kitchen, and perimeter placements remain from V20. See [seating](SEATING.md) and [third-party notes](../THIRD_PARTY.md).

## Runtime representation

- `lower.glb`, `upper.glb`, `roof.glb`, and `context.glb` separate playable floors,
  roof visibility, and exterior context. Three small plant prototypes reproduce
  330 authored instances with instanced rendering.
- The large scene GLBs use meshopt compression, 16-bit position quantization,
  static role batching, render LODs, and embedded image maps capped at 1024 pixels.
  Native models plus four finish tiles total 40,022,742 bytes (38.17 MiB), excluding external catalog seating.
  The complete lower facade is a separate context band, visible in Building
  view. Plants use 8 m culling batches indoors and shared overview batches in
  Building view. Fast Building view omits interior furniture; Quality restores it.
  No additional mesh simplification is used in this pass.
- Oak albedo/height tiles cover 3.60 × 1.80 m; brick tiles cover 0.96 × 1.20 m.
  Both are baked from the original Blender graphs and use world-space UVs.
  Other unsupported procedural shaders retain authored diffuse finishes.
- Full-height physics remains independent of the Orbit/Top-down wall cutaway.
  Camera blockers come from source collision bodies. Actual floor triangles
  preserve slab boundaries and the open mezzanine void.
- Render depth is ordered at floor and wall seams: base slabs sit behind architectural finishes and trim.
  Authored opaque construction culls internal back faces; glass, cutouts, lamps, foliage, and imported furniture
  retain their authored sides. This changes raster depth only, not mesh placement, textures, or collision geometry.
  Wide cameras move their near plane out with view distance to resolve thin layers. Shoulder view retains its
  5 cm near plane for close camera clearance.
- 4,002 native convex collision bodies remain after the lounge edit. The original optimization reduced 16,283 bodies
  to 4,216 by omitting tiny
  contact hardware and nonstructural finish details with solid substrates.
  Furniture uses connected-component CoACD at a 15 mm target. One failed ALEX
  template uses recorded conservative convex component hulls. Glazing retains
  source-object barrier envelopes. These are fixed contact approximations.
  Runtime geoms are grouped into fixed 4 m spatial bodies for faster head-camera ray rejection. Replacement seating
  adds its own source-mesh colliders. Removed furniture has no residual contact, navigation or camera blockers.
- Theta* receives floor polygons eroded by 0.52 m planning / 0.30 m tracking radii
  plus half a 10 cm cell diagonal, minus inflated obstacles. Render geometry,
  physics, and navigation share one source transform.

## Scope and limits

The roof apartment and mezzanine are playable. The complete tower facade and
remaining roof complex are visual context; other storeys and lobby are not
navigable. **Building** frames that exterior. The prior aerial arrival location
is unchanged and remains a separate visual introduction, not a claim that the
Hephaestus interior reproduces Building K in Santa Clara.

Furniture and source doors are fixed and closed in the website. The PAX 0–90°
controls remain in the Blender source; web articulation is not implemented.
The original L stair geometry is preserved. Route planning works both ways,
but physical completion with the trained walking policy remains experimental.
This is not a structural engineering model or a photoreal Cycles render.

## Rebuilding exports

Normal development uses the checked-in assets; no Blender or Python is required.
The offline scripts are in `scripts/hephaestus/`. To rebuild, provide the original
workspace (including its `assets/runtime/room/prototypes/t10.glb`–`t12.glb`) and
Blender 5.2.2. Python preparation used NumPy 2.x, SciPy, Shapely 2.x, trimesh,
CoACD 1.0.14, Pillow, fast-simplification 0.2.0, and networkx 3.7.
Set `HEPHAESTUS_WORKSPACE` to that workspace's absolute path. Intermediate geometry
and collision caches are written under its `output/web_integration_v21/`.

From this repository:

```bash
export HEPHAESTUS_WORKSPACE=/path/to/Hephaestus-Tower-Map
blender --background --python scripts/hephaestus/inspect_web_map_v21.py
blender --background --python scripts/hephaestus/export_centoria_map_v21.py
blender --background --python scripts/hephaestus/export_centoria_context_v21.py
blender --background --python scripts/hephaestus/inspect_centoria_plants_v21.py
blender --background --python scripts/hephaestus/bake_centoria_finishes_v21.py
python scripts/hephaestus/prepare_centoria_map_v21.py
```

Run `compact_centoria_glb_v21.py INPUT OUTPUT` on each raw lower/upper/context GLB,
then `python scripts/hephaestus/split_context_glb.py COMPACTED_CONTEXT CONTEXT_BANDS`
on the compacted context only. Run gltfpack 1.3.0 on the compacted lower/upper
and split context with `-cc -ke -kn -vp 16`, writing the
final files into `public/assets/hephaestus/`. Compress the raw roof GLB with the
same gltfpack settings as well, then run
`python scripts/hephaestus/finalize_centoria_map_v21.py` to update the source-derived
masks, physics module, plant prototypes, and checksummed manifest together.
Compaction promotes converted WebP textures to standard JPEG/PNG bindings and
repairs named UV references to the retained UV layer. It preserves valid textures.

For the runtime lounge edit, use the unedited lower GLB as input. The version before the edit is available at
`2a17559`. The checked-in region list removes complete furniture and decoration components from the joined mesh;
it excludes the carpet and floor. It also filters their collision bodies, then rebuilds navigation and camera data:

```bash
git show 2a17559:public/assets/hephaestus/lower.glb > local_assets/hephaestus/lower-v20.glb
node scripts/hephaestus/declutter_lounge.js local_assets/hephaestus/lower-v20.glb
python scripts/hephaestus/update_lounge_navigation.py
python scripts/prepare_seating.py
```

The navigation rebuild needs NumPy and Shapely; render filtering uses the existing Three.js and meshoptimizer
packages. The edited lower GLB has zero Khronos validator errors (11 warnings, versus 13 in the original).

## Validation

`npm test` runs shared/demo and Hephaestus asset/layout/navigation checks, including route rendering, material
restoration, camera handoff, and the grounded stand-to-walk transfer.
`npm run test:simulation` first checks unchanged upstream controller parity,
then the original full demo regressions (including lift and physical straight
stairs), then the new-map real MuJoCo/ONNX checks. The latter probe carpet,
table, glazing, upper slab, and mezzanine void, and exercise idle balance,
manual aisle locomotion, automatic aisle arrival, pause, and reset.
It also compares the elevation maps of the grouped and flat physics models at sixteen
poses, including one at the foot of the stairs. See [performance measurements](PERFORMANCE.md) for reproduction and limits.

All seven exported GLBs passed Khronos glTF Validator with zero errors. Normal
maps without authored tangents retain generated-tangent warnings. Browser QA
covers Shoulder, apartment cutaway, Mezzanine, and full Building views. These
checks do not establish completion of the new L stair.
