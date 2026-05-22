import { Page } from 'playwright';
import { parseTeatroRealDate } from './teatro-real.js';
import { parseAuditorioNacionalDate } from './auditorio-nacional.js';

export type ScrapedStatus = 'available' | 'sold_out' | 'limited' | 'cancelled' | 'unknown';

export interface ScrapedEventData {
  title?: string;
  event_date?: string;
  status: ScrapedStatus;
}

export function detectSite(
  url: string
): 'teatro-real' | 'teatro-canal' | 'auditorio-nacional' | 'teatro-zarzuela' | 'generic' {
  if (url.includes('tickets.teatroreal.es')) return 'teatro-real';
  if (url.includes('teatroscanal.com')) return 'teatro-canal';
  if (url.includes('auditorionacional.inaem.gob.es')) return 'auditorio-nacional';
  if (url.includes('teatrodelazarzuela.inaem.gob.es')) return 'teatro-zarzuela';
  return 'generic';
}

async function scrapeTeatroRealPage(page: Page, url: string): Promise<ScrapedEventData> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

  const cookieBtn = await page.$('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');
  if (cookieBtn) {
    await cookieBtn.click();
    await page.waitForTimeout(500);
  }

  const data = await page.evaluate(() => {
    const pageText = document.body.textContent?.toLowerCase() || '';

    const titleEl = document.querySelector<HTMLElement>('.title, h1, .product-name');
    const title = titleEl?.textContent?.trim() || '';

    const soldOutEl = document.querySelector('.soldout');
    const limitedEl = document.querySelector('.limited');
    const bookEl = document.querySelector('a[id^="book"], button[id^="book"]');

    // Date/time from first visible performance block
    const dateEl = document.querySelector<HTMLElement>('.day, .date-show, .event-date');
    const dateText = dateEl?.textContent?.trim() || '';
    const timeText = (() => {
      for (const el of Array.from(document.querySelectorAll('span, p, div'))) {
        const t = el.textContent?.trim() || '';
        if (/^\d{1,2}:\d{2}$/.test(t)) return t;
      }
      return '';
    })();

    return {
      title,
      dateText,
      timeText,
      isSoldOut: !!soldOutEl || pageText.includes('entradas agotadas') || pageText.includes('sold out'),
      isLimited: !!limitedEl || pageText.includes('últimas entradas'),
      isCancelled: pageText.includes('cancelad') || pageText.includes('aplazad'),
      hasBookButton: !!bookEl,
    };
  });

  let status: ScrapedStatus = 'unknown';
  if (data.isCancelled) status = 'cancelled';
  else if (data.isSoldOut) status = 'sold_out';
  else if (data.isLimited) status = 'limited';
  else if (data.hasBookButton) status = 'available';

  let event_date: string | undefined;
  if (data.dateText) {
    const fullText = `${data.dateText} ${data.timeText}`.trim();
    const parsed = parseTeatroRealDate(fullText);
    const diff = Math.abs(new Date(parsed).getTime() - Date.now());
    if (diff > 3_600_000) event_date = parsed;
  }

  return { title: data.title || undefined, status, event_date };
}

