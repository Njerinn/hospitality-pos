import { Redis } from 'ioredis';
import { config } from '../config.js';

export const redis = config.REDIS_URL
  ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false })
  : null;

if (redis) {
  redis.on('error', (e: Error) => console.error('redis error', e));
}
