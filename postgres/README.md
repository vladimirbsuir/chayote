# Sync setup (any Postgres)

The sync engine speaks the plain Postgres wire protocol with TLS. Any
server works — hosted Postgres or a local container: paste its connection
string into **Settings → Sync** and the app behaves identically. There is
no provider-specific code anywhere.

## 1. The server tables create themselves

There is nothing to run by hand. Every sync cycle starts by reading the
highest version in `chayote_schema_migrations`; if the server is behind the
app, the app applies the missing files from `migrations/` in order, inside
one transaction, under a Postgres advisory lock so two devices syncing at the
same moment apply each step once. An empty database therefore becomes a
Chayote server on the first **Sync now**, and an app update that changes the
server schema upgrades it on its first sync. A server whose tables were
created by hand from `0001_initial.sql` before this existed is adopted: the
file is all `IF NOT EXISTS`, so it applies as a no-op and is recorded.

If the server is *ahead* of the app (another device runs a newer Chayote),
sync stops with "update Chayote on this device" rather than writing rows the
newer schema may not expect.

**By hand, only if the role may not create tables:** run every file in
`migrations/` in order in your provider's SQL editor. Each file is
idempotent, so the app re-running them on its next sync, and recording them
as it does, changes nothing.

Rules for a new server migration: add `NNNN_name.sql` with the next number,
list it in `SERVER_MIGRATIONS` (`src-tauri/src/sync/schema.rs`; a test fails
if the folder and the list disagree), never edit one that has shipped, and
keep every statement idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).

No RLS, no auth, no extensions: single-user mode, the connection string
itself is the credential.

## 2. Which connection string to use

`Settings → Sync` wants a Postgres connection string, e.g.

- **Hosted pooler in session mode (recommended for hosted databases):**
  `postgresql://postgres.PROJECTREF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres`
  (Dashboard → Project Settings → Database → Connection string → **Pooler**,
  session mode.) Session mode gives every connection a stable server
  session; transaction mode (port 6543) does not support the protocol-level
  prepared statements every client sends, which surfaces as
  `prepared statement "s0" already exists` or silent stalls — so port 6543
  is not usable here, on any plan.
- **Local container:** `postgresql://postgres:postgres@127.0.0.1:5432/chayote?sslmode=disable`
  (`sslmode=disable` is honoured for non-public hosts only. Prefer the
  numeric address over `localhost`: on some machines `localhost` resolves
  to IPv6 first and the connection hangs where `127.0.0.1` succeeds.)

Direct `db.*:5432` strings are IPv6-only without a paid IPv4 add-on; the
pooler above is IPv4 on every plan.

The string is stored on the device next to the database (plaintext, same as
your notes). Anyone holding it has full read/write access to these four
tables, so treat it like a password and do not paste it anywhere else. There
are no accounts and no keychain integration, by decision — see `07-sync-plan.md`
§7.

### TLS (`sslmode`)

The engine follows libpq names, read off the connection string:

| `sslmode` | Behaviour |
|-----------|-----------|
| absent or `require` | TLS, server not authenticated (what `psql` does out of the box) |
| `verify-full` (also `verify-ca`) | TLS against the bundled Mozilla roots |
| `disable` | Plaintext (local use) |
| `prefer` / `allow` | Behave as `require` — there is deliberately no silent plaintext fallback |

The default is `require`, not verification, for a measured reason: hosted
poolers serve a privately-rooted chain (observed: a "Supabase Intermediate
2021 CA" no public bundle contains), so verification is impossible there by
construction. Encryption still defeats passive capture; active MITM is not
defended in this mode. Servers with public certificates (direct hosts,
self-hosted with Let's Encrypt) should use `verify-full`.

## 3. First sync (bootstrap)

1. Paste the string, enable **Sync**, press **Save** (saving with an empty
   field keeps the stored string and only flips the switch), then **Sync now**.
2. The first run pushes every local row (tags → folders → notes → tag sets),
   then pulls. Large libraries take one longer first run; later runs are
   incremental (50-row batches, 60 s interval while the app is open).
3. If a row id already exists on the server, it is treated as a conflict
   (07 §5): folders/tags resolve by latest write, note text is never
   auto-merged — the remote copy is parked under **Settings → Sync →
   Conflicts** and your local version stays live.

Switching servers re-uploads everything automatically: revisions and pull
watermarks are meaningless against a database that has never seen the
device, so saving a *different* connection string marks every row dirty,
re-queues it and restarts the watermarks. Saving the *same* string (or an
empty field) changes nothing. One limitation: folders and tags deleted
*before* the switch are already gone locally and leave no tombstone behind,
so the new server never learns about those deletions.

## 4. Checking the server state by hand

Any Postgres client works, e.g. `psql "<connection-string>"`:

```sql
SELECT count(*) FROM notes;
SELECT id, rev, updated_at FROM notes ORDER BY rev DESC LIMIT 5;
SELECT * FROM folders WHERE deleted_at IS NOT NULL;  -- tombstones
```

## 5. Deleting remote data

There is no "delete account" (there is no account). To wipe the server:

```sql
TRUNCATE note_tags, notes, tags, folders RESTART IDENTITY;
```

`RESTART IDENTITY` resets `sync_rev_seq`; afterwards every device should
sync once with an empty server before writing, or stale `rev` watermarks
will skip rows. The device keeps its notes regardless.

To remove Chayote from the database entirely, drop the tables instead:

```sql
DROP TABLE note_tags, notes, tags, folders, chayote_schema_migrations;
DROP SEQUENCE sync_rev_seq;
```

The next sync from any device creates them again, empty. As after any wipe,
each device then needs **Re-upload everything** to push its library again
(`07-sync-plan.md` §6).
