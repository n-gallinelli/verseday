# Focus Ambient Background

**What:** A 25-minute ambient background color journey during focus sessions — cool blue-neutral (`#f0f2f5`) through neutral (`#f5f3ee`) to warm amber-neutral (`#f5f0e6`). Applied via `.focus-ambient-bg` on the full-screen focus mode container. The animation runs `1500s` (25 min) with `ease-in-out forwards`, matching one Pomodoro cycle.

**Why:** Provides a subtle temporal cue that a full work cycle is progressing without requiring the user to check the timer. The warm shift echoes the VerseDay sunrise/sunset motif — you start cool and "arrive" at warmth by the end of the session. It reinforces the ritual feel of deep work without being consciously distracting.

**Reduced motion:** Gated behind `@media (prefers-reduced-motion: reduce)` — users who prefer reduced motion get a static neutral background instead of the animated journey.
