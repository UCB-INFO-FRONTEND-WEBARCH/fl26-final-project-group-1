import os
"""Derive fixed MuJoCo convex bodies and per-floor navigation from V20 meshes."""
import os
os.environ.setdefault('OMP_NUM_THREADS','2')
from pathlib import Path
import json,math,hashlib,concurrent.futures,subprocess,sys
import numpy as np,trimesh,coacd
from shapely.geometry import Polygon,MultiPoint,mapping,box
from shapely.ops import unary_union
from scipy.spatial import ConvexHull
R=Path(os.environ['HEPHAESTUS_WORKSPACE']).resolve();Q=R/'output/web_integration_v21';Q.mkdir(parents=True,exist_ok=True);REPO=Path(__file__).resolve().parents[2];CACHE=Q/'collision_cache';CACHE.mkdir(exist_ok=True)
coacd.set_log_level('error')
def decomposition(args):
 key,vertices,faces=args;file=CACHE/(key+'.json')
 if file.exists():return key,json.loads(file.read_text())
 v=np.array(vertices,dtype=float);f=np.array(faces,dtype=int);mesh=trimesh.Trimesh(v,f,process=True)
 # Collapse connected convex parts independently, preserving table/desk gaps.
 print('BEGIN_TEMPLATE',key,flush=True)
 parts=mesh.split(only_watertight=False);parts=[p for p in parts if len(p.faces)>=4 and np.ptp(p.vertices,axis=0).min()>1e-5]
 result=[]
 for part in parts:
  if part.is_convex:
   points=part.convex_hull.vertices
   if len(points)<=64:result.append(np.round(points,6).tolist());continue
  if len(part.faces)>10000:part=part.simplify_quadric_decimation(face_count=10000)
  hulls=coacd.run_coacd(coacd.Mesh(np.asarray(part.vertices),np.asarray(part.faces)),threshold=.015,real_metric=True,max_convex_hull=20,preprocess_resolution=50,resolution=1500,mcts_nodes=8,mcts_iterations=30,seed=0,decimate=True,max_ch_vertex=48)
  result.extend(np.round(points,6).tolist() for points,faces in hulls)
 if not result:
  try:result=[np.round(mesh.convex_hull.vertices,6).tolist()]
  except:return key,[]
 file.write_text(json.dumps(result,separators=(',',':')));print('V21_COLLIDER_TEMPLATE',key,len(result),flush=True);return key,result

