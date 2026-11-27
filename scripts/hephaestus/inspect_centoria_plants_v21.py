import os
import bpy,json
from pathlib import Path
from mathutils import Matrix
R=Path(os.environ['HEPHAESTUS_WORKSPACE']).resolve();Q=R/'output/web_integration_v21';Q.mkdir(parents=True,exist_ok=True);bpy.ops.wm.open_mainfile(filepath=str(R/'output/CHU2_Hephaestus_Tower_main_room_v20.blend'));plants=[]
for o in bpy.context.scene.objects:
 if o.get('asset_id') not in ['t10','t11','t12'] or not o.get('asset_instance'):continue
 if not -2<o.matrix_world.translation.z<10:continue
 plants.append(dict(key=o.get('asset_key',o['asset_id']),matrix=[list(v) for v in Matrix.Translation((2.8,-13.935,-3.03))@o.matrix_world]))
(Q/'plant_instances.json').write_text(json.dumps(plants));print('NATIVE_PLANTS',len(plants),flush=True)
