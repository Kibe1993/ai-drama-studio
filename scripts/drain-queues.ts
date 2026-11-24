import { Queue } from 'bullmq';

const queues = ['generation', 'production', 'maintenance'];

async function main() {
  for (const queueName of queues) {
    try {
      const queue = new Queue(queueName, { connection: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });

      const counts = await queue.getJobCounts('active', 'waiting', 'completed', 'failed', 'delayed', 'paused');
      console.log(`${queueName}: active=${counts.active} waiting=${counts.waiting} completed=${counts.completed} failed=${counts.failed} delayed=${counts.delayed} paused=${counts.paused}`);

      if (counts.active > 0 || counts.waiting > 0 || counts.delayed > 0) {
        console.log(`  → Draining ${queueName}...`);
        await queue.drain();
      }

      await queue.obliterate({ force: true });
      console.log(`  → Obliterated ${queueName}`);

      await queue.close();
    } catch (err) {
      console.log(`${queueName}: ${(err as Error).message}`);
    }
  }
  console.log('\nAll queues cleared.');
}

main();