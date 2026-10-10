# 06 — Platform Specification

**Status:** Frozen. Last updated 2026-10-07.

---

## 1. Shared foundations

Tauri 2 owns both platforms. The differences below are platform-specific behaviour that must be handled explicitly — Tauri does not abstract them away.

| Aspect | Value |
|--------|-------|
| Product name | `Chayote` |
| Bundle identifier | `com.chayote.app` (frozen — see `09-decisions.md` ADR-012) |
| WebView | Android System WebView (Chromium). **The user can update it independently of the app**, so never target a feature above the oldest WebView we support *in principle*. **In practice M6 dropped the obligation to test on it** — see below. |

**Testing on the oldest WebView is no longer required.** Decided at M6. Verification targets any stable System WebView, not the floor.

This is a deliberate reduction in rigour, taken because testing the floor means pinning an old WebView on a real device and holding that combination for a platform v1 will not otherwise be revisited. The rule above still stands as a *constraint* — no syntax or API newer than the oldest supported WebView should be used — and `color-mix()` is the one place already close to the line, which is why ADR-019 notes that `ConfirmDialog` used it before M6 did. What is gone is the **test**, not the constraint. A user on a genuinely old WebView may find a rendering difference that no check in this repository would have caught; that is the accepted cost, recorded rather than hidden.
| Window chrome | Native decorations in v1. A custom title bar is a deliberate simplification; see `09-decisions.md` ADR-009. |
| Min OS | Windows 10 1809, macOS 10.15, Ubuntu 20.04, Android 8.0 (API 26) |
| IPC | `invoke` only. No HTTP server, no local socket, no port. |
| Startup | Window is created hidden; `show()` after the frontend's first paint, to avoid a white flash. |

The app is offline. v1 makes zero network requests. This is a verifiable property, not an aspiration — CI should assert that no `fetch`/`XMLHttpRequest`/`WebSocket` reaches a remote origin.

**Assets count as network.** Fonts are bundled via `@fontsource/inter`; icons are compiled into the bundle as inline SVG from `lucide-react` (`05-ui-ux.md` §3.3). No CDN, no Google Fonts, no icon sprite sheet, no icon font. A blocked or offline machine must produce a pixel-identical first paint.

## 2. Data locations

| Store | Desktop path | Android path |
|-------|--------------|--------------|
| Notes database | `{appDataDir}/chayote.db` | `{filesDir}/chayote.db` |
| Settings | `{appConfigDir}/settings.json` | `{filesDir}/settings.json` |
| Logs | `{appLogDir}/chayote.log` | `{filesDir}/logs/chayote.log` |

Paths come from Tauri's `app.path()` API, never from string concatenation. The database filename is the constant `chayote.db`, declared in exactly one place in the Rust code; there is no user-configurable data directory in v1.

WAL sidecar files (`chayote.db-wal`, `chayote.db-shm`) live next to the database. This matters for backup: any backup that copies only `chayote.db` can lose recent transactions.

**Backup story, stated honestly:** the notes are a plain SQLite file in a documented location. Copying that file while the app is closed is a complete backup. The app does not implement backup, does not ship to iCloud, and does not sync in v1. This is a limitation to be addressed by the sync phase, not a hidden feature.

## 3. Desktop specifics

### 3.1 Window

| Property | Value |
|----------|-------|
| Default size | 1280 × 820 |
| Minimum size | 720 × 520 |
| Centre on launch | First launch only; afterwards restore the saved position, clamped to visible display bounds |
| Full screen | Allowed; the layout adapts via CSS |

### 3.2 Window events

| Event | Required behaviour |
|-------|---------|
| `CloseRequested` | Flush the pending autosave, then close. If the flush fails, show a native confirmation; do not silently discard. |
| `Focused(false)` | Flush the autosave |
| `Resized` / `Moved` | Debounced 500 ms, persist geometry to settings |
| `ThemeChanged` (OS) | Update the effective theme if the user selected System |
| Second instance launched | Focus the existing window; do not start a second process |

### 3.3 Clipboard

Read and write through the platform via Tauri. The WebView's own clipboard API is unreliable in some Linux environments and under Wayland. Copy, cut, and paste inside the editor must use the Tauri clipboard path with the WebView API as fallback.

### 3.4 Menus

| Platform | Approach |
|----------|----------|
| Windows, Linux | Tauri application menu. `Edit` carries the undo/redo/cut/copy/paste items so the platform conventions hold. |
| macOS | Standard macOS app menu, first position, with the app name. |

### 3.5 Global shortcuts

Not registered in v1. A global hotkey to capture a thought is the obvious next feature after sync, but it needs a defined capture flow and an OS-specific UI affordance. Tracked in `08-roadmap.md`.

### 3.6 Drag and drop

Only within the app: folder re-parenting, reordering, and the tag list. External file drops are ignored until attachments exist in v1.2. Dropping a file must not navigate away or insert content.

### 3.7 Packaging

