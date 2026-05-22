import { getDb } from './connection.js';

export interface Event {
  id?: number;
  site_id: number;
  url: string;
  event_url?: string;
  title: string;
  status: string;
  event_date?: string;
  last_checked_at?: string;
}

export async function upsertEvent(event: Event): Promise<number> {
  const db = await getDb();

  // Warn if future event is marked cancelled (should only happen if scanner detected cancelation keywords)
  if (event.event_date && event.status === 'cancelled') {
    const eventTime = new Date(event.event_date).getTime();
    const nowTime = new Date().getTime();
    if (eventTime > nowTime) {
      console.warn(`[DB] Future event marked cancelled (should have detection keywords): ${event.title}`);
    }
  }

  // Try to find existing event by URL and event_date (composite key)
  const existing = await db.get(
    'SELECT id FROM events WHERE url = ? AND event_date = ?',
    event.url,
    event.event_date
  );

  const now = new Date().toISOString();
  if (existing) {
    console.log(`[DB] UPDATE event id=${existing.id} status=${event.status} date=${event.event_date}`);
    await db.run(
      `UPDATE events SET
        title = ?,
        status = ?,
        event_url = ?,
        last_checked_at = ?
       WHERE id = ?`,
      event.title,
      event.status,
      event.event_url || null,
      now,
      existing.id
    );
    return existing.id;
  } else {
    console.log(`[DB] INSERT title='${event.title}' status=${event.status} date=${event.event_date} site_id=${event.site_id}`);
    try {
      const result = await db.run(
        `INSERT INTO events (site_id, url, event_url, title, status, event_date, last_checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        event.site_id,
        event.url,
        event.event_url || null,
        event.title,
        event.status,
        event.event_date,
        now
      );
      console.log(`[DB] INSERT success, id=${result.lastID}`);
      return result.lastID!;
    } catch (e) {
      console.log(`[DB] INSERT ERROR: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }
}

export async function getEventsToScan(): Promise<Event[]> {
  const db = await getDb();
  return db.all('SELECT * FROM events ORDER BY event_date ASC');
}

export interface EventWithSite extends Event {
  site_name: string;
  site_slug: string;
}

export async function getAllEventsWithSite(): Promise<EventWithSite[]> {
  const db = await getDb();
  return db.all(`
    SELECT e.*, s.name AS site_name, s.slug AS site_slug
    FROM events e
    JOIN sites s ON e.site_id = s.id
    ORDER BY e.event_date ASC
  `);
}

export async function updateEventFields(
  id: number,
  fields: { status?: string; title?: string; event_date?: string }
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (fields.status !== undefined) { sets.push('status = ?'); values.push(fields.status); }
  if (fields.title !== undefined) { sets.push('title = ?'); values.push(fields.title); }
  if (fields.event_date !== undefined) { sets.push('event_date = ?'); values.push(fields.event_date); }

  if (sets.length === 0) return;

  sets.push('last_checked_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  try {
    await db.run(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`, ...values);
    console.log(`[DB] UPDATED id=${id}`, fields);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE') && fields.event_date) {
      // event_date conflicts — update only status/title
      const safeFields = { ...fields };
      delete safeFields.event_date;
      if (Object.keys(safeFields).length > 0) {
        await updateEventFields(id, safeFields);
      }
    } else {
      throw e;
    }
  }
}
