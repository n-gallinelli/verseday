# Global quick-add task hotkey

**Author:** Terse
**For review by:** Verse
**Status:** Revision 4 — main window lifecycle locked to hide-on-close (Path A); rev 3 + Verse's review #3 corrections

## The user's request

> I want there to be a global button for adding a task. If I click Cmd+Shift+V
> no matter what window I'm focused on, I want an "add task" little bar to pop
> up in the middle of my screen so I can quickly add a task to VerseDay on the
> fly without having to focus on it. It should have the option to add estimate
> time and a project, but if I click Enter it should accept the task and
> disappear.

Critical bits:
- **OS-level shortcut** — works even when VerseDay isn't the focused app.
- **Mid-screen popup** — *not* the main window coming forward. A separate small
  bar that floats over whatever the user is doing.
- Fields needed: title, estimate, project. Date can default to today.
- **Enter submits + dismisses.** Esc cancels + dismisses.

## Architecture choice — multi-window with URL hash routing

There's already a precedent in this codebase, **but it's not where revision 1
said it was.** Verse caught the factual error.

The actual situation:

- `tauri.conf.json` declares **only one window**: `main` ("VerseDay"). It does
  *not* declare focus-pip.
- `FocusMode.tsx:142` creates the focus-pip window **at runtime** via
  `new WebviewWindow("focus-pip", { url: "/#focus-pip", ... })`.
- `capabilities/default.json:7` lists `focus-pip` in the windows array so the
  runtime create call has permission.
- `App.tsx:49` routes by URL hash:
  ```ts
  if (window.location.hash === "#focus-pip") return <FocusPip />;
  return <MainApp />;
  ```

The hash-routing half of the precedent is solid. The window-creation half is
runtime-from-JS, which is the wrong choice for a global quick-add (see below).

The quick-add bar will reuse the **hash-routing** half of the precedent
verbatim, but will create the window **from Rust `.setup()` instead of from
JS** — see *Step 3*.

## What's new vs. what already exists

| Concern | Already in place | Needs to be added |
|---|---|---|
| Multi-window runtime support | ✅ `focus-pip` runtime-create precedent (FocusMode.tsx:142) | — |
| Window permissions wiring | ✅ `core:window:*` granted in `capabilities/default.json` | Add `quick-add` label to that capability's `windows` array |
| URL hash routing | ✅ `App.tsx:49` already does it for `#focus-pip` | Add an `#quick-add` branch |
| SQLite plugin | ✅ `tauri-plugin-sql` works from any window | — |
| **Global hotkey registration** | ❌ no precedent | New plugin: `tauri-plugin-global-shortcut` (Rust + JS) |
| **Window create from Rust `.setup()`** | ❌ no precedent (focus-pip is JS-side) | New code in `lib.rs` |
| Quick-add UI component | ❌ doesn't exist | New `QuickAdd.tsx` page |
| Window show/hide logic | ❌ doesn't exist | Rust handler invoked by the global shortcut callback |
| **Settings UI for hotkey remap + permission status** | ❌ doesn't exist (per Verse, in scope for this PR) | New row in `Settings.tsx` + persisted setting + first-run confirmation modal |

## Implementation plan

### Step 1 — Add `tauri-plugin-global-shortcut` dependency

**Cargo:**
```toml
# src-tauri/Cargo.toml
tauri-plugin-global-shortcut = "2"
```

**npm:**
```
@tauri-apps/plugin-global-shortcut
```

Both sides of the plugin are MIT/Apache, free, no service costs. Zero-budget
rule satisfied.

### Step 2 — Register the plugin in the Rust builder

```rust
// src-tauri/src/lib.rs
.plugin(tauri_plugin_global_shortcut::Builder::new().build())
```

### Step 3 — Create the quick-add window from Rust `.setup()` (NOT from JS, NOT from `tauri.conf.json`)

This is the locked decision per Verse's review. Three options were considered:

