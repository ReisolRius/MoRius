"""Find - and optionally delete - rows left behind by past incomplete deletes.

Until the publication-copy fix, deleting a published world or character left its public copy
alive, and `story_summary_jobs` was never cleaned at all. Those rows still sit in the database:
they hold messages, memory blocks and base64 images, and a stale public copy is what makes a
long-deleted world resurface in the catalogue.

Read-only by default. Nothing is written without --apply.

    python scripts/sweep_orphans.py              # report
    python scripts/sweep_orphans.py --apply      # delete
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import delete as sa_delete, func, select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import Base, StoryCharacter, StoryGame, StorySummaryJob  # noqa: E402
from app.routers.story_characters import _delete_story_character_with_relations  # noqa: E402
from app.services.story_games import delete_story_game_with_relations  # noqa: E402


def _orphan_publication_games(db) -> list[StoryGame]:
    """Public copies whose source world is gone."""
    live_ids = select(StoryGame.id).scalar_subquery()
    return list(
        db.scalars(
            select(StoryGame)
            .where(StoryGame.source_world_id.is_not(None))
            .where(StoryGame.source_world_id.not_in(live_ids))
        ).all()
    )


def _orphan_publication_characters(db) -> list[StoryCharacter]:
    live_ids = select(StoryCharacter.id).scalar_subquery()
    return list(
        db.scalars(
            select(StoryCharacter)
            .where(StoryCharacter.source_character_id.is_not(None))
            .where(StoryCharacter.source_character_id.not_in(live_ids))
        ).all()
    )


def _orphan_child_rows(db) -> list[tuple[str, str, int]]:
    """Any table with a game_id/world_id pointing at a world that no longer exists."""
    live_games = select(StoryGame.id).scalar_subquery()
    found: list[tuple[str, str, int]] = []
    for mapper in sorted(Base.registry.mappers, key=lambda m: m.local_table.name):
        table = mapper.local_table
        if table.name == "story_games":
            continue
        for column in table.columns:
            if column.name not in {"game_id", "world_id"}:
                continue
            count = int(
                db.execute(
                    select(func.count()).select_from(table).where(column.is_not(None)).where(column.not_in(live_games))
                ).scalar()
                or 0
            )
            if count:
                found.append((table.name, column.name, count))
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="actually delete (default: report only)")
    args = parser.parse_args()

    with SessionLocal() as db:
        stale_games = _orphan_publication_games(db)
        stale_characters = _orphan_publication_characters(db)
        stale_jobs = int(
            db.execute(
                select(func.count())
                .select_from(StorySummaryJob)
                .where(StorySummaryJob.game_id.not_in(select(StoryGame.id).scalar_subquery()))
            ).scalar()
            or 0
        )
        child_rows = _orphan_child_rows(db)

        print("Published worlds whose source is deleted : %d" % len(stale_games))
        for game in stale_games[:15]:
            print("    #%-7s %s" % (game.id, (game.title or "")[:60]))
        if len(stale_games) > 15:
            print("    ... and %d more" % (len(stale_games) - 15))
        print("Published characters whose source is gone: %d" % len(stale_characters))
        print("Summary jobs for deleted worlds          : %d" % stale_jobs)
        print("Orphan child rows by table:")
        if child_rows:
            for name, column, count in child_rows:
                print("    %-42s %-10s %d" % (name, column, count))
        else:
            print("    none")

        if not args.apply:
            print("\nDry run. Re-run with --apply to delete.")
            return 0

        for game in stale_games:
            delete_story_game_with_relations(db, game_id=int(game.id))
        for character in stale_characters:
            _delete_story_character_with_relations(db, character_id=int(character.id))
        db.execute(
            sa_delete(StorySummaryJob).where(StorySummaryJob.game_id.not_in(select(StoryGame.id).scalar_subquery()))
        )
        db.commit()
        print("\nDeleted. Run VACUUM to hand the freed pages back to the filesystem.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
