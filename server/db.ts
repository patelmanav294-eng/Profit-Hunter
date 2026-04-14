import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { chartAnalyses, InsertChartAnalysis, InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

export type RecentNewsItem = {
  headline: string;
  source: string;
  publishedAt: string;
  impact: string;
  url?: string;
};

export type ChartAnalysisRecord = Omit<typeof chartAnalyses.$inferSelect, "recentNewsJson"> & {
  recentNews: RecentNewsItem[];
};

let _db: ReturnType<typeof drizzle> | null = null;

function parseRecentNews(raw: string | null): RecentNewsItem[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(item => item && typeof item === "object")
      .map(item => ({
        headline: typeof item.headline === "string" ? item.headline : "",
        source: typeof item.source === "string" ? item.source : "Unknown",
        publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : "",
        impact: typeof item.impact === "string" ? item.impact : "Impact unclear hai",
        url: typeof item.url === "string" ? item.url : undefined,
      }))
      .filter(item => item.headline.length > 0);
  } catch {
    return [];
  }
}

function hydrateAnalysis(record: typeof chartAnalyses.$inferSelect): ChartAnalysisRecord {
  const { recentNewsJson, ...rest } = record;
  return {
    ...rest,
    recentNews: parseRecentNews(recentNewsJson ?? null),
  };
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function createChartAnalysis(input: InsertChartAnalysis): Promise<ChartAnalysisRecord> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  await db.insert(chartAnalyses).values(input);

  const latest = await db.select().from(chartAnalyses).orderBy(desc(chartAnalyses.id)).limit(1);

  if (latest.length === 0) {
    throw new Error("Analysis save failed");
  }

  return hydrateAnalysis(latest[0]);
}

export async function getLatestChartAnalyses(limit = 10): Promise<ChartAnalysisRecord[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }

  const rows = await db.select().from(chartAnalyses).orderBy(desc(chartAnalyses.createdAt), desc(chartAnalyses.id)).limit(limit);
  return rows.map(hydrateAnalysis);
}
