import 'dotenv/config';
import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import { createClient } from 'redis';
import { getDb, closeDb } from '../db/connection.js';
import { getAppUrl } from './tunnel.js';

// Redis client for ingest + SSE
const redisUrl = process.env.REDIS_URL;
const redisOpts = redisUrl ? {
  url: redisUrl,
  socket: { reconnectStrategy: (retries: number) => Math.min(retries * 200, 5000) },
} : null;
const redisClient = redisOpts ? createClient(redisOpts) : null;
const redisSub = redisOpts ? createClient(redisOpts) : null;
if (redisClient) {
  redisClient.on('error', e => console.error('[Redis] error:', e.message));
  redisClient.on('reconnecting', () => console.log('[Redis] reconnecting...'));
  redisClient.connect().catch(e => console.error('[Redis] connect error:', e));
}
if (redisSub) {
  redisSub.on('error', e => console.error('[Redis sub] error:', e.message));
  redisSub.on('reconnecting', () => console.log('[Redis sub] reconnecting...'));
  redisSub.connect().catch(e => console.error('[Redis sub] connect error:', e));
}

// Token validity: 90 days in milliseconds
const TOKEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

const app = express();
const port = process.env.PORT || 3002;
const nodeEnv = process.env.NODE_ENV || 'development';
const corsOrigin = process.env.CORS_ORIGIN || (nodeEnv === 'production' ? '' : '*');

// Security middleware
app.use(helmet());

// CORS — allow tunnel subdomains automatically (they change on each restart)
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin) return callback(null, true);
    // Always allow in development
    if (nodeEnv === 'development') return callback(null, true);
    // Allow any trycloudflare.com subdomain (quick tunnels)
    if (origin.endsWith('.trycloudflare.com')) return callback(null, true);
    // Allow configured CORS_ORIGIN
    if (corsOrigin && corsOrigin !== '*' && origin === corsOrigin) return callback(null, true);
    if (corsOrigin === '*') return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'OPTIONS', 'POST'],
  maxAge: 86400,
};
if (corsOrigin === '' && nodeEnv === 'production') {
  throw new Error('CORS_ORIGIN must be set in production');
}
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_REQUESTS || '100'),
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => nodeEnv === 'development',
});
app.use('/api/', limiter);

// Body parser with size limit
app.use(express.json({ limit: '1mb' }));

// Request logging (production-safe)
app.use((req: Request, res: Response, next: NextFunction) => {
  if (nodeEnv === 'development') {
    console.log(`${req.method} ${req.path}`);
  }
  next();
});

async function validateToken(req: Request): Promise<boolean> {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token as string;
  if (!token || token.length !== 64) return false; // 32 bytes hex = 64 chars
  const db = await getDb();
  const row = await db.get(
    'SELECT id, subscribed_at FROM landing_subscribers WHERE access_token = ?',
    token
  );
  if (!row) return false;
  // Check token age (subscribed_at is the creation time)
  if (row.subscribed_at) {
    const created = new Date(row.subscribed_at).getTime();
    if (Date.now() - created > TOKEN_MAX_AGE_MS) return false;
  }
  return true;
}

app.get('/api/events', async (req: Request, res: Response) => {
  try {
    if (!await validateToken(req)) {
      return res.status(401).json({ error: 'Token required' });
    }

    const db = await getDb();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const events = await db.all(`
      SELECT e.id, e.site_id, e.url, e.title, e.status, e.event_date, e.last_checked_at, s.name as site_name
      FROM events e
      JOIN sites s ON e.site_id = s.id
      WHERE e.event_date >= ?
      ORDER BY e.event_date ASC
    `, todayStart.toISOString());
    res.json(events);
  } catch (error) {
    console.error('[API] Error fetching events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/validate', async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) {
      return res.status(400).json({ valid: false, error: 'Token required' });
    }
    if (token.length !== 64) {
      return res.status(400).json({ valid: false, error: 'Invalid token format' });
    }
    const db = await getDb();
    const row = await db.get(
      'SELECT email, subscribed_at FROM landing_subscribers WHERE access_token = ?',
      token
    );
    if (!row) {
      return res.status(401).json({ valid: false, error: 'Invalid token' });
    }
    // Check expiration
    if (row.subscribed_at) {
      const created = new Date(row.subscribed_at).getTime();
      if (Date.now() - created > TOKEN_MAX_AGE_MS) {
        return res.status(401).json({ valid: false, error: 'Token expired' });
      }
    }
    res.json({ valid: true, email: row.email });
  } catch (error) {
    console.error('[API] Error validating token:', error);
    res.status(500).json({ valid: false, error: 'Internal server error' });
  }
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Reuse the transporter across calls (connection pooling)
let _transporter: nodemailer.Transporter | null = null;
function getTransporter(): nodemailer.Transporter | null {
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailAppPassword) return null;
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailAppPassword },
      pool: true,           // reuse connections
      maxConnections: 3,
      maxMessages: 100,
    });
  }
  return _transporter;
}

