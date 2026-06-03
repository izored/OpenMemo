import type { Memo } from '@/types';

// Domains that use hotlink protection — proxy through backend.
export const HOTLINK_DOMAINS = ['dribbble.com', 'behance.net', 'pinterest.com', 'cdn.dribbble.com'];

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

export function mediaSrc(memo: Memo): string | null {
  if (memo.thumbnail_path) {
    if (memo.thumbnail_path.startsWith('http')) {
      const needsProxy = HOTLINK_DOMAINS.some((d) => memo.thumbnail_path!.includes(d));
      if (needsProxy)
        return `/api/proxy/image?url=${encodeURIComponent(memo.thumbnail_path)}&memo_id=${memo.id}`;
    }
    return memo.thumbnail_path;
  }
  if (memo.type === 'image' && memo.file_path) return `/api/memos/${memo.id}/file`;
  return null;
}
