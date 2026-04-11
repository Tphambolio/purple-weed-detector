"""Cloud Function — Gemini proxy.

Faithful Python port of web/functions/api/gemini.js (the Cloudflare Pages
Function it replaces). Same request/response shape so the frontend needs
zero behavioural changes — only the base URL flips.

Configuration:
  - GEMINI_API_KEY is fetched from Secret Manager (secret name "gemini-api-key").
    Cached at cold start so warm invocations don't re-hit Secret Manager.
  - ACCESS_PASSWORD is read from the function's environment variable
    (set via `gcloud functions deploy --set-env-vars`). It is NOT a secret —
    if you want it in Secret Manager too, replicate the _get_api_key pattern.

Deploy with deploy.sh, which wires up the Secret Manager binding via
`--set-secrets` and the password env var via `--set-env-vars`.

Entry point: gemini_proxy
"""

from __future__ import annotations

import json
import os
from typing import Optional

import functions_framework
import requests
from google.cloud import secretmanager

MODEL = "gemini-2.5-flash"
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{MODEL}:generateContent"
)
SECRET_NAME = "gemini-api-key"

# Cold-start cache for the API key. Populated on the first request.
_API_KEY: Optional[str] = None


def _cors_headers(extra: Optional[dict] = None) -> dict:
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Access-Password",
    }
    if extra:
        headers.update(extra)
    return headers


def _get_api_key() -> Optional[str]:
    """Fetch the Gemini API key from Secret Manager. Cached after first call.

    Project discovery order:
      1. google.auth.default() — works in Cloud Run / Functions gen2 via the
         metadata server, no env vars required
      2. GCP_PROJECT / GOOGLE_CLOUD_PROJECT env vars (gen1 convention, kept
         as a fallback so the function still runs locally with `functions-framework`)
    """
    global _API_KEY
    if _API_KEY is not None:
        return _API_KEY

    project_id = None
    try:
        import google.auth
        _, project_id = google.auth.default()
    except Exception:
        project_id = None

    if not project_id:
        project_id = os.environ.get("GCP_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT")

    if not project_id:
        return None

    try:
        client = secretmanager.SecretManagerServiceClient()
        name = f"projects/{project_id}/secrets/{SECRET_NAME}/versions/latest"
        response = client.access_secret_version(request={"name": name})
        _API_KEY = response.payload.data.decode("utf-8")
        return _API_KEY
    except Exception:
        return None


@functions_framework.http
def gemini_proxy(request):
    """HTTP entry point. Same contract as the Cloudflare Pages Function."""
    # CORS preflight.
    if request.method == "OPTIONS":
        return ("", 204, _cors_headers())

    if request.method != "POST":
        return ("Method not allowed", 405, _cors_headers())

    api_key = _get_api_key()
    if not api_key:
        return (
            "GEMINI_API_KEY not configured (Secret Manager fetch failed)",
            500,
            _cors_headers(),
        )

    access_password = os.environ.get("ACCESS_PASSWORD")
    if not access_password:
        return ("ACCESS_PASSWORD not configured", 500, _cors_headers())

    supplied = request.headers.get("X-Access-Password", "") or ""
    if supplied != access_password:
        return ("Unauthorized", 401, _cors_headers())

    body = request.get_json(silent=True)
    if body is None:
        return ("Invalid JSON body", 400, _cors_headers())

    image_b64 = body.get("image_b64")
    prompt = body.get("prompt")
    if not image_b64 or not prompt:
        return ("Missing image_b64 or prompt", 400, _cors_headers())

    # Few-shot examples (Feature 3B): optional list of {b64, label}.
    # Cap at 6 to keep prompt size sane. Backwards compatible — if absent,
    # behavior is identical to v1.
    examples = body.get("examples") or []
    if not isinstance(examples, list):
        examples = []

    parts = []
    for i, ex in enumerate(examples[:6]):
        if not isinstance(ex, dict):
            continue
        ex_b64 = ex.get("b64")
        ex_label = ex.get("label") or "reference"
        if not ex_b64:
            continue
        parts.append({"text": f"Example {i + 1} — {ex_label}:"})
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": ex_b64}})
    if parts:
        parts.append({"text": "Now classify this crop using the examples above as calibration:"})
    parts.append({"inline_data": {"mime_type": "image/jpeg", "data": image_b64}})
    parts.append({"text": prompt})

    gemini_body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "maxOutputTokens": 512,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }

    try:
        upstream = requests.post(
            GEMINI_URL,
            params={"key": api_key},
            json=gemini_body,
            timeout=60,
        )
    except requests.RequestException as e:
        return (f"Gemini upstream error: {str(e)[:300]}", 502, _cors_headers())

    if not upstream.ok:
        return (
            f"Gemini upstream {upstream.status_code}: {upstream.text[:300]}",
            502,
            _cors_headers(),
        )

    try:
        data = upstream.json()
    except ValueError:
        return ("Gemini returned non-JSON response", 502, _cors_headers())

    text = ""
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"] or ""
    except (KeyError, IndexError, TypeError):
        text = ""

    return (
        json.dumps({"text": text}),
        200,
        _cors_headers({"Content-Type": "application/json"}),
    )
