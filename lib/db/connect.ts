import mongoose from "mongoose";

const DATABASE_NAME = "DramaStudio";

type Cache = {
  conn: mongoose.Connection | null;
  promise: Promise<mongoose.Connection> | null;
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

  if (cached.conn?.readyState === 1) return cached.conn;

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

  global.mongooseCache = cached;
  return cached.conn;
}
