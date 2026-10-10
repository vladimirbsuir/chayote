# 11 — Verification Strategy

**Status:** Frozen. Last updated 2026-10-07.

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
adb devices                       # a device id, status "device"   <- still empty
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
| ~~The back button walking the view stack~~ **done at M7 via ADR-020**, and observed on the device | Long-press opening the context menu. **Measured at M8**: the user's own long-press opened the folder menu (and showed it clipped — the portal fix), and `adb shell input swipe x y x y 900` reproduces a WebView-recognised long-press, contrary to the earlier note that it could not |
| ~~Window insets keep the app clear of the system bars~~ **found broken on device at M7 and fixed** | ~~44 px touch targets~~ **done at M7** — the editor's status bar slots were ~20 px and are 44 px, asserted as geometry in `e2e/mobile.spec.ts`. Playwright cannot see the insets, since Chromium reports zero |
| Frontend layout at 360 × 640 in Chromium — now also covered by `e2e/mobile.spec.ts`, which asserts the mobile row's shape and that nothing wraps | Airplane mode changing nothing, because nothing is online. **Not yet exercised** — it needs a permission this shell does not have |
| | Rotation preserving the open note and the editor scroll position. **Layout verified at M7**; scroll position not measured |
| | Cold start reaching an editable caret on the device. **Verified at M7** |

The second column is the reason M7 exists as a milestone rather than a build step. The first column is a real gate and worth running before anyone is asked to plug in a phone. **Struck-through rows ran, not stopped mattering** — every one of those rows is a regression risk, and §3.5 gives the commands that catch it. The three that remain were not skipped for difficulty: two need a human or a permission this shell does not have, and the third is a spec problem rather than a build problem.

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
- **Stop and ask** when: a plan needs approval, a visual judgement is required, a change touches R1–R9, a decision changes, or a check cannot be run.
- **Never** claim a check passed that was not run. If `adb` is missing, the Android milestone is blocked, not done.