async function sendWelcomeEmail(toEmail: string, token: string): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    console.log('[Email] No GMAIL_USER/GMAIL_APP_PASSWORD, skipping email');
    return;
  }

  try {
    const appUrl = await getAppUrl();
    const dashboardLink = `${appUrl}?token=${token}`;

    await transporter.sendMail({
      from: `"Avisador de Entradas" <eventosavisador@gmail.com>`,
      to: toEmail,
      subject: 'Tu acceso a Avisador de Entradas',
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
          <h2 style="color: #1a1a1a; margin-bottom: 16px;">¡Bienvenido a Avisador de Entradas!</h2>
          <p style="color: #444; line-height: 1.6;">
            Accede al dashboard para ver la disponibilidad de entradas en los principales teatros de clásica en Madrid:
          </p>
          <ul style="color: #444; line-height: 1.8;">
            <li>Auditorio Nacional</li>
            <li>Teatro Real</li>
            <li>Teatro de la Zarzuela</li>
            <li>Teatro del Canal</li>
          </ul>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${dashboardLink}" style="background: #f59e0b; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
              Acceder al Dashboard
            </a>
          </div>
          <p style="color: #888; font-size: 13px;">
            Este enlace es personal. No lo compartas.
          </p>
        </div>
      `,
    });
    console.log(`[Email] Welcome email sent to ${toEmail}`);
  } catch (err) {
    console.error('[Email] Failed to send:', err);
    // Don't throw — email failure shouldn't break the subscribe flow
  }
}

// Landing subscribe endpoint
app.post('/api/landing/subscribe', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Normalize email: trim and lowercase
    const normalizedEmail = email.trim().toLowerCase();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const db = await getDb();
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.get('user-agent') || 'unknown';
    const token = generateToken();

    // Check if already subscribed
    const existing = await db.get('SELECT access_token FROM landing_subscribers WHERE email = ?', normalizedEmail);

    if (existing) {
      let finalToken = existing.access_token;
      if (!finalToken) {
        finalToken = token;
        await db.run('UPDATE landing_subscribers SET access_token = ? WHERE email = ?', [finalToken, normalizedEmail]);
      }
      // Always re-send email for existing users (they may have lost their link)
      await sendWelcomeEmail(normalizedEmail, finalToken);
      return res.status(200).json({ success: true, message: 'Check your email for access link' });
    }

    try {
      await db.run(
        'INSERT INTO landing_subscribers (email, ip_address, user_agent, access_token) VALUES (?, ?, ?, ?)',
        [normalizedEmail, ipAddress, userAgent, token]
      );
    } catch (insertErr) {
      // Race condition: another request inserted the same email between our SELECT and INSERT
      if (insertErr instanceof Error && insertErr.message.includes('UNIQUE constraint failed')) {
        const raced = await db.get('SELECT access_token FROM landing_subscribers WHERE email = ?', normalizedEmail);
        if (raced?.access_token) {
          await sendWelcomeEmail(normalizedEmail, raced.access_token);
          return res.status(200).json({ success: true, message: 'Check your email for access link' });
        }
      }
      throw insertErr;
    }

    await sendWelcomeEmail(normalizedEmail, token);

    res.status(201).json({ success: true, message: 'Check your email for access link' });
  } catch (error) {
    console.error('[API] Error subscribing:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Analytics: active user segments from Redis
app.get('/api/analytics/users', async (_req: Request, res: Response) => {
  if (!redisClient?.isOpen) return res.status(503).json({ error: 'Redis not available' });
  try {
    const keys = await redisClient.keys('user:*');
    const userKeys = keys.filter(k => !k.endsWith(':counters') && !k.endsWith(':sites'));
    const users = await Promise.all(
      userKeys.map(async (key) => {
        const data = await redisClient.hGetAll(key);
        const counters = await redisClient.hGetAll(`${key}:counters`);
        const sites = await redisClient.sMembers(`${key}:sites`);
        return { userId: key.replace('user:', ''), ...data, counters, sites };
      })
    );
    res.json(users.filter(u => u.segment || u.last_event_name));
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Analytics: global stats
app.get('/api/analytics/stats', async (_req: Request, res: Response) => {
  if (!redisClient?.isOpen) return res.status(503).json({ error: 'Redis not available' });
  try {
    const keys = await redisClient.keys('user:*');
    const userKeys = keys.filter(k => !k.endsWith(':counters') && !k.endsWith(':sites'));
    const streamLen = await redisClient.xLen('events:realtime').catch(() => 0);
    const segments: Record<string, number> = {};
    for (const key of userKeys) {
      const seg = await redisClient.hGet(key, 'segment');
      if (seg) segments[seg] = (segments[seg] || 0) + 1;
    }
    res.json({
      total_users: userKeys.length,
      stream_events: streamLen,
      segments,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Analytics: event timeline (buckets por minuto, últimas 2h)
app.get('/api/analytics/timeline', async (_req: Request, res: Response) => {
  if (!redisClient?.isOpen) return res.status(503).json({ error: 'Redis not available' });
  try {
    const raw = await redisClient.hGetAll('events:timeline');
    const now = Date.now();
    // Generar slots de los últimos 60 minutos
    const slots = Array.from({ length: 60 }, (_, i) => {
      const d = new Date(now - (59 - i) * 60000);
      const key = d.toISOString().slice(0, 16);
      const label = d.toISOString().slice(11, 16); // HH:MM
      return { time: label, events: parseInt(raw[key] || '0') };
    });
    res.json(slots);
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Analytics: historial de reglas disparadas
app.get('/api/analytics/rules-history', async (_req: Request, res: Response) => {
  if (!redisClient?.isOpen) return res.status(503).json({ error: 'Redis not available' });
  try {
    const items = await redisClient.lRange('rules:history', 0, 49); // últimos 50
    res.json(items.map(i => JSON.parse(i)));
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Event ingest → Redis Streams (fast path, sub-second pipeline)
app.post('/api/events/ingest', async (req: Request, res: Response) => {
  if (!redisClient?.isOpen) {
    return res.status(503).json({ error: 'Redis not available' });
  }
  const { userId, eventName, properties } = req.body;
  if (!userId || !eventName) {
    return res.status(400).json({ error: 'userId and eventName required' });
  }
  try {
    await redisClient.xAdd('events:realtime', '*', {
      data: JSON.stringify({ userId, eventName, properties: properties || {}, ts: Date.now() }),
    });
    // Timeline bucket por minuto
    const bucket = new Date().toISOString().slice(0, 16);
    await redisClient.hIncrBy('events:timeline', bucket, 1);
    await redisClient.expire('events:timeline', 7200);
    res.status(202).json({ ok: true });
  } catch (e) {
    console.error('[Ingest] Redis xAdd error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// SSE — realtime dashboard stream
app.get('/api/sse/dashboard', (req: Request, res: Response) => {
  if (!redisSub) {
    return res.status(503).json({ error: 'Redis not available' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('connected', { timestamp: new Date().toISOString() });

  const hb = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15000);

  const onMessage = (_channel: string, message: string) => {
    try {
      const parsed = JSON.parse(message);
      send(parsed.type || 'update', parsed);
    } catch {}
  };

  redisSub.subscribe('realtime:dashboard', onMessage).catch(console.error);

  req.on('close', () => {
    clearInterval(hb);
    redisSub.unsubscribe('realtime:dashboard', onMessage).catch(() => {});
  });
});

// Invite endpoint — envía enlace de acceso a un invitado
app.post('/api/invite', async (req: Request, res: Response) => {
  const { toEmail, fromEmail } = req.body;
  if (!toEmail || !toEmail.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  const transporter = getTransporter();
  if (!transporter) {
    return res.status(503).json({ error: 'Email not configured' });
  }
  try {
    const appUrl = await getAppUrl();
    const from = fromEmail ? `<strong>${fromEmail}</strong>` : 'un amigo';
    await transporter.sendMail({
      from: `"Avisador de Entradas" <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: '🎭 Te han invitado a Avisador de Entradas',
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px; background: #faf9f7;">
          <h2 style="color: #5a3520; margin-bottom: 12px;">¡Te han invitado! 🎟️</h2>
          <p style="color: #444; line-height: 1.6;">
            ${from} te ha compartido acceso a <strong>Avisador de Entradas</strong> —
            la herramienta que monitoriza disponibilidad de entradas en los principales
            teatros de música clásica en Madrid en tiempo real.
          </p>
          <ul style="color: #555; line-height: 1.8;">
            <li>Auditorio Nacional</li>
            <li>Teatro Real</li>
            <li>Teatro de la Zarzuela</li>
            <li>Teatro del Canal</li>
          </ul>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${appUrl}" style="background: #7a4f2e; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
              Acceder al Avisador
            </a>
          </div>
          <p style="color: #aaa; font-size: 12px;">
            Introduce tu email en la landing page para recibir tu enlace de acceso personal.
          </p>
        </div>
      `,
    });
    console.log(`[Invite] Sent from ${fromEmail} to ${toEmail}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Invite] Error:', e);
    res.status(500).json({ error: 'Send failed' });
  }
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Express requires exactly 4 params to recognize this as an error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(Number(port), '0.0.0.0', () => {
  console.log(`API running on http://0.0.0.0:${port} (${nodeEnv})`);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n[API] ${signal} received, shutting down gracefully...`);
  server.close(async () => {
    await closeDb();
    console.log('[API] Closed.');
    process.exit(0);
  });
  // Force exit after 10s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
