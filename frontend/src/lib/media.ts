import type { Memo, MemoType } from '@/types';

// There is no hotlink list here any more, on purpose. It existed so cards could
// render straight from dribbble/behance/pinterest through /api/proxy/image, and
// that is the design openMemo is not supposed to have: a picture on a card is a
// file on this machine, never a request to the source. See mediaSrc below and
// backend/core/pictures.py. The proxy route itself stays, since it also writes
// the fetched image to disk and is how a repair pass rescues a hotlinked cover.

/**
 * Gating predicate for the "Make it local" panel.
 *
 * Returns true ONLY when ALL of the following hold:
 *   1. memo.type is a localizable media type ("video" or "audio")
 *   2. memo.source_url exists — the memo is remote, not locally uploaded
 *   3. memo.file_path is absent — no local file has been saved yet
 *   4. memo.localize_status is not "done" — the download hasn't completed
 *
 * All other memo types (article, link, image, note, document, code, file)
 * return false — "Make it local" is meaningless for non-media or local memos.
 * Use this predicate at every render site so the logic can never drift.
 */
export function canMakeLocal(memo: Memo): boolean {
  return (
    (memo.type === 'video' || memo.type === 'audio') &&
    !!memo.source_url &&
    !memo.file_path &&
    memo.localize_status !== 'done'
  );
}

/**
 * Gating predicate for the "Get transcript" action.
 *
 * A transcript can be produced for any video/audio memo that has SOMETHING to
 * transcribe — either a local media file (Whisper STT) or a remote source_url
 * (caption-first, STT fallback; see ADR-004). This is non-destructive: the
 * memo keeps its type and embed. Host-agnostic — yt-dlp handles every video
 * provider, and unknown/auth-walled hosts simply fail gracefully to an error
 * state with "open original" still available.
 */
export function canTranscript(memo: Memo): boolean {
  return (
    (memo.type === 'video' || memo.type === 'audio') &&
    (!!memo.file_path || !!memo.source_url)
  );
}

/**
 * The memo's transcript text, or null when it doesn't have one.
 *
 * `content_text` is seeded at ingest with the source's own description/caption
 * and only later overwritten by a real transcript, so `transcript_status` alone
 * can't tell the two apart — a run that produced no text once left the status at
 * 'done' with the blurb still sitting there, and the Transcript card happily
 * showed an Instagram caption as "what is said in the video". The server settles
 * it with `has_transcript`; the string comparison is the fallback for payloads
 * predating that field. Every read site goes through here (ADR-001).
 */
export function transcriptText(memo: Memo): string | null {
  if (memo.transcript_status !== 'done') return null;
  const text = (memo.content_text || '').trim();
  if (!text) return null;
  if (typeof memo.has_transcript === 'boolean') return memo.has_transcript ? text : null;
  const blurbs = [(memo.video_description || '').trim(), (memo.description || '').trim()];
  return blurbs.includes(text) ? null : text;
}

// Video platform detection + embed URLs live in `lib/platforms.ts`; linked-audio
// hosts (SoundCloud/Bandcamp/Mixcloud/…) live in `lib/audioPlatforms.ts`. Both
// are single registries consumed by every render site (ADR-001). Re-exported
// here so existing `@/lib/media` import sites keep working.
export { audioEmbed, isAudioHost, audioPlatformMeta } from './audioPlatforms';

/**
 * Audio sub-kind for a memo (ADR-005): 'voice' | 'music', or null for non-audio.
 *
 *   • voice — a mic recording (waveform UI, no aurora, no inline card player)
 *   • music — an uploaded file OR linked SoundCloud/Bandcamp/… (cover-art
 *     player, inline card player, aurora glow)
 *
 * Reads the persisted `audio_kind` column; falls back to the same heuristic the
 * backend uses for rows saved before the column existed. Single source of truth
 * — every render site calls this, never re-derives.
 */
export function audioKind(memo: Memo): 'voice' | 'music' | null {
  if (memo.type !== 'audio') return null;
  if (memo.audio_kind === 'voice' || memo.audio_kind === 'music') return memo.audio_kind;
  if (!memo.source_url && memo.title?.startsWith('Voice memo')) return 'voice';
  return 'music';
}

