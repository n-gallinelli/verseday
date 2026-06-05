import { describe, it, expect } from "vitest";
import { selectRunningSession, selectFocusedTask, type SessionState, type FocusView } from "./appStore";
import type { Task } from "../types";

// Stage 5 — the FocusState union is split into two orthogonal store fields:
// `session` (canonical running) and `focusView` (preview staging). A preview can
// never be read as running because they're different fields. These pin the
// selectors that encode that: running ⟺ session !== null; the focused task is
// the session's, else the preview's.
// minimal AppState slice for the pure selectors under test
const st = (p: { session: SessionState | null; focusView: FocusView | null; tasksById?: Map<number, Task> }) =>
  p as unknown as Parameters<typeof selectFocusedTask>[0];

const session: SessionState = {
  timeEntryId: 42,
  taskId: 7,
  paused: false,
  workedMs: 1000,
  previousPage: "daily",
  priorElapsedMs: 0,
};
const view: FocusView = { taskId: 9, previousPage: "daily", priorElapsedMs: 0 };
const task7 = { id: 7, title: "seven" } as Task;
const task9 = { id: 9, title: "nine" } as Task;
const tasksById = new Map<number, Task>([[7, task7], [9, task9]]);

describe("selectRunningSession — running ⟺ session !== null", () => {
  it("returns the session when running", () => {
    expect(selectRunningSession(st({ session, focusView: null }))).toBe(session);
  });
  it("a preview is NOT running (null)", () => {
    expect(selectRunningSession(st({ session: null, focusView: view }))).toBeNull();
  });
  it("nothing focused → null", () => {
    expect(selectRunningSession(st({ session: null, focusView: null }))).toBeNull();
  });
});

describe("selectFocusedTask — session first, then preview, else null", () => {
  it("resolves the running session's task", () => {
    expect(selectFocusedTask(st({ session, focusView: null, tasksById }))).toBe(task7);
  });
  it("resolves the previewed task when not running", () => {
    expect(selectFocusedTask(st({ session: null, focusView: view, tasksById }))).toBe(task9);
  });
  it("null when neither is set", () => {
    expect(selectFocusedTask(st({ session: null, focusView: null, tasksById }))).toBeNull();
  });
});
