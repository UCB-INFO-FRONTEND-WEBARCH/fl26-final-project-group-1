# GitHub Pages deployment

The project site URL is:

`https://ucb-info-frontend-webarch.github.io/fl26-final-project-group-1/`

GitHub Pages is already configured to use GitHub Actions for this repository.
The workflow in `.github/workflows/pages.yml` tests every PR and push to `main`.
Deployment starts only through **Run workflow**, after the PR is merged.

## Asset storage

The built application is about 55 MB. The full IKEA collection is about 9.7 GB.
[GitHub Pages limits published sites to 1 GB](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
The deployment target is the full catalog on a separate HTTPS static host or object store.
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

## Upload with Cloudflare R2

R2 is a recommended host because it has no bandwidth egress charges.
Storage and request charges depend on usage; see [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
An existing S3-compatible host can use the same directory layout and upload commands
with its endpoint, credentials, and region.

1. In the Cloudflare dashboard, create a dedicated Standard storage bucket, such as `roboplay-assets`.
2. Create an [R2 Object Read & Write token](https://developers.cloudflare.com/r2/api/tokens/)
   scoped to that bucket. Configure public access and CORS through the dashboard.
3. Install the [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).
   Configure a named profile locally:

   ```bash
   aws configure --profile roboplay-assets
   ```

   Enter the R2 Access Key ID and Secret Access Key, region `auto`, and output `json`.
   Credentials are needed for upload only. GitHub Pages does not need them.

Run the following from the repository root. Replace the endpoint with the
**S3 API endpoint** shown for your bucket, including its jurisdiction if applicable.
Replace the bucket name if you chose a different one.

```bash
ikea_storage_endpoint='https://ACCOUNT_ID.r2.cloudflarestorage.com'
ikea_storage_bucket='roboplay-assets'

aws --profile roboplay-assets --endpoint-url "$ikea_storage_endpoint" s3 sync \
  local_assets/ikea/raw/ "s3://$ikea_storage_bucket/ikea/raw/" \
  --exclude '*' --include '*/model.glb' --no-follow-symlinks \
  --content-type model/gltf-binary --cache-control 'public,max-age=86400'

aws --profile roboplay-assets --endpoint-url "$ikea_storage_endpoint" s3 sync \
  local_assets/ikea/thumbnails/ "s3://$ikea_storage_bucket/ikea/thumbnails/" \
  --exclude '*' --include '*.jpg' --no-follow-symlinks \
  --content-type image/jpeg --cache-control 'public,max-age=86400'

aws --profile roboplay-assets --endpoint-url "$ikea_storage_endpoint" s3 sync \
  local_assets/ikea/data/ "s3://$ikea_storage_bucket/ikea/data/" \
  --exclude '*' --include 'catalog-*.json' --include 'manifest.json' --no-follow-symlinks \
  --content-type application/json --cache-control 'public,max-age=300'
```

All three commands must complete successfully. They upload only models, photos,
and catalog JSON. Rerun interrupted commands to copy missing or updated files;
[`sync`](https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html) skips unchanged files.
It does not update metadata on unchanged objects. For a new collection release,
use a new prefix such as `ikea-v2/`, verify it, and change the app's base URL.

In the bucket's **Settings → CORS Policy**, paste this JSON and save:

```json
[
  {
    "AllowedOrigins": ["https://ucb-info-frontend-webarch.github.io"],
    "AllowedMethods": ["GET", "HEAD"],
    "MaxAgeSeconds": 3600
  }
]
```

Connect a public custom domain, such as `assets.example.org`, in the bucket's
**Settings → Custom Domains**. The domain must belong to the same Cloudflare account.
The collection base URL is then `https://assets.example.org/ikea/`.
Cloudflare's `r2.dev` public URL can be used for an initial check, but it is
rate-limited and intended for development. See [public bucket access](https://developers.cloudflare.com/r2/buckets/public-buckets/).

Configure CORS before serving traffic. If objects were cached before a CORS change,
purge the asset hostname's cache so the new headers take effect.
See [R2 CORS configuration](https://developers.cloudflare.com/r2/buckets/cors/).
The authenticated S3 API endpoint is for upload; use the public domain for the app.

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
