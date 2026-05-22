# CJA with PostHog — Customer Journey Analytics Platform

Real-time Customer Journey Analytics platform built on top of **AvisadorEntradas** (Madrid classical music ticket notifier).

## Architecture

```
User action → Redis Streams → Rules Engine → SSE → Dashboard
                                         ↓
                              PostHog Cloud EU (async)
```

### Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| Analytics | PostHog Cloud EU |
| Streaming | Redis Streams + pub/sub (Upstash) |
| Auth | Magic link (SQLite) |
| Email | nodemailer + Gmail SMTP |

## Project Structure

```
src/
├── api/           # Express API (ingest, SSE, auth, analytics endpoints)
├── rules-engine/  # Event processing pipeline + segment rules
├── lib/           # Redis client
├── db/            # SQLite (tickets, auth tokens)
├── scraper/       # Theater ticket scrapers (Auditorio Nacional, Teatro Real, etc.)
└── frontend/      # React app
    └── src/
        ├── App.tsx              # Main ticket browser
        ├── Dashboard.tsx        # /cja — realtime CJA dashboard
        ├── Landing.tsx          # Email capture landing page
        ├── InviteNotification.tsx
        └── hooks/
            ├── useSSE.ts        # SSE connection
            └── useAnalytics.ts  # Analytics polling
```

## Rules Engine

4 segment rules out of the box:

| Rule | Trigger | Segment | Score |
|------|---------|---------|-------|
| High intent | ticket_clicks ≥ 2 in 30min | `high_intent` | 0.85 |
| Warm intent | 5min session + 1 ticket click | `warm_intent` | 0.70 |
| Engaged browser | 3+ venues visited | `engaged` | 0.60 |
| Active searcher | 3+ searches in 30min | `active_searcher` | 0.50 |

When a rule fires:
- Segment written to Redis
- SSE event pushed to `/cja` dashboard
- `high_intent` → proactive email sent
- Invite notification shown in the app

## Setup

```bash
cp .env.example .env
# fill in: REDIS_URL, GMAIL_USER, GMAIL_APP_PASSWORD, APP_URL

npm install
cd src/frontend && npm install && cd ../..

# Start API
npx ts-node src/api/index.ts

# Start Rules Engine
npx ts-node src/rules-engine/engine.ts

# Start Frontend (dev)
cd src/frontend && npm run dev
```

## Environment Variables

```env
REDIS_URL=rediss://...          # Upstash Redis TLS URL
GMAIL_USER=your@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
APP_URL=http://localhost:5173
POSTHOG_API_KEY=phc_...         # PostHog Cloud EU key
VITE_POSTHOG_KEY=phc_...
VITE_API_URL=                   # empty = relative (Vite proxy handles it)
```

## Dashboard

Visit `/cja` for the realtime analytics dashboard:
- Live event stream via SSE
- User segments + intent scores
- Rules engine status
- Full activations history table
