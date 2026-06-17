import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, DateTime, Boolean, Integer, ForeignKey, Table, JSON
)
from sqlalchemy.orm import relationship, DeclarativeBase


def generate_uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


# Association tables
memo_collections = Table(
    "memo_collections",
    Base.metadata,
    Column("memo_id", String, ForeignKey("memos.id"), primary_key=True),
    Column("collection_id", String, ForeignKey("collections.id"), primary_key=True),
)

memo_tags = Table(
    "memo_tags",
    Base.metadata,
    Column("memo_id", String, ForeignKey("memos.id"), primary_key=True),
    Column("tag_id", String, ForeignKey("tags.id"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    email = Column(String, unique=True, nullable=True)
    name = Column(String, default="Local User")
    avatar = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    workspaces = relationship("Workspace", back_populates="owner")


class Workspace(Base):
    __tablename__ = "workspaces"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    owner_id = Column(String, ForeignKey("users.id"))
    type = Column(String, default="personal")  # personal | team
    # Spaces (ADR-020): a Space is a Workspace with kind='space'. The 'default'
    # workspace is the main library (kind='library') and is never listed as a
    # Space. Memos + collections carry workspace_id, so a Space is isolated by a
    # filter, not a separate database. These columns drive the Space card +
    # sidebar presentation; NULL/legacy rows mean the 'default' library.
    kind = Column(String, default="library")  # library | space
    emoji = Column(String, nullable=True)
    icon = Column(String, nullable=True)
    color = Column(String, nullable=True)
    description = Column(String, nullable=True)
    # Notion-style full-bleed cover image (ADR-020). Stores just the extension;
    # the file lives at DATA_DIR/space_covers/<id>.<ext> and is served by the
    # spaces API. NULL = no cover, the header falls back to the color gradient.
    cover_ext = Column(String, nullable=True)
    pinned = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="workspaces")
    memos = relationship("Memo", back_populates="workspace")
    collections = relationship("Collection", back_populates="workspace")
    chat_sessions = relationship("ChatSession", back_populates="workspace")


class Memo(Base):
    __tablename__ = "memos"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    workspace_id = Column(String, ForeignKey("workspaces.id"))
    type = Column(String, nullable=False)  # note, article, video, image, audio, document, link
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    content_text = Column(Text, nullable=True)
    content_raw = Column(Text, nullable=True)  # markdown/html
    source_url = Column(String, nullable=True)
    source_domain = Column(String, nullable=True)
    source_favicon = Column(String, nullable=True)
    file_path = Column(String, nullable=True)
    thumbnail_path = Column(String, nullable=True)
    ai_summary = Column(Text, nullable=True)
    embedding_ids = Column(JSON, nullable=True)  # list of chunk IDs in ChromaDB
    notes = Column(Text, nullable=True)
    # YouTube/social video: original platform description (separate from content_text
    # which holds the real Whisper transcript once generated).
    video_description = Column(Text, nullable=True)
    # Speech-to-text state for audio memos. Transcript text lives in
    # content_text (so it embeds + is searchable); these track UI state.
    transcript_status = Column(String, nullable=True)  # pending|processing|done|error
    transcript_lang = Column(String, nullable=True)    # detected language code
    transcript_source = Column(String, nullable=True)  # captions|stt — how it was obtained
    # Audio sub-kind (ADR-005): 'voice' = mic recording (waveform UI, no aurora),
    # 'music' = uploaded file OR linked SoundCloud/Bandcamp/Mixcloud (cover-art
    # player, inline card player, aurora). NULL for non-audio memos.
    audio_kind = Column(String, nullable=True)  # voice|music
    # Artist from an uploaded music file's tags (ID3/Vorbis), when present. NULL
    # otherwise — we never fall back to the source domain here (ADR-010).
    audio_artist = Column(String, nullable=True)
    # Album the track belongs to (music only) — from the Qobuz match on
    # SpotiFLAC downloads, or the source album's name at ingest. Player + tiles
    # display it; NULL is fine (uploads, voice, pre-column rows).
    audio_album = Column(String, nullable=True)
    # On-demand AI summaries, keyed by mode: {"timestamp": ..., "insights": ..., "essay": ...}.
    # Generated lazily when the user picks a mode; cached so reopening is instant.
    summaries = Column(JSON, nullable=True)
    # "Make it local" download state for link/video memos (yt-dlp).
    localize_status = Column(String, nullable=True)    # pending|processing|done|error
    # Last yt-dlp failure reason (truncated). Lets the UI tell an age/login gate
    # ("needs your cookies") apart from a region-lock or unsupported source.
    localize_error = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    pinned = Column(Boolean, default=False)
    # Liked songs (music UX). Distinct from pinned: pin = sidebar shortcut for
    # any memo, like = a per-track flag the music surfaces read (heart on the
    # tile, wide tile in playlist grids, "Play liked").
    liked = Column(Boolean, default=False)
    # Hidden memos are filtered out of the main dashboard (and the pinned
    # sidebar list) but stay visible inside their collections. The full set
    # lives behind the passcode-gated hidden section (OPNMMO-0016).
    hidden = Column(Boolean, default=False)
    # True for tracks created by whole-playlist ingest (ADR-015). Born tracks
    # live inside their playlist and stay out of every list feed; a standalone
    # song added to a playlist later keeps its library spot (flag stays False).
    playlist_born = Column(Boolean, default=False)
    is_processed = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Drives the single "recent on top" sort. Bumped to now() on create
    # and rewritten by the drag-to-reorder endpoint.
    recency_at = Column(DateTime, default=datetime.utcnow)
    
    workspace = relationship("Workspace", back_populates="memos")
    collections = relationship("Collection", secondary=memo_collections, back_populates="memos")
    tags = relationship("Tag", secondary=memo_tags, back_populates="memos")


class Collection(Base):
    __tablename__ = "collections"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    workspace_id = Column(String, ForeignKey("workspaces.id"))
    name = Column(String, nullable=False)
    emoji = Column(String, default="📁")
    description = Column(String, nullable=True)
    color = Column(String, default="#D97706")
    pinned = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    # Collection sub-kind (ADR-015): 'standard' = a normal user collection;
    # 'playlist' = a music playlist (Music page only — hidden from the
    # collections page, sidebar, and every collection picker by the API's
    # default kind filter). NULL rows predate the column and mean 'standard'.
    kind = Column(String, default="standard")
    # For playlists: the source playlist URL it was ingested from (provenance +
    # future re-sync). NULL for standard collections.
    source_url = Column(String, nullable=True)
    # For playlist-kind collections: what the source actually was — 'album' or
    # 'playlist'. Albums render a single cover and an "Album" label instead of
    # the 4-cover collage. NULL (legacy/standard rows) means 'playlist'.
    music_kind = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    workspace = relationship("Workspace", back_populates="collections")
    memos = relationship("Memo", secondary=memo_collections, back_populates="collections")


class Tag(Base):
    __tablename__ = "tags"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, unique=True, nullable=False)
    
    memos = relationship("Memo", secondary=memo_tags, back_populates="tags")


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    workspace_id = Column(String, ForeignKey("workspaces.id"))
    collection_id = Column(String, ForeignKey("collections.id"), nullable=True)
    memo_id = Column(String, ForeignKey("memos.id"), nullable=True)
    title = Column(String, default="New Chat")
    model_used = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    workspace = relationship("Workspace", back_populates="chat_sessions")
    messages = relationship("Message", back_populates="session", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    session_id = Column(String, ForeignKey("chat_sessions.id"))
    role = Column(String, nullable=False)  # user | assistant | system
    content = Column(Text, nullable=False)
    sources_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    session = relationship("ChatSession", back_populates="messages")
