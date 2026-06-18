# Entitlements.plist — DO NOT add XML comments

`Entitlements.plist` (referenced from `tauri.conf.json` → `bundle.macOS.entitlements`)
**must stay comment-free.** Apple's AMFI entitlements parser is stricter than a normal
plist parser and rejects `<!-- ... -->` with:

    Failed to parse entitlements: AMFIUnserializeXML: syntax error near line N
    → codesign fails → `tauri build` fails

So keep that file as bare `<dict>` key/values only. Put any rationale here instead.

## Why the entitlement exists
Signing with the Apple Development cert (see `signingIdentity` in tauri.conf.json) turns on
**Hardened Runtime** (`codesign` flags=runtime). Under hardened runtime, EventKit (Calendar)
access needs `com.apple.security.personal-information.calendars` in addition to the
`NSCalendars*UsageDescription` strings in `Info.plist`, or the access is denied.

## Signing discipline (keeps the Calendar grant sticky)
Sign EVERY build with the SAME Apple Development cert ("Apple Development: Nicholas
Gallinelli (JB9CWAK77D)", Team `HS7UR8DA2Q`). Switching certs (e.g. to Distribution) or
back to ad-hoc changes the code-signing designated requirement, which re-keys macOS TCC and
brings back the "allow full access" prompt on every sync. The DR is Team-ID-anchored, so a
yearly Dev-cert renewal within the same team keeps the grant.
