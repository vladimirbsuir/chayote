-- 0005_sync_backoff.sql — per-row retry backoff for the sync outbox
-- `07-sync-plan.md` §8 (retry). Forward-only (R8).
--
-- A failing row must not pin the queue at full speed: `next_retry_at` holds
-- the earliest epoch-ms at which the row is due again, computed from
-- `attempts` with exponential backoff. NULL means "due now" — every row
-- written before this migration stays immediately drainable.

ALTER TABLE outbox ADD COLUMN next_retry_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_outbox_retry ON outbox(next_retry_at) WHERE sent_at IS NULL;
