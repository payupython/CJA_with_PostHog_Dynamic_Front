import { chromium } from 'playwright';
import { getSiteBySlug } from './db/sites.js';
import { teatroRealScan } from './scraper/adapters/teatro-real-scan.js';

async function runTeatroReal() {
  console.log('--- STARTING TEATRO REAL SCAN ---');
  const browser = await chromium.launch({ headless: true });
  try {
    const site = await getSiteBySlug('teatro-real');
    if (!site) {
      console.error('Site not found in DB: teatro-real');
      process.exit(1);
    }
    console.log('[teatro-real] Starting scan...');
    await teatroRealScan.scan(browser, site.id, { maxDaysAhead: 14 });
    console.log('[teatro-real] Done.');
  } catch (error) {
    console.error('[teatro-real] Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await browser.close();
  }
  console.log('\n--- TEATRO REAL SCAN COMPLETED ---');
  process.exit(0);
}

runTeatroReal().catch(console.error);
