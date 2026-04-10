"""
SQLite cache — avoids re-scanning photos that haven't changed.
Schema is migrated forward in-place at import time.
"""
import json
import sqlite3
from pathlib import Path
from typing import Optional

from models import Detection, PhotoResult

DB_PATH = Path(__file__).parent / "results.db"


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _column_names(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def init_db():
    conn = _get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS results (
            path        TEXT PRIMARY KEY,
            filename    TEXT NOT NULL,
            has_purple  INTEGER NOT NULL,
            detected    INTEGER,
            species     TEXT,
            confidence  TEXT,
            location    TEXT,
            description TEXT,
            status      TEXT NOT NULL,
            scanned_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Forward migration: add new columns if they don't exist yet.
    existing = _column_names(conn, "results")
    for col, ddl in [
        ("width", "INTEGER"),
        ("height", "INTEGER"),
        ("detections_json", "TEXT"),
    ]:
        if col not in existing:
            conn.execute(f"ALTER TABLE results ADD COLUMN {col} {ddl}")
    conn.commit()
    conn.close()


def _row_to_result(row: sqlite3.Row) -> PhotoResult:
    detections: list[Detection] = []
    raw = row["detections_json"] if "detections_json" in row.keys() else None
    if raw:
        try:
            detections = [Detection(**d) for d in json.loads(raw)]
        except (json.JSONDecodeError, TypeError, ValueError):
            detections = []

    return PhotoResult(
        path=row["path"],
        filename=row["filename"],
        has_purple=bool(row["has_purple"]),
        detected=bool(row["detected"]) if row["detected"] is not None else None,
        species=row["species"],
        confidence=row["confidence"],
        location=row["location"],
        description=row["description"],
        status=row["status"],
        width=row["width"] if "width" in row.keys() else None,
        height=row["height"] if "height" in row.keys() else None,
        detections=detections,
    )


def get_cached_result(path: str) -> Optional[PhotoResult]:
    conn = _get_db()
    row = conn.execute("SELECT * FROM results WHERE path = ?", (path,)).fetchone()
    conn.close()
    return _row_to_result(row) if row else None


def cache_result(result: PhotoResult):
    conn = _get_db()
    detections_json = json.dumps([d.model_dump() for d in result.detections]) if result.detections else None
    conn.execute(
        """
        INSERT OR REPLACE INTO results
            (path, filename, has_purple, detected, species, confidence, location, description, status,
             width, height, detections_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            result.path, result.filename, result.has_purple,
            result.detected, result.species, result.confidence,
            result.location, result.description, result.status,
            result.width, result.height, detections_json,
        ),
    )
    conn.commit()
    conn.close()


def get_folder_results(folder: str) -> list[PhotoResult]:
    conn = _get_db()
    rows = conn.execute(
        "SELECT * FROM results WHERE path LIKE ? ORDER BY path",
        (f"{folder.rstrip('/')}%",),
    ).fetchall()
    conn.close()
    return [_row_to_result(r) for r in rows]


# Initialize on import
init_db()