| Target | Format |
|--------|--------|
| Windows | NSIS `.exe` installer, and a portable `.exe` |
| macOS | `.app` and `.dmg`. No notarisation in v1 — unsigned builds warn on first launch |
| Linux | `.deb` and `.AppImage` |

Code signing is out of scope for v1. Document the platform-specific unsigned-launch steps rather than pretending they do not exist.

## 4. Android specifics

### 4.1 Build

| Aspect | Value |
|--------|-------|
| Min SDK | 26 |
| Target / compile SDK | 34 or newer |
| Architectures | `arm64-v8a` (primary), `armeabi-v7a` (secondary). `x86_64` for the emulator, not shipped |
| JDK | 17 |
| NDK | Latest stable, matched to the installed Rust toolchain |
| Rust targets | `aarch64-linux-android`, `armv7-linux-androideabi` |

`npx tauri android init` scaffolds the Gradle project. Release builds are APKs signed with a keystore that is **not** in the repository. Store distribution (AAB, Play) is out of scope for v1.

**The generator's defaults do not match this table, and M7 changed all three.** `android init` emits `minSdk 24`, and this project builds at 26. The generated project is **tracked in git** (`src-tauri/gen/android/`), because these corrections live in it and an untracked `gen/` meant a fresh clone reproduced the uncorrected configuration — the same class of failure `11-verification.md` §2 records, where three documents agreed and were all wrong. Build output, `jniLibs`, `local.properties`, and keystores stay ignored.

As built at M7: **minSdk 26, compile/target SDK 37**, NDK `27.2.12479018`, Gradle 9.6.1, AGP 9.3.1, Kotlin 2.2.10, JDK 21. Both arm ABIs cross-compile and link; `aarch64-linux-android` and `armv7-linux-androideabi` are installed, and `android init` additionally installs the two x86 targets for the emulator, which are not shipped.

### 4.2 Manifest and permissions

The manifest requests the minimum. No `INTERNET` permission until the sync phase — that makes the offline guarantee enforceable by the platform, not just by convention.

| Permission | v1 | Purpose |
|------------|-----|---------|
| `INTERNET` | No | Sync only (post-v1) |
| `WRITE_EXTERNAL_STORAGE` | No | Attachments only (v1.2) |
| `VIBRATE` | No | |

`android:windowSoftInputMode="adjustResize"` is **required**, not optional: without it the on-screen keyboard covers the editor and the app is unusable. `android init` does not add it; it is set in `app/src/main/AndroidManifest.xml`.

**`INTERNET` is declared in `app/src/debug/AndroidManifest.xml`, not the main one.** The generator adds it unconditionally because `tauri android dev` serves the WebView from a local dev server and needs a socket; a release build loads the bundled assets and does not. Splitting it by build type is what makes the guarantee real rather than aspirational — a permission in a debug-only manifest cannot reach a release APK.

The one permission a release APK *does* carry is `com.chayote.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, injected by `androidx.core` at `protectionLevel="signature"`. It is not a capability and grants the app nothing it does not already have.

**Verified at M7 against the built APK, not against the source file** — `aapt2 dump permissions` and `aapt2 dump xmltree`, since a manifest that is correct on disk and correct in the artefact are not the same claim:

| Property | Observed |
|----------|----------|
| `INTERNET` | **absent** |
| `usesCleartextTraffic` | `false` in release (`true` in debug, for the dev server) |
| `minSdkVersion` / `targetSdkVersion` | `26` / `37` |
| `windowSoftInputMode` | `0x10` — `adjustResize` |
| `native-code` | `arm64-v8a`, `armeabi-v7a` |
| Size | **14.65 MiB** against the 20 MB budget in `02-architecture.md` §8 |

13.11 MiB of that is the two `.so` files; the frontend is embedded in them rather than shipped as loose assets, which is why the APK contains no `.js`, `.css`, or `.woff` entries. The cyrillic subsets of Inter are present.

### 4.3 Keyboard and viewport

| Concern | Handling |
|---------|----------|
| On-screen keyboard | `adjustResize`; the WebView viewport shrinks. The editor's scroll container and status bar stay reachable. |
| Viewport units | Never size a fixed element with `vh` on Android. Use flex layout and `dvh` where a viewport unit is unavoidable, because the keyboard changes the visible viewport height. |
| `done` action | Closes the keyboard rather than inserting a newline |
| Window resize | Flush the autosave on the `Focus`/`Pause` lifecycle event |
| Hardware keyboard | `Ctrl/Cmd` shortcuts from §7 of `05-ui-ux.md` are active |

**Window insets are consumed in CSS, and this was found on a device at M7.** Tauri's
generated `MainActivity` calls `enableEdgeToEdge()`, so the WebView fills the window
and the app draws under the status bar and the navigation bar. Measured on a device:
the mobile top bar sat under the clock and battery with the hamburger clipped at the
edge, and the editor status bar sat behind the three-button navigation bar — which is
also why it disappeared entirely while the keyboard was open, contradicting the first
row of this table.

The fix is `viewport-fit=cover` in `index.html` plus `env(safe-area-inset-*)` padding
on `#root` in `base.css`, via the `--inset-top` / `--inset-bottom` tokens.
`viewport-fit=cover` is load-bearing and not decoration: without it both `env()`
values are `0` on Android and the rule silently does nothing. A desktop browser also
reports `0`, so the rule is inert there.

