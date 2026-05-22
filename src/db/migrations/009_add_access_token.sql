ALTER TABLE landing_subscribers ADD COLUMN access_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_landing_subscribers_token ON landing_subscribers(access_token);
