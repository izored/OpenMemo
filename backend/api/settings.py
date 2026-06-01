"""User-configurable settings API (runtime, persisted as JSON)."""
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from backend.core.app_settings import get_settings, update_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


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
