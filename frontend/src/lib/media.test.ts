import { describe, it, expect } from 'vitest';
import type { Memo, MemoType } from '@/types';
import { canSummarize } from './media';

// Minimal memo factory — canSummarize reads type, content_text, audio_kind,
// source_url and title (the last two only as the audio_kind fallback heuristic).
function m(p: Partial<Memo> & { type: MemoType }): Memo {
  return { id: 'x', content_text: 'some text', ...p } as unknown as Memo;
}

describe('canSummarize() — AI Summary eligibility (ADR-007)', () => {
  it('excludes music with an explicit audio_kind', () => {
    expect(canSummarize(m({ type: 'audio', audio_kind: 'music' }))).toBe(false);
  });

  it('excludes linked music inferred from source_url (no audio_kind)', () => {
    expect(
      canSummarize(m({ type: 'audio', source_url: 'https://soundcloud.com/a/song', title: 'Cool Song' })),
    ).toBe(false);
  });

  it('excludes uploaded music inferred from a non-voice title', () => {
    expect(canSummarize(m({ type: 'audio', title: 'track.mp3' }))).toBe(false);
  });

  it('allows a voice memo with an explicit audio_kind', () => {
    expect(canSummarize(m({ type: 'audio', audio_kind: 'voice' }))).toBe(true);
  });

  it('allows a voice memo inferred from the "Voice memo" title', () => {
    expect(canSummarize(m({ type: 'audio', title: 'Voice memo 2026-06-04' }))).toBe(true);
  });

  it('allows text-bearing non-audio types', () => {
    for (const type of ['video', 'article', 'link', 'document', 'code', 'file', 'note'] as MemoType[]) {
      expect(canSummarize(m({ type }))).toBe(true);
    }
  });

  it('excludes any memo with no content_text', () => {
    expect(canSummarize(m({ type: 'note', content_text: '' }))).toBe(false);
    expect(canSummarize(m({ type: 'article', content_text: undefined }))).toBe(false);
    expect(canSummarize(m({ type: 'image', content_text: undefined }))).toBe(false);
  });

  it('excludes music even when it has a transcript in content_text', () => {
    expect(
      canSummarize(m({ type: 'audio', audio_kind: 'music', content_text: 'la la la lyrics' })),
    ).toBe(false);
  });
});
