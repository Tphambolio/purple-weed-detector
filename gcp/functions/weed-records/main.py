"""Cloud Function — Weed Records.

Persistent storage for confirmed weed detections, backed by Firestore in the
same GCP project as the gemini-proxy. Two routes via the `op` query parameter:

  GET  /?op=list                  → list all detection records (paginated)
  POST /?op=submit                → upsert a detection record (idempotent by id)

The frontend writes through this proxy instead of using the Firebase JS SDK
directly so:
  1. The Firestore credentials never reach the browser (uses Cloud Function ADC)
  2. Schema validation happens server-side, not client-side
  3. Bundle stays slim (no Firebase SDK)

Records collection:  `weed_detections`
Document ID:         hash + '_' + blob_index   (idempotent across re-submits)
Required fields:     species_id, color_class, photo_hash, blob_index
Indexed fields:      species_id, photo_date, location.geohash

Geohash for radial queries — 8-character precision (~38 m bbox), good enough
for "show me all loosestrife within 5 km of this point" without pulling every
record. Computed at submit time so we don't depend on a Firestore extension.
"""

from __future__ import annotations

import json
import os
import time
from typing import Optional

import functions_framework
from google.cloud import firestore

COLLECTION = "weed_detections"

# Lazily-initialised global client. Shared across warm invocations.
_db: Optional[firestore.Client] = None


def _get_db() -> firestore.Client:
    global _db
    if _db is None:
        _db = firestore.Client()
    return _db


def _cors_headers(extra: Optional[dict] = None) -> dict:
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "3600",
    }
    if extra:
        headers.update(extra)
    return headers


# ───────────────────────── Geohash (pure Python) ─────────────────────────
# Standard base32 geohash, 8 characters ≈ ±19 m precision. No external deps.

_GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def encode_geohash(lat: float, lng: float, precision: int = 8) -> str:
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
        return ""
    lat_lo, lat_hi = -90.0, 90.0
    lng_lo, lng_hi = -180.0, 180.0
    bits = []
    even = True  # toggle: True = longitude, False = latitude
    while len(bits) < precision * 5:
        if even:
            mid = (lng_lo + lng_hi) / 2
            if lng >= mid:
                bits.append(1); lng_lo = mid
            else:
                bits.append(0); lng_hi = mid
        else:
            mid = (lat_lo + lat_hi) / 2
            if lat >= mid:
                bits.append(1); lat_lo = mid
            else:
                bits.append(0); lat_hi = mid
        even = not even
    out = []
    for i in range(0, len(bits), 5):
        idx = (bits[i] << 4) | (bits[i+1] << 3) | (bits[i+2] << 2) | (bits[i+3] << 1) | bits[i+4]
        out.append(_GEOHASH_BASE32[idx])
    return "".join(out)


# ───────────────────────── Validation ─────────────────────────

REQUIRED_FIELDS = ("species_id", "color_class", "photo_hash", "blob_index")


def validate_record(rec: dict) -> Optional[str]:
    """Return an error message if the record is invalid, else None."""
    if not isinstance(rec, dict):
        return "record must be an object"
    for f in REQUIRED_FIELDS:
        if rec.get(f) in (None, ""):
            return f"missing required field: {f}"
    if not isinstance(rec.get("blob_index"), int):
        return "blob_index must be an integer"
    loc = rec.get("location")
    if loc is not None:
        if not isinstance(loc, dict):
            return "location must be an object"
        try:
            lat = float(loc.get("lat"))
            lng = float(loc.get("lng"))
        except (TypeError, ValueError):
            return "location.lat and location.lng must be numbers"
        if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
            return "location out of range"
    return None


def normalize_record(rec: dict) -> dict:
    """Whitelist + enrich a record before writing to Firestore."""
    out = {
        # Identity
        "photo_hash": str(rec["photo_hash"]),
        "blob_index": int(rec["blob_index"]),
        # Species & verdict
        "species_id": str(rec["species_id"]),
        "species_label": str(rec.get("species_label", rec["species_id"])),
        "color_class": str(rec["color_class"]),
        "confidence": str(rec.get("confidence", "low")),
        "is_match": bool(rec.get("is_match", True)),
        "human_verdict": rec.get("human_verdict") or None,
        "human_species": rec.get("human_species") or None,
        "description": (rec.get("description") or "")[:500],
        # Photo metadata
        "photo_filename": (rec.get("photo_filename") or "")[:200],
        "photo_date": rec.get("photo_date") or None,
        "photo_camera": (rec.get("photo_camera") or "")[:80],
        # Bbox geometry
        "bbox": rec.get("bbox") or None,
        # Optional thumbnail (small base64 JPEG)
        "thumb_b64": (rec.get("thumb_b64") or "")[:32_000],
        # Server timestamps
        "submitted_at": int(time.time() * 1000),
    }

    loc = rec.get("location")
    if loc and isinstance(loc, dict) and loc.get("lat") is not None and loc.get("lng") is not None:
        lat = float(loc["lat"])
        lng = float(loc["lng"])
        out["location"] = {
            "lat": lat,
            "lng": lng,
            "altitude": loc.get("altitude"),
            "geohash": encode_geohash(lat, lng, 8),
        }
    else:
        out["location"] = None

    return out


