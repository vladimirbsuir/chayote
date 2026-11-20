/* The release notes the updater shows (`latest.json` → `notes`).
 *
 * `tauri-action` copies the GitHub Release body into `latest.json`, and that
 * body is written for a web page: a download table, Markdown emphasis, hard
 * line breaks, install advice for people who do not have the app yet. The
 * Updates tab is read by people who do, on a phone, under an Install button —
 * v0.2.1 showed them the whole page. So the manifest gets its own notes, built
 * here from the Conventional Commits since the previous tag
 * (`10-conventions.md` §11): user-facing `feat` and `fix`/`perf` subjects, as a
 * plain list the tab lays out (`src/lib/releaseNotes.ts`).
 *
 * Usage:
 *   node scripts/release-notes.mjs [<ref>]     # default HEAD
 *
 * Prints the notes to stdout. Needs the history and tags, so a CI checkout must
 * use `fetch-depth: 0`. */

import { execFileSync } from 'node:child_process';

const ref = process.argv[2] ?? 'HEAD';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

let previous = '';
try {
  previous = git('describe', '--tags', '--abbrev=0', '--match', 'v*', `${ref}^`);
} catch {
  /* No earlier tag: the first release lists everything. */
}

const range = previous ? `${previous}..${ref}` : ref;
const subjects = git('log', '--no-merges', '--format=%s', range).split('\n').filter(Boolean);

/* Scopes that describe the build, not the app a user runs. */
const INTERNAL_SCOPES = new Set(['release', 'ci', 'e2e', 'docs', 'test', 'deps']);
const COMMIT = /^(feat|fix|perf)(?:\(([^)]*)\))?!?:\s*(.+)$/;

const added = [];
const fixed = [];
for (const subject of subjects) {
  const match = COMMIT.exec(subject);
  if (!match) continue;
  const [, type, scope = '', summary] = match;
  if (scope.split(',').some((part) => INTERNAL_SCOPES.has(part.trim()))) continue;
  /* `(#12)` and `(ADR-025)` point into the repository, not at anything a reader
     of the tab can open. */
  const text = summary.replace(/\s*\((?:#\d+|ADR-\d+)\)/g, '').trim();
  if (!text) continue;
  const line = `- ${text[0].toUpperCase()}${text.slice(1)}`;
  (type === 'feat' ? added : fixed).push(line);
}

const sections = [];
if (added.length > 0) sections.push(['New:', ...added].join('\n'));
if (fixed.length > 0) sections.push(['Fixed:', ...fixed].join('\n'));

process.stdout.write(`${sections.length > 0 ? sections.join('\n\n') : 'Maintenance release.'}\n`);
