import 'dotenv/config';
import { createClient } from 'redis';

const url = process.env.REDIS_URL;
if (!url) throw new Error('REDIS_URL not set');

export const redis = createClient({ url });
redis.on('error', (err) => console.error('[Redis] Error:', err));

export async function connectRedis() {
  if (!redis.isOpen) await redis.connect();
}
