from __future__ import annotations

import base64
import binascii
import io
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

try:  # Pillow is a hard dependency in practice, but a missing one must not break uploads.
    from PIL import Image, ImageSequence

    _PILLOW_AVAILABLE = True
except Exception:  # pragma: no cover - only hit on a broken install
    Image = None  # type: ignore[assignment]
    ImageSequence = None  # type: ignore[assignment]
    _PILLOW_AVAILABLE = False


@dataclass(frozen=True)
class ImageProfile:
    """How hard to squeeze one class of image."""

    max_dimension: int
    quality: int


# Every picture the product stores, sized for the largest box it is ever drawn in. Going past
# that is pure waste: the browser only ever scales it back down.
PROFILE_AVATAR = ImageProfile(max_dimension=512, quality=86)
PROFILE_CHARACTER = ImageProfile(max_dimension=768, quality=86)
PROFILE_COVER = ImageProfile(max_dimension=1600, quality=84)
PROFILE_SCENE = ImageProfile(max_dimension=1920, quality=82)
PROFILE_DEFAULT = PROFILE_COVER

# Formats worth decoding. Anything else is passed through untouched.
_TRANSCODABLE_MIME_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}

# Below this there is nothing to win, and re-encoding a tiny icon can make it bigger.
_MIN_BYTES_TO_BOTHER = 12 * 1024


def _decode_data_url(data_url: str) -> tuple[str, bytes] | None:
    if not data_url.startswith("data:") or "," not in data_url:
        return None
    header, payload = data_url.split(",", maxsplit=1)
    if ";base64" not in header:
        return None
    mime_type = header[len("data:") :].split(";", maxsplit=1)[0].lower()
    try:
        return mime_type, base64.b64decode(payload, validate=True)
    except (ValueError, binascii.Error):
        return None


def _encode_webp_data_url(raw: bytes) -> str:
    return "data:image/webp;base64," + base64.b64encode(raw).decode("ascii")


def _is_animated(image: "Image.Image") -> bool:
    return bool(getattr(image, "n_frames", 1) > 1)


def compress_image_bytes(raw_bytes: bytes, profile: ImageProfile) -> bytes | None:
    """Re-encode one image to WebP, shrinking it to the profile's box.

    Returns None when the image should be kept exactly as it is: animated, already small,
    unreadable, or when WebP turns out no smaller than what we were given.
    """
    if not _PILLOW_AVAILABLE:
        return None
    try:
        with Image.open(io.BytesIO(raw_bytes)) as image:
            if _is_animated(image):
                # Animated avatars are rare and Pillow's animated-WebP output is lossy in ways
                # that are hard to predict. Leaving them alone is the safe trade.
                return None
            image.load()
            has_alpha = image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info
            working = image.convert("RGBA" if has_alpha else "RGB")

            width, height = working.size
            longest = max(width, height)
            if longest > profile.max_dimension:
                scale = profile.max_dimension / float(longest)
                working = working.resize(
                    (max(1, round(width * scale)), max(1, round(height * scale))),
                    Image.LANCZOS,
                )

            buffer = io.BytesIO()
            working.save(buffer, format="WEBP", quality=profile.quality, method=6)
            encoded = buffer.getvalue()
    except Exception as exc:  # pragma: no cover - depends on the uploaded bytes
        logger.info("Image compression skipped: %s", exc)
        return None

    # Never trade a smaller file for a bigger one.
    if len(encoded) >= len(raw_bytes):
        return None
    return encoded


def compress_media_data_url(data_url: str, profile: ImageProfile = PROFILE_DEFAULT) -> str:
    """Return `data_url` re-encoded as WebP, or the original when it is not worth touching.

    Never raises: a picture that cannot be compressed is still a picture the user wanted to
    upload, so the caller gets its input back and the upload carries on.
    """
    decoded = _decode_data_url(data_url)
    if decoded is None:
        return data_url
    mime_type, raw_bytes = decoded
    if mime_type not in _TRANSCODABLE_MIME_TYPES:
        return data_url
    if len(raw_bytes) < _MIN_BYTES_TO_BOTHER and mime_type == "image/webp":
        return data_url

    encoded = compress_image_bytes(raw_bytes, profile)
    if encoded is None:
        return data_url
    return _encode_webp_data_url(encoded)
