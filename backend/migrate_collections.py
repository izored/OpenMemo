import asyncio
from backend.db.database import async_session_maker
from sqlalchemy import text

async def migrate():
    async with async_session_maker() as session:
        try:
            await session.execute(text("ALTER TABLE collections ADD COLUMN emoji VARCHAR DEFAULT '\\U0001F4C1'"))
        except Exception as e:
            print(f"emoji column: {e}")
        try:
            await session.execute(text("ALTER TABLE collections ADD COLUMN description VARCHAR"))
        except Exception as e:
            print(f"description column: {e}")
        await session.commit()
        print("Migration complete")

asyncio.run(migrate())
