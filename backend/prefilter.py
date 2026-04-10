"""
OpenCV blob detector — finds individual purple plant clusters in aerial photos.
Returns precise pixel coordinates for each candidate so we can crop tight
windows for Gemini species ID.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

import cv2
import numpy as np

# Purple HSV range — covers violet through magenta-purple
PURPLE_LOWER = np.array([120, 30, 30])
PURPLE_UPPER = np.array([165, 255, 255])

# Tuned for ~150 m AGL DJI Mavic 3 photos (~3.75 cm/px GSD).
# A single ~1 m purple loosestrife clump is ~27 px wide → ~570 px area.
# Smallest detectable flower spike (~30 cm) is ~8 px wide → ~50 px area.
MIN_AREA_PX = 30
MAX_AREA_PX = 100_000  # rejects huge solid purple objects (tarp, jacket, dye)
MAX_BLOBS_PER_IMAGE = 20  # cap API spend on dense fields

# Morphological closing kernel — merges nearby purple pixels of the same plant.
CLOSE_KERNEL = np.ones((9, 9), np.uint8)


@dataclass
class Blob:
    x: int
    y: int
    w: int
    h: int
    cx: int
    cy: int
    area: int


def find_purple_blobs(
    image_path: str,
    min_area: int = MIN_AREA_PX,
    max_area: int = MAX_AREA_PX,
    max_blobs: int = MAX_BLOBS_PER_IMAGE,
) -> tuple[List[Blob], Optional[tuple[int, int]]]:
    """
    Returns (blobs, (width, height)). Blobs are in NATIVE image pixel coords,
    sorted by area descending and capped at max_blobs.
    """
    img = cv2.imread(str(image_path))
    if img is None:
        return [], None

    h_img, w_img = img.shape[:2]

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, PURPLE_LOWER, PURPLE_UPPER)

    # Close gaps between adjacent purple pixels so a single plant becomes one blob.
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, CLOSE_KERNEL)

    num_labels, _labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)

    blobs: List[Blob] = []
    # Label 0 is background — skip it.
    for i in range(1, num_labels):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < min_area or area > max_area:
            continue
        blobs.append(Blob(
            x=int(stats[i, cv2.CC_STAT_LEFT]),
            y=int(stats[i, cv2.CC_STAT_TOP]),
            w=int(stats[i, cv2.CC_STAT_WIDTH]),
            h=int(stats[i, cv2.CC_STAT_HEIGHT]),
            cx=int(centroids[i, 0]),
            cy=int(centroids[i, 1]),
            area=area,
        ))

    blobs.sort(key=lambda b: b.area, reverse=True)
    return blobs[:max_blobs], (w_img, h_img)
