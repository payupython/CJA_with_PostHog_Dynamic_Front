import 'dotenv/config';
import { createClient } from 'redis';
import nodemailer from 'nodemailer';
import { RULES } from './rules.js';

const REDIS_URL = process.env.REDIS_URL!;

const mailer = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    })
  : null;

function makeClient() {
  return createClient({
    url: REDIS_URL,
    socket: { reconnectStrategy: (n) => Math.min(n * 200, 5000) },
  });
}

const consumer  = makeClient();
const publisher = makeClient();

consumer.on('error',  e => console.error('[Rules] consumer error:', e.message));
publisher.on('error', e => console.error('[Rules] publisher error:', e.message));

async function ensureConnected() {
  if (!consumer.isOpen)  await consumer.connect();
  if (!publisher.isOpen) await publisher.connect();
}

// ────────────────────────────────────────────────────────────────────────────
// Email
// ────────────────────────────────────────────────────────────────────────────
async function sendHighIntentEmail(toEmail: string, sites: string[]) {
  if (!mailer) return;
  const alreadySent = await publisher.get(`email_sent:high_intent:${toEmail}`);
  if (alreadySent) return;

  const hasSites = sites.length > 0;
  const sitesHtml = hasSites
    ? sites.map(s => `<li style="padding:4px 0"><strong>🎭 ${s}</strong></li>`).join('')
    : '<li>Auditorio Nacional</li><li>Teatro Real</li><li>Teatro de la Zarzuela</li><li>Teatro del Canal</li>';
  const subjectSite = hasSites && sites.length === 1 ? `entradas para ${sites[0]}` : 'entradas en Madrid';

  try {
    await mailer.sendMail({
      from: `"Avisador de Entradas" <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: `🎭 Buscas ${subjectSite} — te tenemos en el radar`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 16px;background:#faf9f7">
          <h2 style="color:#5a3520;margin-bottom:12px">Hola 👋</h2>
          <p style="color:#444;line-height:1.6">Vimos que estás buscando entradas activamente${hasSites ? ' en:' : '.'}</p>
          ${hasSites ? `<div style="background:#fff8f0;border-left:3px solid #c87941;padding:12px 16px;margin:16px 0;border-radius:0 8px 8px 0">
            <ul style="color:#555;margin:0;padding:0;list-style:none;line-height:1.8">${sitesHtml}</ul>
          </div>` : ''}
          <p style="color:#444;line-height:1.6">Tu cuenta <strong>${toEmail}</strong> ya está monitorizando disponibilidad en tiempo real.</p>
          <div style="background:#f5f5f5;border-radius:8px;padding:12px 16px;margin:24px 0">
            <p style="color:#666;margin:0;font-size:13px;line-height:1.6">
              ✓ Monitoreo en tiempo real<br/>✓ Alerta inmediata por email<br/>✓ Sin necesidad de hacer nada más
            </p>
          </div>
          <p style="color:#aaa;font-size:12px">Estamos atentos por ti.</p>
        </div>`,
    });
    await publisher.set(`email_sent:high_intent:${toEmail}`, '1', { EX: 604800 });
    console.log(`[Rules] High intent email → ${toEmail} (sites: ${sites.join(', ') || 'none'})`);
  } catch (e) {
    console.error('[Rules] Email error:', e);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Event processing
// ────────────────────────────────────────────────────────────────────────────
const EVENT_TO_COUNTER: Record<string, string> = {
  ticket_link_clicked:  'ticket_clicks',
  site_filter_selected: 'site_filters',
  search:               'searches',
  day_filter_toggled:   'day_filters',
};

async function processEvent(event: Record<string, unknown>) {
  const userId    = event.userId    as string;
  const eventName = event.eventName as string;
  if (!userId || !eventName) return;

  let properties: Record<string, string> = {};
  try {
    if (event.properties) {
      properties = typeof event.properties === 'string'
        ? JSON.parse(event.properties)
        : event.properties as Record<string, string>;
    }
  } catch {}

  // ── Increment counter ──────────────────────────────────────────────────────
  const counterKey = EVENT_TO_COUNTER[eventName];
  if (counterKey) {
    await publisher.hIncrBy(`user:${userId}:counters`, counterKey, 1);
    await publisher.expire(`user:${userId}:counters`, 3600);
  }

  // ── Track visited site ─────────────────────────────────────────────────────
  const site = properties.site;
  if (site && (eventName === 'ticket_link_clicked' || eventName === 'site_filter_selected')) {
    await publisher.sAdd(`user:${userId}:sites`, site);
    await publisher.expire(`user:${userId}:sites`, 3600);
  }

  // ── Track weekend day filter ──────────────────────────────────────────────────
  if (eventName === 'day_filter_toggled') {
    const day = typeof properties.day === 'string' ? parseInt(properties.day) : (properties.day as unknown as number);
    if (day === 0 || day === 6) {
      // Domingo=0, Sábado=6 — key con TTL 120s para ventana deslizante
      await publisher.set(`user:${userId}:weekend_recent`, '1', { EX: 120 });
    }
  }

  // ── Update user state ──────────────────────────────────────────────────────
  const now = Date.now();
  await publisher.hSet(`user:${userId}`, {
    last_event:      now.toString(),
    last_event_name: eventName,
  });
  await publisher.hSetNX(`user:${userId}`, 'first_seen', now.toString());
  await publisher.expire(`user:${userId}`, 7200);

  // ── Evaluate rules ─────────────────────────────────────────────────────────
  const counters   = await publisher.hGetAll(`user:${userId}:counters`);
  const userState  = await publisher.hGetAll(`user:${userId}`);
  const firstSeen  = parseInt(userState.first_seen || now.toString());
  const sessionSeconds = (now - firstSeen) / 1000;

  for (const rule of RULES) {
    // weekendCheck rules use a TTL key, not the counters hash — skip counter check
    let count = 0;
    if (rule.weekendCheck) {
      const recent = await publisher.get(`user:${userId}:weekend_recent`);
      if (!recent) continue;
      count = 1; // TTL key present → threshold met
    } else {
      count = parseInt(counters[rule.counterKey] || '0');
      if (count < rule.threshold) continue;
    }
    if (rule.minSessionSeconds && sessionSeconds < rule.minSessionSeconds) continue;

    const current = await publisher.hGet(`user:${userId}`, 'segment');
    if (current === rule.segment) continue;

    await publisher.hSet(`user:${userId}`, {
      segment:      rule.segment,
      intent_score: rule.score.toString(),
    });

    const msg = JSON.stringify({
      type:      'segment_change',
      userId,
      segment:   rule.segment,
      score:     rule.score,
      rule:      rule.id,
      timestamp: new Date().toISOString(),
    });
    await publisher.publish('realtime:dashboard', msg);
    console.log(`[Rules] ${rule.id} → ${userId} → ${rule.segment}`);

    const sites   = await publisher.sMembers(`user:${userId}:sites`);
    const actions = ['segment_updated', 'sse_published'];

    if (rule.segment === 'high_intent' && userId.includes('@')) {
      const alreadySent = await publisher.get(`email_sent:high_intent:${userId}`);
      if (!alreadySent) {
        actions.push('email_sent');
        sendHighIntentEmail(userId, sites).catch(console.error);
      }
    }

    await publisher.lPush('rules:history', JSON.stringify({
      rule_id:         rule.id,
      rule_name:       rule.name,
      userId,
      segment:         rule.segment,
      score:           rule.score,
      actions,
      sites,
      counter_value:   count,
      threshold:       rule.threshold,
      session_seconds: Math.round(sessionSeconds),
      timestamp:       new Date().toISOString(),
    }));
    await publisher.lTrim('rules:history', 0, 199);

    const bucket = new Date().toISOString().slice(0, 16);
    await publisher.hIncrBy('events:timeline', bucket, 1);
    await publisher.expire('events:timeline', 7200);
  }

  // ── Broadcast raw event to dashboard SSE ──────────────────────────────────
  await publisher.publish('realtime:dashboard', JSON.stringify({
    type:      'event',
    userId,
    eventName,
    timestamp: new Date().toISOString(),
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Main loop
// ────────────────────────────────────────────────────────────────────────────
async function run() {
  await ensureConnected();

  try {
    await publisher.xGroupCreate('events:realtime', 'rules-engine', '0', { MKSTREAM: true });
  } catch {
    // group already exists
  }

  console.log('[Rules Engine] Listening on events:realtime...');

  while (true) {
    try {
      await ensureConnected();

      const results = await consumer.xReadGroup(
        'rules-engine',
        'worker-1',
        [{ key: 'events:realtime', id: '>' }],
        { COUNT: 50, BLOCK: 2000 },
      );

      if (!results) continue;

      for (const { messages } of results) {
        for (const { id, message } of messages) {
          try {
            const event = message.data ? JSON.parse(message.data) : message;
            await processEvent(event);
          } catch (e) {
            console.error('[Rules] processEvent error:', e);
          }
          await consumer.xAck('events:realtime', 'rules-engine', id);
        }
      }
    } catch (e) {
      console.error('[Rules] Stream error:', e);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

run().catch(console.error);