### 4.4 Back navigation

The Android back gesture must not exit the app from the editor.

| Stack depth | Back behaviour |
|-------------|-----------------|
| Editor open | Return to the note list, flushing the autosave |
| List view | Move the task to the background |
| Any dialog open | Dismiss the dialog |

Implement with a Tauri back-button handler, not by listening for `popstate`. A
popstate-based implementation breaks on gesture navigation.

**This is the one requirement M7 could not implement as written, and the reason is in
Tauri's source.** There is no back-button event reachable from JavaScript in Tauri
2.12:

- `AppPlugin.kt` registers an `OnBackPressedCallback` for the `back-button` event,
  and **when a listener exists it dispatches instead of taking its default** — which is
  the behaviour §4.4 wants. But `hasListener()` reads `Plugin.kt`'s private `listeners`
  map, populated only by the plugin's own `registerListener` command. A JavaScript
  `listen('back-button', …)` goes through Rust's event system instead and never appears
  in that map, so the check always fails.
- `Plugin.trigger()` sends only to those same Java channels, so even a listener that did
  register would not receive the event.
- `WryActivity.handleBackNavigation` is the other native hook; `TauriActivity` sets it
  `false`, and `true` only installs wry's own `goBack`-or-finish callback. It does not
  reach the web layer either.

Measured on a device with a JavaScript listener in place: the press fell through to
`webView.goBack()`, the WebView had no history, and **back in the editor did nothing**.

So the mechanism that works is Kotlin — an `OnBackPressedCallback` installed from
`MainActivity.onWebViewCreate`, which `WryActivity` exposes precisely for this — either
pushing a WebView history entry or evaluating JavaScript. That is a change to how the
frontend meets the platform, and it is **not yet decided**; it needs an ADR, because it
either puts a second path to the platform outside `ipc.ts` (against R6's structure) or
revises this section's explicit rejection of `popstate`. It is left unimplemented and
recorded rather than half-built, because a handler that looks like a fix and does
nothing is worse than the documented gap.

### 4.5 Lifecycle

| Event | Required behaviour |
|-------|-------------------|
| `Pause` (backgrounded) | Flush the autosave synchronously |
| `Resume` | Refresh the note list if the system may have destroyed the WebView |
| `LowMemory` | Nothing special; do not force a flush beyond the normal debounce |
| WebView destroyed | The database is a committed WAL, so nothing is lost. On resume, reload and re-run migrations. |

### 4.6 Android-specific limitations, stated honestly

| Limitation | Consequence |
|------------|-------------|
| No system tray | No background sync agent in v1. Sync is foreground-only in the sync phase, or needs a foreground service, which is a separate design. |
| No global shortcuts | Hardware-keyboard shortcuts work only while the app is focused |
| No native file dialog until v1.2 | No import/export from Android in v1 |
| System WebView version varies | Test on a current stable System WebView. The oldest supported WebView is no longer a test target (§1) |
| SQLite `journal_mode = WAL` is supported | **Verified on device at M7** — `chayote.db`, `chayote.db-wal` and `chayote.db-shm` are all present in the app's data directory and the WAL grew as writes landed. The same run verified migrations, FTS5 search with `bm25` and `snippet()`, and that the row survived a `force-stop` |

## 5. Build and verification commands

Reference commands for milestones M0 and M6. Exact CLI flags should be confirmed against the installed Tauri version at the time.

```bash
# Desktop
npm run tauri dev
npm run tauri build

# Android
npm run tauri android init          # once
npm run tauri android dev
npm run tauri android build --apk

# Quality gates
npm run lint
npm run typecheck
npm run test                        # vitest
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run build                       # must complete with no TS errors
```

## 6. Definition of done for a platform

**Desktop**

- Launches and reaches an editable caret inside 1.2 s on a cold start.
- Close and reopen restores geometry, theme, sidebar width, selection, and the open note.
- Resize from 720 px to 4K keeps the layout valid, including the sidebar clamp.
- Multi-monitor with mixed DPI: window restores on the correct display.
- Paste from Word, Google Docs, and a plain-text source all produce clean content.
- Undo/redo survives a note switch without leaking into the other note (`04-editor.md` §6).

**Android**

- Cold start on an arm64 device with a current stable System WebView.
- On-screen keyboard never covers the editor or the status bar.
- Back button walks the view stack and exits from the list.
- Backgrounding during typing loses nothing.
- Airplane mode changes nothing, because nothing is online.
- Long-press opens the context menu; 44 px touch targets respected.
- Rotation preserves the open note and the editor scroll position.