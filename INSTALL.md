# Chayote — Install and uninstall

Chayote is a local-first notes app. It works fully offline, needs no
account, and stores your notes in a single SQLite file on your device.

## Windows

Two downloads are published for every release:

| File                      | What it is                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Chayote_*_x64-setup.exe` | NSIS installer. Installs Chayote for the current user.                                                                          |
| `chayote.exe` (portable)  | The app itself. Runs from anywhere, writes nothing outside the data locations below. Produced by `npx tauri build --no-bundle`. |

The installer is **unsigned** in v1. Windows SmartScreen will warn that the
publisher is unknown. Click `More info`, then `Run anyway`.

## macOS

| File            | What it is                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `Chayote_*.dmg` | Disk image. Open it and drag Chayote into Applications. A bare `.app` is published alongside it. |

The build is **unsigned and unnotarised** in v1. On first launch, macOS will
refuse to open it. Right-click (or Ctrl-click) Chayote, choose `Open`, then
choose `Open` again in the dialog. You only do this once.

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

## First launch

The app opens empty: no folders, no tags, no sample notes, no sign-in. Use
`+` (or `Ctrl+N`) to create your first note. Everything is saved
automatically as you type.

Chayote makes **zero network requests**. If the device is in airplane mode,
nothing changes.

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
