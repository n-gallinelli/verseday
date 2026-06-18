import { getSetting, setSetting } from "../db/queries";

// General UI/display preferences (key-value settings). Kept separate from
// focusSettings.ts, which is scoped to the focus/Pomodoro surfaces.

// ── Strike through completed tasks ──────────────────────────────────────────
const KEY_STRIKETHROUGH_COMPLETED = "ui.strikethrough_completed";

/** Default ON — completed tasks have always been drawn with a line through the
 *  title; the toggle lets the user turn JUST the strikethrough off (the green
 *  check + faded text stay). */
export async function getStrikethroughCompleted(): Promise<boolean> {
  // Absent key → default true (historical behavior). Only an explicit "0" is off.
  return (await getSetting(KEY_STRIKETHROUGH_COMPLETED)) !== "0";
}

export async function setStrikethroughCompleted(v: boolean): Promise<void> {
  await setSetting(KEY_STRIKETHROUGH_COMPLETED, v ? "1" : "0");
}
