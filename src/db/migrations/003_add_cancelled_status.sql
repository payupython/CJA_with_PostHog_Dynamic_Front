-- Add 'cancelled' to status CHECK constraint
-- SQLite doesn't support ALTER CONSTRAINT, so we recreate the table

PRAGMA foreign_keys=OFF;

-- Create new table with updated constraint
CREATE TABLE events_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  url             TEXT    NOT NULL UNIQUE,
  title           TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'pending_first_scan'
                          CHECK (status IN ('available', 'sold_out', 'limited', 'unknown', 'pending_first_scan', 'cancelled')),
  last_checked_at TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  event_date      TEXT
);

-- Copy data from old table
INSERT INTO events_new SELECT * FROM events;

-- Drop old table
DROP TABLE events;

-- Rename new table
ALTER TABLE events_new RENAME TO events;

-- Recreate indexes
CREATE INDEX idx_events_site_id        ON events(site_id);
CREATE INDEX idx_events_status         ON events(status);
CREATE INDEX idx_events_event_date     ON events(event_date);

PRAGMA foreign_keys=ON;
