"""Base service class with standard CRUD patterns.

Rules for all services:
1. All DB operations are async
2. Updates always return the updated object
3. Pagination uses SQL LIMIT/OFFSET — never Python list slicing
4. Relationships are loaded explicitly via selectinload
5. Errors are logged and re-raised as ServiceError
"""

import logging
from typing import TypeVar, Generic, Type, Sequence
from datetime import datetime

from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from backend.db.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

ModelType = TypeVar("ModelType")


class ServiceError(Exception):
    """Raised when a service operation fails."""

    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class BaseService(Generic[ModelType]):
    """Base service with CRUD operations.

    Usage:
        class MemoService(BaseService[Memo]):
            model = Memo
            default_relations = [Memo.collections, Memo.tags]
    """

    model: Type[ModelType] = None  # type: ignore
    default_relations: list = []

    def __init__(self, db: AsyncSession | None = None):
        self.db = db
        self._owns_session = db is None

    async def _get_session(self) -> AsyncSession:
        if self.db is None:
            self.db = AsyncSessionLocal()
            self._owns_session = True
        return self.db

    async def _close(self):
        if self._owns_session and self.db:
            await self.db.close()
            self.db = None

    def _query(self, load_relations: bool = True):
        """Build a SELECT query with optional relation loading."""
        q = select(self.model)
        if load_relations and self.default_relations:
            for relation in self.default_relations:
                q = q.options(selectinload(relation))
        return q

    # ─── Read ───

    async def get(self, id: str, load_relations: bool = True) -> ModelType | None:
        """Get a single record by ID."""
        session = await self._get_session()
        try:
            result = await session.execute(self._query(load_relations).where(self.model.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"{self.model.__name__}.get({id}) failed: {e}")
            raise ServiceError(f"Failed to fetch {self.model.__name__}")
        finally:
            await self._close()

    async def get_or_404(self, id: str, load_relations: bool = True) -> ModelType:
        """Get a record or raise HTTP 404."""
        obj = await self.get(id, load_relations)
        if not obj:
            raise HTTPException(status_code=404, detail=f"{self.model.__name__} not found")
        return obj

    async def list(
        self,
        *,
        filters: dict | None = None,
        order_by: str = "created_at",
        descending: bool = True,
        offset: int = 0,
        limit: int = 50,
        load_relations: bool = True,
    ) -> tuple[Sequence[ModelType], int]:
        """List records with pagination.

        Returns (items, total_count). Uses SQL LIMIT/OFFSET — never Python slicing.
        """
        session = await self._get_session()
        try:
            # Base query
            query = self._query(load_relations)

            # Apply filters
            if filters:
                for key, value in filters.items():
                    if hasattr(self.model, key) and value is not None:
                        query = query.where(getattr(self.model, key) == value)

            # Count total (before pagination)
            count_query = select(func.count()).select_from(query.subquery())
            total = (await session.execute(count_query)).scalar() or 0

            # Order
            order_col = getattr(self.model, order_by, self.model.created_at)
            if descending:
                query = query.order_by(desc(order_col))
            else:
                query = query.order_by(order_col)

            # Pagination
            query = query.offset(offset).limit(limit)

            result = await session.execute(query)
            items = result.scalars().all()
            return items, total

        except Exception as e:
            logger.error(f"{self.model.__name__}.list failed: {e}")
            raise ServiceError(f"Failed to list {self.model.__name__}")
        finally:
            await self._close()

    # ─── Write ───

    async def create(self, **kwargs) -> ModelType:
        """Create a new record."""
        session = await self._get_session()
        try:
            obj = self.model(**kwargs)
            session.add(obj)
            await session.commit()
            await session.refresh(obj)
            logger.info(f"{self.model.__name__}.created: id={obj.id}")
            return obj
        except Exception as e:
            await session.rollback()
            logger.error(f"{self.model.__name__}.create failed: {e}")
            raise ServiceError(f"Failed to create {self.model.__name__}")
        finally:
            await self._close()

    async def update(self, id: str, **kwargs) -> ModelType:
        """Update a record by ID. Returns the updated object.

        Only updates fields that are provided (not None).
        Logs what changed for auditability.
        """
        session = await self._get_session()
        try:
            obj = await self.get(id, load_relations=False)
            if not obj:
                raise HTTPException(status_code=404, detail=f"{self.model.__name__} not found")

            changed = []
            for key, value in kwargs.items():
                if value is not None and hasattr(obj, key):
                    old = getattr(obj, key)
                    if old != value:
                        setattr(obj, key, value)
                        changed.append(key)

            if changed:
                obj.updated_at = datetime.utcnow()
                await session.commit()
                await session.refresh(obj)
                logger.info(f"{self.model.__name__}.updated: id={id} fields={changed}")
            else:
                logger.info(f"{self.model.__name__}.updated: id={id} (no changes)")

            return obj
        except HTTPException:
            raise
        except Exception as e:
            await session.rollback()
            logger.error(f"{self.model.__name__}.update({id}) failed: {e}")
            raise ServiceError(f"Failed to update {self.model.__name__}")
        finally:
            await self._close()

    async def delete(self, id: str) -> None:
        """Delete a record by ID."""
        session = await self._get_session()
        try:
            obj = await self.get(id, load_relations=False)
            if not obj:
                raise HTTPException(status_code=404, detail=f"{self.model.__name__} not found")

            await session.delete(obj)
            await session.commit()
            logger.info(f"{self.model.__name__}.deleted: id={id}")
        except HTTPException:
            raise
        except Exception as e:
            await session.rollback()
            logger.error(f"{self.model.__name__}.delete({id}) failed: {e}")
            raise ServiceError(f"Failed to delete {self.model.__name__}")
        finally:
            await self._close()