# ───────────────────────── Routes ─────────────────────────

def handle_submit(request) -> tuple:
    body = request.get_json(silent=True)
    if body is None:
        return ("Invalid JSON body", 400, _cors_headers())

    # Accept either a single record or a batch
    records = body if isinstance(body, list) else [body]
    if len(records) > 100:
        return ("batch limit is 100 records per request", 400, _cors_headers())

    db = _get_db()
    coll = db.collection(COLLECTION)
    ids = []
    errors = []

    for rec in records:
        err = validate_record(rec)
        if err:
            errors.append({"record": rec.get("photo_hash"), "error": err})
            continue
        normalized = normalize_record(rec)
        # Idempotent doc id: photo_hash + blob_index. Re-submitting overwrites.
        doc_id = f"{normalized['photo_hash']}_{normalized['blob_index']}"
        try:
            coll.document(doc_id).set(normalized, merge=True)
            ids.append(doc_id)
        except Exception as e:  # pragma: no cover — Firestore errors are surfaced
            errors.append({"record": doc_id, "error": str(e)[:200]})

    return (
        json.dumps({"submitted": len(ids), "ids": ids, "errors": errors}),
        200,
        _cors_headers({"Content-Type": "application/json"}),
    )


def handle_list(request) -> tuple:
    """List records, optionally filtered by species or limited count."""
    species = request.args.get("species")
    limit_str = request.args.get("limit", "500")
    try:
        limit = max(1, min(2000, int(limit_str)))
    except ValueError:
        limit = 500

    db = _get_db()
    coll = db.collection(COLLECTION)
    query = coll
    if species:
        query = query.where("species_id", "==", species)
    # Newest first
    query = query.order_by("submitted_at", direction=firestore.Query.DESCENDING).limit(limit)

    out = []
    for snap in query.stream():
        d = snap.to_dict()
        d["id"] = snap.id
        # Strip large fields by default to keep the payload small.
        # Frontend can fetch full record by id later if it needs the thumb.
        if d.get("thumb_b64") and len(d["thumb_b64"]) > 0 and request.args.get("thumbs") != "1":
            d["thumb_b64"] = None
        out.append(d)

    return (
        json.dumps({"count": len(out), "records": out}),
        200,
        _cors_headers({"Content-Type": "application/json"}),
    )


def handle_delete(request) -> tuple:
    """Delete a record by id (admin / cleanup use)."""
    rec_id = request.args.get("id")
    if not rec_id:
        return ("missing id", 400, _cors_headers())
    try:
        _get_db().collection(COLLECTION).document(rec_id).delete()
    except Exception as e:
        return (f"delete failed: {str(e)[:200]}", 500, _cors_headers())
    return (
        json.dumps({"deleted": rec_id}),
        200,
        _cors_headers({"Content-Type": "application/json"}),
    )


@functions_framework.http
def weed_records(request):
    """HTTP entry point. Routes by `?op=` query parameter.

    Routes:
      OPTIONS *               → CORS preflight
      GET  /?op=list          → list records (with optional &species=, &limit=)
      POST /?op=submit        → upsert single record OR batch (array body)
      POST /?op=delete&id=…   → delete a record by id
    """
    if request.method == "OPTIONS":
        return ("", 204, _cors_headers())

    op = request.args.get("op", "")

    if request.method == "GET" and op == "list":
        return handle_list(request)
    if request.method == "POST" and op == "submit":
        return handle_submit(request)
    if request.method == "POST" and op == "delete":
        return handle_delete(request)

    return (
        json.dumps({"error": f"unknown route: {request.method} ?op={op}"}),
        400,
        _cors_headers({"Content-Type": "application/json"}),
    )
