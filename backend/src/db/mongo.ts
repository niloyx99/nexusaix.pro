import { MongoClient, type Db, type Collection, type Document } from "mongodb";

const DB_NAME = process.env.MONGODB_DB_NAME || "aldi_bot";

export const COLLECTIONS = {
  licenses: "licenses",
  licenseUsage: "license_usage",
  chartSignals: "chart_signals",
  candleHistory: "candle_history",
  appMeta: "app_meta",
} as const;

let client: MongoClient | null = null;
let db: Db | null = null;

export function getMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Add it in Render Environment variables or backend/.env"
    );
  }
  return uri;
}

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  const uri = getMongoUri();
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(DB_NAME);

  await ensureIndexes(db);
  return db;
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
