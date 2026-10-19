"""Use Panel's existing local transcription service without storing audio or text.

The browser calls Kinema on its own origin, including under Panel's app prefix.
Only this fixed local route is reachable; caller input never selects a server.
Readiness checks whether the route is reachable, not whether a microphone works.
"""
from __future__ import annotations

import httpx
import re
from fastapi import APIRouter, UploadFile, Form
from fastapi.responses import JSONResponse

router = APIRouter()
ENDPOINT = "http://127.0.0.1:8770/api/chat/transcribe"
MAX_BYTES = 25_000_000
MIMES = {"audio/webm", "video/webm", "audio/ogg", "audio/mp4", "audio/x-m4a",
         "audio/wav", "audio/x-wav", "audio/mpeg", "application/octet-stream"}


@router.get("/api/dictation/status")
async def status():
    try:
        async with httpx.AsyncClient(trust_env=False, timeout=3.0, follow_redirects=False) as client:
            response = await client.get(ENDPOINT)
        # The existing POST-only route returns 405 to this read-only check.
        available = response.status_code == 405 and "POST" in response.headers.get("allow", "").upper()
    except httpx.HTTPError:
        available = False
    return {"available": available, "reason": "" if available else "Panel's local dictation service is unavailable. Open Panel and try again."}


@router.post("/api/dictation/transcribe")
async def transcribe(file: UploadFile, live: bool = Form(False),
                     final: bool = Form(False), language: str | None = Form(None)):
    try:
        # Match Panel's live WAV snapshot contract. Do not silently send live
        # audio through its separate full-recording path or lose the language hint.
        hint = (language or "").strip().lower().split("-")[0].split("_")[0]
        if hint and not re.fullmatch(r"[a-z]{2,3}", hint):
            return JSONResponse({"error": "Unsupported dictation language. Omit language for automatic detection."}, status_code=422)
        mime = (file.content_type or "application/octet-stream").split(";", 1)[0].lower()
        if mime not in MIMES:
            return JSONResponse({"error": "Choose an audio recording."}, status_code=415)
        raw = await file.read(MAX_BYTES + 1)
        if not raw:
            return JSONResponse({"error": "The recording is empty."}, status_code=422)
        if len(raw) > MAX_BYTES:
            return JSONResponse({"error": "The recording is over 25 MB. Use a shorter recording."}, status_code=413)
        try:
            async with httpx.AsyncClient(trust_env=False, timeout=httpx.Timeout(85.0, connect=3.0), follow_redirects=False) as client:
                fields = {"live": "1" if live else "0", "final": "1" if final else "0"}
                if hint:
                    fields["language"] = hint
                response = await client.post(ENDPOINT, data=fields, files={"file": ("dictation", raw, mime)})
        except httpx.TimeoutException:
            return JSONResponse({"error": "Dictation took too long. Your typed draft is kept."}, status_code=504)
        except httpx.HTTPError:
            return JSONResponse({"error": "Panel's local dictation service is unavailable. Your typed draft is kept."}, status_code=503)
        if response.status_code == 429:
            return JSONResponse({"error": "Dictation is busy. Try again shortly."}, status_code=429, headers={"Retry-After": "1"})
        if response.status_code == 422:
            # The browser retries once without an unsupported language hint.
            # Preserve that machine-readable condition, but not arbitrary logs.
            try:
                detail = response.json()
                unsupported = isinstance(detail, dict) and "unsupported dictation language" in str(detail.get("error", "")).lower()
            except (ValueError, TypeError):
                unsupported = False
            error = ("Unsupported dictation language. Omit language for automatic detection." if unsupported else
                     "The audio could not be read. Your typed draft is kept.")
            return JSONResponse({"error": error}, status_code=422)
        if response.status_code == 413:
            return JSONResponse({"error": "The recording is too large. Use a shorter recording."}, status_code=413)
        if not response.is_success:
            # Do not relay internal paths, model logs or HTML from the service.
            return JSONResponse({"error": "The recording could not be transcribed. Your typed draft is kept."}, status_code=502)
        try:
            result = response.json()
            text = result.get("text") if isinstance(result, dict) else None
            if not isinstance(text, str):
                raise ValueError("missing text")
        except (ValueError, TypeError):
            return JSONResponse({"error": "Dictation returned an unreadable response. Your typed draft is kept."}, status_code=502)
        return {"text": text.strip(), "lang": result.get("lang")}
    finally:
        await file.close()
