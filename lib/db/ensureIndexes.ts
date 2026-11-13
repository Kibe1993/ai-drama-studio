import type { Connection } from "mongoose";
import { log } from "@/lib/log";

/**
 * Repair the `stories.productionRunId` index on databases created before the
 * partial unique index existed.
 *
 * The old index was `{ productionRunId: 1 }` with `unique: true` and no partial
 * filter. MongoDB treats a missing/null field as a value, so that index allowed
 * exactly one project-level story draft across the whole database and rejected
 * every other project with E11000. The current model uses a partial unique
 * index that only applies when productionRunId is an ObjectId, allowing many
 * project-level drafts (null run) while keeping one story per production run.
 *
 * The migration is targeted and idempotent: it drops the legacy index when it
 * is present and ensures the partial index exists. It is safe to call on every
 * process start.
 */
export async function ensureStoryIndexes(connection: Connection): Promise<void> {
  const collection = connection.collection("stories");
  let indexes;
  try {
    indexes = await collection.indexes();
  } catch (error) {
    const code = (error as { code?: number }).code;
    // NamespaceNotFound: the collection has not been created yet. Mongoose will
    // create the model indexes on first write.
    if (code === 26 || code === 27) return;
    throw error;
  }

  const legacy = indexes.find(
    (index) =>
      index.name === "productionRunId_1" &&
      index.unique === true &&
      !index.partialFilterExpression
  );
  if (legacy) {
    try {
      await collection.dropIndex("productionRunId_1");
      log.info("db", "dropped legacy stories.productionRunId unique index");
    } catch (error) {
      if ((error as { code?: number }).code !== 27) throw error;
    }
  }

  const current = indexes.find(
    (index) =>
      index.name === "productionRunId_1" &&
      index.unique === true &&
      Boolean(index.partialFilterExpression)
  );
  if (!legacy && current) return;

  await collection.createIndex(
    { productionRunId: 1 },
    {
      name: "productionRunId_1",
      unique: true,
      partialFilterExpression: { productionRunId: { $type: "objectId" } },
    }
  );
  log.info("db", "ensured partial unique stories.productionRunId index");
}
