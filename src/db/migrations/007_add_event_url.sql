-- Add event_url column to store the public event info URL (different from purchase URL)
-- url = purchase URL (entradas.teatroscanal.com — private ticketing)
-- event_url = public event info URL (teatroscanal.com/espectaculo/... — public info page)

ALTER TABLE events ADD COLUMN event_url TEXT;

-- Create index for event_url if it becomes a common query
CREATE INDEX idx_events_event_url ON events(event_url);
