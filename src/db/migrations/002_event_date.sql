-- Migration 002: Add event_date to events
ALTER TABLE events ADD COLUMN event_date TEXT;
CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);
