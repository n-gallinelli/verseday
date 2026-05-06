// Calendar permission TS surface (M3).
//
// Thin wrappers around the three `calendar_*_permission` Tauri commands
// from M1. The literal type mirrors Rust's `PermissionStatus` enum
// (#[serde(rename_all = "lowercase")]).

import { invoke } from "@tauri-apps/api/core";

/** Mirrors Rust's PermissionStatus. EventKit on macOS 14+ collapses
 *  Restricted/WriteOnly/future-unknown variants into 'denied' (see
 *  src-tauri/src/calendar.rs::map_status). */
export type PermissionStatus = "granted" | "denied" | "prompt";

export async function checkPermission(): Promise<PermissionStatus> {
  return invoke<PermissionStatus>("calendar_check_permission");
}

/** Triggers the EventKit system prompt if status is 'prompt'.
 *  Returns the resulting status — 'granted', 'denied', or still
 *  'prompt' (rare, MDM-managed devices). */
export async function requestPermission(): Promise<PermissionStatus> {
  return invoke<PermissionStatus>("calendar_request_permission");
}
