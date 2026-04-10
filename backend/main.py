from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path

from models import ScanRequest, DriveScanRequest
from scanner import scan_folder, scan_drive_folder
from database import get_folder_results

app = FastAPI(title="Purple Weed Detector API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
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
async def serve_image(path: str = Query(..., description="Absolute path to local image")):
    """Proxy a local image file so the browser can display it."""
    p = Path(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(str(p))


@app.get("/health")
async def health():
    return {"status": "ok"}
