import os
"""Read-only V20 -> portable scene and geometry for a Centoria map adapter."""
import bpy,json,hashlib,math,sys,array,time
from pathlib import Path
from mathutils import Vector,Matrix
R=Path(os.environ['HEPHAESTUS_WORKSPACE']).resolve();Q=R/'output/web_integration_v21';Q.mkdir(parents=True,exist_ok=True);Q.mkdir(exist_ok=True);SOURCE=R/'output/CHU2_Hephaestus_Tower_main_room_v20.blend';sha=hashlib.sha256(SOURCE.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(SOURCE));s=bpy.context.scene;bpy.context.view_layer.update()
OFFSET=Vector((-2.8,13.935,3.03));visible=set()
def walk(c,v=True):
 v=v and not c.hide_render
 if v:visible.update(o.name for o in c.objects if not o.hide_render)
 for cc in c.children:walk(cc,v)
walk(s.collection)
def bounds(o):
 p=[o.matrix_world@Vector(v) for v in o.bound_box];return Vector([min(v[i] for v in p) for i in range(3)]),Vector([max(v[i] for v in p) for i in range(3)])
def ancestors(o):
 while o:yield o;o=o.parent
rows=json.loads((Q/'source_inventory.json').read_text())['objects'];names={o['name'] for o in rows};originals=[bpy.data.objects[n] for n in names];deps=bpy.context.evaluated_depsgraph_get();export_collection=bpy.data.collections.new('V21 web export only');s.collection.children.link(export_collection)
# Portable PBR conversion only in this disposable process. Keep supplied image
# maps; unsupported procedural native finishes get their existing diffuse tint.
for mat in bpy.data.materials:
 if not mat.use_nodes:continue
 bs=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
 if not bs:continue
 base=bs.inputs['Base Color']
 if base.is_linked and base.links[0].from_node.type not in {'TEX_IMAGE','HUE_SAT','MIX_RGB','MIX','MAPPING','REROUTE'}:
  for link in list(base.links):mat.node_tree.links.remove(link)
  base.default_value=mat.diffuse_color
 if any(w in mat.name.lower() for w in ['glass','glazing']):
  bs.inputs['Alpha'].default_value=.18;bs.inputs['Roughness'].default_value=.1;bs.inputs['Transmission Weight'].default_value=0
  mat.surface_render_method='DITHERED';mat.use_backface_culling=False
geometry={};objects=[];copies=[];cache={};material_names=set()
for index,o in enumerate(originals):
 # Evaluate bevels and curves, then simplify only high-density render copies.
 ev=o.evaluated_get(deps);mesh=bpy.data.meshes.new_from_object(ev,depsgraph=deps);mesh.calc_loop_triangles()
 root=next((a for a in ancestors(o) if a.get('ikea_product_key')),None);key=root.get('ikea_product_key') if root else None
 count=len(mesh.loop_triangles);budget=2500 if key=='gurli' else 18000 if key in ['kivik','morabo','markus','poang'] else 12000
 ob=bpy.data.objects.new(o.name,mesh);export_collection.objects.link(ob);ob.matrix_world=Matrix.Translation(-OFFSET)@o.matrix_world
 if count>budget*1.4:
  mod=ob.modifiers.new('Web-only LOD','DECIMATE');mod.ratio=budget/count
  bpy.context.view_layer.objects.active=ob;ob.select_set(True);bpy.ops.object.modifier_apply(modifier=mod.name);ob.select_set(False)
 mesh=ob.data;mesh.calc_loop_triangles();vv=[list(v.co) for v in mesh.vertices];ff=[list(t.vertices) for t in mesh.loop_triangles]
 h=hashlib.sha256();a=array.array('f',[c for v in vv for c in v]);h.update(a.tobytes());h.update(array.array('I',[i for t in ff for i in t]).tobytes());ident='mesh_'+h.hexdigest()[:16]
 # glTF shares matching render meshes where material assignments also match.
 matkey=tuple(m.name if m else '' for m in mesh.materials);gkey=(ident,matkey)
 if gkey in cache:
  previous_mesh=mesh;ob.data=cache[gkey]
  if previous_mesh.users==0:bpy.data.meshes.remove(previous_mesh)
 else:cache[gkey]=mesh
 if ident not in geometry:geometry[ident]=dict(vertices=vv,faces=ff)
 lo,hi=bounds(o);lo-=OFFSET;hi-=OFFSET
 floor=1 if lo.z>=3.35 else 0
 role='furniture' if root else 'architecture'
 if o.name.startswith('P7 / Apartment first floor'):role='floor';floor=0
 if o.name.startswith('P7 / Mezzanine and upper west floor'):role='floor';floor=1
 if o.name.startswith(('P6 / Stair lower','P6 / Stair upper','P7 / Main stair')):role='stairs'
 if o.name.startswith(('P7 / Apartment roof','V13 / Roof edge fascia Apartment roof')):role='roof'
 if 'glass' in o.name.lower() or 'glazing' in o.name.lower():role='glass' if not root else role
 # No source mesh is stretched. All physics geometry uses this same matrix.
 row=dict(name=o.name,node=ob.name,mesh=ident,matrix=[list(v) for v in ob.matrix_world],bounds=[list(lo),list(hi)],role=role,floor=floor,product=key,root=root.name if root else None)
 objects.append(row);ob['map_role']=role;ob['map_floor']=floor;ob['source_name']=o.name
 copies.append(ob)
 if index%150==0:print('V21_WEB_MESH',index,len(originals),flush=True)
