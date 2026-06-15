import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit tests for syncTodayIfReady — the morning-sync gating primitive.
//
// It must (1) no-op when calendar import is disabled, (2) no-op when EventKit
// permission isn't granted, and (3) when both gates pass, run the date sync and
// surface the SyncResult. The App.tsx rollover caller gates reconcile on
// `created > 0`, so these also pin the value that gate reads (created>0 →
// reconcile fires; created===0 → it doesn't), parity with hooks.ts:178.

const getEnabled = vi.fn<() => Promise<boolean>>();
const checkPermission = vi.fn<() => Promise<string>>();
const invoke = vi.fn();
const upsertCalendarTask = vi.fn();
const getDismissedExternalIds = vi.fn<() => Promise<string[]>>();
const setSetting = vi.fn();
const getExcludedCalendarIds = vi.fn<() => Promise<Set<string>>>();
const todayIso = vi.fn<() => string>();

vi.mock("../utils/dates", () => ({
  // Distinct date per test (see beforeEach) so sync.ts's module-level per-date
  // TTL never short-circuits a later test — otherwise the "already exists →
  // created===0" case could pass via a stale-fresh TTL instead of the upsert.
  todayString: () => todayIso(),
}));
vi.mock("./settings", () => ({
  getEnabled: () => getEnabled(),
  getExcludedCalendarIds: () => getExcludedCalendarIds(),
}));
vi.mock("./permissions", () => ({
  checkPermission: () => checkPermission(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("../db/queries", () => ({
  upsertCalendarTask: (...args: unknown[]) => upsertCalendarTask(...args),
  getDismissedExternalIds: () => getDismissedExternalIds(),
  setSetting: (...args: unknown[]) => setSetting(...args),
}));

import { syncTodayIfReady } from "./sync";
import type { CalendarEvent } from "./types";

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    externalId: "evt-1",
    calendarId: "cal-1",
    calendarName: "Work",
    title: "Standup",
    startLocal: "2026-06-15T09:00",
    endLocal: "2026-06-15T09:30",
    allDay: false,
    status: "confirmed",
    notes: null,
    location: null,
    url: null,
    attendees: [],
    organizerEmail: null,
    selfStatus: "accepted",
    ...over,
  };
}

let dayCounter = 1;

beforeEach(() => {
  vi.clearAllMocks();
  // Unique date per test → fresh TTL bucket in sync.ts.
  todayIso.mockReturnValue("2026-06-" + String(dayCounter++).padStart(2, "0"));
  // Defaults for the "ready" path; individual tests override the gates.
  getEnabled.mockResolvedValue(true);
  checkPermission.mockResolvedValue("granted");
  getExcludedCalendarIds.mockResolvedValue(new Set());
  getDismissedExternalIds.mockResolvedValue([]);
  invoke.mockResolvedValue([event()]);
  upsertCalendarTask.mockResolvedValue(true);
  setSetting.mockResolvedValue(undefined);
});

describe("syncTodayIfReady gating", () => {
  it("no-ops when calendar import is disabled (never hits EventKit)", async () => {
    getEnabled.mockResolvedValue(false);
    const res = await syncTodayIfReady();
    expect(res).toEqual({ created: 0, skipped: 0 });
    expect(checkPermission).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("no-ops when permission is not granted (never hits EventKit)", async () => {
    checkPermission.mockResolvedValue("denied");
    const res = await syncTodayIfReady();
    expect(res).toEqual({ created: 0, skipped: 0 });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("never rejects — swallows + logs a sync failure", async () => {
    invoke.mockRejectedValue(new Error("EventKit blew up"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await syncTodayIfReady();
    expect(res).toEqual({ created: 0, skipped: 0 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("syncTodayIfReady result drives the caller's reconcile gate", () => {
  it("created>0 when ready and an event is inserted (reconcile fires)", async () => {
    upsertCalendarTask.mockResolvedValue(true);
    const res = await syncTodayIfReady();
    expect(res.created).toBeGreaterThan(0);
  });

  it("created===0 when ready but the event already exists (no reconcile)", async () => {
    upsertCalendarTask.mockResolvedValue(false); // existing external_id → skipped
    const res = await syncTodayIfReady();
    expect(res.created).toBe(0);
  });
});
