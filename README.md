# Purple Weed Detector

Scan a folder of photos for invasive purple weeds using **OpenCV pre-filtering** + **Gemini Vision AI**.

![Stack](https://img.shields.io/badge/FastAPI-backend-009688?style=flat-square) ![Stack](https://img.shields.io/badge/React-frontend-61dafb?style=flat-square) ![Stack](https://img.shields.io/badge/Gemini%202.5%20Flash-vision-a855f7?style=flat-square)

## How it works

```
Photos folder
    ↓
OpenCV HSV mask        ← fast purple pixel pre-filter (eliminates ~70% of API calls)
    ↓ (purple found)
Gemini 2.5 Flash       ← species identification
    ↓
SQLite cache           ← skip re-scanning unchanged photos
    ↓
React gallery          ← Detected / Clean / All tabs, real-time SSE stream
```

## Target species (Alberta focus)

| Species | Notes |
|---|---|
| Purple Loosestrife (*Lythrum salicaria*) | Wetland edges, tall magenta spikes |
| Canada Thistle (*Cirsium arvense*) | Upland disturbed areas, pink-purple heads |
| Nodding Thistle (*Carduus nutans*) | Roadsides, drooping flower heads |
| Dame's Rocket (*Hesperis matronalis*) | Urban edges, 4-petalled purple/white |

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- Google Gemini API key

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt

export GEMINI_API_KEY=...
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

### Quick start (both at once)

```bash
chmod +x run.sh && ./run.sh
```

## Usage

1. Enter the absolute path to a photo folder (e.g. `/home/user/survey-photos`)
2. Select target species (default: any purple weed)
3. Click **Start Scan**
4. Results stream in real time — purple outlines = detected
5. Click any photo for species ID, confidence, and description

## Architecture

| File | Purpose |
|---|---|
| `backend/main.py` | FastAPI app, SSE endpoint, image proxy |
| `backend/prefilter.py` | OpenCV HSV purple-pixel filter |
| `backend/analyzer.py` | Gemini Vision API calls |
| `backend/scanner.py` | Async folder walk + pipeline orchestration |
| `backend/database.py` | SQLite results cache |
| `frontend/src/App.jsx` | Root state, SSE stream consumer |
| `frontend/src/components/` | FolderInput, ScanProgress, PhotoGallery, PhotoDetail |

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Your Google Gemini API key |

## Deploying the browser version to GCP

The `web/` directory is a browser-only React app that does blob detection
in a Web Worker (opencv.js / WASM) and proxies Gemini calls through a
serverless function. This branch (`gcp-migration`) ships GCP-flavoured
hosting: a static frontend on **Cloud Storage** + a Python proxy on
**Cloud Functions** + the API key in **Secret Manager**.

### Prerequisites

- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- A GCP project with billing enabled
- Node 18+ (for the frontend build)
- A Gemini API key from https://aistudio.google.com/apikey

### One-time setup

```bash
gcloud config set project YOUR_PROJECT_ID

# Enables APIs, creates the GCS bucket, prompts for the Gemini API key,
# stores it in Secret Manager, and grants the Cloud Functions service
# account access. Idempotent — safe to re-run.
./gcp/setup.sh
```

The script accepts these env-var overrides:

| Variable | Default | Notes |
|---|---|---|
| `GCP_PROJECT_ID` | from `gcloud config` | which project to deploy into |
| `GCP_REGION` | `us-central1` | function + bucket region |
| `GCS_BUCKET` | `purple-weed-detector-app` | static-hosting bucket |

### Deploying

```bash
# First deploy must include ACCESS_PASSWORD so the function can authenticate
# requests from the frontend. Subsequent deploys can omit it — the existing
# value is preserved.
ACCESS_PASSWORD=your-shared-secret ./gcp/deploy.sh
```

What `deploy.sh` does:

1. Deploys `gcp/functions/gemini-proxy/` as a 2nd-gen Cloud Function
   (Python 3.12, HTTP trigger, unauthenticated, 256 MiB, 60 s timeout).
2. Reads the function's HTTPS URL.
3. Builds the frontend with `VITE_API_BASE_URL=<function-url>` and
   `--base /<bucket>/` so all asset paths resolve under the bucket prefix.
4. `gsutil rsync` uploads `web/dist/` to `gs://<bucket>` and sets
   `Cache-Control: no-cache` on `index.html` so updates are visible immediately.
5. Prints the public URL.

The deployed app lives at:

```
https://storage.googleapis.com/<bucket>/index.html
```

Open it, paste your `ACCESS_PASSWORD` in the access-password field at the
top of the page (stored in browser localStorage), then drag photos in.

### Local dev pointing at the deployed function

If you want to iterate on the frontend locally while still hitting the
real GCP function, set `VITE_API_BASE_URL` in `web/.env.local`:

```
VITE_USE_PROXY=1
VITE_API_BASE_URL=https://us-central1-YOUR_PROJECT.cloudfunctions.net/gemini-proxy
```

Then `cd web && npm run dev` — the browser will POST to the live function,
which still requires the access password from localStorage.

### Rotating the Gemini key

```bash
echo -n 'NEW_KEY' | gcloud secrets versions add gemini-api-key \
  --data-file=- --project=YOUR_PROJECT_ID
```

The next cold start of the function picks it up. To force-warm a new
version immediately, redeploy: `./gcp/deploy.sh`.

### Rotating the access password

```bash
ACCESS_PASSWORD=new-password ./gcp/deploy.sh
```

### GCP variables reference

| Variable | Required | Where | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | yes | Secret Manager (`gemini-api-key`) | the actual Gemini key |
| `ACCESS_PASSWORD` | yes | Function env var | shared secret callers send via `X-Access-Password` |
| `VITE_API_BASE_URL` | yes (build time) | `web/.env.local` or set inline | frontend points here for `/api/gemini` |
| `GCP_PROJECT_ID` | optional | shell env | overrides `gcloud config get-value project` |
| `GCP_REGION` | optional | shell env | defaults to `us-central1` |
| `GCS_BUCKET` | optional | shell env | defaults to `purple-weed-detector-app` |

## Tuning the pre-filter

Edit `backend/prefilter.py` to adjust sensitivity:

```python
PURPLE_LOWER = np.array([120, 30, 30])   # HSV lower bound
PURPLE_UPPER = np.array([165, 255, 255]) # HSV upper bound
DEFAULT_THRESHOLD = 0.005                # 0.5% of pixels must be purple
```

Lower the threshold to catch more edge cases (more API calls). Raise it to reduce false positives.
