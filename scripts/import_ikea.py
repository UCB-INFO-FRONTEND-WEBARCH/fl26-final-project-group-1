"""Import the local IKEA archive without adding the model collection to Git."""

import argparse
from pathlib import Path
import re
import shutil
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "local_assets" / "ikea"
COLLECTION = "IKEA_Asset_Catalog/assets/ikea/full_collection/"
CATALOG = "IKEA_Asset_Catalog/sites/ikea-asset-catalog/dist/client/data/"


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("archive", type=Path)
  args = parser.parse_args()
  count = 0
  with ZipFile(args.archive) as archive:
    for entry in archive.infolist():
      relative = entry.filename.removeprefix(COLLECTION)
      if not entry.filename.startswith(COLLECTION) or not re.fullmatch(
        r"raw/\d{8}/model\.glb|thumbnails/[a-f0-9]{24}\.jpg", relative
      ):
        continue
      destination = LIBRARY / relative
      destination.parent.mkdir(parents=True, exist_ok=True)
      with archive.open(entry) as source, destination.open("wb") as output:
        shutil.copyfileobj(source, output)
      count += 1
      if count % 5000 == 0:
        print(f"Imported {count:,} models and photos", flush=True)
    (LIBRARY / "data").mkdir(parents=True, exist_ok=True)
    for entry in archive.infolist():
      relative = entry.filename.removeprefix(CATALOG)
      if entry.filename.startswith(CATALOG) and re.fullmatch(r"manifest\.json|catalog-\d+\.json", relative):
        (LIBRARY / "data" / relative).write_bytes(archive.read(entry))
  print(f"Imported {count:,} models and photos to {LIBRARY}")


if __name__ == "__main__":
  main()
