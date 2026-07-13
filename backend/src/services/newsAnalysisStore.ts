import type { NewsAnalysisResult } from "./newsAnalysis.js";
import { getCollection } from "../db/mongo.js";

export type AnalysisPhase = "initial" | "confirmation" | "post-release";

export interface NewsAnalysisDoc {
  _id: string;
  calendarDate: string;
  eventId: string;
  analysisVersion: number;
  snapshot: string;
  phase: AnalysisPhase;
  analyzedAt: number;
  expiresAt: number;
  data: NewsAnalysisResult;
  updatedAt: string;
}

const COLLECTION = "news_analysis";

async function collection() {
  return getCollection<NewsAnalysisDoc>(COLLECTION);
}

export async function loadNewsAnalysisDoc(id: string): Promise<NewsAnalysisDoc | null> {
  try {
    const col = await collection();
    return col.findOne({ _id: id });
  } catch {
    return null;
  }
}

export async function loadNewsAnalysesForDate(
  calendarDate: string,
  analysisVersion: number
): Promise<NewsAnalysisDoc[]> {
  try {
    const col = await collection();
    const now = Date.now();
    return col
      .find({
        calendarDate,
        analysisVersion,
        expiresAt: { $gt: now },
      })
      .toArray();
  } catch {
    return [];
  }
}

export async function saveNewsAnalysisDoc(doc: NewsAnalysisDoc): Promise<void> {
  try {
    const col = await collection();
    await col.updateOne(
      { _id: doc._id },
      { $set: { ...doc, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
  } catch (error) {
    console.warn("news_analysis save failed:", error);
  }
}
