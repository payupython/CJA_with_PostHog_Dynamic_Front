import { chromium } from 'playwright';
import { getSiteBySlug } from './db/sites.js';
import { auditorioNacionalScan } from './scraper/adapters/auditorio-nacional-scan.js';

async function runAuditorioNacional() {
  console.log('--- STARTING AUDITORIO NACIONAL SCAN ---');
  const browser = await chromium.launch({ headless: true });
  try {
    const site = await getSiteBySlug('auditorio-nacional');
    if (!site) {
      console.error('Site not found in DB: auditorio-nacional');
      process.exit(1);
    }
    console.log('[auditorio-nacional] Starting scan...');
    await auditorioNacionalScan.scan(browser, site.id, { maxDaysAhead: 14 });
    console.log('[auditorio-nacional] Done.');
  } catch (error) {
    console.error('[auditorio-nacional] Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await browser.close();
  }
  console.log('\n--- AUDITORIO NACIONAL SCAN COMPLETED ---');
  process.exit(0);
}

runAuditorioNacional().catch(console.error);