# Export one mesh file per layer; renderer controls cutaways without modifying
# the authoring scene. Original authoring file is never saved from this process.
files=[]
for layer,predicate in [('lower',lambda r:r['floor']==0 and r['role']!='roof'),('upper',lambda r:r['floor']==1 and r['role']!='roof'),('roof',lambda r:r['role']=='roof')]:
 chosen=[]
 for role in ['architecture','furniture','floor','stairs','glass','roof']:
  group=[ob for ob,row in zip(copies,objects) if predicate(row) and row['role']==role]
  if not group:continue
  bpy.ops.object.select_all(action='DESELECT')
  for ob in group:ob.select_set(True)
  bpy.context.view_layer.objects.active=group[0]
  if len(group)>1:bpy.ops.object.join()
  ob=bpy.context.view_layer.objects.active;ob.name='HEPHAESTUS_'+layer+'_'+role;ob['map_role']=role;ob['map_floor']=1 if layer=='upper' else 0
  # Consolidate duplicate slots after joining, preserving source materials.
  unique=[];indices=[]
  for mat in ob.data.materials:
   if mat not in unique:unique.append(mat)
   indices.append(unique.index(mat))
  values=[indices[p.material_index] for p in ob.data.polygons];ob.data.materials.clear()
  for mat in unique:ob.data.materials.append(mat)
  for p,idx in zip(ob.data.polygons,values):p.material_index=idx
  chosen.append(ob)
 bpy.ops.object.select_all(action='DESELECT')
 for ob in chosen:ob.select_set(True)
 path=Q/(layer+'.glb');print('V21_EXPORT_LAYER',layer,len(chosen),flush=True)
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_apply=False,export_yup=True,export_extras=True,export_materials='EXPORT',export_cameras=False,export_lights=False,export_image_format='AUTO')
 files.append(dict(layer=layer,file=path.name,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
# Plant instances remain procedural in Blender; the web adapter reuses the
# established lightweight exports of those very same plant families.
plants=[]
for o in s.objects:
 if o.name not in visible or not o.get('asset_instance') or o.get('asset_id') not in ['t10','t11','t12']:continue
 p=o.matrix_world.translation
 if 2.5<p.z<10 and -28<p.x<13 and 3<p.y<24:plants.append(dict(key=o.get('asset_key',o.get('asset_id')),matrix=[list(v) for v in Matrix.Translation(-OFFSET)@o.matrix_world]))
manifest=dict(source=str(SOURCE.relative_to(R)),source_sha256=sha,offset_blender_xyz=list(OFFSET),units='metres',render_coordinates='glTF Y-up; adapter restores Z-up once',physics_coordinates='Z-up, translated by offset_blender_xyz',files=files,objects=objects,plants=plants,geometry=geometry)
(Q/'export_geometry.json').write_text(json.dumps(manifest,separators=(',',':'),ensure_ascii=False));assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==sha
print('V21_WEB_EXPORT_DONE',len(objects),len(geometry),len(plants),'plants',flush=True)
