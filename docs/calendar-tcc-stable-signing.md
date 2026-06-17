# Plan — Stop the repeated Calendar permission prompt (stable code signing)

**Author:** Terse
**Date:** 2026-06-17
**Status:** PENDING Verse review (signing/entitlements — security-relevant)
**Branch (proposed):** `fix/calendar-tcc-signing` (off `build/combined-install`)
**Scope:** Build config (`tauri.conf.json`) + `Info.plist` key. No app logic. Needs a
ONE-TIME manual step by Nick (TCC reset + keychain allow). No DDL.

## Symptom
"verseday.app would like full access to your Calendar" re-prompts on (manual) calendar
sync, repeatedly. Nick syncs 3–4×/day and wants to grant ONCE, forever.

## Root cause (confirmed) — unstable code signature, not a code bug
- The calendar code is correct: auto-sync only READS `authorizationStatusForEntityType`
  (`calendar.rs:249`) and never requests; the request fires only when status is
  `notDetermined` (`CalendarSettings.tsx:321`).
- `codesign -dv /Applications/verseday.app` shows: `Signature=adhoc`, `linker-signed`,
  `Info.plist=not bound`, `Identifier=app-22a141d36a15f70e` (random per build),
  `TeamIdentifier=not set`. macOS TCC keys a grant to the app's code identity; an ad-hoc
  linker signature changes its cdhash/identity on **every rebuild**, so each
  rebuild+reinstall makes TCC treat it as a new app → grant forgotten → status reads
  `notDetermined` → re-prompt on the next sync. The repeated reinstalls this session are
  exactly the trigger.

## The fix — sign with a stable identity Nick already has
`security find-identity -v -p codesigning` shows two valid certs in the keychain:
`Apple Development: Nicholas Gallinelli (JB9CWAK77D)` and `Apple Distribution …`. Signing
every build with the **Apple Development** identity gives a stable, Team-ID-based
designated requirement that does NOT change across rebuilds → TCC keeps the grant.

### 1. `src-tauri/tauri.conf.json` — `bundle.macOS`
```json
"macOS": {
  "minimumSystemVersion": "14.0",
  "signingIdentity": "Apple Development: Nicholas Gallinelli (JB9CWAK77D)"
}
```
(Equivalent: the SHA-1 `FF6F6A2D19F72BD6057EB272014809BF476CB972`.) No hardened runtime,
no entitlements file — not needed for a local, non-sandboxed app, and avoids pulling in
notarization. Stable identity is the only thing TCC needs.

### 2. `src-tauri/Info.plist` — add the macOS 14+ full-access key
Currently only the deprecated `NSCalendarsUsageDescription` is present.
`requestFullAccessToEventsWithCompletion` (Sonoma+/macOS 26) reads
`NSCalendarsFullAccessUsageDescription`. Add it (keep the old key for back-compat):
```xml
<key>NSCalendarsFullAccessUsageDescription</key>
<string>VerseDay reads your Calendar.app events to surface them as tasks for the day. Data stays local to this device and is never sent anywhere.</string>
```

### 3. One-time manual step (Nick), AFTER the first install with the new signing
```
tccutil reset Calendar com.verseday.app
```
Clears stale ad-hoc grants so the next grant lands clean under the new stable identity.
Then sync once → Allow Full Access → it persists across all future rebuilds.
(First `tauri build` after this may pop a keychain prompt "codesign wants to use key …" →
choose **Always Allow**.)

## Risk / blast radius
- One-time re-prompt on the first signed build (expected); stable thereafter.
- Identity change may affect notifications: `notify.rs` fell back to NSUserNotification
  *because* the app was ad-hoc ("UNUserNotifications needs proper code signing"). A real
  Development cert could change which notification API is viable — FLAG: verify the focus
  PiP / break notifications still fire after the switch (eyes-on). The current code path
  shouldn't break, but the signing change is exactly what that fallback keyed on.
- Gatekeeper: a Development-signed app run locally by the signing user is fine (not
  notarized; Nick runs his own build).
- No app logic changes; pure build/identity + Info.plist.

## Self-validation
- `tauri build` succeeds and `codesign -dv` on the output shows `TeamIdentifier=JB9CWAK77D`
  (not `adhoc`), `Identifier=com.verseday.app`.
- Reinstall, `tccutil reset Calendar com.verseday.app`, grant once, sync again → NO prompt.
- Rebuild + reinstall once more → sync → STILL no prompt (the real test that the identity
  is stable across builds).
- Eyes-on: calendar events still import as tasks; notifications still fire.

## Out of scope
- Notarization / Developer ID distribution (this is a local install).
- Hardened runtime + calendar entitlement (only needed if we later sandbox/notarize).
