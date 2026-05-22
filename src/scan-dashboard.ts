import { chromium } from 'playwright';
import { getAllEventsWithSite, updateEventFields } from './db/events.js';
import { scrapeEventPage } from './scraper/adapters/event-page-scraper.js';
import { randomDelay } from './utils/delay.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function main() {
  const events = await getAllEventsWithSite();
  console.log(`\nDashboard scan: ${events.length} events to verify\n`);

  if (events.length === 0) {
    console.log('No events in DB. Run npm run scan first.');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'es-ES' });
  const page = await context.newPage();

  let updated = 0;
  let errors = 0;
  let unchanged = 0;

  for (const event of events) {
    const dateLabel = event.event_date ? event.event_date.slice(0, 16).replace('T', ' ') : 'no-date';
    console.log(`[${event.site_name}] ${event.title} | ${dateLabel} | ${event.status}`);

    try {
      const scraped = await scrapeEventPage(page, event.url);

      const changes: { status?: string; title?: string; event_date?: string } = {};

      if (scraped.status !== 'unknown' && scraped.status !== event.status) {
        changes.status = scraped.status;
      }

      if (scraped.title && scraped.title.length > 2 && scraped.title !== event.title) {
        changes.title = scraped.title;
      }

      if (scraped.event_date && event.event_date) {
        const scrapedMs = new Date(scraped.event_date).getTime();
        const storedMs = new Date(event.event_date).getTime();
        // Only update if difference > 2 minutes (avoid noise from timezone/rounding)
        if (Math.abs(scrapedMs - storedMs) > 120_000) {
          changes.event_date = scraped.event_date;
        }
      }

      if (Object.keys(changes).length > 0) {
        const parts = Object.entries(changes)
          .map(([k, v]) => `${k}: ${(event as Record<string, unknown>)[k]} → ${v}`)
          .join(' | ');
        console.log(`  UPDATED: ${parts}`);
        await updateEventFields(event.id!, changes);
        updated++;
      } else {
        console.log(`  OK (url says: ${scraped.status})`);
        unchanged++;
      }

      await randomDelay(1, 2);
    } catch (e) {
      console.error(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
      errors++;
    }
  }

  await context.close();
  await browser.close();

  console.log(`\n── Dashboard scan complete ──`);
  console.log(`  Total:     ${events.length}`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  Errors:    ${errors}`);
}

main().catch(console.error);
