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

Measured on the development machine, 2026-10-07:

| Capability | Available | Notes |
|------------|-----------|-------|
| Node.js 24, npm 11 | Yes | |
| Rust 1.94 stable | Yes | |
| Git 2.50 | Yes | |
| Chromium for Playwright | **Yes** — `ms-playwright/chromium-1234` installed | Enables real browser automation and screenshots |
| Screen capture of a native window | **Yes** — `System.Drawing` available | Enables capturing the actual Tauri window |
| JDK 21 | Yes | Sufficient for Android Gradle builds |
| Android SDK / `adb` | **No** | `ANDROID_HOME` and `ANDROID_SDK_ROOT` both empty |
| Rust Android targets | **No** — only `x86_64-pc-windows-msvc` installed | Needs `rustup target add aarch64-linux-android` |

**Consequence:** milestones M0–M6 and M8 are fully agent-verifiable. **M7 (Android) cannot be built or run on this machine** until the SDK is installed. It is blocked, and pretending otherwise would produce an untested Android claim.

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

### 3.5 Android — manual, and blocked until the SDK exists

`06-platform.md` §6 "Android" is a checklist a human walks through on a physical arm64 device. It cannot be automated on this machine.

Before M7 can begin:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
rustup target add aarch64-linux-android
rustup target add armv7-linux-androideabi
adb devices
```

Until `adb devices` lists a device, no Android claim is verifiable and none should be made.

## 4. Visual regression against the prototype

`prototype/index.html` is the visual source of truth (ADR-016). A screenshot comparison turns it from a reference into a check.

Approach, in increasing cost:

1. **Assertion tests.** `expect(page.locator('.note-card')).toHaveCount(6)`, `toBeVisible()`, bounding boxes matching `05-ui-ux.md` §2. Cheap, stable, catches regressions that matter. This is the baseline.
2. **Screenshot capture at fixed viewports.** Playwright screenshots each state at 1280 × 820, 768 × 1023, and 360 × 640, in both themes. Committed under `screenshots/`. Reviewed by a human, compared between runs by eye.
3. **Pixel diffing against the prototype.** Possible but brittle — the prototype and the app will never be pixel-identical, since the prototype is static and the app is live. Only worth doing once the app is stable, and only for the chrome, not the editor.

**Recommendation: do level 1 from M3, level 2 from M6.** Level 3 is probably not worth the maintenance. A brittle visual test that fails on an inconsequential 1 px difference trains people to ignore it.

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