| Option | Where window is created | Cold-start latency | Survives main window not yet rendered? | Verse verdict |
|---|---|---|---|---|
| (a) JS `useEffect` in `MainApp` mount | After main window first render | ~0ms after main render, but main render gates it | ❌ shortcut is dead until main has rendered | ❌ rejected |
| (b) **Rust `.setup()` at runtime startup** | **Before any frontend code runs** | **0ms — ready the instant the dock icon stops bouncing** | **✅** | **✅ chosen** |
| (c) Rust on first shortcut press | Lazy, on demand | ~200ms cold spinner every press | ✅ but UX-killing | ❌ rejected |

**Why (b):** the entire point of a global capture tool is that it's instant.
Option (a) means if VerseDay just launched and the user hits the hotkey
before the main window has rendered, nothing happens. Option (c) means every
press takes 200ms, which kills the magic. Option (b) creates the window once,
in Rust, before anything else runs, and from that moment forward the show /
hide cycle is instant.

In `src-tauri/src/lib.rs`, inside `tauri::Builder::default().setup(|app| { ... })`:

```rust
use tauri::{WebviewUrl, WebviewWindowBuilder};

WebviewWindowBuilder::new(
    app,
    "quick-add",
    WebviewUrl::App("index.html#quick-add".into()),
)
.title("VerseDay — Quick Add")
.inner_size(600.0, 80.0)
.resizable(false)
.decorations(false)
.transparent(true)
.always_on_top(true)
.skip_taskbar(true)
.center()
.visible(false)
.focused(false)
.build()?;
```

Key flags:
- `decorations(false)` → no title bar
- `transparent(true)` → rounded corners via CSS
- `always_on_top(true)` → floats over other apps when shown
- `skip_taskbar(true)` → no dock icon for this window
- `visible(false)` + `focused(false)` → created at startup but hidden until
  the hotkey is pressed
- `center()` → centered on the active monitor on first show; subsequent
  re-centering happens inside the shortcut handler via `set_position`

The shortcut handler (also in Rust, registered via the plugin) just calls
`app.get_webview_window("quick-add").show() + set_focus()`. Both are already
covered by the existing `core:window:allow-set-focus` permission line at
`capabilities/default.json:17`. Save handling stays in the JS side of the
quick-add window — Rust only owns lifecycle.

### Step 4 — Grant capabilities (with scope hardening per Verse)

The quick-add window itself needs window permissions to receive show/hide
calls. Add `quick-add` to the `default.json` `windows` array:

```json
// src-tauri/capabilities/default.json
"windows": ["main", "focus-pip", "quick-add"]
```

The `global-shortcut:*` permissions are **scoped only to the main window** —
the quick-add window has no business registering or unregistering shortcuts
itself. Defense in depth is cheap. Create a new dedicated capability file:

```json
// src-tauri/capabilities/global-shortcut.json (NEW)
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "global-shortcut",
  "description": "Global hotkey registration — main window only",
  "windows": ["main"],
  "permissions": [
    "global-shortcut:default",
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister",
    "global-shortcut:allow-is-registered"
  ]
}
```

### Step 5 — Ship unbound; first launch routes to Settings to pick a binding

**Decision locked**: nothing is registered until the user explicitly opts in
from the Settings UI. Default binding: **none** (`null`). Suggested
pre-filled value in the Settings picker: **`Cmd+Shift+A`** (the only one of
the candidate alternatives that doesn't collide with a heavy-traffic
system-wide binding — see *Binding research* below).

#### Why "ship unbound" over "ship pre-bound to Cmd+Shift+A"

Verse argued strongly for unbound, even though `Cmd+Shift+A` is clean:

1. The user's original Cmd+Shift+V request was uninformed. Baking *any*
   global hotkey in as a silent default ambushes the user the first time
   another app's binding gets hijacked.
2. The Settings UI is already in this PR (per rev 2). Routing first launch
   into it is the same code path, just entered earlier — zero extra cost.
3. If macOS asks for Accessibility permission and the user declines, they're
   already sitting in Settings looking at the deny banner with a fix path.
   "Register on launch" would silently fail with no recovery context.
4. Default is a one-line setting, not an architecture. If "ship unbound"
   creates friction, flipping the default later is a one-line change.

