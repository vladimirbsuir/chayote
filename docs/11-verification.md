# 11 — Verification Strategy

**Status:** Frozen. Last updated 2026-10-10.

How each layer is proved correct, and what an agent can check without asking a human. Read this before milestone M0 and before claiming any feature is done.

---

## 1. The principle

Verification is a build target, not an afterthought. Every milestone in `08-roadmap.md` has acceptance criteria; this document says what actually runs to check them.

The rule that shapes everything below:

> **A claim of "done" without a command that proves it is not done.** If the only way to verify a milestone is for a human to open the app and look, the milestone is not finished — the check is missing.

That does not mean a human is never needed. It means the human's attention is spent on judgement, not on regression hunting.

## 2. What an agent can and cannot verify alone

Measured on the development machine, 2026-10-07. Re-measured at the end of M0, and again at M6 on 2026-10-10:

| Capability | Available | Notes |
|------------|-----------|-------|
| Node.js 24.16, npm 11.9 | Yes | |
| Rust 1.94 stable | Yes | |
| Git 2.50 | Yes | Repository initialised at M0 |
| Chromium for Playwright | **Yes** | `npx playwright install chromium` must have been run for the installed `@playwright/test` revision; a version bump requires running it again |
| Screen capture of a native window | **Yes** — `System.Drawing` available | Enables capturing the actual Tauri window |
| JDK 21 (Temurin) | Yes | AGP 8.x requires 17 or newer |
| Android SDK | **Yes** | `%LOCALAPPDATA%\Android\Sdk`. platforms android-33…37.0, build-tools 34.0.0…36.1.0, NDK 24.0.8215888 / **27.2.12479018**, `cmdline-tools` latest, **licences already accepted** |
| `platform-tools` / `adb` | **Yes** — 1.0.41 | |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | **Yes**, set to the SDK path | Was empty until M6; both are read by Gradle and by Tauri |
| Rust Android targets | **Yes** — installed at M7 on 2026-10-10 | `aarch64-linux-android`, `armv7-linux-androideabi`, plus `i686` and `x86_64` which `android init` adds for the emulator |
| A connected device or emulator | **Yes, since the M7 run** | Infinix X6836 (Android 13, arm64-v8a), attached over USB for the §3.5a runtime checks and still attached. Through M6 `adb devices` listed nothing |

**This table was wrong from M1 until M6.** Every version of it said the Android SDK was absent, and so did `README.md` §7 and `docs/08-roadmap.md` §2. The SDK had been installed the whole time — it simply was not on `PATH` and the environment variables were empty, and nobody checked the filesystem before writing it down. The correction is recorded here rather than quietly fixed, because the failure is the point: **a capability table written from assumption is a table that lies**, and three documents agreed with each other and were all wrong.

**Consequence:** M0–M6 and M8 are fully agent-verifiable. **M7 was buildable without a device** — the toolchain is present and an APK can be produced and inspected — but its runtime half needed one, and got it: all but the three unmeasured items in §3.5a are now verified on hardware.

**The build half of M7 ran on 2026-10-10 and passed.** `tauri android init`, both arm ABIs cross-compiling and linking, a 14.65 MiB release APK against the 20 MB budget, and a manifest checked with `aapt2` for a missing `INTERNET` permission and a present `adjustResize`. Details and the commands are in §3.5. The runtime half remains unverified, and no Android *runtime* claim is made anywhere in this repository until a device is attached.

## 3. The four verification layers

### 3.1 Rust unit and integration tests — fully automated

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Covers every repository method, the migration runner, derivation functions, the document validator, and the outbox transaction guarantee. Target 80 % of `src-tauri/src/` excluding `commands/`.

The ten required tests in `10-conventions.md` §10 are non-negotiable and each exists to catch a rule that is easy to break silently. If one cannot be written, that is a signal the design is wrong, not that the test is inconvenient.

### 3.2 TypeScript units — fully automated

```bash
npm run test        # Vitest
```

Utilities, relative time, debounce, paste sanitiser, the view-stack reducer.

### 3.3 Visual and interaction testing in a real browser — automated

This is the important one. **The Tauri frontend is an ordinary web application served by Vite on a local port.** Playwright can drive it directly.

