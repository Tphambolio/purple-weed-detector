import os
from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path

from models import ScanRequest, DriveScanRequest
from scanner import scan_folder, scan_drive_folder, validate_scan_root
from database import get_folder_results

app = FastAPI(title="Purple Weed Detector API", version="1.0.0")

_allowed_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:5174,http://localhost:4173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed_origins if o.strip()],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.post("/api/scan")
async def scan(request: ScanRequest):
    """Stream scan results via Server-Sent Events."""
    async def event_stream():
        async for status in scan_folder(request.folder, request.weeds, request.force_rescan):
            yield f"data: {status.model_dump_json()}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/scan-drive")
async def scan_drive(request: DriveScanRequest):
    """Stream scan results for a Google Drive folder via SSE."""
    async def event_stream():
        async for status in scan_drive_folder(request.folder, request.weeds, request.force_rescan):
            yield f"data: {status.model_dump_json()}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/results")
async def get_results(folder: str = Query(..., description="Absolute folder path")):
    """Return cached results for a previously-scanned folder."""
    results = get_folder_results(folder)
    return {"results": [r.model_dump() for r in results]}


@app.get("/api/image")
async def serve_image(
    path: str = Query(..., description="Absolute path to local image"),
    folder: str = Query(..., description="Parent scan folder (must contain path)"),
):
    """Serve a local image file, but only if it lives under the declared scan
    folder. Resolves symlinks to prevent escape via crafted links."""
    try:
        root = validate_scan_root(folder)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        target = Path(path).resolve(strict=True)
    except (FileNotFoundError, OSError):
        raise HTTPException(status_code=404, detail="Image not found")

    try:
        target.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=403, detail="Path outside scan folder")

    if not target.is_file():
        raise HTTPException(status_code=404, detail="Not a file")

    return FileResponse(str(target))


@app.get("/health")
async def health():
    return {"status": "ok"}
