/* Merges the Android artifact into a release's `latest.json`.
 *
 * `tauri-action` generates that file for the desktop matrix and merges each
 * matrix job's platform keys into it. It cannot do the Android one, because
 * `tauri android build` packages through Gradle rather than through Tauri's
 * bundler: it produces no updater artifact and no `.sig`, so there is nothing
 * for the action to find and nothing for it to merge (ADR-025). The signature is
 * therefore produced here with `tauri signer sign`, and the key written here.
 *
 * Both ARM ABIs point at the same APK, which carries both — that is what
 * `tauri android build --target aarch64 --target armv7` produces — so they share
 * one signature. They are separate manifest keys because a device asks for the
 * key matching its own architecture, and a 32-bit device asking for `aarch64`
 * would be told the update does not exist.
 *
 * Usage:
 *   node scripts/android-updater-manifest.mjs <manifest.json> <apk.sig> \
 *        <asset-name> <version> <tag>
 *
 * Reads the manifest, writes the merged manifest to stdout, and changes nothing
 * on disk. The caller decides where it goes. */

import { readFileSync } from 'node:fs';

const [, , manifestPath, signaturePath, assetName, version, tag] = process.argv;

if (!manifestPath || !signaturePath || !assetName || !version || !tag) {
  process.stderr.write(
    'usage: android-updater-manifest.mjs <manifest.json> <apk.sig> <asset-name> <version> <tag>\n',
  );
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/* The signature is the contents of the `.sig` file, base64 inside the JSON, not
   a path and not a URL. Tauri decodes the outer base64 to find it. */
const signature = readFileSync(signaturePath, 'utf8').trim();
const url = `https://github.com/vladimirbsuir/chayote/releases/download/${tag}/${assetName}`;

/* `requireSignedVersion` compares the version in the signature's trusted comment
 * with the one announced here, and a mismatch makes every Android update fail at
 * install rather than at check. Tauri writes that comment as
 * `version:<v>\tts:<unix>\tfile:<name>`, so the version is read out of it — not
 * guessed from the signature blob, which is just base64 and would pass any
 * assertion that only asks whether it is non-empty. */
const decoded = Buffer.from(signature, 'base64').toString('utf8');
const trusted = decoded.split('\n').find((line) => line.startsWith('trusted comment:'));

if (trusted === undefined) {
  process.stderr.write('the signature carries no trusted comment, so it names no version\n');
  process.exit(1);
}

const signedVersion = /version:([^\s\t]+)/.exec(trusted)?.[1];

if (signedVersion === undefined) {
  process.stderr.write(`the trusted comment names no version: ${trusted}\n`);
  process.exit(1);
}

if (signedVersion !== version) {
  process.stderr.write(
    `the signature is for version ${signedVersion} but the build is ${version}\n`,
  );
  process.exit(1);
}

if (manifest.version !== version) {
  process.stderr.write(
    `the manifest announces ${manifest.version} but the build is ${version}\n`,
  );
  process.exit(1);
}

manifest.platforms = manifest.platforms ?? {};
manifest.platforms['android-aarch64'] = { signature, url };
manifest.platforms['android-armv7'] = { signature, url };

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);