async function scrapeTeatroCanalPage(page: Page, url: string): Promise<ScrapedEventData> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

  const data = await page.evaluate(() => {
    const pageText = document.body.textContent || '';
    const lower = pageText.toLowerCase();

    const titleEl = document.querySelector<HTMLElement>(
      'h1.entry-title, h1, h2.event-title, .tribe-events-single-event-title'
    );
    const title = titleEl?.textContent?.trim() || '';

    const dateEl = document.querySelector<HTMLElement>(
      '.tribe-event-date-start, .event-date, .fecha-show, time'
    );
    const dateText = dateEl?.textContent?.trim() || '';

    const horaMatch = pageText.match(/Hora\s*[:\n\r]*\s*(\d{1,2}):(\d{2})/);
    const timeText = horaMatch ? `${horaMatch[1]}:${horaMatch[2]}` : '';

    const isSoldOut =
      lower.includes('agotad') || lower.includes('sold out') || lower.includes('sin entradas');
    const isLimited = lower.includes('últimas') || lower.includes('pocas entradas');
    const isCancelled = lower.includes('cancelad') || lower.includes('aplazad');
    const hasBuyButton = !!(
      document.querySelector('a[href*="comprar"]') ||
      document.querySelector('button.comprar') ||
      document.querySelector('.comprar-entradas a') ||
      document.querySelector('a.tribe-event-url')
    );

    return { title, dateText, timeText, isSoldOut, isLimited, isCancelled, hasBuyButton };
  });

  let status: ScrapedStatus = 'unknown';
  if (data.isCancelled) status = 'cancelled';
  else if (data.isSoldOut) status = 'sold_out';
  else if (data.isLimited) status = 'limited';
  else if (data.hasBuyButton) status = 'available';

  let event_date: string | undefined;
  if (data.dateText && data.timeText) {
    const monthMap: Record<string, string> = {
      enero: '01', febrero: '02', marzo: '03', abril: '04',
      mayo: '05', junio: '06', julio: '07', agosto: '08',
      septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
    };
    const m = data.dateText.match(/(\d{1,2})\s+(?:de\s+)?(\w+)(?:\s+de\s+(\d{4}))?/);
    if (m) {
      const [, day, monthName, yearStr] = m;
      const month = monthMap[monthName.toLowerCase()];
      const year = yearStr || new Date().getFullYear().toString();
      if (month) {
        const iso = `${year}-${month}-${day.padStart(2, '0')}T${data.timeText}:00`;
        event_date = new Date(iso).toISOString();
      }
    }
  }

  return { title: data.title || undefined, status, event_date };
}

async function scrapeAuditorioNacionalPage(page: Page, url: string): Promise<ScrapedEventData> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

  const data = await page.evaluate(() => {
    const lower = document.body.textContent?.toLowerCase() || '';

    const titleEl = document.querySelector<HTMLElement>(
      'h1, h2.event-title, .event-title, .page-header h1'
    );
    const title = titleEl?.textContent?.trim() || '';

    const dateEl = document.querySelector<HTMLElement>('.event-date, .fecha, time[datetime]');
    const dateAttr = (dateEl as HTMLTimeElement)?.dateTime || '';
    const dateText = dateAttr || dateEl?.textContent?.trim() || '';

    const hourEl = document.querySelector<HTMLElement>('.hour, .hora, .event-time');
    const hourText = hourEl?.textContent?.trim() || '';

    const isSoldOut =
      lower.includes('agotado') || lower.includes('entradas agotadas') || lower.includes('sold out');
    const isCancelled = lower.includes('cancelad') || lower.includes('aplazad');
    const hasTicketLink = !!(
      document.querySelector('a[href*="venta"]') ||
      document.querySelector('a[href*="ticket"]') ||
      document.querySelector('a[href*="comprar"]') ||
      document.querySelector('.buy-ticket') ||
      document.querySelector('.ticket-btn')
    );

    return { title, dateText, hourText, isSoldOut, isCancelled, hasTicketLink };
  });

  let status: ScrapedStatus = 'unknown';
  if (data.isCancelled) status = 'cancelled';
  else if (data.isSoldOut) status = 'sold_out';
  else if (data.hasTicketLink) status = 'available';

  let event_date: string | undefined;
  if (data.dateText) {
    if (/^\d{4}-\d{2}-\d{2}/.test(data.dateText)) {
      const dateOnly = data.dateText.split('T')[0];
      const time = data.hourText.match(/\d{1,2}:\d{2}/)?.[0] || '00:00';
      event_date = new Date(`${dateOnly}T${time}:00`).toISOString();
    } else {
      const parsed = parseAuditorioNacionalDate(data.dateText, data.hourText);
      const diff = Math.abs(new Date(parsed).getTime() - Date.now());
      if (diff > 3_600_000) event_date = parsed;
    }
  }

  return { title: data.title || undefined, status, event_date };
}