#### Persisted state (three flags)

| Setting key | Type | Default | Meaning |
|---|---|---|---|
| `quickadd_shortcut_binding` | string \| null | `null` | The actual key combo to register, e.g. `"CmdOrCtrl+Shift+A"`. `null` means "never picked" |
| `quickadd_shortcut_enabled` | boolean | `false` | User has explicitly enabled the feature. Lets the user temporarily disable without losing their picked binding |
| `quickadd_first_run_shown` | boolean | `false` | Whether the first-run modal has been shown. Prevents the modal from re-appearing on every launch |

Three flags instead of rev 2's single overloaded `consent` flag. Cleaner
separation: *what binding*, *is it active*, *have we asked yet*.

#### Startup flow on every main window mount

```ts
async function setupQuickAdd() {
  const enabled = await getSetting("quickadd_shortcut_enabled");
  const binding = await getSetting("quickadd_shortcut_binding");
  const firstRunShown = await getSetting("quickadd_first_run_shown");

  // Register the shortcut if the user has enabled it and picked a binding
  if (enabled === "true" && binding) {
    await register(binding, showQuickAddWindow);
  }

  // First launch: show the one-time intro modal
  if (firstRunShown !== "true") {
    setShowFirstRunModal(true);
    await setSetting("quickadd_first_run_shown", "true");
  }
}
```

The first-run modal is intentionally minimal — it does **not** ask for a
binding choice on the spot. It just announces the feature and offers two
buttons:

- **Set up in Settings** → navigate to `setPage("settings")` and scroll to
  the Quick add hotkey section
- **Not now** → close the modal; user can find it later in Settings

Mid-session rebind/disable from Settings: unregister the old binding (if
any) and register the new one. No restart required.

### Step 6 — Settings UI: three-block binding picker (NEW per Verse review #1, refined per #2)

A new section in `src/pages/Settings.tsx` (the file already exists, untracked
in the working tree, currently used for the Anthropic API key BYOK pattern).

Per Verse's secondary recommendation in review #2, the picker is structured
as **three visually distinct blocks** so the user makes an informed choice
rather than facing a blank key-recorder:

```
┌─ QUICK ADD HOTKEY ────────────────────────────────────────────────┐
│                                                                   │
│  Status: ⚪ Disabled                              [ Enable ▢ ]    │
│                                                                   │
│  ┌─ Your binding ─────────────────────────────────────────────┐  │
│  │  [ Press a key combo to record... ]                        │  │
│  │  Currently: (none)                                         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Suggested safe defaults ──────────────────────────────────┐  │
│  │  ⌘ ⇧ A   Cmd+Shift+A     [ Use this ]                     │  │
│  │          (cleanest of the candidates we evaluated)         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Conflicts we know about on macOS ─────────────────────────┐  │
│  │  ⌘ ⇧ V    Paste and Match Style (system-wide)              │  │
│  │  ⌘ ⇧ T    Reopen Closed Tab (every browser)                │  │
│  │  ⌘ ⌥ T    Fonts panel (TextEdit, Pages, Mail)              │  │
│  │  ⌘ ⇧ ␣    Raycast / Alfred / LaunchBar primary launcher    │  │
│  │                                                             │  │
│  │  If you pick one of these, the other app loses it          │  │
│  │  while VerseDay is running.                                 │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  [ Test shortcut ]   (only enabled when binding is set)          │
└───────────────────────────────────────────────────────────────────┘
```

Components of this section:

- **Status indicator** at the top: `⚪ Disabled` / `🟢 Active` / `⚠ Permission required`
- **Enable toggle** — disabled until a binding is set
- **Key recorder** for the user's pick — captures the next key combo pressed,
  validates against a small denylist (`Cmd+Q`, `Cmd+W`, `Cmd+Tab`, etc.)
- **"Suggested safe defaults"** block with `Cmd+Shift+A` and a one-click
  "Use this" button that fills the recorder
- **"Conflicts we know about"** informational block — static, just educates
  the user about the cost of common picks. Pulled from research below.
