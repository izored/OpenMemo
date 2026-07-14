// Pure helpers for the global file drag-and-drop layer (ADR-023). No React,
// no store, no DOM side effects — just the decisions the FileDropLayer makes
// on a drop: is this an OS-file drag, where does it land, and how is it routed.

import type { Collection } from '@/types';

// A drag carries OS files (as opposed to dnd-kit's internal card reorder, which
// is pointer-driven and carries no `Files` type). This one check is what keeps
// the veil from raising while a memo card is being dragged onto a collection.
export function dragHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  // `types` is a DOMStringList in some browsers — normalize to a plain array.
  return Array.from(dt.types || []).includes('Files');
}

// Read the actual File objects off a drop's DataTransfer. Prefers `items`
// (filtered to kind === 'file') and falls back to `files` for older browsers.
export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.items && dt.items.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
    if (out.length) return out;
  }
  return dt.files ? Array.from(dt.files) : [];
}

export interface DropTarget {
  // 'instant' uploads straight to the resolved bucket; 'prefill' stages the
  // files into the New-Memo panel so the user picks a home first (ADR-023 §4).
  mode: 'instant' | 'prefill';
  // The bucket the files land in. 'music' routes audio through the album path.
  scope: 'collection' | 'space' | 'music' | 'library';
  collectionId?: string;
  workspaceId?: string;
  // Human label for the veil, e.g. "🗂️ Fitness" or "your library".
  label: string;
}

interface ResolveArgs {
  pathname: string;
  activeSpace: string | null;
  activeCollection: string | null;
  // The collections currently in scope (library or the open Space), used only
  // to name the target in the veil. Missing names degrade to a generic label.
  collections?: Pick<Collection, 'id' | 'name' | 'emoji'>[];
  spaceName?: string | null;
  spaceEmoji?: string | null;
}

// Tier-1 page-default targeting (ADR-023 §2). Reads where the user already is
// from the route + store and decides the bucket AND the commit mode. Clear
// buckets (a collection, a Space, the Music page) ingest instantly; ambiguous
// surfaces (bare library, lists, detail, ask) prefill the panel.
export function resolveDropTarget({
  pathname,
  activeSpace,
  activeCollection,
  collections = [],
  spaceName,
  spaceEmoji,
}: ResolveArgs): DropTarget {
  // Music page: audio goes through the album/playlist ingest. Instant.
  if (pathname.startsWith('/music')) {
    return { mode: 'instant', scope: 'music', workspaceId: activeSpace || undefined, label: 'your music' };
  }

  // Inside a collection (dashboard filter or a Space's collection view). Instant.
  if (activeCollection) {
    const c = collections.find((x) => x.id === activeCollection);
    const label = c ? `${c.emoji || '📁'} ${c.name}` : 'this collection';
    return {
      mode: 'instant',
      scope: 'collection',
      collectionId: activeCollection,
      workspaceId: activeSpace || undefined,
      label,
    };
  }

  // Inside a Space, no collection open. Instant into the Space.
  if (activeSpace) {
    const label = spaceName ? `${spaceEmoji || '🗂️'} ${spaceName}` : 'this Space';
    return { mode: 'instant', scope: 'space', workspaceId: activeSpace, label };
  }

  // Bare library / Spaces list / Collections list / memo detail / Ask — no
  // single bucket. Prefill the panel so the user chooses (ADR-023 §4).
  return { mode: 'prefill', scope: 'library', label: 'your library' };
}

// Type routing (ADR-023 §3): on the Music page a pure-audio drop becomes an
// auto-grouped album; everything else is one memo per file.
export function isAllAudio(files: File[]): boolean {
  return files.length > 0 && files.every((f) => f.type.startsWith('audio/'));
}
