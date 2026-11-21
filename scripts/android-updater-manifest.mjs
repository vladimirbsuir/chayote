import { readFileSync } from 'node:fs';

const [, , manifestPath, signaturePath, assetName, version, tag] = process.argv;

if (!manifestPath || !signaturePath || !assetName || !version || !tag) {
  process.stderr.write(
    'usage: android-updater-manifest.mjs <manifest.json> <apk.sig> <asset-name> <version> <tag>\n',
  );
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const signature = readFileSync(signaturePath, 'utf8').trim();
const url = `https://github.com/vladimirbsuir/chayote/releases/download/${tag}/${assetName}`;

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