- **Test shortcut** button that calls the show-window handler directly, so
  the user can verify everything works without switching to another app
- **Permission-denied banner** (only shown if Accessibility permission is
  denied): explains what happened and includes a button that deep-links to
  System Settings → Privacy → Accessibility via `x-apple.systempreferences:`

Settings persistence uses the three keys defined in Step 5 above.

#### Binding research (from Verse review #2)

| Combo | Real-world conflict | Verdict |
|---|---|---|
| `Cmd+Shift+V` | macOS-wide *Paste and Match Style* in any Cocoa text view (Notes, Mail, Safari, Pages, Slack, Notion, Messages) | Heavy |
| `Cmd+Shift+T` | Reopen Closed Tab in Chrome, Safari, Firefox, Arc, Edge — ubiquitous browser shortcut | **Worse than V**, hard reject |
| `Cmd+Option+T` | Fonts panel toggle in TextEdit, Pages, Mail, most Cocoa text apps; some terminals | Medium |
| `Cmd+Shift+Space` | Primary launcher key for Raycast / Alfred / LaunchBar; macOS Character Viewer in some apps | Heavy if user runs a launcher |
| `Cmd+Shift+A` | Chrome "Search Tabs" (low-traffic), Figma "select all with same color" | **Cleanest** — chosen as suggested default |

### Step 7 — Build the `QuickAdd` component

`src/pages/QuickAdd.tsx`:

```
[ + Add a task...                          ] [ Project ▾ ] [ 0m ▾ ]
```

- Single-row layout, fills the 600×80 frameless window
- Background: rounded rectangle, slight backdrop blur, soft border
- Title input is autofocused on mount
- Project picker: dropdown populated from `getProjects()` (filter archived)
- Estimate: small numeric input or preset chips (15m / 30m / 1h)
- **Enter** → call `createTask({...})`, then hide the window
- **Esc** → hide the window without saving
- **Window blur** → hide the window without saving
- After hide, reset all fields so the next invocation is clean

Hide via:
```ts
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
await getCurrentWebviewWindow().hide();
```

### Step 8 — Wire the route in `App.tsx`

```ts
if (window.location.hash === "#quick-add") {
  return <ErrorBoundary><QuickAdd /></ErrorBoundary>;
}
```

Mirrors the existing `#focus-pip` branch.

### Step 9 — Save flow

`createTask` already exists in `src/db/queries.ts`. The quick-add window calls
it with: `{ title, projectId, estimatedMinutes, dateScheduled: today, priority: "medium" }`.

After save, the main window won't auto-refresh its task lists. **Known
limitation, deferred** — see *Limitations* below.

## UX details

| Action | Result |
|---|---|
| Press `Cmd+Shift+V` from anywhere | Quick-add bar appears centered on active screen, focused, autofocus on title input |
| Type a task title, press Enter | Task saved to today's plan, bar disappears |
| Type a title, pick a project, set estimate, press Enter | Task saved with those fields, bar disappears |
| Press Esc | Bar disappears without saving |
| Click outside the bar (window blur) | Bar disappears without saving |
| Press `Cmd+Shift+V` again | Same bar reappears, fields reset |

## Permissions and platform considerations

### macOS

- The first time the user triggers a global shortcut, **macOS may prompt for
  Input Monitoring or Accessibility permission**. The exact prompt depends on
  whether `tauri-plugin-global-shortcut` uses the modern `RegisterEventHotKey`
  Carbon API (no permission needed) or low-level event taps (permission
  required).
- The plugin docs say it uses the system-wide hotkey registration, so it
  *should* work without a permission prompt — but I want Verse to confirm
  this against the upstream plugin source before I commit to the user-facing
  story.

### Cmd+Shift+V conflict

- Many apps bind `Cmd+Shift+V` to "paste without formatting" (Slack, Notion,
  some browsers). When VerseDay is running, those apps will lose this binding
  globally because OS hotkeys take precedence.
- This is the behaviour the user explicitly asked for, but worth flagging in
  the doc and in a settings UI follow-up so it can be remapped.

### Privacy

