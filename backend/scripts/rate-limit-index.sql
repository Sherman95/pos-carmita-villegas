-- SIDRO P6.2 — Optional index for the rate limiter cleanup job.
-- Idempotent: safe to run repeatedly. NOT executed automatically.
--
-- Impact:
--   * Adds one index on api_rate_limit_counters(reset_at).
--   * Only accelerates `DELETE FROM api_rate_limit_counters WHERE reset_at < now()`
--     and keeps the cleanup fast as the table grows.
--   * Touches no business tables and modifies no data.
--   * The limiter works correctly without it (the table stays small because
--     expired rows are purged every 5 minutes).

CREATE INDEX IF NOT EXISTS idx_api_rate_limit_counters_reset_at
  ON api_rate_limit_counters (reset_at);
