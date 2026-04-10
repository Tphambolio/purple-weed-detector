#!/usr/bin/env bash
# First-time GCP setup for the Purple Weed Detector deployment.
# Idempotent — safe to re-run; existing resources are skipped.
#
# What this does:
#   1. Enables the GCP APIs we need
#   2. Creates a public GCS bucket configured for static website hosting
#   3. Creates the Secret Manager secret for the Gemini API key
#      (prompts you to paste the value if it doesn't already exist)
#   4. Grants the default Cloud Functions service account access to the secret
#
# Required environment:
#   gcloud auth login
#   gcloud config set project <project-id>

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GCP_REGION:-us-central1}"
BUCKET="${GCS_BUCKET:-purple-weed-detector-app}"
SECRET_NAME="gemini-api-key"

if [ -z "$PROJECT_ID" ]; then
  echo "ERROR: no GCP project. Set GCP_PROJECT_ID or run 'gcloud config set project <id>'." >&2
  exit 1
fi

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "==> Project       : $PROJECT_ID ($PROJECT_NUMBER)"
echo "==> Region        : $REGION"
echo "==> Bucket        : $BUCKET"
echo "==> Secret        : $SECRET_NAME"
echo "==> Functions SA  : $COMPUTE_SA"
echo

# ─── 1. Enable APIs ────────────────────────────────────────────────────
echo "==> Enabling required APIs (this may take a minute)..."
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  --project="$PROJECT_ID"

# ─── 2. Create the GCS bucket ──────────────────────────────────────────
if gsutil ls -b "gs://$BUCKET" >/dev/null 2>&1; then
  echo "==> Bucket gs://$BUCKET already exists — skipping create."
else
  echo "==> Creating bucket gs://$BUCKET in $REGION..."
  gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://$BUCKET"
fi

# Static website hosting (index.html as default, 404 fallback to index.html
# so the React app handles its own routing if you ever add it).
echo "==> Configuring bucket for static website hosting..."
gsutil web set -m index.html -e index.html "gs://$BUCKET"

# Make all objects in the bucket publicly readable.
echo "==> Granting allUsers objectViewer on the bucket..."
gsutil iam ch allUsers:objectViewer "gs://$BUCKET"

# ─── 3. Create the Secret Manager secret ───────────────────────────────
if gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "==> Secret '$SECRET_NAME' already exists — skipping create."
  echo "    To rotate the key:"
  echo "      echo -n 'NEW_KEY' | gcloud secrets versions add $SECRET_NAME --data-file=- --project=$PROJECT_ID"
else
  echo
  echo "==> Creating secret '$SECRET_NAME'."
  echo "    Paste your Gemini API key from https://aistudio.google.com/apikey"
  echo "    and press Enter (input is hidden):"
  read -r -s API_KEY
  echo

  if [ -z "$API_KEY" ]; then
    echo "ERROR: empty key — aborting." >&2
    exit 1
  fi

  echo -n "$API_KEY" | gcloud secrets create "$SECRET_NAME" \
    --replication-policy=automatic \
    --data-file=- \
    --project="$PROJECT_ID"

  unset API_KEY
fi

# ─── 4. Grant the function's service account access to the secret ─────
echo "==> Granting $COMPUTE_SA access to secret '$SECRET_NAME'..."
gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
  --member="serviceAccount:$COMPUTE_SA" \
  --role=roles/secretmanager.secretAccessor \
  --project="$PROJECT_ID" \
  >/dev/null

echo
echo "==> Setup complete."
echo
echo "    Next: ACCESS_PASSWORD=<your-shared-password> ./gcp/deploy.sh"
