import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const BACKUP_DIR = path.join(process.cwd(), 'backups');

const collectionsToExport = [
  'narrativecanons',
  'canonfacts',
  'continuityledgers',
  'narrativeregistries',
  'canonicalregistries',
  'narrativegraphs',
  'canonlocks',
  'canonextractionoutboxes',
  'canonicalentities',
  'voiceprofiles',
  'projects',
  'storybibles',
  'stories',
  'episodes',
  'seasonplans',
  'productionruns',
  'productionscenes',
  'timelines',
  'renderjobs',
  'audiosegments',
  'mediaassets',
  'shotproductionrecords',
  'generationjobs',
  'costevents',
  'storyevents',
];

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  const db = mongoose.connection.db;
  const summary: Record<string, number> = {};

  for (const collectionName of collectionsToExport) {
    try {
      const collection = db.collection(collectionName);
      const count = await collection.countDocuments();
      summary[collectionName] = count;

      if (count > 0) {
        const docs = await collection.find({}).toArray();
        const filename = path.join(BACKUP_DIR, `${collectionName}.json`);
        fs.writeFileSync(filename, JSON.stringify(docs, null, 2));
        console.log(`  ${collectionName}: ${count} docs → ${filename}`);
      } else {
        console.log(`  ${collectionName}: 0 docs (skipped)`);
      }
    } catch (err) {
      console.warn(`  ${collectionName}: ERROR - ${(err as Error).message}`);
      summary[collectionName] = -1;
    }
  }

  fs.writeFileSync(
    path.join(BACKUP_DIR, 'backup-summary.json'),
    JSON.stringify(summary, null, 2)
  );
  console.log('\nSummary written to backups/backup-summary.json');

  await mongoose.disconnect();
  console.log('Disconnected.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});