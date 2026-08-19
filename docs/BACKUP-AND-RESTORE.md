# Backup and restore: what exists and what it protects

Written 2026-08-18, after a review of the macOS update path turned up two
things that had been quietly broken for a long time. This is the reference for
what openMemo keeps, where it keeps it, and which failures it actually covers.

If you only read one line: **your library is never inside the app.** Replacing
`OpenMemo.app`, rebuilding the Docker image, or reinstalling from scratch does
not touch it.

---

## 1. What openMemo keeps, and where

| What | Where | Written by | Rotated |
|---|---|---|---|
| The library itself | `<data>/openmemo.db` | the app | no |
| Uploaded media | `<data>/files/` | the app | no |
| Daily snapshots | `<data>/backups/openmemo-*.db.gz` | `core/autobackup.py` | last 7 |
| Pre-update copies (macOS) | `<data>/backups/preupgrade-*.zip` | `macOS/src/upgrade.ts` | last 3 per direction |
| Pre-restore copies | `<data>/pre-restore/<stamp>/` | `api/backup.py` | never |
| Manual backups | wherever you saved them | you, from Settings | never |

`<data>` is `~/Library/Application Support/OpenMemo` on macOS, and the mounted
`data/` directory under Docker.

Two rotations exist and they are deliberately blind to each other. The daily
job only ever matches `openmemo-*.db.gz`, so it cannot delete a pre-update copy.
The macOS rotation only matches its own two prefixes, and keeps three of each
direction separately, so backing out of an update repeatedly cannot evict the
copy you are backing out to. Nothing rotates `pre-restore/`.

---

## 2. What each one protects against

| Failure | Covered by | Notes |
|---|---|---|
| A bad app update | pre-update copy (macOS) | Taken before the new backend migrates anything. |
| Going back to an older build | pre-downgrade copy (macOS) | Warned about first, and you can quit out. |
| A restore you regret | pre-restore copy | Both the database and the media it displaced. |
| Deleting something days ago | daily snapshots | Last 7 days, database only. |
| Losing the whole machine | manual backup, full scope | The only one that includes your media, and the only one that leaves the machine. |

The gap worth naming: **only the manual full backup leaves your disk.** Every
automatic copy above is on the same drive as the thing it protects. They cover
mistakes, not hardware.

---

## 3. Restoring

All of it goes through **Settings, Backup and Restore**.

- **A daily snapshot.** Pick a date from the list. It restores the database
  only; your uploaded files stay as they are.
- **A pre-update copy.** Restore, then choose the `preupgrade-*.zip` from the
  backups folder. The Backup card has a button that opens it.
- **A manual backup.** Restore, then choose the `.zip` you saved.

Both file shapes are accepted: the `.zip` that Settings produces, and the
gzipped database that the automatic snapshots are. Before anything is replaced,
the archive is checked, and the database being replaced is copied into
`<data>/pre-restore/<timestamp>/`. The response tells you where it went.

**Restoring never deletes your media.** A full archive moves the current files
into the same `pre-restore` folder rather than deleting them.

---

## 4. What was broken, and is not any more

Recorded because both were invisible from the outside and neither would have
been noticed until someone needed the backup.

**Backups that could not be restored.** The app wrote two shapes and could
restore one. Settings produced a `.zip`; the daily snapshots and the macOS
pre-update copy were gzipped SQLite written straight to disk. The restore
endpoint rejected those on its first line, and the file picker was filtered to
`.zip`, so they could not even be selected. A year of daily snapshots was
insurance nobody could claim. Both shapes restore now.

**The daily snapshots were invisible.** The endpoint that lists them existed
and had no caller anywhere in the frontend. You could read in Settings that
snapshots were being taken and had no way to see or use one. They are listed by
date now.

**Restore destroyed what it replaced.** It moved media aside, deliberately and
with a comment explaining why, then copied straight over the database. So
restoring a January archive to recover one deleted memo took every memo since
January, permanently, while the photos came back fine. The database is kept now.

**Two restores in one second shared a folder.** Found while testing the fix
above: the folder name is per second, so the second restore overwrote the first
one's safety copy. Each gets its own now.

**The snapshot rewrote the database it was copying.** It opened the live file
read-write, and closing that connection checkpoints the write-ahead log, so a
routine whose only job was to take a copy modified the original every time it
ran, while the app was serving requests. It opens read-only now.

**The macOS data folder could move on a rename.** Electron derives it from the
product name, so a rename, even a change of capitalisation, would have opened a
new empty folder with no error anywhere and the old library still on disk. The
name is pinned.

---

## 5. Still open

- **The PIN lock can be bypassed during boot.** Closing the window while the
  app is still starting lets a second window load the library over the lock
  screen. Unrelated to backups; tracked separately.
- **Nothing goes off the machine automatically.** Deliberate, given the
  project's local-first stance, but it means the automatic copies do not
  survive a dead disk. Take a manual full backup somewhere else periodically.

---

## 6. If you are about to do something risky

1. **Settings, Backup and Restore, Full backup.** Save the zip somewhere that
   is not this machine.
2. Do the thing.
3. If it went wrong, restore that zip. Your previous database is kept in
   `pre-restore/` either way, so a wrong restore is also recoverable.

Never delete the data folder to "reinstall clean". Deleting the app is
harmless. That folder is the library.
