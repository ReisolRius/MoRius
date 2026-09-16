"""Re-encode base64 images already stored in the database as WebP.

Every picture in this product lives inside a text column as a `data:image/...;base64,...` URL,
so the database carries roughly a third more bytes than the pictures themselves even before
counting PNGs that were never compressed. New uploads go through `image_compression` now; this
script does the same to everything uploaded before that.

Safe to run against a live database: it works in small committed batches, touches one row at a
time, and skips anything it cannot decode. Stop it at any point and re-run later - rows already
converted are recognised and skipped.

    python scripts/compress_stored_media.py                 # report what would change
    python scripts/compress_stored_media.py --apply         # convert
    python scripts/compress_stored_media.py --apply --limit 500
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import String, Text, func, select, update  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import Base  # noqa: E402
from app.services.image_compression import (  # noqa: E402
    PROFILE_AVATAR,
    PROFILE_CHARACTER,
    PROFILE_COVER,
    PROFILE_SCENE,
    ImageProfile,
    compress_media_data_url,
)

# Which squeeze applies to which column. Anything not listed falls back to the cover profile.
_PROFILE_BY_TABLE: dict[str, ImageProfile] = {
    "users": PROFILE_AVATAR,
    "story_characters": PROFILE_CHARACTER,
    "story_turn_images": PROFILE_SCENE,
    "story_scene_backgrounds": PROFILE_SCENE,
    "story_map_images": PROFILE_SCENE,
    "user_gallery_images": PROFILE_SCENE,
}


def _media_columns() -> list[tuple[str, str]]:
    """Every text column that plausibly holds an image data URL."""
    found: list[tuple[str, str]] = []
    for mapper in sorted(Base.registry.mappers, key=lambda m: m.local_table.name):
        table = mapper.local_table
        for column in table.columns:
            if not isinstance(column.type, (String, Text)):
                continue
            name = column.name.lower()
            if "image" in name or "avatar" in name or "cover" in name or name.endswith("_assets"):
                found.append((table.name, column.name))
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the converted values back")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many rows (0 = all)")
    parser.add_argument("--batch", type=int, default=50, help="rows per commit")
    args = parser.parse_args()

    columns = _media_columns()
    print("Scanning %d candidate columns\n" % len(columns))

    total_before = total_after = converted = skipped = 0

    with SessionLocal() as db:
        for table_name, column_name in columns:
            table = Base.metadata.tables[table_name]
            column = table.columns[column_name]
            pk = list(table.primary_key.columns)[0]
            profile = _PROFILE_BY_TABLE.get(table_name, PROFILE_COVER)

            rows = db.execute(
                select(pk, column).where(column.is_not(None)).where(column.like("data:image/%"))
            ).all()
            if not rows:
                continue

            col_before = col_after = col_count = 0
            pending = 0
            for row_id, value in rows:
                if args.limit and converted >= args.limit:
                    break
                compressed = compress_media_data_url(value, profile)
                if compressed == value:
                    skipped += 1
                    continue
                col_before += len(value)
                col_after += len(compressed)
                col_count += 1
                converted += 1
                if args.apply:
                    db.execute(update(table).where(pk == row_id).values({column_name: compressed}))
                    pending += 1
                    if pending >= args.batch:
                        db.commit()
                        pending = 0
            if args.apply and pending:
                db.commit()

            if col_count:
                total_before += col_before
                total_after += col_after
                print(
                    "  %-34s %-22s %5d rows  %8.1f MB -> %8.1f MB  (-%.0f%%)"
                    % (
                        table_name,
                        column_name,
                        col_count,
                        col_before / 1048576,
                        col_after / 1048576,
                        100 * (1 - col_after / col_before) if col_before else 0,
                    )
                )

    saved = total_before - total_after
    print("\nRows converted : %d   (left alone: %d)" % (converted, skipped))
    print("Stored bytes   : %.2f GB -> %.2f GB" % (total_before / 1073741824, total_after / 1073741824))
    print("Reclaimed      : %.2f GB" % (saved / 1073741824))
    if not args.apply:
        print("\nDry run - nothing was written. Re-run with --apply.")
    else:
        print("\nWritten. Run VACUUM to hand the freed pages back to the filesystem.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
