import { Browser } from 'playwright';
import { upsertEvent } from '../../db/events.js';
import { ScanAdapter, ScanOptions } from '../types.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE_URL = 'https://teatrodelazarzuela.inaem.gob.es';

function parseZarzuelaDate(dateText: string, hourText: string = '19:30'): string {
  const monthMap: { [key: string]: string } = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
    'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
    'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
  };

  // dateText format: "Viernes, 08 Mayo 2026" or "08 Mayo 2026"
  const dayMonthYearMatch = dateText.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!dayMonthYearMatch) {
    const today = new Date();
    return today.toISOString();
  }

  const [, day, monthName, year] = dayMonthYearMatch;
  const month = monthMap[monthName.toLowerCase()];
  const [hour = '19', minute = '30'] = (hourText || '19:30').split(':');

  if (!month) {
    return new Date().toISOString();
  }

  const isoString = `${year}-${month}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`;
  return new Date(isoString).toISOString();
}

async function checkEventStatus(page: any, eventUrl: string): Promise<'cancelled' | 'available'> {
  try {
    await page.goto(eventUrl, { waitUntil: 'networkidle' }).catch(() => {});
    const pageText = await page.evaluate(() => document.body.textContent || '');

    if (pageText.toLowerCase().includes('cancelad')) {
      return 'cancelled';
    }
  } catch (e) {
    console.log(`    [DEBUG] Error checking status for ${eventUrl}: ${e}`);
  }
  return 'available';
}

const CATEGORIES = [
  { name: 'Lírica', url: '/es/temporada/lirica-2025-2026' },
  { name: 'Conciertos', url: '/es/temporada/conciertos-2025-2026' },
  { name: 'Ambigú', url: '/es/temporada/ambigu-2025-2026' },
  { name: 'Danza', url: '/es/temporada/danza-2025-2026' },
  { name: 'Teatro musical de cámara', url: '/es/temporada/teatro-musical-de-camara-2025-2026' },
  { name: 'Ciclo de lied', url: '/es/temporada/ciclo-de-lied-2025-2026' },
];

export const teatroZarzuelaScan: ScanAdapter = {
  async scan(browser: Browser, siteId: number, options: ScanOptions = {}) {
    const { maxDaysAhead = 14 } = options;
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'es-ES' });
    const page = await context.newPage();
    const now = new Date();
    const limitDate = new Date();
    limitDate.setDate(now.getDate() + maxDaysAhead);

    let totalEvents = 0;

    try {
      // Scan selected categories
      const categoriesToScan = CATEGORIES.filter(c =>
        ['Lírica', 'Conciertos', 'Ambigú', 'Danza', 'Teatro musical de cámara'].includes(c.name)
      );

      for (const category of categoriesToScan) {
        console.log(`  Scanning ${category.name}...`);

        try {
          await page.goto(`${BASE_URL}${category.url}`, { waitUntil: 'networkidle' });

          // Get all clickable dates (event dates in calendar)
          const availableDates = await page.evaluate(() => {
            const dates: string[] = [];
            const calendarLinks = Array.from(document.querySelectorAll('a.calEvent, a.calEventAzul'));

            for (const link of calendarLinks) {
              const href = link.getAttribute('href');
              if (href && href.includes('day.listevents')) {
                dates.push(href);
              }
            }
            return dates;
          });

          // Process each available date
          for (const dateLink of availableDates) {
            const fullUrl = `${BASE_URL}${dateLink}`;

            try {
              await page.goto(fullUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

              // Get events and date for this date
              const dayData = await page.evaluate(() => {
                const events: any[] = [];
                let dateText = '';
                const pageText = document.body.textContent || '';

                // Check if any event is cancelled or postponed
                const isCancelledOrPostponed =
                  pageText.toLowerCase().includes('cancelad') ||
                  pageText.toLowerCase().includes('aplazad');

                // Find the closest preceding li that contains the date for this day's events
                const allLis = Array.from(document.querySelectorAll('li'));
                const eventListsUL = Array.from(document.querySelectorAll('ul.calInfoDayEvents'));

                if (eventListsUL.length > 0) {
                  const currentEventUL = eventListsUL[0];
                  let closestLi: HTMLElement | null = null;

                  // Find the <li> that contains this event list
                  for (const li of allLis) {
                    if (li.contains(currentEventUL)) {
                      closestLi = li;
                      break;
                    }
                  }

                  if (closestLi) {
                    const text = closestLi.textContent?.trim() || '';
                    const match = text.match(/([A-Za-z]+,?\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
                    if (match) {
                      dateText = match[1];
                    }
                  }
                }

                // Get events from this day's list
                const eventLinks = Array.from(document.querySelectorAll('ul.calInfoDayEvents li a'));
                for (const link of eventLinks as HTMLAnchorElement[]) {
                  const title = link.textContent?.trim();
                  const href = link.href;
                  const parentLi = link.closest('li');
                  const fullText = parentLi?.textContent?.trim() || '';

                  if (title && href && !isCancelledOrPostponed) {
                    // If title is just site name, try parent li content for actual event title
                    let realTitle = title;
                    if (title === 'Teatro de la Zarzuela' && fullText !== title) {
                      const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);
                      realTitle = lines.find(l => l !== title) || title;
                    }
                    events.push({ title: realTitle, href });
                  }
                }

                return { dateText, events };
              });

              // Save events with proper date
              const eventDate = parseZarzuelaDate(dayData.dateText);
              for (const event of dayData.events) {
                if (!event.title || !event.href) continue;

                const sessionUrl = event.href.startsWith('http') ? event.href : `${BASE_URL}${event.href}`;
                const status = await checkEventStatus(page, sessionUrl);

                console.log(`    [EVENT] ${event.title} | ${dayData.dateText} | status: ${status}`);

                await upsertEvent({
                  site_id: siteId,
                  url: sessionUrl,
                  title: event.title,
                  status,
                  event_date: eventDate
                });

                totalEvents++;
              }
            } catch (dateError) {
              // Continue with next date
            }
          }
        } catch (categoryError) {
          console.warn(`    Error scanning ${category.name}`);
        }
      }

      console.log(`Teatro de la Zarzuela: ${totalEvents} events saved`);
    } catch (error) {
      console.error('Teatro de la Zarzuela scan failed:', error instanceof Error ? error.message : String(error));
    } finally {
      await context.close();
    }
  },
};
