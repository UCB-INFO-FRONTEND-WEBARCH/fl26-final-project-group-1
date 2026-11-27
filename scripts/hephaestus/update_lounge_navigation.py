"""Regenerate camera blockers and both navigation masks from the edited collision bodies."""
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from shapely.geometry import MultiPoint, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
data = json.loads((ROOT / 'local_assets/hephaestus/lounge_input.json').read_text())
world, physics = data['map'], data['physics']
obstacles = [[], []]
camera = []
for body in physics:
  if body['role'] in ['floor', 'stairs', 'roof'] or 'Shared carpet' in body['source']:
    continue
  vertices = np.array(body['vertices'])
  low, high = vertices.min(0), vertices.max(0)
  for floor in [0, 1]:
    if high[2] < floor * 3.6 + .03 or low[2] > floor * 3.6 + 1.45:
      continue
    polygon = MultiPoint(vertices[:, :2]).convex_hull
    if polygon.geom_type != 'Polygon' or polygon.area < .0001:
      continue
    obstacles[floor].append(polygon)
    camera.append(dict(center=np.round((low + high) / 2, 5).tolist(),
                       size=np.round(high - low, 5).tolist(), floor=floor))

def polygons(geometry):
  if geometry.is_empty:
    return []
  if geometry.geom_type == 'Polygon':
    return [geometry]
  return [p for child in geometry.geoms for p in polygons(child)]

def areas(geometry):
  return [[list(p.exterior.coords), *[list(r.coords) for r in p.interiors]] for p in polygons(geometry)]

world['floor_areas'], world['obstacle_areas'] = [], []
stairs = [Polygon([[l,b], [r,b], [r,t], [l,t]]) for l,r,b,t in world['stair_regions']]
for floor in [0, 1]:
  surface = unary_union([Polygon(t) for t in world['floor_triangles'][floor]])
  occupied = unary_union(obstacles[floor]).buffer(0)
  world['obstacle_areas'].append(areas(occupied.simplify(.008, preserve_topology=True)))
  occupied = unary_union([occupied, *stairs])
  world['floor_areas'].append({key: areas(surface.buffer(-radius - .1 / math.sqrt(2))
    .difference(occupied.buffer(radius + .1 / math.sqrt(2))).simplify(.003, preserve_topology=True))
    for key, radius in [('planning', .52), ('tracking', .30)]})
world['camera_boxes'] = camera
assets = ROOT / 'public/assets/hephaestus'
for entry in world['files']:
  path = assets / entry['file']
  entry.update(bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
world['collision_detail']['runtime_bodies'] = len(physics)
world['render_detail']['lounge'] = 'Two sofas and two coffee tables; matching visuals, contacts, navigation and camera blockers.'
(ROOT / 'src/hephaestus_data.js').write_text('// Generated offline. Metres, Z up.\nexport const HEPHAESTUS_MAP = ' + json.dumps(world, separators=(',', ':'), ensure_ascii=False) + ';\n')
(ROOT / 'src/hephaestus_physics.js').write_text('// Generated offline. World-space metres, Z up.\nexport const HEPHAESTUS_PHYSICS = ' + json.dumps(physics, separators=(',', ':'), ensure_ascii=False) + ';\n')
manifest = json.loads((assets / 'manifest.json').read_text())
for key in ['files', 'collision_detail', 'render_detail']:
  manifest[key] = world[key]
manifest['lounge_layout'] = world['lounge_layout']
(assets / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Updated {len(physics)} collision bodies and both navigation maps.')
