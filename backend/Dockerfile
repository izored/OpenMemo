FROM python:3.12-slim

WORKDIR /app

# Install system deps. ffmpeg is required for video thumbnail extraction
# (backend/core/video.py shells out to it); without it video memos render blank.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create backend package directory
RUN mkdir -p /app/backend

COPY requirements.txt /app/backend/
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy all backend files into the backend package directory
COPY . /app/backend/

EXPOSE 8000

# Self-update yt-dlp to the latest release on container start, THEN launch the
# API. YouTube breaks old yt-dlp builds every few weeks, far faster than image
# rebuilds — this keeps "Make it local" working without a rebuild. Best-effort:
# if there's no network (offline / air-gapped), the update fails quietly and the
# pinned floor version from requirements.txt is used. Set YTDLP_AUTOUPDATE=0 to
# skip (e.g. fully offline deployments).
CMD ["sh", "-c", "if [ \"$YTDLP_AUTOUPDATE\" != \"0\" ]; then pip install --no-cache-dir --upgrade yt-dlp >/dev/null 2>&1 || echo '[entrypoint] yt-dlp self-update skipped (offline?)'; fi; exec uvicorn backend.main:app --host 0.0.0.0 --port 8000"]
