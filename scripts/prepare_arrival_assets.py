"""Download public aerial imagery and road geometry for the arrival sequence."""

import array
import hashlib
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request


OUTPUT = Path(__file__).resolve().parents[1] / 'public/assets/arrival'
ORIGIN = [-121.95947, 37.37378]
LOCAL_ROAD_BOUNDS = [37.32, -122.02, 37.43, -121.90]
# Roof center, checked against NVIDIA's visitor map and the aerial image.
TARGET = [-121.96032, 37.37356]
IMAGERY = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer'
USER_AGENT = 'Centoria asset preparation (github.com/UCB-INFO-FRONTEND-WEBARCH/fl26-final-project-group-1)'


def mercator(longitude, latitude):
  radius = 6378137
  return [radius * math.radians(longitude), radius * math.log(math.tan(math.pi / 4 + math.radians(latitude) / 2))]


def download(url, payload=None):
  request = urllib.request.Request(url, data=payload, headers={'User-Agent': USER_AGENT})
  with urllib.request.urlopen(request, timeout=120) as response:
    return response.read()


def prepare_images():
  target = mercator(*ORIGIN)
  levels = [
    ('bay-area', 'San Francisco Bay Area', [-122.18, 37.61], 220000),
    ('santa-clara', 'Santa Clara Valley', ORIGIN, 40000),
    ('campus', 'NVIDIA campus', ORIGIN, 6000),
    ('building-k', 'NVIDIA Building K', ORIGIN, 900),
  ]
  previous = OUTPUT / 'manifest.json'
  known = {image['name']: image['source'] for image in json.loads(previous.read_text())['images']} if previous.exists() else {}
  images = []
  for index, (name, label, location, extent) in enumerate(levels):
    center = mercator(*location)
    bounds = [center[0] - extent / 2, center[1] - extent / 2,
              center[0] + extent / 2, center[1] + extent / 2]
    # The opening crops the regional image around Building K. Use a detailed,
    # cloud-free satellite mosaic with complete coastal coverage for that crop.
    pixels = 4000 if index == 0 else 1536
    parameters = {'bbox': ','.join(map(str, bounds)), 'bboxSR': 3857, 'imageSR': 3857,
                  'size': f'{pixels},{pixels}', 'format': 'jpg', 'f': 'image',
                  'bandIds': '0,1,2', 'interpolation': 'RSP_BilinearInterpolation',
                  'compressionQuality': 92 if index == 0 else 88}
    service = IMAGERY + '/exportImage'
    if index == 0:
      service = 'https://tiles.maps.eox.at/wms'
      parameters = {'SERVICE': 'WMS', 'REQUEST': 'GetMap', 'VERSION': '1.1.1',
                    'LAYERS': 's2cloudless_3857', 'STYLES': '', 'FORMAT': 'image/jpeg',
                    'SRS': 'EPSG:3857', 'BBOX': ','.join(map(str, bounds)),
                    'WIDTH': pixels, 'HEIGHT': pixels}
    url = service + '?' + urllib.parse.urlencode(parameters)
    path = OUTPUT / f'{name}.jpg'
    if not path.exists() or known.get(name) != url:
      contents = download(url)
      if not contents.startswith(b'\xff\xd8'):
        raise RuntimeError(f'{name}: expected JPEG, got {contents[:300]!r}')
      path.write_bytes(contents)
    contents = path.read_bytes()
    images.append({'name': name, 'label': label, 'file': path.name, 'extent': extent,
                   'center': [round(center[0] - target[0], 3), round(center[1] - target[1], 3)],
                   'pixels': [pixels, pixels], 'source': url,
                   'sha256': hashlib.sha256(contents).hexdigest()})
    if index == 0:
      images[-1].update(license='CC-BY-4.0', acquisition_years=[2016, 2017],
        attribution='Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)')
    print(f'{name}: {len(contents):,} bytes', flush=True)
  return images


