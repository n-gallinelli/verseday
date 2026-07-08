// Break-prompt button labels — the single source shared by the full Focus
// screen (BreakCelebration) and the compact PiP prompt, so the two surfaces
// can't drift in copy again. Order is also canonical: Rest now → In 5 min →
// Skip it (primary → secondary → tertiary).
export const BREAK_PROMPT = {
  restNow: "Rest now",
  inFiveMin: "In 5 min",
  skipIt: "Skip it",
} as const;
