import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const scanners = [
  { name: 'Teatro Real', script: 'scan-teatro-real.ts' },
  { name: 'Teatro de la Zarzuela', script: 'scan-zarzuela.ts' },
  { name: 'Auditorio Nacional', script: 'scan-auditorio-nacional.ts' },
  { name: 'Teatro del Canal', script: 'scan-teatro-canal.ts' },
];

async function runFullScan() {
  console.log('========================================');
  console.log('   FULL SCAN - TODAS LOS TEATROS');
  console.log('========================================\n');

  const startTime = Date.now();
  let completed = 0;
  let failed = 0;

  for (const scanner of scanners) {
    try {
      console.log(`\n>>> Iniciando scan: ${scanner.name}`);
      const projectRoot = dirname(__dirname);
      execSync(`tsx src/${scanner.script}`, {
        stdio: 'inherit',
        cwd: projectRoot
      });
      completed++;
    } catch (error) {
      console.error(`✗ Error en ${scanner.name}`);
      failed++;
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n========================================');
  console.log('   FULL SCAN COMPLETADO');
  console.log('========================================');
  console.log(`✓ Completados: ${completed}/${scanners.length}`);
  console.log(`✗ Fallidos: ${failed}/${scanners.length}`);
  console.log(`⏱ Tiempo total: ${duration}s`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runFullScan().catch(console.error);
