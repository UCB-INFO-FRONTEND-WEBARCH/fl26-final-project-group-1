import os
"""Bake native procedural albedo/height tiles in an unsaved Blender copy."""
import bpy,json,hashlib
from pathlib import Path
R=Path(os.environ['HEPHAESTUS_WORKSPACE']).resolve();Q=R/'output/web_integration_v21';Q.mkdir(parents=True,exist_ok=True);A=Path(__file__).resolve().parents[2]/'public/assets/hephaestus';src=R/'output/CHU2_Hephaestus_Tower_main_room_v20.blend';sha=hashlib.sha256(src.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(src));s=bpy.context.scene
# Hide the enormous scene for baking a single isolated tile at a time.
for o in s.objects:o.hide_render=True
def tile(key,material,w,h,wall=False):
 mat=bpy.data.materials[material].copy();nt=mat.node_tree;bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED');out=next(n for n in nt.nodes if n.type=='OUTPUT_MATERIAL');base=bs.inputs['Base Color'];color=base.links[0].from_socket if base.is_linked else None
 mesh=bpy.data.meshes.new(key);vertices=[(0,0,0),(w,0,0),(w,h,0),(0,h,0)] if not wall else [(0,0,0),(0,w,0),(0,w,h),(0,0,h)];mesh.from_pydata(vertices,[],[(0,1,2,3)]);uv=mesh.uv_layers.new()
 for p,v in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):p.uv=v
 ob=bpy.data.objects.new(key,mesh);s.collection.objects.link(ob);ob.hide_render=False;ob.data.materials.append(mat)
 for o in bpy.context.selected_objects:o.select_set(False)
 ob.select_set(True);bpy.context.view_layer.objects.active=ob
 emit=nt.nodes.new('ShaderNodeEmission');nt.links.new(emit.outputs[0],out.inputs['Surface'])
 texture=nt.nodes.new('ShaderNodeTexImage');texture.select=True;nt.nodes.active=texture
 for channel in ['color','height']:
  for l in list(emit.inputs['Color'].links):nt.links.remove(l)
  if channel=='color':
   if color:nt.links.new(color,emit.inputs['Color'])
   else:emit.inputs['Color'].default_value=base.default_value
  else:
   brick=next(n for n in nt.nodes if n.type=='TEX_BRICK');nt.links.new(brick.outputs['Fac'],emit.inputs['Color'])
  image=bpy.data.images.new('V21 '+key+' '+channel,1024,1024,alpha=False);texture.image=image;image.colorspace_settings.name='sRGB' if channel=='color' else 'Non-Color';s.render.bake.margin=0;bpy.ops.object.bake(type='EMIT');image.filepath_raw=str(A/(key+'_'+channel+'.png'));image.file_format='PNG';image.save()
 ob.hide_render=True
s.render.engine='CYCLES';s.cycles.samples=1;s.cycles.device='CPU';s.render.threads_mode='FIXED';s.render.threads=8
for args in [('oak','V13 · natural oak floor · 180 × 1800 mm',3.6,1.8,False),('brick','V13 · warm buff brick · 240 × 75 mm',.96,1.2,True)]:tile(*args)
assert hashlib.sha256(src.read_bytes()).hexdigest()==sha;print('V21_NATIVE_FINISHES_BAKED',flush=True)
