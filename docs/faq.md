# Frequently Asked Questions

## Do I need a GPU?

No. openMemo runs on CPU. A GPU makes chat responses faster and makes the larger
Whisper transcription models practical, but nothing requires one.

## Can I use this without Docker?

Yes. Three ways: the native macOS app (no Docker, no browser), Docker Compose,
or running the backend and frontend directly. See `deployment.md` and
`INSTALL.md`.

## Where is my data stored?

Everything is local:

- `data/openmemo.db` — SQLite: memos, collections, tags, playlists, spaces
- `data/chroma/` — vector embeddings
- `data/backups/` — the automatic compressed snapshots
- `data/hf-cache/` — the downloaded Whisper model
- `files/` — uploads, downloaded media, thumbnails, covers

Set `DATA_DIR` to anchor all of it under one directory. The macOS app does
exactly that, pointing at Application Support.

Nothing is sent anywhere. Model inference happens through your own Ollama.

## What file types can I upload, and how large?

PDF, DOCX, XLSX, images, audio (including lossless WAV and FLAC), video, and
plain text. Files are validated by magic bytes, not by extension.

The default size cap is **5 GB**, changeable in Settings. Setting it to 0
removes the cap entirely. This is a local-first app; your disk is the real
limit.

## How do I change the LLM model?

Pull it with Ollama (`ollama pull llama3.1:8b`), then pick it in
**Settings → Local AI**, or per conversation from the Ask composer. The dropdown
reads what is actually installed on your machine. Full model guide in
`ollama.md`.

## The search isn't finding my memos

Embedding happens in the background after ingestion, and a long document can
take a while. Keyword search through FTS5 works immediately. Ask Memo needs the
embeddings, so give a fresh import a moment.

## Can multiple people use the same instance?

No. openMemo is single-user by design, with no login. Multi-user is on the
roadmap, not in the product. Do not put it on a public URL without putting
authentication in front of it.

## Can I use it on two computers?

Yes, that is what Mesh does. Both machines hold the whole library, both can
write, and changes travel in both directions with no server in between. You pair
once with a 12-word code or a QR scan. It is off by default and takes two
switches to expose anything. See `MESH-HANDBOOK.md` and
`MESH-PAIRING-WALKTHROUGH.md`.

## Can I save things from my phone?

Share to your private Telegram bot. openMemo polls Telegram from your machine,
so there is no VPN and no open port. If your computer is asleep, messages wait
on Telegram for 24 hours and openMemo collects them when it wakes. It warns you
when something is close to that limit.

## Are my memos backed up?

Yes, automatically. openMemo compresses a copy of the database on a schedule and
keeps the recent ones; Settings lists them by date and size and restores one on
a click. Restoring saves a copy of what it is replacing first. On macOS, a
version change triggers a backup before the new backend is allowed to open your
library. Details in `BACKUP-AND-RESTORE.md`, and `DISASTER-RECOVERY.md` for when
something has already gone wrong.

## Does it work offline?

Yes. Rendering openMemo makes no network request at all: fonts are on disk,
favicons are cached, and embeds only load when you press play. A strip appears
at the top when the connection drops, and everything already on your disk keeps
working. Fetching new content obviously needs a connection.

## I get a CORS error

Add your origin to `CORS_ORIGINS` and restart the API:

```env
CORS_ORIGINS=http://localhost:3000,http://localhost,https://your-domain.com
```

For the browser extension, `EXTENSION_ORIGIN` locks it to your exact extension
ID. Left empty, any `chrome-extension://` origin is accepted.

## The app went down and says `unable to open database file`

Something other than the container opened the SQLite file. SQLite's WAL
shared-memory file is not shared across a Docker bind mount, so a host process
pointed at `data/openmemo.db` takes the running app down. Recover with:

```bash
docker compose restart openmemo-api
```

Then point that host process somewhere else.

## A site keeps asking me to solve a puzzle and the memo comes back empty

Temu, and shops guarded the same way, answer anything automated with a slider or
rotate CAPTCHA. Nothing openMemo runs can finish one, so it files the link as a
plain bookmark and says so instead of saving the puzzle page as if it were the
product. To capture the real page, solve the puzzle in your own browser and save
it with the browser extension: the extension reads the tab you already got
through, so the wall never enters into it. Uploading your cookies in Settings
also helps for sites whose wall only lifts for a signed-in session. Full detail
in [bot-walls-and-captchas.md](bot-walls-and-captchas.md).

## A collection is drowning my dashboard

Edit the collection and turn on **Hide from the dashboard**. Its memos stop
appearing in All Memos and the type tabs. The collection stays in the sidebar,
on the Collections page and in every picker, search still finds its memos, and
opening the collection shows all of them. It is for decluttering a bucket you
fill fast, not for privacy: the passcode-gated Hidden section is still the place
for things you do not want on screen at all.
