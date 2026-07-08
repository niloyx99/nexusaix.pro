import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { License, LicenseUsageRecord } from "../types/license.js";
import type { ChartSignalRecord } from "../services/chartAnalytics.js";
import { COLLECTIONS, getCollection } from "./mongo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../../data");

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface AppMetaDoc {
  _id: string;
  done?: boolean;
  migratedAt?: string;
}

export async function migrateJsonToMongoIfNeeded(): Promise<void> {
  const meta = await getCollection<AppMetaDoc>(COLLECTIONS.appMeta);
  const flag = await meta.findOne({ _id: "json_migrated" });
  if (flag?.done) return;

  const licensesCol = await getCollection<License>(COLLECTIONS.licenses);
  const usageCol = await getCollection<
    LicenseUsageRecord & { licenseKey: string }
  >(COLLECTIONS.licenseUsage);
  const chartCol = await getCollection<ChartSignalRecord>(COLLECTIONS.chartSignals);

  const licenses = await readJson<License[]>(
    path.join(DATA_DIR, "licenses.json"),
    []
  );
  if (licenses.length) {
    for (const lic of licenses) {
      await licensesCol.updateOne({ id: lic.id }, { $set: lic }, { upsert: true });
    }
  }

  const usageMap = await readJson<Record<string, LicenseUsageRecord>>(
    path.join(DATA_DIR, "usage.json"),
    {}
  );
  for (const [licenseKey, record] of Object.entries(usageMap)) {
    await usageCol.updateOne(
      { licenseKey },
      { $set: { licenseKey, ...record } },
      { upsert: true }
    );
  }

  const chartStore = await readJson<{ signals: ChartSignalRecord[] }>(
    path.join(DATA_DIR, "chartAnalytics.json"),
    { signals: [] }
  );
  for (const signal of chartStore.signals ?? []) {
    await chartCol.updateOne({ id: signal.id }, { $set: signal }, { upsert: true });
  }

  const candleHistory = await readJson<
    Record<string, { candles: unknown[] }>
  >(path.join(DATA_DIR, "candleHistory.json"), {});
  const candleCol = await getCollection(COLLECTIONS.candleHistory);
  for (const [pair, series] of Object.entries(candleHistory)) {
    if (!series?.candles?.length) continue;
    await candleCol.updateOne(
      { pair: pair.toUpperCase() },
      { $set: { pair: pair.toUpperCase(), candles: series.candles } },
      { upsert: true }
    );
  }

  await meta.updateOne(
    { _id: "json_migrated" },
    { $set: { done: true, migratedAt: new Date().toISOString() } },
    { upsert: true }
  );

  console.log("MongoDB: migrated existing JSON data into collections.");
}
