from pydantic import BaseModel
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


class PhotoResult(BaseModel):
    path: str
    filename: str
    has_purple: bool
    detected: Optional[bool] = None
    species: Optional[str] = None
    confidence: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    status: str = "pending"  # pending | processing | analyzed | skipped | error


class ScanStatus(BaseModel):
    status: str  # scanning | complete | error
    total: int
    processed: int
    detected: int
    current_file: Optional[str] = None
    result: Optional[PhotoResult] = None
