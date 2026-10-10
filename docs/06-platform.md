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

### 4.2 Manifest and permissions

The manifest requests the minimum. No `INTERNET` permission until the sync phase — that makes the offline guarantee enforceable by the platform, not just by convention.

| Permission | v1 | Purpose |
|------------|-----|---------|
| `INTERNET` | No | Sync only (post-v1) |
| `WRITE_EXTERNAL_STORAGE` | No | Attachments only (v1.2) |
| `VIBRATE` | No | |

`android:windowSoftInputMode="adjustResize"` is **required**, not optional: without it the on-screen keyboard covers the editor and the app is unusable.

### 4.3 Keyboard and viewport

| Concern | Handling |
|---------|----------|
| On-screen keyboard | `adjustResize`; the WebView viewport shrinks. The editor's scroll container and status bar stay reachable. |
| Viewport units | Never size a fixed element with `vh` on Android. Use flex layout and `dvh` where a viewport unit is unavoidable, because the keyboard changes the visible viewport height. |
| `done` action | Closes the keyboard rather than inserting a newline |
| Window resize | Flush the autosave on the `Focus`/`Pause` lifecycle event |
| Hardware keyboard | `Ctrl/Cmd` shortcuts from §7 of `05-ui-ux.md` are active |

### 4.4 Back navigation

The Android back gesture must not exit the app from the editor.

| Stack depth | Back behaviour |
|-------------|-----------------|
| Editor open | Return to the note list, flushing the autosave |
| List view | Move the task to the background |
| Any dialog open | Dismiss the dialog |

Implement with a Tauri back-button handler, not by listening for `popstate`. A popstate-based implementation breaks on gesture navigation.

### 4.5 Lifecycle

| Event | Required behaviour |
|-------|---------|
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
| SQLite `journal_mode = WAL` is supported | No behaviour difference expected from desktop. **Not yet verified on a device** — M6 ran on desktop only, and the earlier note here claiming it was "verified in M6" was wrong; WAL on the device filesystem is part of what the `06-platform.md` §6 checklist exists to catch |

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