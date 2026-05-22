import { chromium, Browser, Page } from 'playwright';
import { SelectorConfig, ScraperOptions, ScraperResult, AvailabilityStatus } from './types.js';
import { randomDelay } from '../utils/delay.js';

function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow http and https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    // Prevent localhost/private IPs in production
    if (process.env.NODE_ENV === 'production') {
      const hostname = parsed.hostname;
      if (!hostname || /^(localhost|127\.|192\.168\.|10\.|172\.1[6-9]\.|172\.2[0-9]\.|172\.3[0-1]\.)/.test(hostname)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function sanitizeSelectorString(selector: string): string {
  // Basic selector validation - prevent injection
  if (typeof selector !== 'string' || selector.length > 500) {
    throw new Error('Invalid selector');
  }
  return selector;
}

export async function scrape(
  url: string,
  selectors: SelectorConfig,
  options: ScraperOptions = {}
): Promise<ScraperResult> {
  // Validate URL
  if (!validateUrl(url)) {
    return {
      status: 'unknown',
      confidence: 0,
      raw_text: 'Invalid or disallowed URL',
      timestamp: new Date()
    };
  }

  const {
    timeout = parseInt(process.env.SCRAPER_TIMEOUT || '30000'),
    waitAfterLoad = 2000,
    userAgent = process.env.SCRAPER_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    useRandomDelay = false,
    minDelay = parseInt(process.env.SCRAPER_MIN_DELAY_MS || '25'),
    maxDelay = parseInt(process.env.SCRAPER_MAX_DELAY_MS || '45')
  } = options;

  if (useRandomDelay) {
    await randomDelay(minDelay, maxDelay);
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent });
    const page: Page = await context.newPage();

    await page.goto(url, { waitUntil: 'networkidle', timeout });
    
    // Wait for at least one of the indicators to be present
    const indicators = [
      selectors.status?.available,
      selectors.status?.sold_out,
      selectors.status?.limited,
      'li.performance' // Generic session container for Teatro Real
    ].filter(Boolean).map(sanitizeSelectorString) as string[];

    if (indicators.length > 0) {
      try {
        await Promise.race(
          indicators.map(sel => page.waitForSelector(sel, { timeout: 10000 }))
        );
      } catch (e) {
        console.warn('Timed out waiting for specific selectors, proceeding anyway.');
      }
    }

    // Wait for a bit to let dynamic content load if needed
    if (waitAfterLoad > 0) {
      await page.waitForTimeout(waitAfterLoad);
    }

    const content = await page.content();
    const raw_text = (await page.innerText('body')).toUpperCase();

    let status: AvailabilityStatus = 'unknown';
    let confidence = 0;

    // 1. Check for Sold Out
    if (selectors.status?.sold_out) {
      const soldOutEl = await page.$(sanitizeSelectorString(selectors.status.sold_out));
      if (soldOutEl) {
        status = 'sold_out';
        confidence = 0.95;
      }
    }

    if (status === 'unknown' && selectors.statusText?.sold_out) {
      for (const text of selectors.statusText.sold_out) {
        if (raw_text.includes(text.toUpperCase())) {
          status = 'sold_out';
          confidence = 0.85;
          break;
        }
      }
    }

    // 2. Check for Limited
    if (status === 'unknown' && selectors.status?.limited) {
      const limitedEl = await page.$(sanitizeSelectorString(selectors.status.limited));
      if (limitedEl) {
        status = 'limited';
        confidence = 0.95;
      }
    }

    if (status === 'unknown' && selectors.statusText?.limited) {
      for (const text of selectors.statusText.limited) {
        if (raw_text.includes(text.toUpperCase())) {
          status = 'limited';
          confidence = 0.85;
          break;
        }
      }
    }

    // 3. Check for Available
    if (status === 'unknown' && selectors.status?.available) {
      const availableEl = await page.$(sanitizeSelectorString(selectors.status.available));
      if (availableEl) {
        status = 'available';
        confidence = 0.95;
      }
    }

    if (status === 'unknown' && selectors.statusText?.available) {
      for (const text of selectors.statusText.available) {
        if (raw_text.includes(text.toUpperCase())) {
          status = 'available';
          confidence = 0.85;
          break;
        }
      }
    }

    // Extract title and date if selectors are provided
    let title = '';
    let eventDate: string | undefined = undefined;

    if (selectors.title) {
      title = await page.$eval(sanitizeSelectorString(selectors.title), el => el.textContent?.trim() || '').catch(() => '');
    }

    if (selectors.date) {
      const dateText = await page.$eval(sanitizeSelectorString(selectors.date), el => el.textContent?.trim() || '').catch(() => '');
      if (dateText) {
        eventDate = dateText;
      }
    }

    return {
      status,
      confidence,
      raw_text: raw_text.substring(0, 5000),
      timestamp: new Date(),
      eventDate
    };
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    return {
      status: 'unknown',
      confidence: 0,
      raw_text: error instanceof Error ? error.message : String(error),
      timestamp: new Date()
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
