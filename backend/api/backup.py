"""Backup and restore API — downloadable zip snapshots, one-click restore."""
import io
import json
import logging
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from backend.config import settings

router = APIRouter(prefix="/api/backup", tags=["backup"])

_META = "backup_meta.json"
_DB = "openmemo.db"
_FILES_PREFIX = "files/"


def _sqlite_backup(src_path: Path, dst_path: Path) -> None:
    src = sqlite3.connect(str(src_path))
    dst = sqlite3.connect(str(dst_path))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()


@router.post("")
async def create_backup(scope: Literal["structure", "full"] = Query("structure")):
    """Create a downloadable backup zip.
    scope=structure → DB only (memos, collections, tags, chats).
    scope=full → DB + all uploaded files (excludes thumbnail cache).
    """
    db_path = Path(settings.DATA_DIR) / "openmemo.db"
    files_dir = Path(settings.FILES_DIR)
    thumbs_dir = files_dir / "thumbs"

    ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    filename = f"openmemo-backup-{ts}-{scope}.zip"

    buf = io.BytesIO()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_db = Path(tmp) / "openmemo.db"
        if db_path.exists():
            _sqlite_backup(db_path, tmp_db)

        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            meta = {
                "scope": scope,
                "created_at": datetime.utcnow().isoformat() + "Z",
                "app_version": settings.VERSION,
            }
            zf.writestr(_META, json.dumps(meta, indent=2))

            if tmp_db.exists():
                zf.write(tmp_db, _DB)

            if scope == "full" and files_dir.exists():
                thumbs_str = str(thumbs_dir)
                for f in files_dir.rglob("*"):
                    if f.is_file() and not str(f).startswith(thumbs_str):
                        rel = f.relative_to(files_dir).as_posix()
                        zf.write(f, _FILES_PREFIX + rel)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/restore")
async def restore_backup(file: UploadFile = File(...)):
    """Restore from an uploaded backup zip. Replaces the database and (for full
    backups) all uploaded files. This operation is irreversible."""
    raw = await file.read()

    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Not a valid zip file")

    names = zf.namelist()
    if _META not in names:
        raise HTTPException(
            status_code=400,
            detail="Missing backup_meta.json — not an OpenMemo backup",
        )
    if _DB not in names:
        raise HTTPException(status_code=400, detail="Backup is missing the database file")

    meta = json.loads(zf.read(_META))
    scope = meta.get("scope", "structure")

    db_path = Path(settings.DATA_DIR) / "openmemo.db"
    files_dir = Path(settings.FILES_DIR)

    # Validate EVERY file entry before touching the DB or the files dir, so a
    # malicious archive is rejected without destroying anything
    # (Zip-Slip defense in depth — see plans/002).
    files_dir_resolved = files_dir.resolve()
    safe_entries: list[tuple[str, Path]] = []
    if scope == "full":
        for name in names:
            if name.startswith(_FILES_PREFIX) and not name.endswith("/"):
                rel = name[len(_FILES_PREFIX):]
                dest = (files_dir / rel).resolve()
                try:
                    dest.relative_to(files_dir_resolved)
                except ValueError:
                    raise HTTPException(status_code=400, detail="Backup contains an unsafe file path")
                safe_entries.append((name, dest))

    # Write restored DB to a temp file first, then atomically replace.
    with tempfile.TemporaryDirectory() as tmp:
        tmp_db = Path(tmp) / "openmemo.db"
        tmp_db.write_bytes(zf.read(_DB))

        # Validate SQLite magic bytes before touching the live database.
        if tmp_db.read_bytes()[:16] != b"SQLite format 3\x00":
            raise HTTPException(status_code=400, detail="Database file is not a valid SQLite database")

        # Release all pooled connections before replacing the file.
        from backend.db.database import engine
        await engine.dispose()

        db_path.parent.mkdir(parents=True, exist_ok=True)
        # Stale WAL sidecars from the old database would shadow the restored
        # file's content — remove them before the swap (plans/006 follow-up).
        # Best-effort: on Windows a lingering reader can hold the -wal open;
        # the next connection checkpoints it anyway.
        for suffix in ("-wal", "-shm"):
            sidecar = db_path.with_name(db_path.name + suffix)
            try:
                sidecar.unlink(missing_ok=True)
            except OSError:
                logging.getLogger(__name__).warning("Could not remove stale sidecar %s", sidecar)
        # Drop any queued work carried in by the backup. job_queue is this
        # device's transient to-do list, not user data: restoring it would
        # resurrect jobs from whenever the backup was taken and re-run downloads
        # for memos that may not exist in the restored library. The startup
        # sweep would then dutifully requeue them. Best-effort — a backup taken
        # before the queue existed simply has no such table.
        try:
            con = sqlite3.connect(str(tmp_db))
            con.execute("DELETE FROM job_queue")
            con.commit()
            con.close()
        except sqlite3.Error:
            pass

        shutil.copy2(tmp_db, db_path)

    if scope == "full":
        files_dir.mkdir(parents=True, exist_ok=True)
        # Remove existing files but keep the thumbs cache directory structure.
        for item in files_dir.iterdir():
            if item.name != "thumbs":
                if item.is_dir():
                    shutil.rmtree(item, ignore_errors=True)
                else:
                    item.unlink(missing_ok=True)

        for name, dest in safe_entries:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(zf.read(name))

    return {"ok": True, "scope": scope, "version": meta.get("app_version")}
