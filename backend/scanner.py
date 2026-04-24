"""
Folder scanner — iterates images, finds purple blobs, asks Gemini what each is.
Yields ScanStatus objects for SSE streaming. Supports both local folders
and Google Drive folders.
"""
import asyncio
import os
from pathlib import Path
from typing import AsyncGenerator, List

import cv2

from analyzer import analyze_crop
from database import cache_result, get_cached_result
from models import Detection, PhotoResult, ScanStatus, WeedType
from prefilter import find_purple_blobs

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tiff", ".tif"}


def _allowed_roots() -> list[Path]:
    """Whitelist of directories the scanner may traverse. Set via env
    SCAN_ROOTS=/path/one:/path/two. Defaults to the user's home dir."""
    raw = os.getenv("SCAN_ROOTS")
    if raw:
        roots = [Path(p).expanduser().resolve() for p in raw.split(os.pathsep) if p.strip()]
    else:
        roots = [Path.home().resolve()]
    return roots


def validate_scan_root(folder: str) -> Path:
    """Resolve the folder, follow symlinks, and confirm it lives under an
    allowed root. Raises ValueError with a user-safe message."""
    if not folder or not folder.strip():
        raise ValueError("Folder path is required")
    try:
        resolved = Path(folder).expanduser().resolve(strict=True)
    except (FileNotFoundError, OSError):
        raise ValueError(f"Folder not found: {folder}")
    if not resolved.is_dir():
        raise ValueError(f"Not a directory: {folder}")

    roots = _allowed_roots()
    for root in roots:
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    allowed = ", ".join(str(r) for r in roots)
    raise ValueError(f"Folder is outside allowed roots ({allowed})")


async def _process_image(
    local_path: str,
    display_name: str,
    weeds: List[WeedType],
    force_rescan: bool,
) -> tuple[PhotoResult, bool]:
    """Run blob detection + per-blob Gemini classification on a local file.
    Returns (result, from_cache)."""
    if not force_rescan:
        cached = get_cached_result(local_path)
        if cached:
            return cached, True

    result = PhotoResult(
        path=local_path,
        filename=display_name,
        has_purple=False,
        status="processing",
    )

    # Stage 1: cheap OpenCV blob detection.
    try:
        blobs, dims = await asyncio.to_thread(find_purple_blobs, local_path)
    except Exception as e:
        result.status = "error"
        result.description = f"prefilter failed: {e}"[:200]
        cache_result(result)
        return result, False

    if dims:
        result.width, result.height = dims

    if not blobs:
        result.has_purple = False
        result.detected = False
        result.status = "skipped"
        cache_result(result)
        return result, False

    result.has_purple = True

    # Load the image once so all blobs share the same decode.
    img = await asyncio.to_thread(cv2.imread, local_path)
    if img is None:
        result.status = "error"
        result.description = "cv2.imread returned None"
        cache_result(result)
        return result, False

    # Stage 2: per-blob Gemini classification.
    detections: list[Detection] = []
    first_match: Detection | None = None
    for blob in blobs:
        det = Detection(
            x=blob.x, y=blob.y, w=blob.w, h=blob.h,
            cx=blob.cx, cy=blob.cy, area_px=blob.area,
        )
        try:
            analysis = await analyze_crop(img, blob, weeds)
            det.species = analysis.get("species")
            det.confidence = analysis.get("confidence")
            det.description = analysis.get("description")
            det.is_match = bool(analysis.get("is_plant"))
        except Exception as e:
            det.species = None
            det.confidence = "low"
            det.description = f"analyzer error: {e}"[:200]
            det.is_match = False

        detections.append(det)
        if det.is_match and first_match is None:
            first_match = det

    result.detections = detections
    result.detected = first_match is not None
    if first_match is not None:
        result.species = first_match.species
        result.confidence = first_match.confidence
        result.description = first_match.description
    else:
        result.species = None
        result.confidence = None
        result.description = f"{len(detections)} purple blob(s); none confirmed as target weed"
    result.status = "analyzed"

    cache_result(result)
    return result, False


async def scan_folder(
    folder: str,
    weeds: List[WeedType],
    force_rescan: bool = False,
) -> AsyncGenerator[ScanStatus, None]:

    try:
        folder_path = validate_scan_root(folder)
    except ValueError as e:
        yield ScanStatus(status="error", total=0, processed=0, detected=0,
                         current_file=str(e))
        return

    def _iter_images():
        for p in folder_path.rglob("*"):
            if not p.is_file() or p.is_symlink():
                continue
            if p.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            try:
                p.resolve(strict=True).relative_to(folder_path)
            except (ValueError, OSError):
                continue
            yield p

    images = sorted(_iter_images())

    total = len(images)
    processed = 0
    detected = 0

    yield ScanStatus(status="scanning", total=total, processed=0, detected=0)

    for img_path in images:
        result, _from_cache = await _process_image(
            str(img_path), img_path.name, weeds, force_rescan,
        )
        processed += 1
        if result.detected:
            detected += 1

        yield ScanStatus(
            status="scanning", total=total,
            processed=processed, detected=detected,
            current_file=img_path.name, result=result,
        )
        await asyncio.sleep(0)

    yield ScanStatus(status="complete", total=total, processed=processed, detected=detected)


async def scan_drive_folder(
    folder_url_or_id: str,
    weeds: List[WeedType],
    force_rescan: bool = False,
) -> AsyncGenerator[ScanStatus, None]:
    """Scan a Google Drive folder. Lazy-imports drive.py so the local
    scanner still works without google-api-python-client installed."""
    try:
        from drive import list_images, download_to_cache
    except Exception as e:
        yield ScanStatus(status="error", total=0, processed=0, detected=0,
                         current_file=f"Drive integration unavailable: {e}")
        return

    try:
        images = await asyncio.to_thread(list_images, folder_url_or_id, True)
    except Exception as e:
        yield ScanStatus(status="error", total=0, processed=0, detected=0,
                         current_file=f"Drive list failed: {e}")
        return

    total = len(images)
    processed = 0
    detected = 0

    yield ScanStatus(status="scanning", total=total, processed=0, detected=0)

    for img in images:
        try:
            local_path = await asyncio.to_thread(download_to_cache, img)
        except Exception as e:
            processed += 1
            err_result = PhotoResult(
                path=f"drive://{img.file_id}",
                filename=img.name,
                has_purple=False,
                status="error",
                description=f"Download failed: {e}"[:200],
            )
            yield ScanStatus(
                status="scanning", total=total,
                processed=processed, detected=detected,
                current_file=img.name, result=err_result,
            )
            await asyncio.sleep(0)
            continue

        result, _from_cache = await _process_image(
            str(local_path), img.name, weeds, force_rescan,
        )
        processed += 1
        if result.detected:
            detected += 1

        yield ScanStatus(
            status="scanning", total=total,
            processed=processed, detected=detected,
            current_file=img.name, result=result,
        )
        await asyncio.sleep(0)

    yield ScanStatus(status="complete", total=total, processed=processed, detected=detected)
