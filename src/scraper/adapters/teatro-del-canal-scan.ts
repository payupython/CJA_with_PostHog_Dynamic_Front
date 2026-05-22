import { Browser } from 'playwright';
import { upsertEvent } from '../../db/events.js';
import { ScanAdapter, ScanOptions } from '../types.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE_URL = 'https://www.teatroscanal.com';

function parseCanalDates(dateText: string): string[] {
  const monthMap: { [key: string]: string } = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
    'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
    'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
  };

  const dates: string[] = [];
  const currentYear = new Date().getFullYear().toString();

  // Format: "Del 19 de marzo al 8 de mayo de 2026" (range crossing months) or "Del 19 de marzo al 8 de mayo"
  const crossMonthMatch = dateText.match(/del?\s+(\d{1,2})\s+(?:de\s+)?(\w+)\s+al\s+(\d{1,2})\s+(?:de\s+)?(\w+)(?:\s+de\s+(\d{4}))?/i);
  if (crossMonthMatch) {
    const [, startDay, startMonthName, endDay, endMonthName, yearMatch] = crossMonthMatch;
    const year = yearMatch || currentYear;
    const startMonth = monthMap[startMonthName.toLowerCase()];
    const endMonth = monthMap[endMonthName.toLowerCase()];

    if (startMonth && endMonth) {
      const start = new Date(`${year}-${startMonth}-${startDay.padStart(2, '0')}T00:00:00Z`);
      const end = new Date(`${year}-${endMonth}-${endDay.padStart(2, '0')}T23:59:59Z`);

      for (let d = new Date(start); d <= end; ) {
        const iso = d.toISOString().split('T')[0];
        dates.push(new Date(iso + 'T19:30:00').toISOString());
        d.setDate(d.getDate() + 1);
      }
      return dates;
    }
  }

  // Format: "Del 2 al 14 de junio de 2026" (same month)
  const rangeMatch = dateText.match(/del?\s+(\d{1,2})\s+al\s+(\d{1,2})\s+(?:de\s+)?(\w+)(?:\s+de)?\s+(\d{4})/i);
  if (rangeMatch) {
    const [, startDay, endDay, monthName, year] = rangeMatch;
    const month = monthMap[monthName.toLowerCase()];
    if (month) {
      const start = parseInt(startDay);
      const end = parseInt(endDay);
      for (let day = start; day <= end; day++) {
        const isoString = `${year}-${month}-${day.toString().padStart(2, '0')}T19:30:00`;
        dates.push(new Date(isoString).toISOString());
      }
      return dates;
    }
  }

  // Format: "23, 24 y 25 de junio de 2026"
  const listMatch = dateText.match(/(\d{1,2})(?:\s*,\s*(\d{1,2}))*(?:\s+y\s+(\d{1,2}))?\s+(?:de\s+)?(\w+)(?:\s+de)?\s+(\d{4})/i);
  if (listMatch) {
    const monthMatch = dateText.match(/(?:de\s+)?(\w+)(?:\s+de)?\s+(\d{4})/);
    const dayMatches = dateText.match(/\d{1,2}/g);

    if (monthMatch && dayMatches) {
      const [, monthName, year] = monthMatch;
      const month = monthMap[monthName.toLowerCase()];
      if (month) {
        for (const dayStr of dayMatches) {
          const day = parseInt(dayStr);
          const isoString = `${year}-${month}-${day.toString().padStart(2, '0')}T19:30:00`;
          dates.push(new Date(isoString).toISOString());
        }
        if (dates.length > 0) return dates;
      }
    }
  }

  // Format: "15 de mayo de 2026" (single date)
  const singleMatch = dateText.match(/(\d{1,2})\s+(?:de\s+)?(\w+)(?:\s+de)?\s+(\d{4})/);
  if (singleMatch) {
    const [, day, monthName, year] = singleMatch;
    const month = monthMap[monthName.toLowerCase()];
    if (month) {
      const isoString = `${year}-${month}-${day.padStart(2, '0')}T19:30:00`;
      dates.push(new Date(isoString).toISOString());
      return dates;
    }
  }

  // Fallback: return today
  return [new Date().toISOString()];
}

const CATEGORIES = [
  { name: 'Música', url: '/entradas/musica/' },
  { name: 'Teatro', url: '/entradas/teatro-madrid/' },
  { name: 'Danza', url: '/entradas/danza-madrid/' },
];

interface EventStatusInfo {
  status: 'available' | 'sold_out' | 'limited';
  time?: string;
}

