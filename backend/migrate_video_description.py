import asyncio
from backend.db.database import AsyncSessionLocal as async_session_maker
from sqlalchemy import text

async def migrate():
    async with async_session_maker() as session:
        # Add video_description column
        try:
            await session.execute(text("ALTER TABLE memos ADD COLUMN video_description TEXT"))
            print("Added video_description column")
        except Exception as e:
            print(f"video_description column: {e}")

        # Backfill: for video memos with no real transcript yet, copy content_text
        # (which was set to the YouTube description at ingest) into video_description.
        try:
            result = await session.execute(text(
                "UPDATE memos SET video_description = content_text "
                "WHERE type = 'video' AND transcript_status IS NULL "
                "AND content_text IS NOT NULL AND video_description IS NULL"
            ))
            print(f"Backfilled {result.rowcount} video memos")
        except Exception as e:
            print(f"Backfill failed: {e}")

        await session.commit()
        print("Migration complete")

asyncio.run(migrate())
