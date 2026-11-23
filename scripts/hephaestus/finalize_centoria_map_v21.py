import os
"""Prepare bounded collision detail, nav masks and checksummed public assets."""
from pathlib import Path
import json,hashlib,math,collections,shutil
import numpy as np
from shapely.geometry import Polygon,MultiPoint
from shapely.ops import unary_union
from scipy.spatial import ConvexHull
R=Path(os.environ['HEPHAESTUS_WORKSPACE']).resolve();Q=R/'output/web_integration_v21';Q.mkdir(parents=True,exist_ok=True);REPO=Path(__file__).resolve().parents[2];A=REPO/'public/assets/hephaestus';M=json.loads((Q/'map_data.json').read_text())
old=M['physics'];kept=[];glass=collections.defaultdict(list);removed=collections.Counter()
for p in old:
 v=np.array(p['vertices']);d=np.sort(np.ptp(v,axis=0));role=p['role']
 if role=='glass':glass[p['source']].extend(v.tolist());continue
 if role not in ['floor','stairs','roof'] and (d[0]<.004 or d[1]<.015 or d[2]<.12):removed['Sub-contact-scale hardware']+=1;continue
 if role=='architecture' and p['source'].startswith(('V13 /','P7 / Continuous interstorey facade rim','V14 /')):
  removed['Nonstructural finish detail; substrate retained']+=1;continue
 kept.append(p)
for name,pp in glass.items():
 v=np.array(pp)
 try:v=v[ConvexHull(v).vertices]
 except:continue
 # Glazing/frame source objects are planar facade barriers; keep their full
 # footprint with one hull, rather than bevel/screw collision micro-parts.
 kept.append(dict(name='',source=name,role='glass',vertices=np.round(v,6).tolist()))
for i,p in enumerate(kept):p['name']='map_collision_'+str(i).zfill(4)
M['physics']=kept;nav=[[],[]];camera=[]
for p in kept:
 if p['role'] in ['floor','stairs','roof'] or 'Shared carpet' in p['source']:continue
 v=np.array(p['vertices']);lo=v.min(0);hi=v.max(0)
 for floor in [0,1]:
  if hi[2]<floor*3.6+.03 or lo[2]>floor*3.6+1.45:continue
  poly=MultiPoint(v[:,:2]).convex_hull
  if poly.geom_type!='Polygon' or poly.area<.0001:continue
  nav[floor].append(poly);camera.append(dict(center=np.round((lo+hi)/2,5).tolist(),size=np.round(hi-lo,5).tolist(),floor=floor))
def polys(g):
 if g.is_empty:return []
 if g.geom_type=='Polygon':return [g]
 return [p for child in g.geoms for p in polys(child)]
def areas(g):return [[list(p.exterior.coords),*[list(i.coords) for i in p.interiors]] for p in polys(g)]
floors=[unary_union([Polygon(t) for t in ts]) for ts in M['floor_triangles']]
# Source footsteps are already documented with an exact L-shaped centerline.
# Place the upper route endpoint beyond the robot's obstacle inflation margin.
M['stair_path'][-1]=[-13.2,7.944-13.935,3.6]
M['stair_path']=[[round(c,6) for c in p] for p in M['stair_path']]
stair_polys=[Polygon([[l,b],[r,b],[r,t],[l,t]]) for l,r,b,t in M['stair_regions']]
unions=[unary_union(pp).buffer(0) for pp in nav]
M['obstacle_areas']=[areas(g.simplify(.008,preserve_topology=True)) for g in unions]
M['navigation_polygons']=[[] , []] # free masks below include the inflated bodies.
M['floor_areas']=[]
for floor,g in enumerate(floors):
 obstacles=unary_union([unions[floor],*stair_polys]);row={}
 for key,radius in [('planning',.52),('tracking',.30)]:
  margin=radius+.1/math.sqrt(2);free=g.buffer(-margin).difference(obstacles.buffer(margin)).simplify(.003,preserve_topology=True);row[key]=areas(free)
 M['floor_areas'].append(row)
M['camera_boxes']=camera
M['context_bounds']=json.loads((Q/'context_export.json').read_text())['bounds']
M['plants']=json.loads((Q/'plant_instances.json').read_text())
for k in {p['key'] for p in M['plants']}:shutil.copy2(R/'assets/runtime/room/prototypes'/(k+'.glb'),A/(k+'.glb'))
M['files']=[dict(file=p.name,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(A.iterdir()) if p.suffix in ['.glb','.png']]
M['limits'][0]='Playable roof apartment and mezzanine. Full tower facade and roof complex are visual context; lobby and other storeys are not navigable in this migration.'
M['collision_detail']=dict(original_bodies=len(old),runtime_bodies=len(kept),omitted=dict(removed),furniture_method='15mm CoACD target with connected components; hardware below contact scale omitted. Glazing uses one convex source-object envelope.',fallbacks=[p.name for p in (Q/'collision_cache').glob('*.fallback.json')])
M['render_detail']=dict(context_bands='Roof context always available; lower tower facade shown in Building view',triangle_partition='Source attributes preserved; no additional simplification',plants='330 authored placements in 8m culling cells; shared overview batches in Building view')
(Q/'optimized_map_data.json').write_text(json.dumps(M,separators=(',',':'),ensure_ascii=False))
physics=M.pop('physics');(REPO/'src/hephaestus_physics.js').write_text('// Generated offline; kept out of the UI bundle by tree shaking. World-space metres, Z up.\nexport const HEPHAESTUS_PHYSICS = '+json.dumps(physics,separators=(',',':'),ensure_ascii=False)+';\n')
(REPO/'src/hephaestus_data.js').write_text('// Generated from V20 Blender geometry. Metres, Z up; origin normalized exactly once.\nexport const HEPHAESTUS_MAP = '+json.dumps(M,separators=(',',':'),ensure_ascii=False)+';\n')
manifest={k:M[k] for k in ['id','name','source','source_sha256','origin','units','context_bounds','files','limits','collision_detail','render_detail']};(A/'manifest.json').write_text(json.dumps(manifest,indent=2));(Q/'optimization.json').write_text(json.dumps(dict(physics_before=len(old),physics_after=len(kept),asset_bytes=sum(f['bytes'] for f in M['files']),material_image_limit_px=1024,mesh_position_quantization_bits=16,mesh_compression='EXT_meshopt_compression',omitted=dict(removed)),indent=2));print('V21_FINALIZED',len(old),'->',len(kept),'bodies',sum(f['bytes'] for f in M['files']),'bytes',len(M['plants']),'plants',flush=True)
