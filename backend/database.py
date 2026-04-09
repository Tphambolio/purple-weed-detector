"""
SQLite cache — avoids re-scanning photos that haven't changed.
"""
import sqlite3
from pathlib import Path
from typing import Optional

from models import PhotoResult

DB_PATH = Path(__file__).parent / "results.db"


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


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
    conn.commit()
    conn.close()


def get_cached_result(path: str) -> Optional[PhotoResult]:
    conn = _get_db()
    row = conn.execute("SELECT * FROM results WHERE path = ?", (path,)).fetchone()
    conn.close()
    if not row:
        return None
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
    )


def cache_result(result: PhotoResult):
    conn = _get_db()
    conn.execute(
        """
        INSERT OR REPLACE INTO results
            (path, filename, has_purple, detected, species, confidence, location, description, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            result.path, result.filename, result.has_purple,
            result.detected, result.species, result.confidence,
            result.location, result.description, result.status,
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
    return [
        PhotoResult(
            path=r["path"], filename=r["filename"],
            has_purple=bool(r["has_purple"]),
            detected=bool(r["detected"]) if r["detected"] is not None else None,
            species=r["species"], confidence=r["confidence"],
            location=r["location"], description=r["description"],
            status=r["status"],
        )
        for r in rows
    ]


# Initialize on import
init_db()
