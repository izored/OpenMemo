"""User-configurable settings API (runtime, persisted as JSON)."""
import re
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
    hidden_passcode_set,
    save_background,
    save_cookies,
    set_hidden_passcode,
    update_settings,
    verify_hidden_passcode,
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
    auto_download_video: Optional[bool] = None
    music_quality: Optional[str] = None
    music_provider: Optional[str] = None
    chat_model: Optional[str] = None
    num_ctx: Optional[int] = None
    telegram_enabled: Optional[bool] = None
    telegram_poll_minutes: Optional[int] = None
    telegram_default_collection: Optional[str] = None
    telegram_force_localize: Optional[bool] = None


@router.get("")
async def read_settings():
    return get_settings()


@router.put("")
async def write_settings(patch: SettingsPatch):
    return update_settings(patch.model_dump(exclude_none=True))


# --- Hidden-section passcode (OPNMMO-0016) ----------------------------------
# Soft privacy gate for the hidden-memos UI. The hash never leaves the server;
# only `hidden_passcode_set` is exposed. This is NOT an auth layer — the local
# API itself is unauthenticated by design (local-first app).

_MIN_PASSCODE_LEN = 4


class HiddenPasscodeSet(BaseModel):
    passcode: str
    # Required once a passcode exists (change flow); ignored on first set.
    current: Optional[str] = None


class HiddenPasscodeVerify(BaseModel):
    passcode: str


@router.post("/hidden-passcode")
async def write_hidden_passcode(body: HiddenPasscodeSet):
    """Set the hidden-section passcode (first open), or change it given the
    current one."""
    if len(body.passcode) < _MIN_PASSCODE_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Passcode must be at least {_MIN_PASSCODE_LEN} characters.",
        )
    if hidden_passcode_set():
        if not body.current or not verify_hidden_passcode(body.current):
            raise HTTPException(status_code=403, detail="Current passcode is wrong.")
    set_hidden_passcode(body.passcode)
    return {"hidden_passcode_set": True}


@router.post("/hidden-passcode/verify")
async def check_hidden_passcode(body: HiddenPasscodeVerify):
    if not hidden_passcode_set():
        raise HTTPException(status_code=400, detail="No passcode has been set yet.")
    return {"ok": verify_hidden_passcode(body.passcode)}


# --- Telegram capture relay (ADR-020) ----------------------------------------
# The bot token is a secret: stored in the settings JSON, never returned by any
# endpoint — only `telegram_token_present` is (yt_cookies pattern).


class TelegramTokenSet(BaseModel):
    token: str


@router.post("/telegram/token")
async def write_telegram_token(body: TelegramTokenSet):
    """Store the bot token (empty string clears it and unlocks the owner)."""
    from backend.core.app_settings import set_telegram_token, telegram_token_present

    token = body.token.strip()
    # BotFather tokens look like "<digits>:<35 url-safe chars>". Reject obvious
    # garbage early so a paste mistake fails loudly, not silently at poll time.
    if token and not re.fullmatch(r"\d+:[A-Za-z0-9_-]{30,}", token):
        raise HTTPException(
            status_code=400,
            detail="That doesn't look like a bot token. Copy it from @BotFather.",
        )
    set_telegram_token(token)
    return {"telegram_token_present": telegram_token_present()}


@router.delete("/telegram/user-lock")
async def reset_telegram_user_lock():
    """Forget the locked owner so the next sender re-captures the lock."""
    from backend.core.app_settings import set_telegram_allowed_user, telegram_user_locked

    set_telegram_allowed_user(0)
    return {"telegram_user_locked": telegram_user_locked()}


@router.get("/telegram/status")
async def read_telegram_status():
    """Live relay status for the Settings card."""
    from backend.core.app_settings import telegram_token_present, telegram_user_locked
    from backend.services.telegram_relay import RELAY_STATUS

    return {
        **RELAY_STATUS,
        "telegram_token_present": telegram_token_present(),
        "telegram_user_locked": telegram_user_locked(),
    }


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


# --- Instagram login (final-fallback session for IG pulls) ------------------
# Feeds the same shared cookie jar as /cookies, but scoped to Instagram. Two
# ways in: paste a session (safe, no password) or username+password headless
# login (convenient, but IG may checkpoint your main account — the UI warns).


class InstagramSession(BaseModel):
    # A pasted Netscape cookies.txt (only its instagram.com lines are taken).
    cookies: str


class InstagramLogin(BaseModel):
    username: str
    password: str


@router.get("/instagram/status")
async def instagram_status():
    from backend.core.instagram_login import session_status
    return session_status()


@router.post("/instagram/session")
async def instagram_import_session(data: InstagramSession):
    """Import an Instagram session from a pasted cookies.txt. No password."""
    if len(data.cookies) > _MAX_COOKIES_BYTES:
        raise HTTPException(status_code=413, detail="Cookie text is too large.")
    from backend.core.instagram_login import import_session_cookies
    result = import_session_cookies(data.cookies)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/instagram/login")
async def instagram_login(data: InstagramLogin):
    """Headless username/password login. The password is used once to sign in and
    is never stored or logged. May return a checkpoint/2FA status IG imposes."""
    from backend.core.instagram_login import login_with_password
    result = await login_with_password(data.username.strip(), data.password)
    status = result.get("status")
    if status == "ok":
        return result
    messages = {
        "bad_credentials": "Instagram rejected that username or password.",
        "two_factor": "Instagram asked for a 2FA code. Use 'Import session' instead.",
        "checkpoint": "Instagram flagged this login (checkpoint). Use 'Import session' instead.",
        "unavailable": "Automated login isn't available here. Use 'Import session' instead.",
    }
    raise HTTPException(status_code=400, detail=messages.get(status, "Instagram login failed."))


@router.delete("/instagram/session")
async def instagram_disconnect():
    """Remove only the Instagram cookies from the shared jar."""
    from backend.core.instagram_login import disconnect
    return disconnect()


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
