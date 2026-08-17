from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.cozy.database import get_db
from app.cozy.models import CozyPlayer, CozySave
from app.cozy.schemas import SaveIn, SaveOut, SavePushOut
from app.cozy.security import current_player
from app.cozy.settings import settings

router = APIRouter()


def _serialize(row: CozySave | None) -> SaveOut:
    if row is None:
        return SaveOut(exists=False)

    return SaveOut(
        exists=True,
        payload=row.payload,
        save_version=row.save_version,
        play_seconds=int(row.play_seconds),
        saved_at_unix=int(row.saved_at_unix),
        revision=row.revision,
    )


@router.get("/api/cozy/save", response_model=SaveOut)
def read_save(
    player: CozyPlayer = Depends(current_player),
    db: Session = Depends(get_db),
) -> SaveOut:
    return _serialize(db.scalar(select(CozySave).where(CozySave.player_id == player.id)))


@router.put("/api/cozy/save", response_model=SavePushOut)
def write_save(
    payload: SaveIn,
    player: CozyPlayer = Depends(current_player),
    db: Session = Depends(get_db),
) -> SavePushOut:
    """Stores the village, unless doing so would throw one away.

    The rule is one comparison: the client says which revision it was working from, and if that is
    not the revision on the server then something else has written since. That is the whole of the
    concurrency model and it is enough, because the thing being protected against is not two
    phones playing at once - it is a phone that has been offline for a week uploading a week-old
    village over the one that has been played since.

    A fresh install reports revision zero, which is exactly the state that must not be allowed to
    overwrite anything silently: it is what a reinstall looks like, and a reinstall's local save is
    an empty island.
    """
    body = payload.payload or ""
    if not body.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пустое сохранение")

    if len(body.encode("utf-8")) > settings.save_max_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Сохранение слишком большое")

    row = db.scalar(select(CozySave).where(CozySave.player_id == player.id))

    if row is not None and not payload.force and payload.base_revision != row.revision:
        return SavePushOut(accepted=False, revision=row.revision, conflict=True, server=_serialize(row))

    if row is None:
        row = CozySave(player_id=player.id, revision=0)
        db.add(row)

    row.payload = body
    row.save_version = payload.save_version
    row.play_seconds = max(int(payload.play_seconds), 0)
    row.saved_at_unix = max(int(payload.saved_at_unix), 0)
    row.revision += 1

    db.commit()
    db.refresh(row)
    return SavePushOut(accepted=True, revision=row.revision)
