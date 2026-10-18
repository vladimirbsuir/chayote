# Chayote — Install and uninstall

Chayote is a local-first notes app. It works fully offline, needs no
account, and stores your notes in a single SQLite file on your device.

## Updating

On **Windows**, **Linux** and **Android**, Chayote updates itself. Open
`Settings → Updates` and press `Check for updates`; if a newer version exists,
press `Install and restart`. The app checks once a day on its own and tells
nobody, so opening the tab is all you need to do.

**On Android, the first update asks for one permission.** Android will not let
an app install anything unless you allow it, and there is no pop-up for that —
it lives in system settings. Press `Install and restart` and Chayote will take
you to the right screen; press `Install and restart` once more after saying
yes. After that, updates go through without stopping.

Every update is verified against a signing key compiled into the app. An
update that does not match is refused rather than installed.

On **macOS** the app cannot update itself, and the Updates tab says so. Download
the new build from the releases page instead; your notes are untouched by the
switch.

## Windows

Two downloads are published for every release:

| File                      | What it is                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Chayote_*_x64-setup.exe` | NSIS installer. Installs Chayote for the current user.                                                                          |
| `chayote.exe` (portable)  | The app itself. Runs from anywhere, writes nothing outside the data locations below. Produced by `npx tauri build --no-bundle`. |

The installer is **unsigned** in v1. Windows SmartScreen will warn that the
publisher is unknown. Click `More info`, then `Run anyway`.

An in-app update replaces the installed app in place, so you do not need the
installer twice.

## macOS

| File            | What it is                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `Chayote_*.dmg` | Disk image. Open it and drag Chayote into Applications. A bare `.app` is published alongside it. |

The build is **unsigned and unnotarised** in v1. On first launch, macOS will
refuse to open it. Right-click (or Ctrl-click) Chayote, choose `Open`, then
choose `Open` again in the dialog. You only do this once.

macOS does not update in place. Replacing the app in `/Applications` over the
old one is what the installer would have done; drag the new `.app` across and
choose `Replace`. Chayote cannot do this for you, because an unsigned bundle
cannot replace itself — see `docs/06-platform.md` §3.8.

## Linux

| File                 | What it is                                                                         |
| -------------------- | ---------------------------------------------------------------------------------- |
| `Chayote_*.deb`      | Install with `sudo dpkg -i Chayote_*.deb` (or `sudo apt install ./Chayote_*.deb`). |
| `Chayote_*.AppImage` | Make it executable once — `chmod +x Chayote_*.AppImage` — then run it.             |

## Android

| File                        | What it is                                                                |
| --------------------------- | ------------------------------------------------------------------------- |
| `app-universal-release.apk` | Debug-signed APK for `arm64-v8a` and `armeabi-v7a`. Android 8.0 or newer. |

Android does not allow installing APKs from outside the store by default.
On the device, allow `Install unknown apps` for the browser or file manager
you download the APK with, then open the APK to install. The signing key is
a debug key kept outside this repository; a store release with a stable
release key is out of scope for v1.

An update installs over the top of the existing app, so your notes and tags
carry across. If you install by hand instead, put the new APK over the old one
rather than removing it first: Android deletes an app's data when it is
uninstalled, and the notes database goes with it.

## Your data

| Store          | Desktop                                         | Android                                        |
| -------------- | ----------------------------------------------- | ---------------------------------------------- |
| Notes database | `chayote.db` inside the app data directory      | `chayote.db` inside the app files directory    |
| Settings       | `settings.json` inside the app config directory | `settings.json` inside the app files directory |

The exact directory is chosen by the OS (for example
`%APPDATA%\com.chayote.app` on Windows, `~/.local/share/com.chayote.app` on
Linux). To back up your notes, **close the app first**, then copy
`chayote.db` together with its sidecar files (`chayote.db-wal`,
`chayote.db-shm`) if they exist. Copying the database while the app is open
can lose recent edits.

## Uninstall

- **Windows:** `Settings → Apps → Chayote → Uninstall`, or delete the
  portable `.exe`.
- **macOS:** drag Chayote from Applications to the Bin.
- **Linux:** `sudo apt remove chayote` (for the `.deb`), or delete the
  `.AppImage`.
- **Android:** uninstall like any other app.

Uninstalling removes the app but leaves `chayote.db` behind, so
reinstalling finds your notes where you left them. To delete everything,
remove the files listed under “Your data” above.
