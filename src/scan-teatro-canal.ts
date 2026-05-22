import { chromium } from 'playwright';
import { getSiteBySlug } from './db/sites.js';
import { teatroDelCanalScan } from './scraper/adapters/teatro-del-canal-scan.js';

async function runTeatroCanal() {
  console.log('--- STARTING TEATRO DEL CANAL SCAN ---');
  const browser = await chromium.launch({ headless: true });
  try {
    const site = await getSiteBySlug('teatro-del-canal');
    if (!site) {
      console.error('Site not found in DB: teatro-del-canal');
      process.exit(1);
    }
    console.log('[teatro-del-canal] Starting scan...');
    await teatroDelCanalScan.scan(browser, site.id, { maxDaysAhead: 14 });
    console.log('[teatro-del-canal] Done.');
  } catch (error) {
    console.error('[teatro-del-canal] Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await browser.close();
  }
  console.log('\n--- TEATRO DEL CANAL SCAN COMPLETED ---');
  process.exit(0);
}

runTeatroCanal().catch(console.error);
