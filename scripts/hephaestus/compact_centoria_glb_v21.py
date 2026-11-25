"""Resize embedded textures while preserving glTF buffers and material bindings."""
from pathlib import Path
import json,struct,io,sys
from PIL import Image
src=Path(sys.argv[1]);dst=Path(sys.argv[2]);data=src.read_bytes();magic,version,length=struct.unpack_from('<III',data);n,typ=struct.unpack_from('<II',data,12);doc=json.loads(data[20:20+n]);offset=20+n;bn,bt=struct.unpack_from('<II',data,offset);binary=data[offset+8:offset+8+bn];replacement={};changes=[]
for image in doc.get('images',[]):
 idx=image.get('bufferView')
 if idx is None:continue
 view=doc['bufferViews'][idx];raw=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
 try:im=Image.open(io.BytesIO(raw));im.load()
 except:continue
 old=im.size;im.thumbnail((1024,1024),Image.Resampling.LANCZOS);out=io.BytesIO();alpha=im.mode in ['RGBA','LA'] and im.getchannel('A').getextrema()[0]<255
 if alpha:im.save(out,format='PNG',optimize=True);mime='image/png'
 else:im.convert('RGB').save(out,format='JPEG',quality=94,subsampling=0,optimize=True);mime='image/jpeg'
 replacement[idx]=out.getvalue();image['mimeType']=mime;changes.append(dict(image=image.get('name'),before=old,after=im.size,bytes=len(replacement[idx])))
# IKEA imports can retain EXT_texture_webp after their images are re-encoded.
# Promote the converted image to the core JPEG/PNG source binding.
for texture in doc.get('textures', []):
 ext = texture.get('extensions', {})
 webp = ext.pop('EXT_texture_webp', None)
 if webp is not None:
  texture['source'] = webp['source']
 if not ext:
  texture.pop('extensions', None)
for key in ('extensionsUsed', 'extensionsRequired'):
 if key in doc:
  doc[key] = [ext for ext in doc[key] if ext != 'EXT_texture_webp']
  if not doc[key]: doc.pop(key)
# Joined Blender meshes have one retained UV layer. Named source UV references
# can export as -1; bind them to that retained layer only where it exists.
def repair_bindings(value, has_uv):
 if not isinstance(value, dict): return
 for key, child in list(value.items()):
  if isinstance(child, dict) and 'index' in child and 'Texture' in key:
   coord = child.get('texCoord', 0)
   if coord < 0 or coord > 16:
    if has_uv: child['texCoord'] = 0
    else: value.pop(key)
  else: repair_bindings(child, has_uv)
for index, material in enumerate(doc.get('materials', [])):
 users = [p for m in doc.get('meshes', []) for p in m['primitives'] if p.get('material') == index]
 textured = [p for p in users if 'TEXCOORD_0' in p['attributes']]
 if textured and len(textured) != len(users):
  # An untextured material copy avoids inventing UVs for construction geometry.
  import copy
  plain = copy.deepcopy(material)
  repair_bindings(plain, False)
  plain_index = len(doc['materials'])
  doc['materials'].append(plain)
  for primitive in users:
   if 'TEXCOORD_0' not in primitive['attributes']: primitive['material'] = plain_index
 repair_bindings(material, bool(textured))
new=bytearray()
for i,view in enumerate(doc.get('bufferViews',[])):
 while len(new)%4:new.append(0)
 start=view.get('byteOffset',0);chunk=replacement.get(i,binary[start:start+view['byteLength']]);view['byteOffset']=len(new);view['byteLength']=len(chunk);new.extend(chunk)
while len(new)%4:new.append(0)
doc['buffers'][0]['byteLength']=len(new);js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);out=struct.pack('<III',magic,version,12+8+len(js)+8+len(new))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(new),0x004e4942)+new;dst.write_bytes(out);print(json.dumps(dict(source=str(src),output=str(dst),before_bytes=len(data),after_bytes=len(out),images=len(changes))))
