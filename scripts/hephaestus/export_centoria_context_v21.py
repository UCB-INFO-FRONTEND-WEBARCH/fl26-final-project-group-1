import os
import bpy,json,hashlib
from pathlib import Path
from mathutils import Matrix,Vector
R=Path(os.environ['HEPHAESTUS_WORKSPACE']).resolve();Q=R/'output/web_integration_v21';Q.mkdir(parents=True,exist_ok=True);source=R/'output/CHU2_Hephaestus_Tower_main_room_v20.blend';sha=hashlib.sha256(source.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(source));s=bpy.context.scene;bpy.context.view_layer.update();known={r['name'] for r in json.loads((Q/'source_inventory.json').read_text())['objects']};visible=set()
def walk(c,v=True):
 v=v and not c.hide_render
 if v:visible.update(o.name for o in c.objects if not o.hide_render)
 for cc in c.children:walk(cc,v)
walk(s.collection);dest=bpy.data.collections.new('V21 context export');s.collection.children.link(dest);copies=[];deps=bpy.context.evaluated_depsgraph_get()
for o in list(s.objects):
 if o.name not in visible or o.name in known or o.type not in ['MESH','CURVE']:continue
 p=[o.matrix_world@Vector(v) for v in o.bound_box];lo=min(v.z for v in p);hi=max(v.z for v in p)
 tower=(o.get('area')=='tower_context' and o.get('structural_role')=='context') or any(c.name.startswith(('53 ·','54 ·')) for c in o.users_collection)
 if not(tower or hi>.05 and lo>-2 and not any(c.name.startswith('01') for c in o.users_collection)):continue
 if o.get('foliage_source') or any(m.type=='NODES' for m in o.modifiers):continue
 mesh=bpy.data.meshes.new_from_object(o.evaluated_get(deps),depsgraph=deps);cp=bpy.data.objects.new('Context / '+o.name,mesh);dest.objects.link(cp);cp.matrix_world=Matrix.Translation((2.8,-13.935,-3.03))@o.matrix_world;copies.append(cp)
# Procedural native materials become their already-authored diffuse finish.
for mat in {m for o in copies for m in o.data.materials if m}:
 if not mat.use_nodes:continue
 bs=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
 if not bs:continue
 base=bs.inputs['Base Color']
 if base.is_linked and base.links[0].from_node.type!='TEX_IMAGE':
  for l in list(base.links):mat.node_tree.links.remove(l)
  base.default_value=mat.diffuse_color
 if any(w in mat.name.lower() for w in ['glass','glazing']):bs.inputs['Alpha'].default_value=.13;bs.inputs['Transmission Weight'].default_value=0;mat.surface_render_method='DITHERED'
bpy.ops.object.select_all(action='DESELECT')
for o in copies:o.select_set(True)
bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();o=bpy.context.object;o.name='HEPHAESTUS_exterior_context';o['map_role']='context'
unique=[];indices=[]
for m in o.data.materials:
 if m not in unique:unique.append(m)
 indices.append(unique.index(m))
values=[indices[p.material_index] for p in o.data.polygons];o.data.materials.clear()
for m in unique:o.data.materials.append(m)
for p,i in zip(o.data.polygons,values):p.material_index=i
bpy.ops.export_scene.gltf(filepath=str(Q/'context.glb'),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_cameras=False,export_lights=False)
bpy.context.view_layer.update();points=[o.matrix_world@Vector(v) for v in o.bound_box];context_bounds=[[min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)]]
(Q/'context_export.json').write_text(json.dumps(dict(bounds=context_bounds,source_sha256=sha,source_objects=len(copies),triangles=sum(len(p.vertices)-2 for p in o.data.polygons),scope='Entire remaining visible upper complex and full tower facade context; no physics outside apartment in this migration.')))
assert hashlib.sha256(source.read_bytes()).hexdigest()==sha;print('V21_CONTEXT_EXPORT',len(copies),flush=True)
