import { MongoClient, type Db, type Collection, type Document } from "mongodb";

const DB_NAME = process.env.MONGODB_DB_NAME || "aldi_bot";
const MAX_CONNECT_ATTEMPTS = 3;

export const COLLECTIONS = {
  licenses: "licenses",
  licenseUsage: "license_usage",
  chartSignals: "chart_signals",
  candleHistory: "candle_history",
  appMeta: "app_meta",
} as const;

let client: MongoClient | null = null;
let db: Db | null = null;

/** Encode password in mongodb+srv URI if it contains special characters. */
export function normalizeMongoUri(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed.startsWith("mongodb+srv://") && !trimmed.startsWith("mongodb://")) {
    return trimmed;
  }

  try {
    const withoutScheme = trimmed.replace(/^mongodb(\+srv)?:\/\//, "");
    const atIndex = withoutScheme.lastIndexOf("@");
    if (atIndex === -1) return trimmed;

    const creds = withoutScheme.slice(0, atIndex);
    const hostAndRest = withoutScheme.slice(atIndex + 1);
    const colonIndex = creds.indexOf(":");
    if (colonIndex === -1) return trimmed;

    const user = creds.slice(0, colonIndex);
    const password = creds.slice(colonIndex + 1);
    const encodedPassword = encodeURIComponent(decodeURIComponent(password));
    const scheme = trimmed.startsWith("mongodb+srv://") ? "mongodb+srv://" : "mongodb://";
    return `${scheme}${user}:${encodedPassword}@${hostAndRest}`;
  } catch {
    return trimmed;
  }
}

export function getMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri?.trim()) {
    throw new Error(
      "MONGODB_URI is not set. Add it in Render → Environment → MONGODB_URI"
    );
  }
  return normalizeMongoUri(uri);
}

function mongoHelpMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const lines = [
    "MongoDB connection failed.",
    `Error: ${msg}`,
    "",
    "Fix checklist:",
    "1. MongoDB Atlas → Network Access → Add IP → Allow 0.0.0.0/0 (required for Render)",
    "2. Atlas → Database Access → user password is correct in MONGODB_URI",
    "3. Render → Environment → MONGODB_URI is the full Atlas connection string",
    "4. Connection string format:",
    "   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/aldi_bot?retryWrites=true&w=majority",
  ];
  return lines.join("\n");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  const uri = getMongoUri();
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
    try {
      client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 20_000,
        connectTimeoutMS: 20_000,
        maxPoolSize: 10,
      });
      await client.connect();
      await client.db(DB_NAME).command({ ping: 1 });
      db = client.db(DB_NAME);
      await ensureIndexes(db);
      console.log(`MongoDB connected (db: ${DB_NAME}, attempt ${attempt})`);
      return db;
    } catch (error) {
      lastError = error;
      if (client) {
        await client.close().catch(() => undefined);
        client = null;
        db = null;
      }
      console.error(`MongoDB connect attempt ${attempt}/${MAX_CONNECT_ATTEMPTS} failed.`);
      if (attempt < MAX_CONNECT_ATTEMPTS) {
        await sleep(2000 * attempt);
      }
    }
  }

  console.error(mongoHelpMessage(lastError));
  throw lastError;
}

export async function getDb(): Promise<Db> {
  if (!db) return connectMongo();
  return db;
}

export async function getCollection<T extends Document = Document>(
  name: string
): Promise<Collection<T>> {
  const database = await getDb();
  return database.collection<T>(name);
}

async function ensureIndexes(database: Db): Promise<void> {
  await database.collection(COLLECTIONS.licenses).createIndex({ id: 1 }, { unique: true });
  await database.collection(COLLECTIONS.licenses).createIndex({ key: 1 }, { unique: true });
  await database
    .collection(COLLECTIONS.licenseUsage)
    .createIndex({ licenseKey: 1 }, { unique: true });
  await database.collection(COLLECTIONS.chartSignals).createIndex({ id: 1 }, { unique: true });
  await database.collection(COLLECTIONS.chartSignals).createIndex({ licenseKey: 1, signalAt: -1 });
  await database.collection(COLLECTIONS.candleHistory).createIndex({ pair: 1 }, { unique: true });
}

export async function disconnectMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

export function isMongoConnected(): boolean {
  return db !== null;
}
