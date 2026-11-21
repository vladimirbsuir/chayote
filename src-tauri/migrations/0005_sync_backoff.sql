ALTER TABLE outbox ADD COLUMN next_retry_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_outbox_retry ON outbox(next_retry_at) WHERE sent_at IS NULL;
