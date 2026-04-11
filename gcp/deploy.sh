#!/usr/bin/env bash
# Deploy the gemini-proxy Cloud Function and the static frontend to GCS.
# Run gcp/setup.sh once first to create the bucket + secret + APIs.
#
# Required environment:
#   gcloud auth login
#   gcloud config set project <project-id>
#
# Optional overrides:
#   GCP_PROJECT_ID    (defaults to gcloud config)
#   GCP_REGION        (default us-central1)
#   GCS_BUCKET        (default purple-weed-detector-app)
#   FUNCTION_NAME     (default gemini-proxy)
#   ACCESS_PASSWORD   (required on first deploy; reused on subsequent deploys)

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GCP_REGION:-us-central1}"
BUCKET="${GCS_BUCKET:-purple-weed-detector-app}"
FUNCTION_NAME="${FUNCTION_NAME:-gemini-proxy}"

if [ -z "$PROJECT_ID" ]; then
  echo "ERROR: no GCP project. Set GCP_PROJECT_ID or run 'gcloud config set project <id>'." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FUNCTION_SOURCE="$SCRIPT_DIR/functions/gemini-proxy"
RECORDS_FUNCTION_SOURCE="$SCRIPT_DIR/functions/weed-records"
RECORDS_FUNCTION_NAME="weed-records"
WEB_DIR="$REPO_ROOT/web"

echo "==> Project : $PROJECT_ID"
echo "==> Region  : $REGION"
echo "==> Bucket  : $BUCKET"
echo "==> Function: $FUNCTION_NAME"
echo

# ─── 1. Deploy the Cloud Function ──────────────────────────────────────
echo "==> Deploying Cloud Function from $FUNCTION_SOURCE"

# ACCESS_PASSWORD is required on the first deploy. On subsequent deploys
# the existing env var is preserved unless you re-set it.
SET_ENV_FLAG=()
if [ -n "${ACCESS_PASSWORD:-}" ]; then
  SET_ENV_FLAG=(--update-env-vars "ACCESS_PASSWORD=$ACCESS_PASSWORD")
fi

gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --runtime=python312 \
  --region="$REGION" \
  --source="$FUNCTION_SOURCE" \
  --entry-point=gemini_proxy \
  --trigger-http \
  --allow-unauthenticated \
  --memory=256Mi \
  --timeout=60s \
  --set-secrets="LATEST_API_KEY_VERSION=gemini-api-key:latest" \
  "${SET_ENV_FLAG[@]}" \
  --project="$PROJECT_ID"

# Note: --set-secrets above mounts an unused env var purely to grant the
# function's service account read access to the secret. The function then
# uses google-cloud-secret-manager to fetch the actual value at cold start.
# This keeps the IAM binding declarative and visible in `gcloud functions describe`.

FUNCTION_URL="$(
  gcloud functions describe "$FUNCTION_NAME" \
    --gen2 \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format='value(serviceConfig.uri)'
)"

if [ -z "$FUNCTION_URL" ]; then
  echo "ERROR: failed to retrieve function URL." >&2
  exit 1
fi

echo "==> Function URL: $FUNCTION_URL"
echo

# ─── 1b. Ensure Firestore API + database, then deploy weed-records ─────
echo "==> Enabling firestore.googleapis.com (no-op if already enabled)..."
gcloud services enable firestore.googleapis.com --project="$PROJECT_ID" || true

echo "==> Ensuring Firestore (Native mode) database exists in $REGION..."
if ! gcloud firestore databases describe --database='(default)' --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud firestore databases create \
    --location="$REGION" \
    --type=firestore-native \
    --project="$PROJECT_ID" || {
      echo "WARNING: firestore database create failed (may already exist or wrong location). Continuing." >&2
    }
fi

echo "==> Deploying weed-records Cloud Function from $RECORDS_FUNCTION_SOURCE"
gcloud functions deploy "$RECORDS_FUNCTION_NAME" \
  --gen2 \
  --runtime=python312 \
  --region="$REGION" \
  --source="$RECORDS_FUNCTION_SOURCE" \
  --entry-point=weed_records \
  --trigger-http \
  --allow-unauthenticated \
  --memory=256Mi \
  --timeout=60s \
  --project="$PROJECT_ID"

RECORDS_FUNCTION_URL="$(
  gcloud functions describe "$RECORDS_FUNCTION_NAME" \
    --gen2 \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format='value(serviceConfig.uri)'
)"

if [ -z "$RECORDS_FUNCTION_URL" ]; then
  echo "WARNING: failed to retrieve weed-records function URL — frontend will not have records support." >&2
fi

echo "==> Records URL : $RECORDS_FUNCTION_URL"
echo

# ─── 2. Build the frontend pointing at the function ────────────────────
echo "==> Building frontend with VITE_API_BASE_URL=$FUNCTION_URL"

cd "$WEB_DIR"

# Install JS deps if missing (fresh clone in Cloud Shell, CI runner, etc.).
if [ ! -d "node_modules" ]; then
  echo "==> Installing JS deps (one-time)..."
  if [ -f "package-lock.json" ]; then
    npm ci --silent
  else
    npm install --silent
  fi
fi

# --base "/$BUCKET/" prefixes all asset URLs so they resolve correctly under
# https://storage.googleapis.com/$BUCKET/index.html (which serves the bucket
# under a path, not at the origin root).
#
# MSYS_NO_PATHCONV=1 disables Git-Bash's path mangling on Windows; without it
# /purple-weed-detector-app/ would be rewritten to C:/Program Files/Git/...
MSYS_NO_PATHCONV=1 \
VITE_USE_PROXY=1 \
VITE_API_BASE_URL="$FUNCTION_URL" \
VITE_RECORDS_URL="$RECORDS_FUNCTION_URL" \
  npx vite build --base "/$BUCKET/"

# ─── 3. Sync to GCS ────────────────────────────────────────────────────
echo "==> Syncing dist/ to gs://$BUCKET"

gsutil -m rsync -r -d "$WEB_DIR/dist" "gs://$BUCKET"

# Don't cache index.html so updates are visible immediately. Hashed asset
# files are immutable and Vite already adds a hash to their filename.
gsutil -m setmeta \
  -h "Cache-Control:no-cache, max-age=0" \
  "gs://$BUCKET/index.html"

cd "$REPO_ROOT"

# ─── 4. Print final URLs ───────────────────────────────────────────────
PUBLIC_URL="https://storage.googleapis.com/$BUCKET/index.html"

echo
echo "==> Deployed!"
echo "    Frontend : $PUBLIC_URL"
echo "    Function : $FUNCTION_URL"
echo "    Records  : $RECORDS_FUNCTION_URL"
echo
echo "    Open the frontend, set the access password in the UI, and start scanning."
