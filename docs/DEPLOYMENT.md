# GitHub Pages deployment

The project site URL is:

`https://ucb-info-frontend-webarch.github.io/fl26-final-project-group-1/`

GitHub Pages is already configured to use GitHub Actions for this repository.
The workflow in `.github/workflows/pages.yml` tests every PR and push to `main`.
Deployment starts only through **Run workflow**, after the PR is merged.

## Asset storage

The built application is about 55 MB. The full IKEA collection is about 9.7 GB.
[GitHub Pages limits published sites to 1 GB](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
Keep the full collection on a separate HTTPS static host or object store.
The Pages artifact contains the application, robot, policy, and decoders.

Copy these directories from `local_assets/ikea/` to the asset host:

```text
data/manifest.json
data/catalog-0.json ... catalog-7.json
raw/<article>/model.glb
thumbnails/<hash>.jpg
```

Keep their paths unchanged. The base URL must resolve the collection root.
For example, a base URL of `https://assets.example.org/ikea/` must serve
`https://assets.example.org/ikea/data/manifest.json`.
The local collision cache and ZIP archive are not needed by the website.

Configure the host as follows:

| Setting | Value |
| --- | --- |
| Public access | Read access to the listed files |
| CORS allowed origin | `https://ucb-info-frontend-webarch.github.io` |
| CORS allowed methods | `GET`, `HEAD` |
| JSON content type | `application/json` |
| GLB content type | `model/gltf-binary` or `application/octet-stream` |
| Photo content type | `image/jpeg` |

The asset URLs are public and are included in the built JavaScript.
Use an HTTPS URL without credentials or expiring query parameters.

## Deploy

1. Upload the collection to the selected asset host.
2. In the repository, open **Settings → Secrets and variables → Actions → Variables**.
3. Set `IKEA_ASSET_BASE_URL` to the collection's HTTPS base URL.
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
node scripts/verify_asset_host.js https://assets.example.org/ikea/ https://ucb-info-frontend-webarch.github.io
VITE_IKEA_BASE_URL=https://assets.example.org/ikea/ npm run build -- --base /fl26-final-project-group-1/
```

Without `VITE_IKEA_BASE_URL`, the application uses `assets/ikea/` under its site
base path. Normal local development continues to use the imported collection.

## Pages-only alternative

The twelve playground models total 1.93 MB. A small public demo could package
those models, their photos, and a reduced catalog directly in Pages.
That option would browse only the selected assets. It would require a separate
catalog packaging step and would not include the full 36,447-model collection.
