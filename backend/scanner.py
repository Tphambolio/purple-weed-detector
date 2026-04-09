"""
Folder scanner — iterates images, applies pre-filter, then Claude Vision.
Yields ScanStatus objects for SSE streaming.
"""
import asyncio
from pathlib import Path
from typing import AsyncGenerator, List

from models import PhotoResult, ScanStatus, WeedType
from prefilter import has_purple
from analyzer import analyze_image
from database import get_cached_result, cache_result

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tiff", ".tif"}


async def scan_folder(
    folder: str,
    weeds: List[WeedType],
    force_rescan: bool = False,
) -> AsyncGenerator[ScanStatus, None]:

    folder_path = Path(folder)
    if not folder_path.exists() or not folder_path.is_dir():
        yield ScanStatus(status="error", total=0, processed=0, detected=0,
                         current_file=f"Folder not found: {folder}")
        return

    images = sorted(
        p for p in folder_path.rglob("*")
        if p.suffix.lower() in IMAGE_EXTENSIONS
    )

    total = len(images)
    processed = 0
    detected = 0

    yield ScanStatus(status="scanning", total=total, processed=0, detected=0)

    for img_path in images:
        str_path = str(img_path)

        # Return cached result if available and not force-rescanning
        if not force_rescan:
            cached = get_cached_result(str_path)
            if cached:
                processed += 1
                if cached.detected:
                    detected += 1
                yield ScanStatus(
                    status="scanning", total=total,
                    processed=processed, detected=detected,
                    current_file=img_path.name, result=cached,
                )
                await asyncio.sleep(0)
                continue

        result = PhotoResult(
            path=str_path,
            filename=img_path.name,
            has_purple=False,
            status="processing",
        )

        # Stage 1: cheap OpenCV pre-filter
        try:
            has_p, ratio = has_purple(str_path)
            result.has_purple = has_p
        except Exception:
            has_p = False
            result.has_purple = False

        if has_p:
            # Stage 2: Claude Vision
            try:
                analysis = await analyze_image(str_path, weeds)
                result.detected = analysis.get("detected", False)
                result.species = analysis.get("species")
                result.confidence = analysis.get("confidence")
                result.location = analysis.get("location")
                result.description = analysis.get("description")
                result.status = "analyzed"
            except Exception as e:
                result.detected = None
                result.description = str(e)[:200]
                result.status = "error"
        else:
            result.detected = False
            result.status = "skipped"

        cache_result(result)

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
