/**
 * Wait for a random number of milliseconds between min and max seconds.
 */
export async function randomDelay(minSec: number = 25, maxSec: number = 45): Promise<void> {
  const delayMs = Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
  console.log(`[delay] Waiting for ${delayMs / 1000} seconds...`);
  return new Promise(resolve => setTimeout(resolve, delayMs));
}
