import { chromium } from 'playwright';
import { getSiteBySlug } from './db/sites.js';
import { teatroZarzuelaScan } from './scraper/adapters/teatro-zarzuela-scan.js';

async function runZarzuelaScan() {
  console.log('--- STARTING ZARZUELA SCAN ---');
  const browser = await chromium.launch({ headless: true });
  try {
    const site = await getSiteBySlug('teatro-zarzuela');
    if (!site) {
      console.error('Site not found in DB: teatro-zarzuela');
      process.exit(1);
    }
    console.log('[teatro-zarzuela] Starting scan...');
    await teatroZarzuelaScan.scan(browser, site.id, { maxDaysAhead: 14 });
    console.log('[teatro-zarzuela] Done.');
  } catch (error) {
    console.error('[teatro-zarzuela] Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await browser.close();
  }
  console.log('\n--- ZARZUELA SCAN COMPLETED ---');
  process.exit(0);
}

runZarzuelaScan().catch(console.error);
