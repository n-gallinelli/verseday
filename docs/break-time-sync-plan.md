# Break-time mismatch: Focus screen vs PiP — fix plan

**Author:** Terse · **Date:** 2026-07-07 · **Status:** PLAN — no code. Needs Verse plan approval. Functional (sync) fix, **no DB/schema change.**
**Distinct from** `break-prompt-unify-plan.md` (that's copy/styling of the break *prompt* buttons; this is the break *countdown* drift).

## Symptom
During a break, the full Focus screen and the PiP widget show **different remaining time** (PiP lags a second, freezes, or the "ends H:MM" labels disagree by a minute).

## Root cause (from recon)
The canonical break value lives **only** in `FocusMode` as an anchor: `breakStartRef` (`Date.now()` stamp) + `breakDuration`, from which it derives `breakRemaining` once/sec (`FocusMode.tsx:946-960`). The full screen renders that derived value.

**The PiP never receives the anchor** — only a pre-computed `breakRemaining` scalar snapshot inside the pushed `PipState` (`pipEvents.ts:72`), which it renders verbatim with **no clock of its own** (`FocusPip.tsx:770`). So the PiP is a *lagging mirror*, not an equal computation. Drift comes from:
- **Snapshot staleness** — PiP shows the last event's value; the tick (`FocusMode.tsx:874`) and the heartbeat re-emit (`FocusMode.tsx:1130`) are **unaligned 1 Hz intervals**, so the PiP can sit a second behind.
- **Freeze on dropped/throttled event** — if an emit is lost or the PiP window is backgrounded/throttled, the PiP number stops while the full screen keeps counting → unbounded growing gap.
- **Two independent `breakEndClock(Date.now(), remaining)` calls** (`FocusMode.tsx:2155`, `FocusPip.tsx:766`) with different `remaining` and different `Date.now()` → "ends" labels disagree.

## Principle
**Ship the anchor, not the scalar.** Give the PiP the absolute end instant and let it run its own 1 Hz clock off the *same number* the full screen uses. Events then only re-sync the anchor (which rarely changes), not the ticking value.

## Design
Add an absolute **`breakEndsAt: number | null`** (epoch ms) to `PipState`. Semantics:
- **Break running** → `breakEndsAt = breakStartRef.current + breakDuration`; PiP computes `remaining = max(0, breakEndsAt − Date.now())` on its own interval and ticks itself.
- **Break paused** → `breakEndsAt = null`; keep shipping the **frozen** `breakRemaining` scalar; PiP shows it and does **not** tick (matches the full screen freezing while paused).
- **Not on break** → `breakEndsAt = null`.

On resume, FocusMode already slides `breakStartRef` forward by the pause span (`FocusMode.tsx:1407-1417`); the recomputed `breakEndsAt` is pushed and the PiP resumes ticking from the corrected anchor. On break end, the PiP's local clock clamps at 0 until the phase-change event flips it to work — no negative countdown.

## Modules (small, ordered)
1. **Shared shape** — `src/utils/pipEvents.ts`: add `breakEndsAt: number | null` to `PipState` (keep `breakRemaining` for the paused/ended frozen value). Both windows are one build, so no cross-version compatibility concern.
2. **Emitter** — `src/pages/FocusMode.tsx` PipState builder (`~1064-1081`): set `breakEndsAt` from the **same** `breakStartRef`/`breakDuration` the tick uses (`946-948`) when `phase==="break" && !paused`, else `null`. Leave `breakRemaining` as the frozen fallback.
3. **Consumer** — `src/components/FocusPip.tsx` break branch (`737-780`): add a local 1 Hz `setInterval` that recomputes `remaining` from `breakEndsAt` when non-null; render that instead of `state.breakRemaining`. When `breakEndsAt == null`, render the pushed scalar (paused/frozen). Compute the "ends" label from `breakEndsAt` directly. Clear the interval when not on break.
4. **(Optional) Unify full screen** — have `BreakScreen` (`FocusMode.tsx:2144-2192`) also derive its countdown + "ends" label from the shared `breakEndsAt`, so both surfaces run identical math off one number. Low priority — FocusMode's tick already uses the same anchor, so the main screen isn't the drifting side; include only if we want pixel-identical labels.

## Non-goals / notes
- **No "extend running break +5/+10" today** — the PiP "+5 min" and the celebration snooze re-arm the *prompt* threshold, they don't lengthen a running break (`FocusPip.tsx:716`, `FocusMode.tsx:1451-1459`). If we add a real extend later, it bumps `breakDuration` → `breakEndsAt` recomputes → both surfaces converge for free under this model. Worth noting as the payoff.
- No store change: `appStore.onBreak` stays a status-only boolean (no time data), which is correct.
- No DB/schema/migration.
- `formatCountdown` already matches (`Math.ceil`) on both sides — no format skew to fix.

## Verse review checklist
- The `breakEndsAt`-null-while-paused representation vs. an explicit `breakPaused` flag — is null-anchor the cleanest, or do you want an explicit paused flag + frozen remaining?
- Whether to do Module 4 (unify full-screen math) now or leave it — the main screen isn't the drifting side.
- Local-interval lifecycle in the PiP (start on break-enter, clear on break-exit/unmount) — confirm no leak / double-interval with the existing liveness/completion intervals (`FocusPip.tsx:421,167`).
- Clamp-at-0 behavior until the phase-change event arrives (no negative flash).
- Confirm no DB/schema impact (none intended).