- A global shortcut listens for ONE specific key combo system-wide. It is
  *not* keylogging — the OS only invokes our callback when the registered
  combo is pressed. No other key data flows through the app.

## Database concurrency

Both `main` and `quick-add` windows hit the same SQLite file via
`tauri-plugin-sql`. The plugin uses a `sqlx` connection pool. SQLite supports
concurrent reads; concurrent writes are serialized by the engine. As long as
both windows go through the plugin (not raw `rusqlite`) we're fine.

A user could in theory press Cmd+Shift+V *while* the main window is in the
middle of a save. The two writes will queue at the SQL layer. No data loss.

## Cross-window state sync — known limitation, deferred

When the quick-add window saves a task, the main window's React state has no
idea. The new task only appears the next time the user navigates within the
main window or refreshes the page they're on.

Two ways to fix later:
1. **Tauri events** — `quick-add` emits `"task-created"` after save; main
   window listens and refetches the affected list.
2. **DB polling** — main window polls for changes (gross, don't).

I lean (1). Defer to a follow-up doc unless Verse insists.

## Files this plan would touch

Updated count: **10 files** (was 8 in revision 1, peaked at 11 in revision 2;
revision 3 drops the standalone consent modal component because the first-run
modal is now a minimal "feature exists, set up in Settings?" announcement
that lives inline in `MainApp` rather than warranting its own file).

| # | File | Change |
|---|---|---|
| 1 | `src-tauri/Cargo.toml` | Add `tauri-plugin-global-shortcut = "2"` |
| 2 | `src-tauri/src/lib.rs` | Register the plugin in the builder; create the `quick-add` window in `.setup()`; **install hide-on-close handler on the main window** (Path A lifecycle fix per rev 4) |
| 3 | `src-tauri/capabilities/default.json` | Add `quick-add` to the windows array |
| 4 | `src-tauri/capabilities/global-shortcut.json` *(new)* | Dedicated capability scoped to `main` only, granting global-shortcut permissions |
| 5 | `package.json` | Add `@tauri-apps/plugin-global-shortcut` |
| 6 | `src/App.tsx` | Add `#quick-add` hash branch; add startup effect that reads the three quick-add settings and registers the shortcut if `enabled === "true"`; show the first-run modal inline if `quickadd_first_run_shown !== "true"` |
| 7 | `src/pages/QuickAdd.tsx` *(new)* | The quick-add bar component |
| 8 | `src/pages/Settings.tsx` | Add the three-block hotkey picker (status, your binding, suggested defaults, conflicts table), enable toggle, test button, permission banner (file already exists, untracked) |
| 9 | `src/db/queries.ts` *(small addition, only if needed)* | The existing `getSetting`/`setSetting` API should cover the three new keys without additional helpers; only touch this file if the typed helpers are useful for call-site clarity |
| 10 | `src/index.css` *(small addition)* | A handful of utility classes for the frameless transparent quick-add window's rounded corners + soft shadow |

Note: there is **no change** to `src-tauri/tauri.conf.json` (revision 1 was
wrong about this — the quick-add window is created from Rust at runtime, not
declared in the config file, mirroring how `focus-pip` is handled today).
There is **no separate consent modal component file** (revision 2 had one;
revision 3 inlines it into `MainApp` since "ship unbound" makes the modal
trivial — just "feature exists, open Settings?").

## Things I'd specifically like Verse to scrutinize

1. **macOS permission story.** Does `tauri-plugin-global-shortcut` v2 require
   accessibility permission on macOS? If yes, the user's first-launch UX
   needs a prompt explaining what's about to happen, plus a graceful fallback
   if they decline. If no, no extra UX needed. I don't want to ship and have
   the user hit a confusing system dialog with no context.

2. **Hotkey choice.** `Cmd+Shift+V` collides with "paste without formatting"
   in Slack / Notion / many browsers. The user explicitly asked for it, so
   we ship it as-is, but should there also be a settings UI to remap it?
   First version vs. follow-up?

3. **Window lifecycle.** Creating the `quick-add` window at app launch
   (`visible: false`) means it consumes a tiny bit of memory the whole time
   the app is running, but show/hide is instant. The alternative is to
   create it on demand and destroy on hide, which is cleaner memory-wise but
   adds ~200ms of cold-start latency every time the user pops it. I prefer
   "create once, show/hide" for snappiness. Confirm?

4. **Cross-window sync.** Defer to follow-up, as noted, *unless* you think
   the bad UX of "I added a task and it's not showing" is bad enough that
   we need to ship the Tauri-event sync in this same PR.

5. **Tauri-side capabilities scope.** I'm granting `global-shortcut:default`
   to the same `default` capability that the main window already has. Should
   it be a separate capability scoped only to the main window? (The
   quick-add window doesn't need to register/unregister shortcuts itself —
   only the main window does.)

6. **Frameless transparent windows on Linux/Windows.** This is a desktop-only
   feature for now. Tauri 2 supports frameless transparent windows on all
   three platforms but rendering quirks differ. Since the user is on macOS
   and we have no Windows/Linux smoke testing yet, this is "macOS-first,
   ship and see" — flag any concerns.

7. **Cost.** `tauri-plugin-global-shortcut` is MIT/Apache, no runtime cost,
   no service dependency. Zero-budget rule satisfied.

8. **Security.** The hotkey registration is the only new privilege. The
   plugin doesn't expose any other escalation. Quick-add window has the
   same SQL permissions as main, but it can only call `createTask` from
   the React layer (no new Rust commands).

## Verse's review #1 — items addressed in revision 2

| # | Verse's required correction | Status |
|---|---|---|
| 1 | Fix factual error: focus-pip is created at runtime in `FocusMode.tsx:142`, not declared in `tauri.conf.json` | ✅ done — Architecture section + table updated; file count corrected to remove `tauri.conf.json` |
| 2 | Lock window lifecycle to Rust `.setup()`, document why explicitly | ✅ done — Step 3 rewritten with the (a)/(b)/(c) decision table; Rust `WebviewWindowBuilder` snippet replaces the JSON |
| 3 | Promote remap UI from "should we?" to "yes, in this PR"; add user-confirmation step before first registration; update file count and order | ✅ done — Steps 5+6 split: Step 5 is consent-gated registration, Step 6 is the new Settings UI section. File count: 8 → 11. |
| ✱ | Scope `global-shortcut:*` to `main` only via dedicated capability file | ✅ done — Step 4 creates `capabilities/global-shortcut.json` with `"windows": ["main"]` |

Verse's other guidance folded in:

1. **macOS Accessibility permission story** — the consent modal in Step 5 is
   designed to handle the worst case (permission required + may be denied)
   gracefully. The Settings UI in Step 6 includes a permission-denied banner
   with a deep link to System Settings → Privacy → Accessibility. I'll still
   verify the plugin's actual macOS implementation against upstream source
   *during* implementation, before writing the modal copy.
2. **Cross-window state sync** — deferred to follow-up PR per Verse. Document
   in changelog. Tauri `emit`/`listen` is the right tool for that PR.
3. **Cmd+Shift+V conflict** — surfaced to user explicitly; user chose
   **option 3** (Verse's recommendation): ship unbound, with `Cmd+Shift+A`
   as the pre-filled suggestion in the Settings picker. First launch shows a
   minimal "feature exists, open Settings?" modal; nothing global is
   registered until the user explicitly enables it. See *Step 5* and the
   *Binding research* table in *Step 6* for the full reasoning.
4. **Linux/Windows polish** — macOS-first ship-and-see. Will note in
   changelog that the frameless transparent window may render slightly
   differently on Windows/Linux.
5. **Security framing** — will add to the first-run modal: "If macOS asks
   for Accessibility permission, granting it gives VerseDay broader
   capabilities at the OS level than this single feature uses. We only use
   that permission to listen for your chosen hotkey."

## Implementation order (locked, updated for revision 3)

1. **Rust plugin wiring + main window lifecycle fix** — add
   `tauri-plugin-global-shortcut` to `Cargo.toml`, `package.json`; register
   in builder; create empty `quick-add` window in `.setup()`; add the new
   capability file; **install the hide-on-close handler on the main
   window**. Verify the empty quick-add window is created at app launch
   (visible: false) without crashing.

   #### Lifecycle escalation outcome (per Verse review #3 + user confirmation)

   The lifecycle verification Verse asked for in review #3 was performed
   first. Result: **the current build's red-X behavior quits the app
   entirely**. That broke the rev 3 assumption that the React tree would
   survive a red-X close, which would have meant the JS-side hotkey
   registration died on every close, defeating the entire global-capture
   purpose.

   Two paths were considered, both flagged by Verse as acceptable fallbacks:

   - **Path A — change main window close to hide-only.** Standard macOS
     pattern. Red X hides the window; dock icon stays; Cmd+Q still quits.
     Keeps all of rev 3's JS-side architecture intact.
   - **Path B — move registration into Rust `.setup()`.** Bigger rewrite.
     Requires Rust-side raw `rusqlite` reads of the three persisted
     settings flags (since `tauri-plugin-sql`'s pool isn't exposed to Rust),
     and a Tauri event channel for mid-session rebinds from JS Settings.

   **User picked Path A.** This is locked.

   #### Path A implementation in this step

   In `lib.rs`'s `.setup()` closure, after creating the `quick-add` window,
   install a window-event handler on the main window that intercepts
   `CloseRequested`, calls `api.prevent_close()`, and calls `main.hide()`:

   ```rust
   let main = app.get_webview_window("main")
       .expect("main window must exist");
   let main_clone = main.clone();
   main.on_window_event(move |event| {
       if let tauri::WindowEvent::CloseRequested { api, .. } = event {
           api.prevent_close();
           let _ = main_clone.hide();
       }
   });
   ```

   This affects red-X close only. Cmd+Q and "Quit VerseDay" from the menu
   continue to quit the app via the app-level quit path, which is
   independent of window close events.

   #### Verification checklist for step 1 (must all pass before moving on)

   1. App launches without crashing; `quick-add` window exists in
      `WebviewWindow.getByLabel("quick-add")` checks but is invisible.
   2. Click the red X on the main window → window disappears, dock icon
      remains, app process is still running.
   3. Click the dock icon → main window reappears (Tauri 2's default
      activation policy should handle this; if it doesn't, add an
      activation handler in `.setup()`).
   4. Cmd+Q from the menu bar → app fully quits, dock icon disappears.
   5. Wrap the (later, in Step 5) JS shortcut registration in a `useEffect`
      whose cleanup calls `unregister()`, so the flow is idempotent across
      hot reloads in dev and any future remount path.
2. **Verify summon path with a temporary hardcoded test shortcut** — bypass
   the settings/consent gate for this step only. Register `Cmd+Shift+A`
   directly, confirm the empty quick-add window appears centered on the
   active monitor when pressed from another app. Tear down the test
   registration before moving on.
3. **Build the `QuickAddBar` UI** — title input, project picker, estimate,
   Enter/Esc/blur handling. No save wiring yet — just the form.
4. **Wire the save** — call `createTask()` with the form fields; hide the
   window on success; reset form fields for the next invocation.
5. **Build the Settings UI** *(revision 3 reorders this before the modal)*
   — three-block picker with status indicator, key recorder, suggested
   defaults block (`Cmd+Shift+A` pre-filled with "Use this" button),
   conflicts table, enable toggle, test button. Wire to the three persisted
   settings keys. Validate that picking a binding + toggling enable
   actually registers the shortcut (and rebinding mid-session unregisters
   the old one and registers the new one).
6. **Build the first-run modal** — minimal "We added a global quick-add
   hotkey. Want to set it up?" with **Set up in Settings** / **Not now**
   buttons. Show it inline in `MainApp` if `quickadd_first_run_shown !==
   "true"`. Set the flag after the modal is shown (regardless of which
   button the user clicks).
7. **Smoke test the macOS Accessibility permission path** — quit the app,
   revoke Accessibility permission in System Settings (if it was even
   granted), relaunch, enable the feature in Settings, verify the banner
   appears, verify the deep-link to System Settings works.
8. **Smoke test the unbound first-run flow** — wipe the three settings
   keys (or use a fresh DB), relaunch, verify the modal appears once,
   verify clicking "Set up" navigates to Settings and scrolls to the
   right section, verify clicking "Not now" closes the modal and doesn't
   re-show it on next launch.
9. **Smoke test the rebind flow** — pick `Cmd+Shift+A`, enable, confirm
   it works, then rebind to something else, confirm the old binding is
   freed and the new one works.
10. **Ship.**

Each layer is independently testable in the running dev build before the
next layer is added. If something breaks in step 6, I know the bug is in
the modal/startup code, not the Settings UI or the Rust window setup.

This ordering means each layer is independently testable in the running
dev build before the next layer is added, so if something breaks I know
which layer to look at.

## Verse review #2 — items addressed in revision 3

| # | Verse's required correction | Status |
|---|---|---|
| 1 | Correct the "four alternatives don't collide" claim — it's materially wrong | ✅ done — the *Binding research* table in Step 6 now lists the actual conflict for each candidate, including the corrected verdicts (`Cmd+Shift+T` is **worse** than V because of universal browser binding; `Cmd+Shift+Space` collides with Raycast/Alfred/LaunchBar; `Cmd+Option+T` collides with the Fonts panel; only `Cmd+Shift+A` is clean). |
| 2 | Bake in the chosen binding option | ✅ done — user picked option 3 (Verse's recommendation): ship unbound, with `Cmd+Shift+A` as the pre-filled "Use this" suggestion in the Settings picker. Step 5 rewritten around the unbound semantics; three persisted flags replace the single overloaded `consent` flag from rev 2. |
| ✱ | Settings picker should show "your pick / conflicts / suggested defaults" as three blocks | ✅ done — Step 6 has the three-block ASCII layout and explicit per-block descriptions. |

Plus a structural simplification revision 3 enables: the standalone consent
modal component file (rev 2's file #10, `QuickAddConsentModal.tsx`) is gone.
With "ship unbound" the first-run modal becomes trivial — just a "feature
exists, open Settings?" announcement that lives inline in `MainApp`. **File
count: 11 → 10.**

## Verse review #3 — items addressed in revision 4

| # | Verse's required correction or finding | Status |
|---|---|---|
| 1 | Cosmetic: relabel "option 1 (Verse's recommendation)" → "option 3 (Verse's recommendation)" in the spots that mislabeled the user's binding choice | ✅ done — both occurrences fixed |
| 2 | Lifecycle escalation: verify red-X close behavior on the main window before building any of steps 2-9 | ✅ done — verified, **fails** in current build (red-X quits app); user picked Path A (hide-on-close); rev 4 locks the change in Step 1 |
| ✱ | Sub-bullet to step 1 capturing the lifecycle verification + escalation paths | ✅ done — Step 1 rewritten with the full escalation outcome and the Path A implementation snippet |

The lifecycle escalation was the right call. Catching this in step 1 instead
of step 5 saved a half-day of building registration code on a foundation
that would have silently broken.

## Decision needed from Verse

APPROVED / REJECTED on revision 4. Specifically:

1. **The hide-on-close behavior change** is a real UX shift for the user
   (red X no longer quits — they have to use Cmd+Q or the menu). Sign off
   on shipping this change as part of the same PR as the global quick-add
   feature, not as a separate gate?
2. **The Tauri 2 activation policy** should handle "click dock icon → main
   window reappears" automatically. If you know of a Tauri 2 build where
   this isn't true and we need an explicit activation handler, flag it
   before I write the code.
3. **Path A vs Path B**: confirming Path A is the right fallback choice
   for this codebase given (a) it's the standard macOS pattern, (b) it
   keeps all of rev 3's JS-side architecture, and (c) Path B would require
   raw `rusqlite` reads in Rust that bypass the existing connection pool.

If APPROVED, I'll proceed with step 1 implementation as written. If
REJECTED, send the specific change needed.
