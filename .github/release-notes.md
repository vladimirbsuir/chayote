Chayote __VERSION__.

Windows, Linux and Android builds update themselves from
**Settings → Updates**. macOS builds do not, for the reasons in
[`docs/06-platform.md`](https://github.com/vladimirbsuir/chayote/blob/main/docs/06-platform.md).

Download | Asset
--- | ---
Windows | `Chayote___VERSION___x64-setup.exe`
macOS | `.app.tar.gz` or `.dmg`
Linux | `.AppImage` or `.deb`
Android | `app-universal-release.apk`

**Android:** install the APK once by hand to replace any earlier
build, then every update after that arrives in the app. Android
refuses an update signed with a different certificate than the
installed one, so a build installed with a debug key has to be
removed before a released one will take — and removing it deletes
its notes, so back them up first. The first update asks for one
permission, granted in system settings rather than in a pop-up.