async function checkEventStatusAndTime(page: any, eventUrl: string): Promise<EventStatusInfo> {
  try {
    await page.goto(eventUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    const pageData = await page.evaluate(() => {
      const pageText = document.body.textContent || '';

      // Look for time in context of "Hora" label or near a date pattern
      // Pattern: find "Hora" or similar, then look for HH:MM nearby
      const horaMatch = pageText.match(/Hora\s*\n?\s*(\d{1,2}):(\d{2})/);
      let time: string | undefined;

      if (horaMatch) {
        time = `${horaMatch[1]}:${horaMatch[2]}`;
      } else {
        // Fallback: look for pattern like "Viernes DD de Mes de AAAA HH:MM"
        const dateTimeMatch = pageText.match(/(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo)\s+\d{1,2}\s+de\s+\w+\s+de\s+\d{4}\s*\n?\s*(\d{1,2}):(\d{2})/i);
        if (dateTimeMatch) {
          time = `${dateTimeMatch[1]}:${dateTimeMatch[2]}`;
        }
      }

      return { pageText, time };
    });

    // Check for sold out indicators
    if (pageData.pageText.toLowerCase().includes('agotad') || pageData.pageText.toLowerCase().includes('sold out')) {
      return { status: 'sold_out', time: pageData.time };
    }

    // Check for "Si" (availability) text on the page
    if (pageData.pageText.includes('Si') || pageData.pageText.toLowerCase().includes('disponible')) {
      return { status: 'available', time: pageData.time };
    }

    // Check for limited availability
    if (pageData.pageText.toLowerCase().includes('últimas') || pageData.pageText.toLowerCase().includes('limited')) {
      return { status: 'limited', time: pageData.time };
    }

    return { status: 'available', time: pageData.time };
  } catch (e) {
    // Continue with default
  }
  return { status: 'available' };
}

export const teatroDelCanalScan: ScanAdapter = {
  async scan(browser: Browser, siteId: number, options: ScanOptions = {}) {
    const { maxDaysAhead = 14 } = options;
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'es-ES' });
    const page = await context.newPage();
    const now = new Date();
    const limitDate = new Date();
    limitDate.setDate(now.getDate() + maxDaysAhead);

    let totalEvents = 0;

    try {
      for (const category of CATEGORIES) {
        console.log(`  Scanning ${category.name}...`);

        try {
          await page.goto(`${BASE_URL}${category.url}`, { waitUntil: 'networkidle' });

          // Extract events from category page
          const events = await page.evaluate(() => {
            const eventList: any[] = [];
            // Look for event containers (tribe-events-event divs with post- class)
            const eventDivs = Array.from(document.querySelectorAll('div.tribe-events-event[class*="post-"]'));

            for (const eventDiv of eventDivs) {
              try {
                // Get title from h2, h3 or similar
                const titleElement = eventDiv.querySelector('h2, h3');
                const title = titleElement?.textContent?.trim();

                // Get author/show name
                const authorElement = eventDiv.querySelector('.autor-show');
                const author = authorElement?.textContent?.trim();

                // Get date
                const dateElement = eventDiv.querySelector('.fecha-show');
                const dateText = dateElement?.textContent?.trim();

                // Get purchase link (inside .comprar-espectaculo)
                const linkElement = eventDiv.querySelector('.comprar-espectaculo a') as HTMLAnchorElement;
                const href = linkElement?.href;

                // Get event info link (from h2 title link or .btn-info)
                const eventInfoElement = eventDiv.querySelector('h2.show-home a') as HTMLAnchorElement;
                const event_url = eventInfoElement?.href;

                if (title && href && dateText && event_url) {
                  eventList.push({
                    title: author ? `${title} - ${author}` : title,
                    href,
                    event_url,
                    dateText
                  });
                }
              } catch (e) {
                // Continue with next event
              }
            }

            return eventList;
          });

          // Save events
          for (const event of events) {
            if (!event.title || !event.href) continue;

            const eventDates = parseCanalDates(event.dateText);
            const statusInfo = await checkEventStatusAndTime(page, event.href);

            // Save one record per date
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            for (const baseDate of eventDates) {
              const [datePart] = baseDate.split('T');
              const time = statusInfo.time || '19:30';
              if (!/^\d{2}:\d{2}$/.test(time)) continue;
              const eventDate = new Date(`${datePart}T${time}:00`).toISOString();
              const ed = new Date(eventDate);

              // Skip past events
              if (ed < todayStart) continue;
              if (ed <= limitDate) {
                console.log(`    [EVENT] ${event.title} | ${event.dateText} | ${time} | status: ${statusInfo.status}`);

                await upsertEvent({
                  site_id: siteId,
                  url: event.href,
                  event_url: event.event_url,
                  title: event.title,
                  status: statusInfo.status,
                  event_date: eventDate
                });

                totalEvents++;
              }
            }
          }
        } catch (categoryError) {
          console.warn(`    Error scanning ${category.name}`);
        }
      }

      console.log(`Teatro del Canal: ${totalEvents} events saved`);
    } catch (error) {
      console.error('Teatro del Canal scan failed:', error instanceof Error ? error.message : String(error));
    } finally {
      await context.close();
    }
  },
};
