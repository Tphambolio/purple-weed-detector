"""
Claude Vision analysis for purple weed identification.
Uses claude-haiku-4-5 (fast + cheap) for per-photo classification.
"""
import anthropic
import base64
import json
from pathlib import Path
from typing import List

from models import WeedType

client = anthropic.AsyncAnthropic()

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


def build_prompt(weeds: List[WeedType]) -> str:
    if WeedType.ANY in weeds:
        target = "any purple or magenta flowering weed or invasive plant species"
        species_hint = "Common Alberta invasive purple weeds: Purple Loosestrife (Lythrum salicaria), Canada Thistle (Cirsium arvense), Nodding Thistle (Carduus nutans), Dame's Rocket (Hesperis matronalis)."
    else:
        targets = [WEED_DESCRIPTIONS[w] for w in weeds if w in WEED_DESCRIPTIONS]
        target = "; ".join(targets)
        species_hint = ""

    return f"""Analyze this photo for the presence of {target}.
{species_hint}

Respond ONLY with a JSON object — no markdown, no extra text:
{{
  "detected": true or false,
  "species": "species name or null if none found",
  "confidence": "high" | "medium" | "low",
  "location": "where in the image (e.g. center foreground, bottom-left)",
  "description": "one sentence describing what you see"
}}"""


async def analyze_image(image_path: str, weeds: List[WeedType]) -> dict:
    path = Path(image_path)
    media_type = MEDIA_TYPES.get(path.suffix.lower(), "image/jpeg")

    with open(path, "rb") as f:
        image_data = base64.standard_b64encode(f.read()).decode("utf-8")

    message = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": image_data,
                    },
                },
                {
                    "type": "text",
                    "text": build_prompt(weeds),
                },
            ],
        }],
    )

    text = message.content[0].text.strip()

    # Strip markdown code fences if the model wraps the JSON
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1].lstrip("json").strip() if len(parts) > 1 else text

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {
            "detected": False,
            "species": None,
            "confidence": "low",
            "location": None,
            "description": text[:200],
        }
