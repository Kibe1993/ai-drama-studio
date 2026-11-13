import mongoose from "mongoose";
import { ensureStoryIndexes } from "@/lib/db/ensureIndexes";
import { log } from "@/lib/log";

const DATABASE_NAME = "DramaStudio";

type Cache = {
  conn: mongoose.Connection | null;
  promise: Promise<mongoose.Connection> | null;
  indexesEnsured?: boolean;
};

declare global {
  var mongooseCache: Cache | undefined;
}

const cached: Cache = global.mongooseCache ?? { conn: null, promise: null };

/**
 * One connection for this application. Models register on the connection
 * returned here, not on Mongoose's default connection.
 */
export async function connectDB(): Promise<mongoose.Connection> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Please define the MONGODB_URI environment variable");
  }

  if (cached.conn?.readyState === 1) {
    if (cached.indexesEnsured) return cached.conn;
    await runIndexMigration(cached.conn);
    return cached.conn;
  }

  if (!cached.promise) {
    const connection = mongoose.createConnection(uri, {
      bufferCommands: false,
      dbName: DATABASE_NAME,
      serverSelectionTimeoutMS: 8000,
    });
    cached.promise = connection.asPromise();
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    cached.promise = null;
    cached.conn = null;
    const message = error instanceof Error ? error.message : "";
    if (/mongodb(\+srv)?:\/\//i.test(message)) {
      throw new Error("Database is unavailable");
    }
    throw error;
  }

  await runIndexMigration(cached.conn);
  global.mongooseCache = cached;
  return cached.conn;
}

/**
 * One-time, targeted repair for legacy databases. It must not take the app
 * down: a failure is logged and retried on the next connection attempt.
 */
async function runIndexMigration(connection: mongoose.Connection): Promise<void> {
  if (cached.indexesEnsured) return;
  try {
    await ensureStoryIndexes(connection);
    cached.indexesEnsured = true;
  } catch (error) {
    log.error("db", "story index migration failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
}
