from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum


class WeedType(str, Enum):
    ANY = "any"
    LOOSESTRIFE = "purple_loosestrife"
    THISTLE = "thistle"
    DAMES_ROCKET = "dames_rocket"


class ScanRequest(BaseModel):
    folder: str
    weeds: List[WeedType] = [WeedType.ANY]
    force_rescan: bool = False


class DriveScanRequest(BaseModel):
    folder: str  # Drive folder URL or bare folder ID
    weeds: List[WeedType] = [WeedType.ANY]
    force_rescan: bool = False


class Detection(BaseModel):
    """One identified plant in an image. Coordinates are in native pixels."""
    x: int           # bbox top-left x
    y: int           # bbox top-left y
    w: int           # bbox width
    h: int           # bbox height
    cx: int          # centroid x
    cy: int          # centroid y
    area_px: int     # purple-pixel area inside the blob
    species: Optional[str] = None
    confidence: Optional[str] = None  # high | medium | low
    description: Optional[str] = None
    is_match: bool = False  # Gemini confirmed it as a target weed


class PhotoResult(BaseModel):
    path: str
    filename: str
    has_purple: bool
    detected: Optional[bool] = None  # True if any detection.is_match
    species: Optional[str] = None    # representative species (first match)
    confidence: Optional[str] = None
    location: Optional[str] = None   # legacy — kept for older cache rows
    description: Optional[str] = None
    status: str = "pending"  # pending | processing | analyzed | skipped | error
    width: Optional[int] = None
    height: Optional[int] = None
    detections: List[Detection] = Field(default_factory=list)


class ScanStatus(BaseModel):
    status: str  # scanning | complete | error
    total: int
    processed: int
    detected: int
    current_file: Optional[str] = None
    result: Optional[PhotoResult] = None
