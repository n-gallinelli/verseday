// Pomodoro work-elapsed math.
//
// "Work elapsed" is the workedMs counter minus accumulated break time, plus any
// carried prior-cycle work (continue-mode break continuity). The per-second
// focus tick compares (workElapsed − workCycleStart) against the work duration
// to fire the break prompt; every site that re-anchors the cycle
// (workCycleStartRef / snoozeThresholdRef) MUST compute work-elapsed the same
// way. Previously this formula was hand-spelled in five places and the four
// anchor sites dropped the breakCarry term, so in continue mode the anchor sat
// breakCarry-too-low and the prompt re-fired instantly. One function makes that
// drift impossible.
export function workElapsedMs(rawWorkedMs: number, totalBreakMs: number, breakCarryMs: number): number {
  return rawWorkedMs - totalBreakMs + breakCarryMs;
}