/** True for uploaded/linked music (gets the cover player + inline card + aurora). */
export function isMusic(memo: Memo): boolean {
  return audioKind(memo) === 'music';
}

/** True for mic recordings (keep the waveform tile — no aurora/cover player). */
export function isVoice(memo: Memo): boolean {
  return audioKind(memo) === 'voice';
}

// Memo types eligible for the AI Summary panel (ADR-007). EDIT THIS SET to
// change which types get summarized — single source of truth, mirrored on the
// backend (`classify.can_summarize`). Music audio is excluded separately in
// `canSummarize` (a song is not summarizable text), regardless of this set.
const SUMMARIZABLE_TYPES = new Set<MemoType>([
  'note', 'article', 'link', 'video', 'audio', 'document', 'code', 'file',
]);

/**
 * Gating predicate for the AI Summary panel (ADR-007).
 *
 * True only when the memo has text to summarize AND its type is summarizable
 * AND it is not music. Music (`audio_kind === 'music'`) is always excluded:
 * summarizing a song's transcript/lyrics is meaningless. Voice memos (spoken
 * word) ARE summarizable. Edit SUMMARIZABLE_TYPES above to add/remove a type;
 * every render site reads this one predicate so eligibility can never drift.
 */
export function canSummarize(memo: Memo): boolean {
  if (!memo.content_text) return false;
  if (isMusic(memo)) return false;
  return SUMMARIZABLE_TYPES.has(memo.type);
}

/**
 * Is this memo still being actively pulled in the background? (OPNMMO-0050)
 *
 * Two cases the user should see as "working", not as a finished card:
 *   1. localize_status pending/processing — yt-dlp / headless scrape is
 *      downloading the media right now (the "couple of seconds" case the user
 *      flagged: an embed-less video or linked audio auto-downloading on save).
 *   2. is_processed === false AND there is no error — the memo's text is still
 *      being chunked + embedded. A localize error is NOT working: it failed and
 *      its own error chip takes over, so a memo never spins forever.
 *
 * Single source of truth — every render site (card badge, grid polling) reads
 * this so the "is it busy?" answer can never drift between them.
 */
export function isMemoWorking(memo: Memo): boolean {
  if (memo.localize_status === 'pending' || memo.localize_status === 'processing') return true;
  if (memo.localize_status === 'error') return false;
  return memo.is_processed === false;
}

/**
 * The image to render for a memo, or null for the type placeholder.
 *
 * Never returns a remote URL. A card that fetches its own picture from the
 * source is a live window onto someone else's server, not a saved thing, and
 * it goes blank whenever they decide — which is what happened to six
 * Instagram carousels in August 2026. The backend already strips remote image
 * URLs on the way out (backend/core/pictures.py); this is the second half of
 * the same rule, so a stale cached payload cannot reintroduce a hotlink.
 *
 * A memo whose picture has not landed yet reports `pictures_pending`, and the
 * card shows its placeholder until the download catches up.
 */
export function mediaSrc(memo: Memo): string | null {
  if (memo.thumbnail_path && !memo.thumbnail_path.startsWith('http')) return memo.thumbnail_path;
  if (memo.type === 'image' && memo.file_path) return `/api/memos/${memo.id}/file`;
  return null;
}

/**
 * Is this memo a PDF openMemo holds on disk?
 *
 * Decided from the stored file, not from `memo.type`. A .pdf upload is
 * categorized as "document" (backend/core/security/upload.py), which is also
 * what a .docx, an .epub and a .csv get, and the text extraction that follows
 * flattens all of them into the same wall of paragraphs. Only the extension
 * says which of those we can actually render as pages. The title is the
 * fallback because that is where the original filename lives.
 */
export function isPdf(memo: Memo): boolean {
  if (!memo.file_path) return false;
  const name = (memo.file_path || '').toLowerCase();
  return name.endsWith('.pdf') || (memo.title || '').toLowerCase().endsWith('.pdf');
}
