"""
Google Drive integration — OAuth bootstrap, recursive image listing,
download-to-cache with modifiedTime-based invalidation.

First run pops a browser for OAuth consent. Subsequent runs use the cached
token at backend/.drive-token.json.
"""
from __future__ import annotations

import io
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

BACKEND_DIR = Path(__file__).parent
CREDENTIALS_FILE = BACKEND_DIR / "credentials.json"
TOKEN_FILE = BACKEND_DIR / ".drive-token.json"
CACHE_DIR = Path.home() / ".purple-weed-cache"

IMAGE_MIME_PREFIX = "image/"
SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tiff", ".tif"}
FOLDER_MIME = "application/vnd.google-apps.folder"

_FOLDER_ID_RE = re.compile(r"folders/([a-zA-Z0-9_-]+)")


@dataclass
class DriveImage:
    file_id: str
    name: str
    mime_type: str
    modified_time: str  # RFC3339 string from Drive API


def parse_folder_id(folder_url_or_id: str) -> str:
    """Accept a Drive folder URL or a bare folder ID."""
    s = folder_url_or_id.strip()
    m = _FOLDER_ID_RE.search(s)
    if m:
        return m.group(1)
    return s


def _load_credentials() -> Credentials:
    creds: Optional[Credentials] = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        _write_token(creds)
        return creds

    if not CREDENTIALS_FILE.exists():
        raise FileNotFoundError(
            f"Missing {CREDENTIALS_FILE}. Create an OAuth Desktop client in "
            "Google Cloud Console (Drive API enabled) and save the JSON there."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
    creds = flow.run_local_server(port=0)
    _write_token(creds)
    return creds


def _write_token(creds: Credentials) -> None:
    """Persist OAuth token with owner-only permissions (0600)."""
    TOKEN_FILE.write_text(creds.to_json())
    try:
        os.chmod(TOKEN_FILE, 0o600)
    except OSError:
        pass  # Windows / filesystems without POSIX perms


def _get_service():
    return build("drive", "v3", credentials=_load_credentials(), cache_discovery=False)


def list_images(folder_url_or_id: str, recursive: bool = True) -> list[DriveImage]:
    """List image files in a Drive folder. Recurses into subfolders by default."""
    service = _get_service()
    root_id = parse_folder_id(folder_url_or_id)
    images: list[DriveImage] = []
    stack: list[str] = [root_id]
    seen: set[str] = set()

    while stack:
        folder_id = stack.pop()
        if folder_id in seen:
            continue
        seen.add(folder_id)

        page_token: Optional[str] = None
        while True:
            resp = service.files().list(
                q=f"'{folder_id}' in parents and trashed = false",
                fields="nextPageToken, files(id, name, mimeType, modifiedTime)",
                pageSize=1000,
                pageToken=page_token,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            ).execute()

            for f in resp.get("files", []):
                mime = f.get("mimeType", "")
                if mime == FOLDER_MIME:
                    if recursive:
                        stack.append(f["id"])
                    continue
                if not mime.startswith(IMAGE_MIME_PREFIX):
                    continue
                ext = Path(f["name"]).suffix.lower()
                if ext and ext not in SUPPORTED_EXTS:
                    continue
                images.append(DriveImage(
                    file_id=f["id"],
                    name=f["name"],
                    mime_type=mime,
                    modified_time=f.get("modifiedTime", ""),
                ))

            page_token = resp.get("nextPageToken")
            if not page_token:
                break

    images.sort(key=lambda i: i.name.lower())
    return images


def _safe_token(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]", "", s)


def cache_path_for(img: DriveImage) -> Path:
    """Stable local cache path. Encodes modifiedTime so a content change
    yields a new path — invalidating the SQLite results cache automatically."""
    ext = Path(img.name).suffix.lower() or ".jpg"
    mtime_token = _safe_token(img.modified_time) or "unknown"
    return CACHE_DIR / f"{img.file_id}_{mtime_token}{ext}"


def download_to_cache(img: DriveImage) -> Path:
    """Download the file to its stable cache path. No-op if already present."""
    target = cache_path_for(img)
    if target.exists() and target.stat().st_size > 0:
        return target

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    service = _get_service()
    request = service.files().get_media(fileId=img.file_id)

    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()

    tmp = target.with_suffix(target.suffix + ".part")
    tmp.write_bytes(buf.getvalue())
    os.replace(tmp, target)
    return target
