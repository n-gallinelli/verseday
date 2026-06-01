# Stale branch cleanup (2026-06-01)

Four ~4-week-old local branches (from May 4–6, before the M3 canonical-store
refactor and the `feat/focus-screen-unified` merge) were reviewed. Verse
confirmed at the ref/content level and approved the deletions below.

Tip SHAs recorded for recovery (unreachable objects are gc-pruned in ~2 weeks —
`git fsck --lost-found` / `git reflog` within that window):

## Deleted (superseded — content already in main or deliberately redone)
- `feat/shutdown-mood-column` → **450d7611410c43c74d87ecada6a793b1716373d7**
- `feat/shutdown-review-polish` → **450d7611410c43c74d87ecada6a793b1716373d7**
  (literal duplicate ref — same SHA as above)
- `tweak/focus-two-column` → **5df8564fb754881974c6c38776e558a5dbc3d94f**
  (38-commit dev trail of the two-column focus redesign; that design + its doc
  `docs/2026-05-06-focus-two-column.md` shipped via the focus-unified merge)

`450d761`'s headline content (VerseDayLogo, local-date fix) is in main, redone
not merged. Merging any of these would revert/conflict against M3 + focus-unified.

## Held for Nick's call (real unmerged work)
- `feat/focus-collapsed-sidebar` → **e3cf95110cece709235a27c36574e0213f760ac6**
  ("expandable collapsed sidebar on focus screens"). The only branch with work
  not reproduced in main. Built on the stale pre-M3 base, so NOT mergeable
  as-is. Its design doc (`docs/2026-05-05-focus-collapsed-sidebar.md`) is
  salvaged into main so the idea survives the branch. If the feature is still
  wanted, rebuild fresh on current main from that doc (+ the e3cf951 SHA above
  for reference); otherwise delete the branch.