async function scrapeTeatroZarzuelaPage(page: Page, url: string): Promise<ScrapedEventData> {
  await page
    .goto(url, { waitUntil: 'networkidle', timeout: 20000 })
    .catch(() => {});

  const data = await page.evaluate(() => {
    const pageText = document.body.textContent || '';
    const lower = pageText.toLowerCase();

    const titleEl = document.querySelector<HTMLElement>('h1, h2, .evento-title, .page-title');
    const title = titleEl?.textContent?.trim() || '';

    const dateTimeMatch = pageText.match(
      /([A-Za-záéíóúÁÉÍÓÚüÜñÑ]+,?\s+\d{1,2}\s+[A-Za-záéíóúÁÉÍÓÚ]+\s+\d{4})/
    );
    const dateText = dateTimeMatch?.[1] || '';

    const timeMatch = pageText.match(/(\d{1,2}:\d{2})/);
    const timeText = timeMatch?.[1] || '';

    const isCancelled = lower.includes('cancelad') || lower.includes('aplazad');
    const isSoldOut = lower.includes('entradas agotadas') || lower.includes('agotado');
    const hasTicketLink = !!(
      document.querySelector('a[href*="ticketmaster"]') ||
      document.querySelector('a[href*="entradas"]') ||
      document.querySelector('a[href*="comprar"]') ||
      document.querySelector('.btn-ticket')
    );

    return { title, dateText, timeText, isCancelled, isSoldOut, hasTicketLink };
  });

  let status: ScrapedStatus = 'unknown';
  if (data.isCancelled) status = 'cancelled';
  else if (data.isSoldOut) status = 'sold_out';
  else if (data.hasTicketLink) status = 'available';

  let event_date: string | undefined;
  if (data.dateText) {
    const monthMap: Record<string, string> = {
      enero: '01', febrero: '02', marzo: '03', abril: '04',
      mayo: '05', junio: '06', julio: '07', agosto: '08',
      septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
    };
    const m = data.dateText.match(/(\d{1,2})\s+([A-Za-záéíóúÁÉÍÓÚ]+)\s+(\d{4})/);
    if (m) {
      const [, day, monthName, year] = m;
      const month = monthMap[monthName.toLowerCase()];
      if (month) {
        const time = data.timeText || '19:30';
        event_date = new Date(`${year}-${month}-${day.padStart(2, '0')}T${time}:00`).toISOString();
      }
    }
  }

  return { title: data.title || undefined, status, event_date };
}

async function scrapeGenericPage(page: Page, url: string): Promise<ScrapedEventData> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

  const data = await page.evaluate(() => {
    const lower = document.body.textContent?.toLowerCase() || '';
    const titleEl = document.querySelector<HTMLElement>('h1, h2');
    return {
      title: titleEl?.textContent?.trim() || '',
      isCancelled: lower.includes('cancelad'),
      isSoldOut: lower.includes('agotad') || lower.includes('sold out'),
      isLimited: lower.includes('últimas'),
    };
  });

  let status: ScrapedStatus = 'unknown';
  if (data.isCancelled) status = 'cancelled';
  else if (data.isSoldOut) status = 'sold_out';
  else if (data.isLimited) status = 'limited';

  return { title: data.title || undefined, status };
}

export async function scrapeEventPage(page: Page, url: string): Promise<ScrapedEventData> {
  const site = detectSite(url);
  switch (site) {
    case 'teatro-real':        return scrapeTeatroRealPage(page, url);
    case 'teatro-canal':       return scrapeTeatroCanalPage(page, url);
    case 'auditorio-nacional': return scrapeAuditorioNacionalPage(page, url);
    case 'teatro-zarzuela':    return scrapeTeatroZarzuelaPage(page, url);
    default:                   return scrapeGenericPage(page, url);
  }
}
