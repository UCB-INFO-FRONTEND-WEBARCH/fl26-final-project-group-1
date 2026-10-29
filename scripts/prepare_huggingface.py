"""Stage the IKEA catalog for public hosting without duplicating model bytes."""

import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "local_assets" / "ikea"


def link_asset(source, destination):
  destination.parent.mkdir(parents=True, exist_ok=True)
  if destination.exists():
    if not destination.samefile(source):
      raise ValueError(f"Refusing to replace a different file: {destination}")
    return
  destination.hardlink_to(source)


def prepare(output):
  manifest = json.loads((LIBRARY / "data/manifest.json").read_text())
  columns = manifest["columns"]
  id_column = columns.index("id")
  image_column = columns.index("image")
  articles = set()
  images = set()
  (output / "data").mkdir(parents=True, exist_ok=True)

  for name in manifest["chunks"]:
    if not re.fullmatch(r"catalog-\d+\.json", name):
      raise ValueError(f"Invalid catalog chunk: {name}")
    rows = json.loads((LIBRARY / "data" / name).read_text())
    for row in rows:
      article = row[id_column]
      if not re.fullmatch(r"\d{8}", article) or article in articles:
        raise ValueError(f"Invalid or repeated article: {article}")
      articles.add(article)
      link_asset(LIBRARY / "raw" / article / "model.glb", output / "raw" / article[:2] / article / "model.glb")
      image = row[image_column]
      if image:
        if not re.fullmatch(r"/thumbnails/[a-f0-9]{24}\.jpg", image):
          raise ValueError(f"Invalid thumbnail path: {image}")
        filename = image.rsplit("/", 1)[1]
        images.add(filename)
        relative = Path("thumbnails") / filename[:2] / filename
        link_asset(LIBRARY / image.lstrip("/"), output / relative)
        row[image_column] = f"/{relative.as_posix()}"
    (output / "data" / name).write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n")

  if len(articles) != manifest["total"] or len(images) != manifest["thumbnailCache"]["uniqueImages"]:
    raise ValueError("Staged file counts differ from the catalog manifest")
  manifest["localOnly"] = False
  (output / "data/manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n")
  (output / ".gitattributes").write_text(
    "*.glb filter=lfs diff=lfs merge=lfs -text\n*.jpg filter=lfs diff=lfs merge=lfs -text\n"
  )
  (output / "README.md").write_text(f"""---
pretty_name: IKEA Furniture Catalog
tags:
- 3d
- furniture
- robotics
size_categories:
- 10K<n<100K
---

# IKEA Furniture Catalog

This collection contains {len(articles):,} GLB product models and {len(images):,} cached
product photos, with searchable metadata from an IKEA catalog snapshot dated
{manifest['snapshot']}. It supports furniture inspection and indoor robot navigation
research in [RoboPlay](https://github.com/UCB-INFO-FRONTEND-WEBARCH/fl26-final-project-group-1).

## Files

- `data/manifest.json`: catalog columns, categories, counts, and chunk names.
- `data/catalog-N.json`: rows encoded as arrays in the manifest's column order.
- `raw/<first two article digits>/<eight-digit article>/model.glb`: product geometry.
- `thumbnails/<first two hash characters>/<hash>.jpg`: product photos.

Catalog image fields refer to the sharded paths above. The `url` and `productUrl`
columns retain their original IKEA source URLs. Model SHA-256 hashes are in the
`hash` column. Model bytes are unchanged from the supplied archive. Models use
metres and a Y-up coordinate system. Some metadata is inferred, as indicated by
the `inferred` column; catalog dimensions are distinct from mesh bounds.

## Provenance

Prepared from the user-supplied `IKEA_Furniture_and_Local_Catalog.zip` archive.
Product names, images, and models originate from IKEA. This dataset does not
grant a new license to the source assets. Source URLs are retained for attribution.

## Browser use

Use public `/resolve/<commit>/` file URLs. Pin the commit when pairing visuals
with precomputed collision meshes. The repository is a file collection; the
catalog JSON is consumed directly by RoboPlay rather than the Hub dataset viewer.
""")
  print(f"Staged {len(articles):,} models and {len(images):,} photos at {output}")
  print("Model and photo files are hard links: do not edit the staged asset bytes.")


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--output", type=Path, default=ROOT / "local_assets/huggingface")
  args = parser.parse_args()
  prepare(args.output)


if __name__ == "__main__":
  main()
