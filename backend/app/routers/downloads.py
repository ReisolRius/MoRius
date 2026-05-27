from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from app.config import BASE_DIR

router = APIRouter()

ANDROID_APK_PATH = BASE_DIR / "downloads" / "morius-ai.apk"
ANDROID_APK_FILENAME = "morius-ai.apk"
ANDROID_APK_MEDIA_TYPE = "application/vnd.android.package-archive"


@router.get("/api/downloads/android/morius-ai.apk")
def download_android_app() -> FileResponse:
    apk_path = Path(ANDROID_APK_PATH)
    if not apk_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Android app package is not available.",
        )

    return FileResponse(
        path=apk_path,
        media_type=ANDROID_APK_MEDIA_TYPE,
        filename=ANDROID_APK_FILENAME,
        headers={
            "Cache-Control": "public, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )
