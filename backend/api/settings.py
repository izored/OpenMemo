"""User-configurable settings API (runtime, persisted as JSON)."""
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.core.app_settings import (
    cookies_present,
    delete_cookies,
    get_settings,
    save_cookies,
    update_settings,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# A full multi-site export from the browser extension can reach a few hundred KB;
# cap generously but still hard, so a wrong file can't be dumped here.
_MAX_COOKIES_BYTES = 5 * 1024 * 1024  # 5 MB


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