```bash
npm run dev                      # Vite on http://localhost:1420
npx playwright test              # separate terminal
```

What this proves: layout at every breakpoint in `05-ui-ux.md` §9, both themes, focus visibility, keyboard navigation, empty states, list scrolling at 10 000 notes, contrast, and a full create→type→save→search→trash→restore flow.

What it cannot prove on its own: Tauri IPC, the Rust database, window behaviour. That is layer 3.4.

**Therefore the frontend must run without Tauri.** See ADR-018. Without this, no browser-based visual testing exists, and the UI can only be checked by a human opening the packaged app.

### 3.4 Native capture of the real Tauri window — automated, slower

When IPC and SQLite behaviour matters, the real window is the only thing that proves it.

```bash
npm run tauri dev
# then capture the window with System.Drawing, or drive it via a screenshot script
```

Use this sparingly — it is slower than Playwright, needs a display, and cannot be run headless. It is the check for window-level behaviour: theme switching through the real IPC path, `adjustResize` on Android, window close flushing an autosave, native clipboard.

### 3.5 Android — the build half is automated; the runtime half is manual, run on hardware at M7

`06-platform.md` §6 "Android" is a checklist a human walks through on a physical arm64 device. It cannot be automated on this machine.

**The build half ran on 2026-10-10 and is repeatable.** `ANDROID_HOME` and `ANDROID_SDK_ROOT` are set; the Rust targets are installed. The commands:

```powershell
rustup target add aarch64-linux-android armv7-linux-androideabi
npx tauri android init
npx tauri android build --apk --target aarch64 --target armv7
```

The Gradle project is tracked in git, so `android init` is a one-time step per clone, not a prerequisite that silently regenerates an uncorrected manifest.

Verify each, rather than trusting the exit code alone:

```powershell
rustup target list --installed    # aarch64-linux-android, armv7-linux-androideabi
sdkmanager --list_installed       # platform-tools, platforms;android-33..37.0, ndk;27.2.12479018
adb devices                       # 11121253C6000586, status "device" (attached since M7; empty through M6)
adb shell getprop ro.product.cpu.abi   # arm64-v8a
```

**And the two claims that must be read off the artefact, not off the source.** A manifest that is correct on disk and correct in the APK are not the same statement, which is the same lesson as §2: read it where it is true.

```powershell
$apk = "src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.1.0\aapt2.exe" dump permissions $apk
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.1.0\aapt2.exe" dump badging $apk
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.1.0\aapt2.exe" dump xmltree --file AndroidManifest.xml $apk
```

The first must not list `INTERNET`; the second must report `native-code` as `arm64-v8a` and `armeabi-v7a` only, and `minSdkVersion:'26'`; the third must carry `windowSoftInputMode=0x10`. `(Get-Item $apk).Length` is the size check — 15,364,194 bytes, **14.65 MiB** against the 20 MB budget.

**Running it needed a device, and since the M7 run there has been one.** Every **runtime** Android claim below stood unverified until the Infinix attached; §3.5a records what the device proved. A build is not a test, and neither is a run on an emulator the project does not keep.

### 3.5a What a build proves and what only a device does

The distinction matters because "it builds" reads like "it works", and on Android the gap between the two is where the platform-specific work lives. Both columns are M7's real content.

