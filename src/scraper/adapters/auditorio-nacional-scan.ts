import { Browser, Page } from 'playwright';
import { parseAuditorioNacionalDate } from './auditorio-nacional.js';
import { upsertEvent } from '../../db/events.js';
import { ScanAdapter, ScanOptions } from '../types.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE_URL = 'https://auditorionacional.inaem.gob.es';
const PROGRAMMING_URL = `${BASE_URL}/es/programacion`;
const EVENTS_PER_PAGE = 12;

export const auditorioNacionalScan: ScanAdapter = {
  async scan(browser: Browser, siteId: number, options: ScanOptions = {}) {
    const { maxDaysAhead = 14 } = options;
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'es-ES' });
    const page = await context.newPage();
    const now = new Date();
    const limitDate = new Date();
    limitDate.setDate(now.getDate() + maxDaysAhead);

    const startStr = now.toISOString().split('T')[0];
    const endStr = limitDate.toISOString().split('T')[0];
    console.log(`Auditorio Nacional: Date range ${startStr} → ${endStr}`);

    try {
      let bStart = 0;
      let pageNum = 0;
      let hasNext = true;
      const processedUrls = new Set<string>();

      while (hasNext) {
        pageNum++;
        const pageUrl = `${PROGRAMMING_URL}?start=${startStr}&end=${endStr}&b_start:int=${bStart}`;
        console.log(`  Page ${pageNum} (b_start=${bStart})...`);

        await page.goto(pageUrl, { waitUntil: 'networkidle' }).catch(() => {
          console.warn('  Page load timeout, continuing...');
        });

        const eventsData = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('article.eventitem')).map(el => {
            const dateEl = el.querySelector('.event-date');
            const hourEl = el.querySelector('.hour');
            const titleLink = el.querySelector('h3 a, a.eventitem__link');
            const titleAlt = el.children[0]?.getAttribute?.('alt');
            const locationSpan = el.querySelector('.location span');

            const dateText = dateEl?.textContent?.trim() || '';
            const hourText = hourEl?.textContent?.trim() || '00:00';
            const title = titleLink?.textContent?.trim() || titleAlt || '';
            const href = titleLink?.getAttribute('href') || '';
            const location = locationSpan?.textContent?.trim() || '';

            return { title, href, dateText, hourText, location };
          });
        });

        console.log(`  ${eventsData.length} events found`);

        if (eventsData.length === 0) {
          hasNext = false;
          break;
        }

        for (const eventData of eventsData) {
          if (!eventData.title || !eventData.href) continue;

          const sessionUrl = eventData.href.startsWith('http')
            ? eventData.href
            : `${BASE_URL}${eventData.href}`;

          // Skip if already processed on this scan
          if (processedUrls.has(sessionUrl)) continue;
          processedUrls.add(sessionUrl);

          const isoDate = parseAuditorioNacionalDate(eventData.dateText, eventData.hourText);
          const eventDate = new Date(isoDate);

          // Skip past events
          if (eventDate < now) continue;

          // Default to unknown status (could be extended with buy button detection)
          let status: 'available' | 'sold_out' | 'unknown' = 'unknown';

          await upsertEvent({
            site_id: siteId,
            url: sessionUrl,
            title: eventData.title,
            status,
            event_date: isoDate
          });
        }

        // Pagination: increment b_start for next page
        bStart += EVENTS_PER_PAGE;
      }

      console.log(`Auditorio Nacional: ${pageNum} page(s) scanned.`);
    } catch (error) {
      console.error(
        'Auditorio Nacional scan failed:',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      await context.close();
    }
  },
};
