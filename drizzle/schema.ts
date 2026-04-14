import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const chartAnalyses = mysqlTable("chartAnalyses", {
  id: int("id").autoincrement().primaryKey(),
  pair: varchar("pair", { length: 32 }).notNull(),
  timeframe: varchar("timeframe", { length: 16 }).notNull(),
  imageUrl: text("imageUrl").notNull(),
  imageKey: varchar("imageKey", { length: 255 }).notNull(),
  direction: mysqlEnum("direction", ["buy", "sell", "no_trade"]).notNull(),
  entryPrice: varchar("entryPrice", { length: 64 }),
  stopLoss: varchar("stopLoss", { length: 64 }),
  takeProfit: varchar("takeProfit", { length: 64 }),
  reasoning: text("reasoning").notNull(),
  confidenceScore: int("confidenceScore").notNull(),
  riskWarning: text("riskWarning").notNull(),
  newsSummary: text("newsSummary"),
  recentNewsJson: text("recentNewsJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChartAnalysis = typeof chartAnalyses.$inferSelect;
export type InsertChartAnalysis = typeof chartAnalyses.$inferInsert;