| Checkable without a device | Needs a device or emulator |
|---|---|
| ~~`tauri android init` scaffolds the Gradle project~~ **done at M7** | `adjustResize`: the on-screen keyboard must never cover the editor or the status bar (`06-platform.md` §4.3). **Observed on device at M7 — the viewport shrinks and the editor is never covered, portrait and landscape** |
| ~~Both Rust ABIs cross-compile and link~~ **done at M7** | ~~The **real** SQLite backend running on device: migrations, FTS5, WAL on the device filesystem~~ **done at M7** — `chayote.db` + `-wal` + `-shm` on the device filesystem, FTS5 search with `bm25` and `snippet()` returning marked results, and the row surviving a `force-stop` |
| ~~APK size against the 20 MB budget~~ **done at M7 — 14.65 MiB** | ~~The back button walking the view stack~~ **confirmed broken at M7**, and §4.4's prescribed mechanism does not exist in Tauri 2.12. See `06-platform.md` §4.4; needs an ADR |
| ~~The manifest requests no `INTERNET` permission~~ **done at M7** | `Pause`/`Resume` flushing the autosave (§4.5). **Observed on device at M7** — typing inside the debounce and backgrounding lost nothing |
| ~~`adjustResize` present in the manifest — declared, not observed~~ **done at M7, `aapt2`** | A current stable System WebView. The oldest supported WebView was dropped as a test target at M6 (`06-platform.md` §1). **Tested at M7 on WebView 153.0.8010.57** |
| ~~The back button walking the view stack~~ **done at M7 via ADR-020**, and observed on the device | Long-press opening the context menu. **Measured at M8**: the user's own long-press opened the folder menu (and showed it clipped — the portal fix), and `adb shell input swipe x y x y 900` reproduces a WebView-recognised long-press, contrary to the earlier note that it could not. The note rows answered the same hold with a text selection — no `contextmenu` handler and selectable text as far as the gesture could reach — so a trashed note was unrestorable on touch past the toast; rows and list section are not selectable now and answer `contextmenu` like the folder rows. The prevented hold synthesises no release events on this WebView, so the menu stays open; the row eats the release click for engines that do synthesise one. `adb` hold coordinates must be CDP-measured, not eyeballed — the CSS viewport is 360 wide at DPR 3 |
| ~~Window insets keep the app clear of the system bars~~ **found broken on device at M7 and fixed** | ~~44 px touch targets~~ **done at M7** — the editor's status bar slots were ~20 px and are 44 px, asserted as geometry in `e2e/mobile.spec.ts`. Playwright cannot see the insets, since Chromium reports zero |
| Frontend layout at 360 × 640 in Chromium — now also covered by `e2e/mobile.spec.ts`, which asserts the mobile row's shape and that nothing wraps | Airplane mode changing nothing, because nothing is online. **Not yet exercised** — it needs a permission this shell does not have |
| | Rotation preserving the open note and the editor scroll position. **Layout verified at M7**; scroll position not measured |
| | Cold start reaching an editable caret on the device. **Verified at M7** |

The second column is the reason M7 exists as a milestone rather than a build step. The first column is a real gate and worth running before anyone is asked to plug in a phone. **Struck-through rows ran, not stopped mattering** — every one of those rows is a regression risk, and §3.5 gives the commands that catch it. The three that remain were not skipped for difficulty: two need a human or a permission this shell does not have, and the third is a spec problem rather than a build problem.

### 3.5b Device-session cookbook — Windows, USB, Infinix X6836

Everything below was re-derived from scratch in a session where `adb` was assumed missing, and is written down so the next session does not repeat it. The device at the time: Infinix X6836, Android 13, `arm64-v8a`, `1080×2460` at density 480 (CSS pixel ×3), id `11121253C6000586`.

