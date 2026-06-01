# Stability hardening — logged follow-ups (post-effort)

Not in scope for the A–D branches; recorded so they aren't lost.

- **Fix `react-hooks/exhaustive-deps` ESLint config (high-value, near-zero-cost).**
  The rule is misconfigured repo-wide ("Definition for rule
  'react-hooks/exhaustive-deps' was not found"), so the existing
  `// eslint-disable-next-line` directives reference an unknown rule and there's
  **no lint safety net for dependency-array edits**. Branch C made several
  (#8, #14), verified by hand. Wiring up `eslint-plugin-react-hooks` so future
  dep edits are caught is the right reliability follow-up. (Verse note, Branch C.)
- **#3 project-edit propagation** — deferred (M5). If it becomes annoying, the
  lightweight version is a single `verseday:project-changed` broadcast that
  holders re-fetch on; no store rewrite. (Brief, Out of Scope.)
- **#12 polling-while-hidden** — only the await-on-send + grace-window fixes
  shipped in Branch D (decision b). The event-driven `setTimeout`-to-next-event
  rewrite that would eliminate the 30s background poll was deferred as too
  structural for this pass. Revisit if battery/wake cost matters.
