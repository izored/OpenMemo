# Disaster recovery

Written 2026-08-04, the day a test run deleted 435 media files from a live
openMemo library. Every step below had to be invented under pressure. It should
have been a page. Now it is.

Read the first section before you do anything else. The order matters more than
the tools.

---

## The rule that comes first

**Never write to or delete from live data. Read only, always.**

That includes test suites. A suite that points at production paths is not a
test, it is a deletion with extra steps. `backend/tests/test_test_isolation.py`
fails the whole suite if any user data path escapes a temp directory. Do not
disable it.

Before running anything unfamiliar against a real checkout:

1. Check what it writes to. `FILES_DIR`, `DATA_DIR`, `DATABASE_URL`.
2. Run it against a copy of the database first.
3. If a script has an `--apply` flag, the dry run is not optional.

---

## If media has just gone missing

### 1. Stop every write. Right now.

```bash
docker compose stop
```

Do this **before** investigating. On an SSD, every write can land on a block
that still holds a deleted file. Time spent looking around is time spent
destroying what you are about to look for.

### 2. Do not install anything onto the affected drive

A recovery tool downloaded to `D:` writes to `D:`. Install it on another drive,
or run a portable build from a USB stick.

### 3. Recover to a different drive

Never point the output at the source. Recovering `D:` onto `D:` overwrites the
data you are recovering.

### 4. Check the bytes are real before trusting a file count

This is the step that is easy to skip and expensive to skip. A recovery tool
will happily list thousands of files that contain nothing. A file listing proves
nothing.

Verdicts worth knowing:

| What you see | What it means |
|---|---|
| Valid header (`ftyp`, `JFIF`, `PNG`, `ID3`, `OggS`) and non zero body | Real data. If a player refuses it, blame the player or a short tail. |
| All zeros, head and body | TRIM reclaimed the blocks. No tool recovers this. |
| Header fine, body zeroed | Partial survivor. It will not play. |
| 0 byte files everywhere | Nothing was written. Usually a free tier hitting its recovery cap, not a data problem. |

On an SSD with TRIM enabled, which is every modern SSD, deleted files are
usually gone within minutes. Expect zero. Being surprised by success is better
than the reverse.

### 5. Match, restore, restart

openMemo files are named by UUID, and the database still holds every one of
them. Match recovered files back by filename, drop them into `files/`, and only
then start the app.

---

## Getting the library back without the disk

The database is the thing that matters, and it survives most incidents because
it is one small file that nothing bulk deletes. As long as it is intact, every
memo still knows what it was and where it came from.

**Media with a source URL** can be pulled back:

```bash
docker exec openmemo-openmemo-api-1 python -m backend.refetch_missing_media
```

Dry run by default. Add `--apply` to download, `--host` to do one platform at a
time, `--limit` to prove it works first. It reports the database and files
directory it is about to use. Read that banner.

**Music** can also be recovered from the app itself, one playlist at a time, with
no shell. A playlist whose files are gone now says so: the page counts them as
missing rather than downloaded, and the header offers to pull them back
("Re-download (N)"). Beside it, **Re-download all** re-fetches every track
including the ones still on disk, for when the files came back but came back
wrong. Both are the same pipeline `refetch_missing_media` uses, so the choice is
only about scope and comfort: the script for the whole library, the button for
the album you actually want tonight.

**Uploads with no source** exist nowhere else. This writes the hand search list:

```bash
docker exec openmemo-openmemo-api-1 python -m backend.list_lost_uploads
```

Each row carries the title, the date you added it, its collections and your own
notes. The filename is a UUID, so search other drives by type and date, then
confirm by opening the memo.

---

## Restoring from a backup

`POST /api/backup/inspect` tells you what a restore will do before it does it.
Use it. A restore that finds no media in the archive no longer clears your
media, and anything it does replace is moved to `data/pre-restore/<timestamp>/`
rather than deleted, so a wrong restore stays undoable for as long as the disk
has room.

A backup you have never restored is a hypothesis. Restore one into a scratch
folder now, while nothing is on fire.

---

## What to check afterwards

- `files/thumbs` still holds a thumbnail per memo. Broken cards show up here first.
- The missing count from `refetch_missing_media` in dry run mode. It is the
  honest number.
- Open five memos of different types. Cards can render from a cached thumbnail
  long after the file behind them is gone.