**`adb` is not on `PATH` in agent shells — never assume it is.** The SDK from §2 is real; the binary is at `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`. Likewise `ANDROID_HOME` / `ANDROID_SDK_ROOT` live in the `HKCU\Environment` registry but have been observed absent from agent PowerShell sessions, so no command may rely on them — pass full paths (`aapt2` under `build-tools\36.1.0`, `sdkmanager` under `cmdline-tools\latest\bin`). First command of every session:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb devices   # want: 11121253C6000586  device
```

Screenshots, input, install and launch:

```powershell
& $adb shell screencap -p /sdcard/<name>.png
& $adb pull /sdcard/<name>.png <local-path>
& $adb shell input tap <x> <y>                 # single tap, device pixels
& $adb shell input swipe <x> <y> <x> <y> 900   # long-press the WebView recognises
& $adb shell input keyevent 4                  # system back — deterministic for dialogs
& $adb shell am start -n com.chayote.app/.MainActivity
& $adb install -r <apk>                        # -r keeps data on a signature match
& $adb shell dumpsys package com.chayote.app   # version, signature, DEBUGGABLE flag
```

Measuring instead of eyeballing: an eyeballed tap lands ~100 px off (the CSS
viewport is 360 wide at DPR 3, plus the status bar and inset offsets), and a
miss on a 20 px chevron can toggle the wrong control with no visible error
until the next screenshot. `scripts/measure-screenshot.py` reads the pulled
screenshot and prints the brightness runs in a band — hairlines, header glyphs,
text rows — which bound the control to tap; the run's center is the coordinate
on that axis. `--find dark` inverts for the light theme, `--axis cols` finds
vertical edges, `--box` limits the scan. Defaults cover the sidebar's left
gutter on a 1080×2460 shot, where the section chevrons and folder twisties
live:

```powershell
& $adb pull /sdcard/<name>.png <local-path>
python scripts/measure-screenshot.py <local-path>
& $adb shell input tap <x> <y>
```

Needs Pillow (`pip install pillow`); otherwise stdlib only, and it needs no
device connection — it runs on the pulled PNG. Proven in the section-collapse
session: eyeballed taps kept landing in the neighbouring control's hit slop,
and every tap after measuring landed first try. Aim at the middle of the item
box rather than its text core — at a scaled root font the items are far taller
than their text, and an edge tap lands in the neighbour.

**Reading the page on the device — CDP over `adb forward`, no build change needed.** A
screenshot shows what is on the glass; it cannot say what the page thinks. The WebView in a
debug build is already inspectable, so a layout claim can be *measured* on the phone:

```powershell
$line = & $adb shell cat /proc/net/unix | Select-String webview_devtools   # PID changes on every relaunch
& $adb forward tcp:9222 "localabstract:webview_devtools_remote_$pid"
# then over the WebSocket at ws://127.0.0.1:9222/devtools/page/<id>, Runtime.evaluate:
#   JSON.stringify({innerH: window.innerHeight, visualH: Math.round(window.visualViewport.height),
#                   offsetTop: Math.round(window.visualViewport.offsetTop),
#                   focus: document.activeElement?.getAttribute('data-testid')})
```

Node 24 has a global `WebSocket`, so this needs nothing installed in the project. Two
things it settled in the ADR-023 session that four screenshots had not:

- **Which element holds focus.** A tap that appears to miss a field is often a tap that
  landed somewhere else entirely, and `document.activeElement` names the truth in one
  call. It is also how "the text I typed went into the body instead of the title" was
  found rather than guessed at.
- **What the keyboard does to the viewport.** With the IME open on this device,
  `innerHeight` stays 820 while `visualViewport.height` falls to 525 and `offsetTop`
  becomes 220 — the layout viewport is *not* resized, so the WebView shifts the visible
  window down and everything above the caret leaves the screen. No amount of reasoning
  about flex and `min-h-0` reproduces that: a `setViewportSize` harness shrinks the layout
  viewport instead, which is a different failure with a different fix, and a change written
  against it would have been a fix for nothing.

Coordinates still have to be measured per tap, and **the rect has to be taken in the same
state you will tap in**: with the IME open, `getBoundingClientRect()` is in layout
coordinates while the screen shows `layout − offsetTop`, so a point can be measured
accurately and still be 68 px off-screen. Close the IME first, or add the offset back.

**Restoring what a session touched.** Take the copy with the app stopped, and copy all
three files — `db`, `-wal` and `-shm` — or the `-wal` pages are missing from the
restored database. **Do not open the only copy in `sqlite3`**: it replays the WAL into the
main file and deletes the `-wal`, which is exactly the evidence you wanted kept. Copy the
backup somewhere else, open that, and query the original only for a byte-level comparison.
Byte-identical `db` and `-wal` sizes before and after a device session are a cheap check
that nothing was written at all.

What the gear session taught, beyond §3.5a:

- `screencap` returns the full `1080×2460`, so image pixels are device pixels 1:1 — but CSS pixels are ×3 *and* offset by the status bar and the safe-area insets, so eyeballed taps land ~100 px off (the M8 note). Measure the target in the previous screenshot instead of guessing.
- Screenshot after *every* tap and read it before the next one. Blind taps deleted a folder in M8 and missed a menu item here (two taps dismissed the editor overflow instead of pressing Move to trash — suspect a small vertical offset; `keyevent 4` closed the same dialog with no coordinates at all).
- For an on-device check of a frontend change, build debug, not release: `npx tauri android build --apk --debug --target aarch64` is minutes (cached Rust deps, one ABI — enough for this phone), while the full release is ~25. The installed app is already a debug build under the same machine debug key, so `install -r` updates it with data intact. A release APK is unsigned and not installable as-is.
- Device state is test data until told otherwise: creating notes, trashing them, and changing settings during verification is expected — but say what was left behind (here: one extra empty Untitled note, trash flow unretouched).

**The session loop is install → exercise → screenshot → review → fix, and it applies to every change, not just device work.** A change is not done when the tests pass: install the build on the phone, perform the actions the change touches, screenshot each state, look at the shots, and change the code if they show anything wrong. Screenshots nobody reviewed are decoration. This is a standing requirement, repeated in §7 so no session needs to be reminded of it.

## 4. Visual regression against the prototype

`prototype/index.html` is the visual source of truth (ADR-016). A screenshot comparison turns it from a reference into a check.

Approach, in increasing cost:

1. **Assertion tests.** `expect(page.locator('.note-card')).toHaveCount(6)`, `toBeVisible()`, bounding boxes matching `05-ui-ux.md` §2. Cheap, stable, catches regressions that matter. This is the baseline.
2. **Screenshot capture at fixed viewports.** Playwright screenshots each state at 1280 × 820, 768 × 1023, and 360 × 640, in both themes. Committed under `screenshots/`. Reviewed by a human, compared between runs by eye.
3. **Pixel diffing against the prototype.** Possible but brittle — the prototype and the app will never be pixel-identical, since the prototype is static and the app is live. Only worth doing once the app is stable, and only for the chrome, not the editor.

**Recommendation: do level 1 from M3, level 2 from M6.** Level 3 is probably not worth the maintenance. A brittle visual test that fails on an inconsequential 1 px difference trains people to ignore it.

`e2e/capture.spec.ts` implements level 2 from M0. It writes to `screenshots/`, which is committed, so a reviewer can compare states between runs by eye. `e2e/search.spec.ts` writes `search-light.png` the same way, because the search field is the one control whose defects are visual only — Chromium's own cancel button and a second focus ring both passed every DOM assertion and were caught by looking.

## 5. Gates per milestone

Run all of these before declaring any milestone done. They are also the CI gate, per `10-conventions.md` §11.

```bash
npm run typecheck        # zero errors
npm run lint             # zero errors
npm run test             # Vitest, all green
npm run build            # production build succeeds
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npx playwright test      # from M3 onward
```

The agent runs these itself and reports actual output. Reporting "tests pass" without pasting the result is the single most common failure mode and is treated as a false claim.

## 6. Where a human must be involved

Honest list. Everything else is the agent's job.

| Moment | What the human decides |
|--------|----------------------|
| Milestone plan approval | Whether the plan matches intent, before code is written |
| Visual review | Whether the UI *feels* right. Assertions cannot judge taste. This is the one check that cannot be automated. |
| M7 on device | The Android checklist on real hardware |
| Any change to R1–R9 | These are review criteria; a human owns the judgement |
| Any change to a frozen decision | New ADR in `09-decisions.md`, never a silent edit |

## 7. What the agent must do without being asked

Per `README.md` §4.1 and `10-conventions.md` §11:

- Run the gate commands after each change and report the real output.
- Update `docs/08-roadmap.md` §7 in the same commit as the work it describes.
- Screenshot UI work and compare it against `prototype/index.html` before declaring it done.
- **Verify on the device before declaring it done.** Any change that affects the mobile UI is installed on the USB phone (§3.5b), exercised, screenshotted, and reviewed — §3.5b's loop, unprompted.
- **Commit without being asked.** Once the gates pass, commit the work in the same session — one logical change per commit (`10-conventions.md` §11) — and say what was committed. Never end a work session with uncommitted changes unless the user said not to. Do not push unless explicitly asked.
- **Stop and ask** when: a plan needs approval, a visual judgement is required, a change touches R1–R9, a decision changes, or a check cannot be run.
- **Never** claim a check passed that was not run. If `adb` is missing, the Android milestone is blocked, not done.
