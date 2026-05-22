-- Migration 001: Initial schema
-- Compatible with PostgreSQL (REQ-F05): no SQLite-specific types
-- WAL mode and foreign_keys pragma set in connection.ts, not here

CREATE TABLE IF NOT EXISTS _migrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT    NOT NULL UNIQUE,
  applied_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  base_url    TEXT    NOT NULL UNIQUE,
  config_json TEXT    NOT NULL DEFAULT '{}',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  url             TEXT    NOT NULL UNIQUE,
  title           TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'pending_first_scan'
                          CHECK (status IN ('available', 'sold_out', 'limited', 'unknown', 'pending_first_scan')),
  last_checked_at TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS availability_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status        TEXT    NOT NULL
                        CHECK (status IN ('available', 'sold_out', 'limited', 'unknown', 'pending_first_scan')),
  raw_html_hash TEXT,
  detected_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_events_site_id        ON events(site_id);
CREATE INDEX IF NOT EXISTS idx_events_status          ON events(status);
CREATE INDEX IF NOT EXISTS idx_snapshots_event_id     ON availability_snapshots(event_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_detected_at  ON availability_snapshots(detected_at);
