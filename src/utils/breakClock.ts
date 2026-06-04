// "Break ends at" clock label for the focus break screen.
//
// Given the current instant and the remaining break time, returns the
// wall-clock time the break will end, as a 12-hour "h:mm" (no am/pm) — e.g.
// 14:39 + 3m → "2:42". Pure (now is passed in) so it's unit-testable; the
// caller passes Date.now(). Local timezone via Date getters.
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function breakEndClock(nowMs: number, remainingMs: number): string {
  const d = new Date(nowMs + Math.max(0, remainingMs));
  const h12 = ((d.getHours() + 11) % 12) + 1; // 0→12, 13→1, 23→11
  return `${h12}:${pad2(d.getMinutes())}`;
}
