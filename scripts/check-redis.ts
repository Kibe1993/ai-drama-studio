import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

async function main() {
  try {
    await redis.ping();
    console.log('Redis: connected');

    const keys = await redis.keys('bull:*');
    console.log(`BullMQ keys: ${keys.length}`);
    if (keys.length > 0) {
      console.log(keys.slice(0, 30));
    }

    const allKeys = await redis.keys('*');
    console.log(`Total Redis keys: ${allKeys.length}`);
    if (allKeys.length > 0 && allKeys.length <= 50) {
      console.log('All keys:', allKeys);
    }
  } catch (err) {
    console.error('Redis error (may not be running):', (err as Error).message);
  } finally {
    await redis.quit();
  }
}

main();