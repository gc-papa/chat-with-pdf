# Deploying `chat-with-pdf` to Google Cloud Run

This guide shows how to run the project locally (dev and production) and deploy a container to Google Cloud Run.

Prereqs
- Google Cloud SDK (gcloud) installed and authenticated
- A Google Cloud project with billing enabled
- Docker (or use `gcloud builds submit`) installed locally
- pnpm installed

1) Local development

- Install dependencies
  ```fish
  pnpm install
  ```

- Start dev server (hot-reload)
  ```fish
  pnpm dev --remote
  ```

2) Local production build & run

- Build
  ```fish
  pnpm build
  ```

- Run locally (node)
  ```fish
  pnpm start
  # or
  node .output/server/index.mjs
  ```

3) Build a Docker image and run locally

- Build image (replace IMAGE with your name)
  ```fish
  docker build -t gcr.io/PROJECT_ID/chat-with-pdf:latest .
  ```

- Run container locally
  ```fish
  docker run -p 8080:3000 gcr.io/PROJECT_ID/chat-with-pdf:latest
  # open http://localhost:8080
  ```

4) Deploy to Cloud Run

- Using Cloud Build (recommended)
  ```fish
  gcloud builds submit --tag gcr.io/PROJECT_ID/chat-with-pdf:latest
  gcloud run deploy chat-with-pdf \
    --image gcr.io/PROJECT_ID/chat-with-pdf:latest \
    --platform managed \
    --region REGION \
    --allow-unauthenticated \
    --memory=1Gi
  ```

- Using `docker` push (alternative)
  1. Build and tag
     ```fish
     docker build -t gcr.io/PROJECT_ID/chat-with-pdf:latest .
     ```
  2. Push
     ```fish
     docker push gcr.io/PROJECT_ID/chat-with-pdf:latest
     ```
  3. Deploy
     ```fish
     gcloud run deploy chat-with-pdf --image gcr.io/PROJECT_ID/chat-with-pdf:latest --region REGION --allow-unauthenticated
     ```

Notes & caveats
- This project uses NuxtHub and Cloudflare features (R2, Workers AI, Vectorize, D1). Deploying to Cloud Run means you won't automatically get the NuxtHub integrations that the repo's README mentions. You will need to configure alternative services:
  - File storage: use GCS or an external S3-compatible store instead of R2
  - Database: replace D1 with your chosen DB (Supabase, Cloud SQL) and update `server/utils/*` accordingly
  - AI models / vector store: ensure env vars and APIs are configured to point at the external LLM/embedding provider you choose

- Environment variables: set them in Cloud Run's service settings or pass via `--set-env-vars` during deploy. Common values: API keys, DB connection strings, GOOGLE_APPLICATION_CREDENTIALS (if using Cloud SQL with IAM), and any NuxtHub-specific keys if you still use their services.

- Port: The Dockerfile exposes 3000 (Nuxt server). Cloud Run expects the container to listen on the port provided by the `PORT` env var. The Nitro server respects the env var, but if you need to force it, set PORT=8080 (Cloud Run default) or update the `CMD` accordingly.

  Example: set PORT during `docker run` or Cloud Run env var

  ```fish
  # run locally on port 8080
  docker run -p 8080:8080 -e PORT=8080 gcr.io/PROJECT_ID/chat-with-pdf:latest
  ```

Troubleshooting
- If the service returns 502/503 on Cloud Run, check the container logs:
  ```fish
  gcloud logs read --project=PROJECT_ID --limit=50 --format="json"
  ```
- If the Nuxt build fails inside the Docker build, ensure your pnpm version in Docker matches your local pnpm lockfile version. You can switch the `RUN npm install -g pnpm@7` line in the `Dockerfile` to a specific pnpm that matches `package.json`'s `packageManager` field.


Next steps (optional)
- Add `cloudbuild.yaml` for repeatable CI deployments.
- Add health checks and readiness probes via Cloud Run settings.
- If you want to keep NuxtHub integrations, consider deploying to Cloudflare Pages / Workers instead of Cloud Run.
