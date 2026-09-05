# ADR-026: A memo can hold its own library

**Date:** 2026-09-05 · **Status:** Proposed · **Applies to:** memo model, dashboard, search, Mesh, backup

## Context

Every way of grouping things in openMemo asks you to decide first. A collection
has to be created and named before anything can go in it. A Space has to be
created before it can hold a library. Both are deliberate acts of filing, and
both are correct for material that earns them.

Most material does not. A recipe wants the video it came from. A flat wants the
listing, three photos and the agent's email. A song wants the interview about it.
None of those is a collection, so today the supporting material sits loose in the
library with nothing tying it to the thing it belongs to, or it forces a
container into existence that will hold four items and never grow.

The proposal: open any memo and attach things to it.

The risk is not the feature. The risk is that this becomes a **third way to put
things together**, competing with collections and Spaces. This repo has already
paid that bill once. The dashboard sort toggle was removed because three ordering
mechanisms fought each other and no resolution existed short of a rewrite, and
the rule that came out of it is written into `.claude/rules/`: use exactly one
mechanism. An ADR that does not answer the competition question has not earned
the feature.

## Decision

### 1. The distinction, in one sentence

> Collections group things you chose to file together. Spaces isolate an entire
> library. An **inner memo** is material that only makes sense next to its parent.

The test is whether the thing stands up alone. A conference talk you saved
belongs in the library and possibly in a collection. The slide deck for that
talk, the speaker's blog post and a photo of one slide are meaningful as *that
talk's* material and clutter as anything else. The first is a memo. The rest are
inner memos.

If a decision between a collection and an inner memo ever needs a paragraph to
explain, the feature has drifted and should be cut back.

**Guardrail that keeps it from competing:** there is no browsing surface for
inner memos as a category. No tab, no filter, no "Inner memos" page, no dashboard
section. They are reachable from their parent and from search. The moment inner
memos get their own index they have become a rival organiser, and this ADR is
void.

### 2. Inner memos are real memos

They are rows in `memos`, not a new entity and not a JSON blob on the parent.

Everything openMemo does to a memo it must also do to these: full-text and vector
search, thumbnails, localizing pictures to disk, downloading media, backup,
restore, Mesh sync, integrity checks, PDF rendering. A separate lightweight
entity would need every one of those rebuilt, and the first bug report would be
"why can't I search inside my memos".

The cost is dashboard clutter, and that problem is already solved. `Collection`
carries `hidden_from_dashboard`, documented in the model as a decluttering switch
and explicitly **not** a privacy feature (`Memo.hidden` is the passcode-gated
one). The same idea extends to memos:

- Add `Memo.hidden_from_dashboard`, default `false`, mirroring the collection flag.
- A memo **created inside** a parent gets it set to `true`.
- A memo that **already existed** and is later linked to a parent keeps it
  `false`, because the user filed that one deliberately and it is not ours to
  hide.
- The user can toggle it, exactly as they can for a collection.

Search always finds them. A hit shows its parent, so the result explains itself.

### 3. Many parents, via a join table

`memo_links(parent_memo_id, child_memo_id, sort_order, created_at)`, following
`memo_collections` and `memo_tags`, which already establish the pattern.

A `parent_id` column on `memos` is simpler and is wrong the first time one
reference belongs to two subjects, which is the ordinary case rather than the
exotic one: the same datasheet serves two projects. Going from one to many later
is a migration plus a UI rethink; going from many to one is never needed. The
join table costs one table now.

**Depth is capped at one level.** A memo can hold memos. Those cannot hold more.

This is the decision that keeps the feature small. Unbounded nesting is a file
system, and a file system is the ceremony this feature exists to avoid. Capping
at one level also removes cycle detection entirely: with no grandchildren there
is no cycle to detect, and the only rule to enforce is that a memo which is
already someone's child cannot become a parent.

`sort_order` on the join row, not on the memo, because the same child can sit in
two parents in different positions. Memos already carry their own `sort_order`
for the dashboard and reusing it here would make the two orders fight.

### 4. Deleting a parent never buries a child

Deletion is already soft (`Memo.is_deleted`). Deleting a parent deletes the
parent only.

- Join rows survive, so restoring the parent restores its shelf intact.
- A child whose `hidden_from_dashboard` was set **by attachment** and which now
  has no remaining live parent gets that flag cleared, so it returns to the
  dashboard rather than existing only inside a deleted thing.
- A child the user hid by hand stays hidden. Their choice outranks ours.
- Permanently deleting a parent removes its join rows and applies the same
  un-hiding pass.

The failure this prevents is the one that matters: material that is invisible in
the dashboard, has no parent to be seen inside, and is therefore reachable only
by search for a word the user may not remember.

## What this touches

| Area | Work |
|---|---|
| Schema | `memo_links` table, `Memo.hidden_from_dashboard` column, both via `_run_migrations` |
| Dashboard | exclude `hidden_from_dashboard` memos from the feed and type tabs, as collections already are |
| MemoDetail | a section listing attached memos, a drop target, add-existing picker |
| Search | results show the parent for an inner memo |
| Backup / restore | `memo_links` in the archive, or restores lose every shelf |
| Mesh | the join table syncs, or two machines disagree about what is attached |
| Spaces | a child follows its parent's `workspace_id`; moving a parent moves its children |

Drag and drop is free: ADR-023 already puts a global drop layer over the app, so
dropping a file or a link onto an open memo needs a target, not a mechanism.
Gallery already renders multi-item memos. `/api/memos/:id/related` already
computes affinity and is the obvious source for "attach one of these".

## What this costs

- **A second axis on the dashboard.** Two flags now decide whether a memo appears
  in the feed (`hidden`, `hidden_from_dashboard`). That is one more thing to
  reason about when a memo is missing, and the Settings copy has to say which is
  which.
- **A migration on a live library** for anyone upgrading, including the macOS app.
- **A new way to lose track of something.** Mitigated by section 4, but the honest
  version is that any container can swallow things.

## Alternatives rejected

- **Use collections for this.** It is what exists, and the ceremony is the
  problem. A collection per subject produces hundreds of four-item collections
  and buries the ten real ones.
- **A rich-text field with links.** Cheap and dead: the references would not be
  memos, so nothing is searchable, downloadable or backed up. It fails ADR-025,
  which says a picture openMemo shows is a file openMemo owns.
- **Unlimited nesting.** See section 3. It is a file system with extra steps.

## Status

Proposed. Not built. The one-sentence distinction in section 1 is the acceptance
test for the whole idea: if it stops being sayable, stop building.
