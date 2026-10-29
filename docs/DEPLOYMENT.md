# GitHub Pages deployment

The project site URL is:

`https://ucb-info-frontend-webarch.github.io/fl26-final-project-group-1/`

GitHub Pages is already configured to use GitHub Actions for this repository.
The workflow in `.github/workflows/pages.yml` tests every PR and push to `main`.
Deployment starts only through **Run workflow**, after the PR is merged.

## Asset storage

The built application is about 55 MB. The full IKEA collection is about 10.1 GB.
[GitHub Pages limits published sites to 1 GB](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
The deployment target is the full catalog on a separate HTTPS static host or object store.
The Pages artifact contains the application, robot, policy, and decoders.

The prepared dataset has this layout:

```text
data/manifest.json
data/catalog-0.json ... catalog-7.json
raw/<first-two-digits>/<article>/model.glb
thumbnails/<first-two-characters>/<hash>.jpg
```

The public layout differs from the flat imported archive. Use the preparation
script below. The base URL must resolve the collection root, where
`data/manifest.json` is located.
The local collision cache and ZIP archive are not needed by the website.

Configure the host as follows:

| Setting | Value |
| --- | --- |
| Public access | Read access to the listed files |
| CORS allowed origin | `https://ucb-info-frontend-webarch.github.io` |
| CORS allowed methods | `GET`, `HEAD` |
| Catalog responses | Valid JSON (`application/json` or Hugging Face's `text/plain`) |
| GLB content type | `model/gltf-binary` or `application/octet-stream` |
| Photo content type | `image/jpeg` |

The asset URLs are public and are included in the built JavaScript.
Use an HTTPS URL without credentials or expiring query parameters.

## Upload to Hugging Face

The public dataset is [T-K-233/ikea-furniture](https://huggingface.co/datasets/T-K-233/ikea-furniture).
It contains the full collection. The app reads individual files through public
`/resolve/<commit>/` URLs, without a token in the browser.

The verified initial revision is `a6dea1bba516ec9ce963a56fbe21f8a5741da17d`.
All 55,072 published files match their staged sizes and content hashes.
The repository's `IKEA_ASSET_BASE_URL` variable is configured to this revision:

```text
https://huggingface.co/datasets/T-K-233/ikea-furniture/resolve/a6dea1bba516ec9ce963a56fbe21f8a5741da17d/
```

The uploaded layout uses two-character shards to stay within
[Hugging Face's folder limits](https://huggingface.co/docs/hub/storage-limits).
Prepare it from the imported archive:

```bash
python3 scripts/prepare_huggingface.py
```

This creates `local_assets/huggingface/`. Models and photos are hard links to the
imported files, so staging does not duplicate their bytes. Do not edit these
staged assets. The catalog image paths are rewritten for the hosted layout;
original source URLs, model hashes, and geometry are preserved.
The script also creates a dataset card and GLB/JPEG LFS rules.

For future uploads, use an authenticated Hugging Face CLI. The initial upload
used `huggingface_hub==1.14.0` and its resumable large-folder uploader:

```bash
hf upload-large-folder T-K-233/ikea-furniture local_assets/huggingface --repo-type dataset --num-workers 8
```

Rerun an interrupted upload with the same staging folder. Its progress cache is
inside the ignored staging directory. The upload must finish before publishing
a website that depends on it. For a replacement archive, prepare a fresh staging
directory with `--output local_assets/huggingface-v2`.

After an upload, obtain its complete commit SHA from the dataset's commit history.
Use that SHA in `IKEA_ASSET_BASE_URL`, rather than the mutable `main` branch:

```text
https://huggingface.co/datasets/T-K-233/ikea-furniture/resolve/<commit>/
```

Hugging Face handles CORS on public file downloads. The deployment validator
checks the actual responses, including CDN redirects. Keep the dataset public
and ungated; do not place a Hugging Face token in a Vite variable.
Download traffic is subject to [Hub rate limits](https://huggingface.co/docs/hub/rate-limits).

## Deploy

1. Finish the dataset upload and obtain its commit SHA.
2. In the repository, open **Settings → Secrets and variables → Actions → Variables**.
3. Set `IKEA_ASSET_BASE_URL` to the pinned Hugging Face `/resolve/<commit>/` URL.
4. Merge the reviewed PR into `main`.
5. Open **Actions → Build and deploy Pages → Run workflow**. Select `main`.
6. Open the URL in the completed `github-pages` deployment.

The workflow validates CORS, catalog files, and the playground's model hashes
before deployment. This prevents publishing furniture visuals that differ from
their collision geometry. It also checks the playground product photos.
It does not request every model in the full collection.

The workflow uses the official [GitHub Pages artifact and deployment actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
The Python asset tools do not run in the deployed site or deployment workflow.

## Verify locally

Use a repository path to check the same routing as GitHub Pages:

```bash
npm run build -- --base /fl26-final-project-group-1/
npm run preview -- --base /fl26-final-project-group-1/ --port 4182
```

Open `http://127.0.0.1:4182/fl26-final-project-group-1/` and its `catalog/` page.
The local preview serves the imported collection under that path.

To check an external host before deploying:

```bash
ikea_asset_base='https://huggingface.co/datasets/T-K-233/ikea-furniture/resolve/a6dea1bba516ec9ce963a56fbe21f8a5741da17d/'
node scripts/verify_asset_host.js "$ikea_asset_base" https://ucb-info-frontend-webarch.github.io
VITE_IKEA_BASE_URL="$ikea_asset_base" npm run build -- --base /fl26-final-project-group-1/
```

Without `VITE_IKEA_BASE_URL`, the application uses `assets/ikea/` under its site
base path. Normal local development continues to use the imported collection.
