import { Browser, BrowserContext, Page } from 'playwright';
import { parseTeatroRealDate } from './teatro-real.js';
import { upsertEvent } from '../../db/events.js';
import { randomDelay } from '../../utils/delay.js';
import { ScanAdapter, ScanOptions } from '../types.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LIST_URL = 'https://tickets.teatroreal.es/list/events?lang=es';

async function scrollToBottom(page: Page): Promise<void> {
  let prevHeight = 0;
  for (let i = 0; i < 20; i++) {
    const height: number = await page.evaluate(() => document.body.scrollHeight);
    if (height === prevHeight) break;
    prevHeight = height;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
  }
}

async function dismissCookies(page: Page): Promise<void> {
  const btn = await page.$('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');
  if (btn) {
    await btn.click();
    await page.waitForTimeout(500);
  }
}

async function getProductIds(context: BrowserContext): Promise<string[]> {
  const page = await context.newPage();
  try {
    await page.goto(LIST_URL, { waitUntil: 'networkidle' });
    await dismissCookies(page);
    await scrollToBottom(page);
    const ids = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="productId="]'));
      const found = links.map(link => {
        const m = (link as HTMLAnchorElement).href.match(/productId=(\d+)/);
        return m ? m[1] : null;
      }).filter(Boolean) as string[];
      return [...new Set(found)];
    });
    console.log(`Found ${ids.length} unique product IDs.`);
    return ids;
  } finally {
    await page.close();
  }
}

async function scanProduct(
  context: BrowserContext,
  productId: string,
  siteId: number,
  now: Date,
  limitDate: Date
): Promise<void> {
  const url = `https://tickets.teatroreal.es/selection/event/date?productId=${productId}`;
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await dismissCookies(page);
    await page.waitForSelector('li.performance', { timeout: 10000 }).catch(() => {});

    const performances = await page.$$('li.performance');
    if (performances.length === 0) return;

    let title = await page.$eval('.title', el => el.textContent?.trim() ?? '').catch(() => '');
    if (!title) {
      const pageTitle = await page.title();
      const m = pageTitle.match(/\[([^\]]+)\]/);
      if (m) {
        const parts = m[1].split('|').map(p => p.trim());
        title = parts[2] ?? '';
      } else {
        title = pageTitle
            .replace(' - Fundación del Teatro Real', '')
            .replace('Fecha de la sesión ', '')
            .trim();
      }
    }

    console.log(`  [${title}] ${performances.length} sessions`);

    for (const perf of performances) {
      const dateText = await perf
        .$$eval('.day', els => els.map(el => el.textContent?.trim()).join(' '))
        .catch(() => '');
      const timePart = await perf
        .$$eval('span, p', els => {
          for (const el of els) {
            const text = el.textContent?.trim() ?? '';
            if (/\d{1,2}:\d{2}/.test(text)) return text;
          }
          return '';
        })
        .catch(() => '');

      const fullDateText = `${dateText} ${timePart}`.trim();
      if (!fullDateText) continue;

      const isoDate = parseTeatroRealDate(fullDateText);
      const perfDate = new Date(isoDate);

      if (perfDate < now || perfDate > limitDate) continue;

      const isSoldOut = await perf.$('.soldout').then(el => !!el).catch(() => false);
      const isLimited = await perf.$('.limited').then(el => !!el).catch(() => false);
      const bookButton = await perf.$('a[id^="book"]').catch(() => null);

      let status = 'unknown';
      if (isSoldOut) status = 'sold_out';
      else if (isLimited) status = 'limited';
      else if (bookButton) status = 'available';

      if (status === 'unknown') continue;

      let sessionUrl = '';
      if (bookButton) {
        const href = await bookButton.getAttribute('href').catch(() => null);
        if (href) sessionUrl = href.startsWith('http') ? href : `https://tickets.teatroreal.es${href}`;
      }

      if (sessionUrl) {
        await upsertEvent({ site_id: siteId, url: sessionUrl, title, status, event_date: isoDate });
      }
    }
  } finally {
    await page.close();
  }
}

export const teatroRealScan: ScanAdapter = {
  async scan(browser: Browser, siteId: number, options: ScanOptions = {}) {
    const { maxDaysAhead = 14 } = options;
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'es-ES' });
    try {
      const productIds = await getProductIds(context);
      const now = new Date();
      const limitDate = new Date();
      limitDate.setDate(now.getDate() + maxDaysAhead);

      for (let i = 0; i < productIds.length; i++) {
        const productId = productIds[i];
        console.log(`[${i + 1}/${productIds.length}] Product ${productId}`);
        try {
          await scanProduct(context, productId, siteId, now, limitDate);
        } catch (error) {
          console.error(
            `Product ${productId} failed:`,
            error instanceof Error ? error.message : String(error)
          );
        }
        await randomDelay(1, 3);
      }
    } finally {
      await context.close();
    }
  },
};
