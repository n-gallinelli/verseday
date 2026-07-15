import { describe, it, expect } from "vitest";
import { displayElapsed } from "./displayElapsed";

// displayElapsed — the pip smooths its work-elapsed readout between (possibly
// throttled) state emits by adding monotonic time since the value was received.
// Display-only; never touches the authoritative workedMs / DB path.
describe("displayElapsed", () => {
  it("running → advances by the monotonic delta since receipt", () => {
    // received 10s at mono=1000; 700ms later → 10.7s
    expect(displayElapsed(10_000, 1000, 1700, false)).toBe(10_700);
  });

  it("running → keeps advancing across a throttled gap (no emit for ~2s)", () => {
    // received 10s at mono=1000; 2100ms later, still no fresh emit → 12.1s
    expect(displayElapsed(10_000, 1000, 3100, false)).toBe(12_100);
  });

  it("paused/frozen → returns the pushed scalar verbatim (no interpolation)", () => {
    expect(displayElapsed(10_000, 1000, 5000, true)).toBe(10_000);
  });

  it("queued/preview → frozen path shows the static prior time", () => {
    // a queued preview carries prior logged time; must not tick up
    expect(displayElapsed(180_000, 500, 9999, true)).toBe(180_000);
  });

  it("re-sync resets the baseline → interpolation starts fresh from the new emit", () => {
    // first emit: 10s at mono=1000, read at 1500 → 10.5s
    expect(displayElapsed(10_000, 1000, 1500, false)).toBe(10_500);
    // fresh emit re-stamps: 12s at mono=2000, read at 2300 → 12.3s
    expect(displayElapsed(12_000, 2000, 2300, false)).toBe(12_300);
  });

  it("clamps a non-positive delta to 0 (never renders below the received value)", () => {
    // now < receivedAt (shouldn't happen with a monotonic clock) → floor at elapsedMs
    expect(displayElapsed(10_000, 2000, 1000, false)).toBe(10_000);
    // now === receivedAt → exactly the received value
    expect(displayElapsed(10_000, 2000, 2000, false)).toBe(10_000);
  });
});
