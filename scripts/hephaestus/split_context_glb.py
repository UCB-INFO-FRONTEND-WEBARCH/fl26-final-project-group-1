"""Split static tower context into roof and facade bands, preserving source attributes.

Input is the uncompressed compacted Blender export, before gltfpack. No geometry
is simplified, no surface is deleted, and authored normals/UVs remain unchanged.
"""
import copy
import json
import struct
import sys
from pathlib import Path
import numpy as np

source, destination = map(Path, sys.argv[1:3])
raw = source.read_bytes()
json_size = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20 + json_size])
assert not doc.get('skins') and not doc.get('animations'), 'Static scene only'
binary_offset = 20 + json_size
binary_size = struct.unpack_from('<I', raw, binary_offset)[0]
binary = bytearray(raw[binary_offset + 8:binary_offset + 8 + binary_size])
types = {5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
widths = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def read_accessor(index):
    accessor = doc['accessors'][index]
    assert 'sparse' not in accessor
    view = doc['bufferViews'][accessor['bufferView']]
    dtype = np.dtype(types[accessor['componentType']])
    width = widths[accessor['type']]
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', dtype.itemsize * width)
    return np.ndarray((accessor['count'], width), dtype, binary, offset, (stride, dtype.itemsize)).copy()

def append_accessor(template, values, target):
    while len(binary) % 4: binary.append(0)
    data = values.tobytes()
    view = len(doc['bufferViews'])
    doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data),'target':target})
    binary.extend(data)
    accessor = copy.deepcopy(template)
    accessor.update(bufferView=view, byteOffset=0, count=len(values))
    for key in ('min','max'): accessor.pop(key, None)
    if template['type'] == 'VEC3':
        accessor['min'] = values.min(axis=0).tolist()
        accessor['max'] = values.max(axis=0).tolist()
    result = len(doc['accessors'])
    doc['accessors'].append(accessor)
    return result

def local_matrix(node):
    if 'matrix' in node: return np.array(node['matrix']).reshape(4,4).T
    x,y,z,w = node.get('rotation',[0,0,0,1])
    rotation = np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                         [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                         [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    matrix = np.eye(4)
    matrix[:3,:3] = rotation @ np.diag(node.get('scale',[1,1,1]))
    matrix[:3,3] = node.get('translation',[0,0,0])
    return matrix

totals = {'triangles':0,'cells':0,'primitives':0}
def visit(index, parent):
    node = doc['nodes'][index]
    world = parent @ local_matrix(node)
    for child in list(node.get('children',[])): visit(child, world)
    if 'mesh' not in node: return
    mesh = doc['meshes'][node.pop('mesh')]
    cells = {}
    for primitive in mesh['primitives']:
        assert primitive.get('mode',4) == 4 and not primitive.get('targets')
        attributes = {key:read_accessor(value) for key,value in primitive['attributes'].items()}
        assert doc['accessors'][primitive['attributes']['POSITION']]['componentType'] == 5126
        positions = attributes['POSITION']
        triangles = read_accessor(primitive['indices']).reshape(-1,3)
        # Keep every face reaching the occupied roof in its visible band.
        # The complete lower facade remains available in Building view.
        vertex_z = np.c_[positions,np.ones(len(positions))] @ world[2]
        keys = np.zeros((len(triangles),3),dtype=np.int32)
        keys[:,2] = (vertex_z[triangles].max(axis=1) >= -5).astype(np.int32)
        unique_keys, assignments = np.unique(keys, axis=0, return_inverse=True)
        totals['triangles'] += len(triangles)
        for group, key in enumerate(unique_keys):
            indices = triangles[assignments == group].reshape(-1)
            vertices, remapped = np.unique(indices, return_inverse=True)
            part = copy.deepcopy(primitive)
            part['attributes'] = {
                name:append_accessor(doc['accessors'][primitive['attributes'][name]], value[vertices],34962)
                for name,value in attributes.items()
            }
            part['indices'] = append_accessor({'componentType':5125,'type':'SCALAR'},remapped.astype('<u4').reshape(-1,1),34963)
            cells.setdefault(tuple(key),[]).append(part)
            totals['primitives'] += 1
    for key, primitives in cells.items():
        child = len(doc['nodes'])
        extras = {'render_cell':list(map(int,key))}
        extras['context_band'] = 'roof' if key[2] else 'tower'
        doc['nodes'].append({'name':node.get('name','scene')+' / cell '+','.join(map(str,key)),
                             'mesh':len(doc['meshes']),'extras':extras})
        doc['meshes'].append({'primitives':primitives})
        node.setdefault('children',[]).append(child)
        totals['cells'] += 1

# Convert Y-up coordinates to the runtime's Z-up only for cell assignment.
z_up = np.array([[1,0,0,0],[0,0,-1,0],[0,1,0,0],[0,0,0,1]])
for index in doc['scenes'][doc.get('scene',0)]['nodes']: visit(index,z_up)
while len(binary)%4: binary.append(0)
doc['buffers'][0]['byteLength'] = len(binary)
encoded = json.dumps(doc,separators=(',',':')).encode()
encoded += b' '*((-len(encoded))%4)
size = 12+8+len(encoded)+8+len(binary)
destination.write_bytes(struct.pack('<III',0x46546c67,2,size)+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary)
print(json.dumps({'source':str(source),'output':str(destination),**totals}))