def main():
 D=json.loads((Q/'export_geometry.json').read_text());geos=D['geometry'];objects=D['objects'];hulls=[];floors=[[],[]];boxes=[];nav=[[],[]];physics=[];furniture=[]
 # A decorative lamp lens or cushion must not run convex decomposition. The
 # rigid sofa/cabinet/table underneath already defines its obstacle volume.
 keys={'kivik','morabo','poang','listerby','lack','billy','pax','mittzon','markus','alex','sektion','ekbacken','marius'}
 tasks={o['mesh'] for o in objects if o['role']=='furniture' and o['product'] in keys}
 def isolated(k):
  file=CACHE/(k+'.json')
  if not file.exists():
   result=subprocess.run([sys.executable,__file__,'--template',k],timeout=180)
   if result.returncode:
    # A conservative per-connected-component fallback is recorded explicitly;
    # it never removes a visible solid or converts the whole room to one hull.
    mesh=trimesh.Trimesh(geos[k]['vertices'],geos[k]['faces'],process=True);parts=[]
    for p in mesh.split(only_watertight=False):
     try:
      points=p.convex_hull.vertices
      if np.min(np.ptp(points,axis=0))>1e-5:parts.append(np.round(points,6).tolist())
     except:pass
    file.write_text(json.dumps(parts));(CACHE/(k+'.fallback.json')).write_text(json.dumps(dict(reason='CoACD native process failed',method='Conservative convex hull per connected component')))
  return k,json.loads(file.read_text())
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:decomp=dict(pool.map(isolated,sorted(tasks)))
 for o in objects:
  role=o['role'];v=np.array(geos[o['mesh']]['vertices']);f=np.array(geos[o['mesh']]['faces']);m=np.array(o['matrix']);world=(np.c_[v,np.ones(len(v))]@m.T)[:,:3];lo=world.min(0);hi=world.max(0);parts=[]
  if role=='floor':
   z=float(hi[2]);thickness=float(hi[2]-lo[2]);level=o['floor']
   for tri in world[f]:
    if np.max(abs(tri[:,2]-z))>1e-4:continue
    poly=Polygon(tri[:,:2])
    if poly.area<1e-8:continue
    floors[level].append(poly)
    parts.append(np.vstack([tri,tri-[0,0,thickness]]))
  elif role=='stairs':
   # Horizontal treads/landings are exact triangle prisms; sloped underside
   # bulk is intentionally omitted from robot contacts, retaining tread tops.
   for tri in world[f]:
    z=float(tri[0,2]);normal=np.cross(tri[1]-tri[0],tri[2]-tri[0])
    if normal[2]<1e-9 or np.ptp(tri[:,2])>1e-4:continue
    thickness=.18 if o['name'].startswith('P6 / Stair') else hi[2]-lo[2]
    parts.append(np.vstack([tri,tri-[0,0,thickness]]))
  elif role=='furniture' and o['product']=='vollerslev':
   parts=[trimesh.creation.box(bounds=np.array([lo,hi])).vertices]
  elif role=='furniture' and o['mesh'] in decomp:
   for pp in decomp[o['mesh']]:
    p=np.array(pp);parts.append((np.c_[p,np.ones(len(p))]@m.T)[:,:3])
  elif role in ['architecture','glass','roof']:
   if np.min(hi-lo)<.003:continue
   mesh=trimesh.Trimesh(world,f,process=True)
   # Extruded native architecture has parallel horizontal caps. Partition its
   # caps into convex prisms so door openings and floor wells stay empty.
   cap=[tri for tri in world[f] if np.max(abs(tri[:,2]-hi[2]))<1e-4 and Polygon(tri[:,:2]).area>1e-8]
   is_prism=all(min(abs(z-lo[2]),abs(z-hi[2]))<1e-4 for z in world[:,2])
   if is_prism and cap:
    if mesh.is_convex:parts=[mesh.convex_hull.vertices]
    else:parts=[np.vstack([tri,tri-[0,0,hi[2]-lo[2]]]) for tri in cap]
   else:
    # Round rails and bevelled trims are small closed source components. A
    # convex component approximation retains their local envelopes.
    for part in mesh.split(only_watertight=False):
     if len(part.vertices)<4:continue
     try:parts.append(part.convex_hull.vertices)
     except:pass
  for part in parts:
   if len(part)<4 or np.min(np.ptp(part,axis=0))<1e-5:continue
   try:part=part[ConvexHull(part).vertices]
   except:continue
   record=dict(name='map_collision_'+str(len(physics)).zfill(4),source=o['name'],vertices=np.round(part,6).tolist(),role=role)
   physics.append(record)
   if role not in ['floor','stairs','roof'] and o['product']!='vollerslev':
    for floor in [0,1]:
     # All obstacles intersecting the walking body height, including walls,
     # glass and guard infills, reserve the same projected collision hull.
     if part[:,2].max()<floor*3.6+.03 or part[:,2].min()>floor*3.6+1.45:continue
     poly=MultiPoint(part[:,:2]).convex_hull
     if poly.geom_type=='Polygon' and poly.area>.0001:nav[floor].append(poly)
     b0=part.min(0);b1=part.max(0);boxes.append(dict(center=((b0+b1)/2).tolist(),size=(b1-b0).tolist(),floor=floor))
 print('V21_PHYSICS_BODIES',len(physics),flush=True)
 floor_unions=[unary_union(pp).buffer(0) for pp in floors]
 polygons=lambda g:[g] if g.geom_type=='Polygon' else list(g.geoms)
 floor_polygons=[[list(p.exterior.coords) for p in polygons(g)] for g in floor_unions]
 floor_holes=[[list(i.coords) for p in polygons(g) for i in p.interiors] for g in floor_unions]
 floor_areas=[]
 for g in floor_unions:
  area={}
  for k,margin in [('planning',.52+.1/math.sqrt(2)),('tracking',.3+.1/math.sqrt(2))]:
   area[k]=[[list(p.exterior.coords),*[list(i.coords) for i in p.interiors]] for p in polygons(g.buffer(-margin)) if p.geom_type=='Polygon']
  floor_areas.append(area)
 # Convex free-floor triangles include the true disconnected edges and voids.
 floor_triangles=[[[list(v) for v in p.exterior.coords][:3] for p in pp] for pp in floors]
 O=np.array(D['offset_blender_xyz']);P=lambda p:(np.array(p)-O).tolist()
 stair_path=[P([-11.63,11.85,3.03])]
 for i in range(9):stair_path.append(P([-11.63,11.204-(i+.5)*.29,3.03+(i+1)*.18]))
 stair_path.append(P([-11.63,7.944,4.83]))
 for i in range(9):stair_path.append(P([-12.28-(i+.5)*.29,7.944,4.83+(i+1)*.18]))
 stair_path.append(P([-15.65,7.944,6.63]))
 stair_regions=[[-12.28-O[0],-10.98-O[0],8.594-O[1],11.204-O[1]],[-12.28-O[0],-10.98-O[0],7.294-O[1],8.594-O[1]],[-14.89-O[0],-12.28-O[0],7.294-O[1],8.594-O[1]]]
 # Recover direct stair click heights from the exact horizontal faces.
 step_polygons=[]
 for p in physics:
  if p['role']!='stairs':continue
  vv=np.array(p['vertices']);z=vv[:,2].max();poly=MultiPoint(vv[:,:2]).convex_hull
  step_polygons.append(dict(polygon=list(poly.exterior.coords),height=float(z),center=[*list(poly.centroid.coords)[0],float(z)]))
 bounds=list(floor_unions[0].bounds);bounds=[bounds[0],bounds[2],bounds[1],bounds[3]]
 for o in objects:
  if o['role']=='furniture' and o['product'] in keys:
   furniture.append(dict(name=o['name'],product=o['product'],floor=o['floor'],bounds=o['bounds']))
 data=dict(id='hephaestus-v20',name='Hephaestus Tower',source=D['source'],source_sha256=D['source_sha256'],origin=D['offset_blender_xyz'],units='metres',floor_height=3.6,floor_names=['Apartment','Mezzanine'],bounds=bounds,spawn=[2.7,0,.7593],spawn_yaw=math.pi,
 files=D['files'],plants=D['plants'],physics=physics,camera_boxes=boxes,furniture=furniture,floor_areas=floor_areas,floor_polygons=floor_polygons,floor_holes=floor_holes,floor_triangles=floor_triangles,navigation_polygons=[[list(p.exterior.coords) for p in pp] for pp in nav],stair_path=stair_path,stair_regions=stair_regions,steps=step_polygons,elevator=False,
 rooms=[dict(name=name,position=[x-O[0],y-O[1]],number=str(i+1).zfill(2)) for i,(name,x,y) in enumerate([('MAIN LOUNGE',-2.8,13.935),('READING NOOK',7.2,9.6),('WEST WORK ROOM',-19.8,19),('KITCHENETTE',-23,13.4)])],
 limits=['Playable roof apartment and mezzanine. Full tower exterior and roof complex are visual context; navigation outside the apartment is not included.','Render-only LOD and portable PBR approximations; source Blender file unchanged.','Fixed furniture, closed source doors. PAX controls remain in Blender; web furniture articulation is not added.','Original 180 mm risers are preserved. Learned-policy stair travel remains experimental.'])
 (Q/'map_data.json').write_text(json.dumps(data,separators=(',',':'),ensure_ascii=False));(REPO/'src/hephaestus_data.js').write_text('// Generated from V20 Blender geometry by prepare_centoria_map_v21.py. Metres, Z up.\nexport const HEPHAESTUS_MAP = '+json.dumps(data,separators=(',',':'),ensure_ascii=False)+';\n')
 (Q/'physics_summary.json').write_text(json.dumps(dict(geometry_templates=len(decomp),collision_bodies=len(physics),source_sha256=D['source_sha256'],navigation_obstacles=[len(p) for p in nav],source_unchanged=True,collider_settings='15 mm target, <=20 CoACD hulls per connected part; exact prisms for native extrusions and floors.'),indent=2));print('V21_MAP_DATA_READY',flush=True)
if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='--template':
  D=json.loads((Q/'export_geometry.json').read_text());k=sys.argv[2];g=D['geometry'][k];decomposition((k,g['vertices'],g['faces']))
 else:main()
