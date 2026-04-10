"""
Gemini Vision analysis. Two entry points:
  - analyze_image: full-image classification (legacy)
  - analyze_crop:  per-blob crop classification (used by the survey pipeline)

Uses gemini-2.5-flash with thinking disabled for fast structured JSON output.
"""
import asyncio
import json
import os
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np
from google import genai
from google.genai import types

from models import WeedType
from prefilter import Blob

MODEL = "gemini-2.5-flash"

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

WEED_DESCRIPTIONS = {
    WeedType.LOOSESTRIFE: "Purple Loosestrife (Lythrum salicaria) — tall spikes of magenta-purple flowers, wetland edges",
    WeedType.THISTLE: "thistle species (Canada Thistle Cirsium arvense, Nodding Thistle Carduus nutans) — spiny leaves, pink-purple flower heads",
    WeedType.DAMES_ROCKET: "Dame's Rocket (Hesperis matronalis) — 4-petalled purple/white flowers, common urban edges",
}

MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".tiff": "image/jpeg",
    ".tif": "image/jpeg",
}

# How much context to add around each blob, as a multiple of bbox size.
# A larger crop gives Gemini more visual context for species ID.
CROP_PADDING_RATIO = 1.5
# Minimum crop side in pixels — keeps crops sharp enough for the model.
MIN_CROP_SIDE = 384

_GEN_CONFIG = types.GenerateContentConfig(
    response_mime_type="application/json",
    max_output_tokens=512,
    # Gemini 2.5 Flash burns "thinking" tokens before output by default,
    # which truncates short structured responses. Disable for this task.
    thinking_config=types.ThinkingConfig(thinking_budget=0),
)


def _build_full_prompt(weeds: List[WeedType]) -> str:
    if WeedType.ANY in weeds:
        target = "any purple or magenta flowering weed or invasive plant species"
        species_hint = "Common Alberta invasive purple weeds: Purple Loosestrife (Lythrum salicaria), Canada Thistle (Cirsium arvense), Nodding Thistle (Carduus nutans), Dame's Rocket (Hesperis matronalis)."
    else:
        targets = [WEED_DESCRIPTIONS[w] for w in weeds if w in WEED_DESCRIPTIONS]
        target = "; ".join(targets)
        species_hint = ""

    return f"""Analyze this aerial photo for the presence of {target}.
{species_hint}

Respond ONLY with a JSON object — no markdown, no extra text:
{{
  "detected": true or false,
  "species": "species name or null if none found",
  "confidence": "high" | "medium" | "low",
  "location": "where in the image",
  "description": "one sentence describing what you see"
}}"""


def _build_crop_prompt(weeds: List[WeedType]) -> str:
    if WeedType.ANY in weeds:
        target = "any purple/magenta flowering weed or invasive plant"
        species_hint = "Possible species: Purple Loosestrife (Lythrum salicaria), Canada Thistle (Cirsium arvense), Nodding Thistle (Carduus nutans), Dame's Rocket (Hesperis matronalis)."
    else:
        targets = [WEED_DESCRIPTIONS[w] for w in weeds if w in WEED_DESCRIPTIONS]
        target = "; ".join(targets)
        species_hint = ""

    return f"""This is a tight crop from a drone aerial photo (~150 m altitude) centered on a purple object.
Identify whether the purple thing in this crop is {target}, or something else (purple non-plant: tarp, jacket, paint, dye, vehicle).
{species_hint}

Respond ONLY with a JSON object — no markdown, no extra text:
{{
  "is_plant": true or false,
  "species": "species name or 'unknown' or 'not a plant'",
  "confidence": "high" | "medium" | "low",
  "description": "one short sentence describing the purple object"
}}"""


def _parse_json(text: str) -> Optional[dict]:
    text = (text or "").strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1].lstrip("json").strip() if len(parts) > 1 else text
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


# ---------- Legacy: full-image analyzer (kept for the local-folder path) ----------

async def analyze_image(image_path: str, weeds: List[WeedType]) -> dict:
    path = Path(image_path)
    media_type = MEDIA_TYPES.get(path.suffix.lower(), "image/jpeg")

    with open(path, "rb") as f:
        image_bytes = f.read()

    response = await client.aio.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=media_type),
            _build_full_prompt(weeds),
        ],
        config=_GEN_CONFIG,
    )

    parsed = _parse_json(response.text)
    if parsed:
        return parsed
    return {
        "detected": False,
        "species": None,
        "confidence": "low",
        "location": None,
        "description": (response.text or "")[:200],
    }


# ---------- Survey: per-blob crop analyzer ----------

def _padded_crop(img: np.ndarray, blob: Blob) -> np.ndarray:
    h_img, w_img = img.shape[:2]

    # Pad each side proportional to bbox size, with a minimum total side length.
    pad_x = max(int(blob.w * CROP_PADDING_RATIO), (MIN_CROP_SIDE - blob.w) // 2)
    pad_y = max(int(blob.h * CROP_PADDING_RATIO), (MIN_CROP_SIDE - blob.h) // 2)

    x1 = max(0, blob.x - pad_x)
    y1 = max(0, blob.y - pad_y)
    x2 = min(w_img, blob.x + blob.w + pad_x)
    y2 = min(h_img, blob.y + blob.h + pad_y)

    return img[y1:y2, x1:x2]


def _crop_to_jpeg_bytes(img: np.ndarray, blob: Blob) -> bytes:
    crop = _padded_crop(img, blob)
    ok, buf = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    if not ok:
        raise RuntimeError("cv2.imencode failed")
    return buf.tobytes()


async def analyze_crop(
    img: np.ndarray,
    blob: Blob,
    weeds: List[WeedType],
) -> dict:
    """Crop a context window around the blob and ask Gemini what it is.
    Returns dict with is_plant / species / confidence / description."""
    crop_bytes = await asyncio.to_thread(_crop_to_jpeg_bytes, img, blob)

    response = await client.aio.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=crop_bytes, mime_type="image/jpeg"),
            _build_crop_prompt(weeds),
        ],
        config=_GEN_CONFIG,
    )

    parsed = _parse_json(response.text)
    if parsed:
        return parsed
    return {
        "is_plant": False,
        "species": "unknown",
        "confidence": "low",
        "description": (response.text or "")[:200],
    }
