import os
import bpy,json,collections
from pathlib import Path
from mathutils import Vector
R=Path(os.environ['HEPHAESTUS_WORKSPACE']).resolve();Q=R/'output/web_integration_v21';Q.mkdir(parents=True,exist_ok=True);bpy.ops.wm.open_mainfile(filepath=str(R/'output/CHU2_Hephaestus_Tower_main_room_v20.blend'));s=bpy.context.scene;bpy.context.view_layer.update()
visible=set()
def walk(c,v=True):
 v=v and not c.hide_render
 if v:visible.update(o.name for o in c.objects if not o.hide_render)
 for cc in c.children:walk(cc,v)
walk(s.collection);stats=collections.defaultdict(lambda:dict(objects=0,faces=0));rows=[]
for o in s.objects:
 if o.name not in visible or o.type not in {'MESH','CURVE'}:continue
 pp=[o.matrix_world@Vector(v) for v in o.bound_box];lo=[min(v[i] for v in pp) for i in range(3)];hi=[max(v[i] for v in pp) for i in range(3)]
 if hi[2]<2.7 or lo[2]>9.85 or hi[0]<-27 or lo[0]>12 or hi[1]<4 or lo[1]>23:continue
 c=o.users_collection[0].name;stats[c]['objects']+=1;stats[c]['faces']+=len(o.data.polygons) if o.type=='MESH' else 0
 rows.append(dict(name=o.name,type=o.type,bounds=[lo,hi],collection=c,faces=len(o.data.polygons) if o.type=='MESH' else 0,modifiers=[(m.name,m.type) for m in o.modifiers],parent=o.parent.name if o.parent else None))
(Q/'source_inventory.json').write_text(json.dumps(dict(collections=stats,objects=rows),ensure_ascii=False,indent=2));print('V21_WEB_INVENTORY',json.dumps(stats,ensure_ascii=False),flush=True)
