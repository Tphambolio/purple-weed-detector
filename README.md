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

## Tuning the pre-filter

Edit `backend/prefilter.py` to adjust sensitivity:

```python
PURPLE_LOWER = np.array([120, 30, 30])   # HSV lower bound
PURPLE_UPPER = np.array([165, 255, 255]) # HSV upper bound
DEFAULT_THRESHOLD = 0.005                # 0.5% of pixels must be purple
```

Lower the threshold to catch more edge cases (more API calls). Raise it to reduce false positives.
