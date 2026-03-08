from __future__ import annotations

from app.models import StoryMessage
from app.schemas import StoryMessageOut


def story_message_to_out(message: StoryMessage) -> StoryMessageOut:
    return StoryMessageOut(
        id=message.id,
        game_id=message.game_id,
        role=message.role,
        content=message.content,
        scene_emotion_payload=str(getattr(message, "scene_emotion_payload", "") or "").strip() or None,
        created_at=message.created_at,
        updated_at=message.updated_at,
    )