def prepare_roads():
  path = OUTPUT / 'roads.json'
  cache = OUTPUT.parents[2] / 'local_assets/arrival/roads.json'
  cache.parent.mkdir(parents=True, exist_ok=True)
  if path.exists():
    path.replace(cache)
  if cache.exists():
    return json.loads(cache.read_text())['roads']
  # Main roads around the Bay, with local streets around the destination.
  query = f'''[out:json][timeout:90];(
    way["highway"~"^(motorway|trunk|primary|secondary)$"](37.1,-122.6,38.1,-121.6);
    way["highway"~"^(tertiary|residential|service|unclassified|living_street)$"]({','.join(map(str, LOCAL_ROAD_BOUNDS))});
  );out geom;'''
  raw = json.loads(download('https://overpass-api.de/api/interpreter',
                           urllib.parse.urlencode({'data': query}).encode()))
  target = mercator(*ORIGIN)
  roads = []
  for way in raw['elements']:
    if 'geometry' not in way:
      continue
    coordinates = []
    for point in way['geometry']:
      x, y = mercator(point['lon'], point['lat'])
      coordinates.extend([round(x - target[0], 1), round(y - target[1], 1)])
    roads.append({'id': way['id'], 'type': way['tags']['highway'], 'points': coordinates})
  cache.write_text(json.dumps({'license': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors',
                             'source': 'https://www.openstreetmap.org/copyright', 'roads': roads}, separators=(',', ':')))
  return roads


def write_light_points(filename, points):
  packed = array.array('f', (value for point in points for value in point))
  if __import__('sys').byteorder != 'little':
    packed.byteswap()
  contents = packed.tobytes()
  (OUTPUT / filename).write_bytes(contents)
  print(f'{filename}: {len(packed) // 3:,} lights, {len(contents):,} bytes', flush=True)
  return {'file': filename, 'count': len(packed) // 3, 'stride': 3,
          'sha256': hashlib.sha256(contents).hexdigest()}


def prepare_lights(roads):
  lights = {}
  for road in roads:
    major = road['type'] in ('motorway', 'trunk', 'primary', 'secondary')
    spacing = 70 if major else 22
    strength = {'motorway': 1, 'trunk': 0.9, 'primary': 0.75, 'secondary': 0.6,
                'tertiary': 0.5, 'residential': 0.35, 'service': 0.22}.get(road['type'], 0.3)
    points = road['points']
    remaining = spacing / 2
    for index in range(2, len(points), 2):
      x, y = points[index - 2:index]
      dx, dy = points[index] - x, points[index + 1] - y
      distance = math.hypot(dx, dy)
      if distance == 0:
        continue
      while remaining <= distance:
        px, py = x + dx * remaining / distance, y + dy * remaining / distance
        key = (round(px / 8), round(py / 8))
        if key not in lights or lights[key][2] < strength:
          lights[key] = (px, py, strength)
        remaining += spacing
      remaining -= distance
  complete = write_light_points('lights.bin', lights.values())
  overview = write_light_points('overview-lights.bin', (point for point in lights.values() if point[2] >= 0.55))
  origin = mercator(*ORIGIN)
  west, south = mercator(LOCAL_ROAD_BOUNDS[1], LOCAL_ROAD_BOUNDS[0])
  east, north = mercator(LOCAL_ROAD_BOUNDS[3], LOCAL_ROAD_BOUNDS[2])
  return {**complete, 'overview': overview,
          'local_bounds': [west - origin[0], south - origin[1], east - origin[0], north - origin[1]],
          'layout': 'little-endian float32: Mercator x, y relative to origin, intensity',
          'license': 'ODbL-1.0', 'source': 'https://www.openstreetmap.org/copyright'}


def main():
  OUTPUT.mkdir(parents=True, exist_ok=True)
  images = prepare_images()
  lights = prepare_lights(prepare_roads())
  focus = [a - b for a, b in zip(mercator(*TARGET), mercator(*ORIGIN))]
  manifest = {'target': {'name': 'NVIDIA Building K', 'address': '2886 Scott Blvd, Santa Clara, CA',
                         'coordinates': TARGET, 'focus': focus}, 'origin': ORIGIN,
              'lights': lights,
              'imagery_credit': 'Sentinel-2 cloudless by EOX (Copernicus 2016 & 2017) / USGS / USDA · © OpenStreetMap contributors',
              'imagery_source': 'https://www.usgs.gov/programs/national-geospatial-program/national-map',
              'images': images}
  (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
  main()
