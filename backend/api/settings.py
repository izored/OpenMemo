"""User-configurable settings API (runtime, persisted as JSON)."""
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.core.app_settings import (
    background_present,
    cookies_present,
    delete_background,
    delete_cookies,
    get_background_path,
    get_settings,
    save_background,
    save_cookies,
    update_settings,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# A full multi-site export from the browser extension can reach a few hundred KB;
# cap generously but still hard, so a wrong file can't be dumped here.
_MAX_COOKIES_BYTES = 5 * 1024 * 1024  # 5 MB

# Custom background: store images up to 10 MB full-quality, as-is. Larger images
# route through a (future) lossless-compression seam, not implemented yet.
_MAX_BG_BYTES = 10 * 1024 * 1024  # 10 MB


class SettingsPatch(BaseModel):
    max_upload_mb: Optional[int] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    avatar_data_url: Optional[str] = None
    mailing_list_consent: Optional[bool] = None
    auto_download_audio: Optional[bool] = None


@router.get("")
async def read_settings():
    return get_settings()


@router.put("")
async def write_settings(patch: SettingsPatch):
    return update_settings(patch.model_dump(exclude_none=True))


def _looks_like_cookie_jar(text: str) -> bool:
    """Lenient Netscape cookies.txt check: a known header, or any data line with
    the 7 tab-separated columns (domain, flag, path, secure, expiry, name, value).
    Exporters vary, so we don't demand the header."""
    if "# Netscape HTTP Cookie File" in text or "# HTTP Cookie File" in text:
        return True
    for line in text.splitlines():
        line = line.rstrip("\n")
        if not line or line.startswith("#"):
            continue
        if line.count("\t") >= 6:
            return True
    return False


@router.post("/cookies")
async def upload_cookies(file: UploadFile = File(...)):
    """Store a yt-dlp cookie jar (Netscape cookies.txt) used to download
    age-restricted / private / login-gated sources. Never echoed back."""
    raw = await file.read()
    if len(raw) > _MAX_COOKIES_BYTES:
        raise HTTPException(status_code=413, detail="Cookie file is too large.")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Not a text cookie file.")
    if not _looks_like_cookie_jar(text):
        raise HTTPException(
            status_code=400,
            detail="That doesn't look like a cookies.txt file. Export it in Netscape format.",
        )
    save_cookies(text)
    return {"yt_cookies_present": True}


@router.delete("/cookies")
async def remove_cookies():
    delete_cookies()
    return {"yt_cookies_present": cookies_present()}


# --- Custom appearance background ------------------------------------------

# Magic-byte sniff -> canonical extension. We trust content, not the filename.
_IMAGE_SIGNATURES = (
    (b"\xff\xd8\xff", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
)


def _sniff_image_ext(raw: bytes) -> str | None:
    for sig, ext in _IMAGE_SIGNATURES:
        if raw.startswith(sig):
            return ext
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return None


def _lossless_compress_seam(raw: bytes) -> bytes:
    """Architecture seam for future lossless compression of large backgrounds.

    Deliberately NOT implemented yet (no compressor dependency, per OPNMMO-0018).
    Until it lands, images over the cap are declined here. When compression is
    built, this is the single place to slot it in and return the smaller bytes.
    """
    raise HTTPException(
        status_code=413,
        detail="Image over 10 MB. Lossless compression for large backgrounds is "
        "coming in a future update — please use a smaller image for now.",
    )


@router.post("/background")
async def upload_background(file: UploadFile = File(...)):
    """Store a custom appearance background full-quality (server-side, not a
    localStorage data URL). Returns the active extension; the image is served by
    GET /api/settings/background."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(raw) > _MAX_BG_BYTES:
        raw = _lossless_compress_seam(raw)  # placeholder: declines >10 MB for now
    ext = _sniff_image_ext(raw)
    if not ext:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image type. Use JPG, PNG, WEBP or GIF.",
        )
    save_background(raw, ext)
    return {"bg_image_ext": ext}


@router.get("/background")
async def read_background():
    p = get_background_path()
    if not p:
        raise HTTPException(status_code=404, detail="No custom background set.")
    return FileResponse(p)


@router.delete("/background")
async def remove_background():
    delete_background()
    return {"bg_image_present": background_present()}
