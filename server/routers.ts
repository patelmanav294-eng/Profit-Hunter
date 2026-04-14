import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { invokeLLM } from "./_core/llm";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { createChartAnalysis, getLatestChartAnalyses, type RecentNewsItem } from "./db";
import { storagePut } from "./storage";

const timeframeSchema = z.enum(["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"]);

const createAnalysisInputSchema = z.object({
  pair: z
    .string()
    .min(3)
    .max(32)
    .transform(value => value.trim().toUpperCase()),
  timeframe: timeframeSchema,
  fileName: z.string().min(1).max(120),
  mimeType: z.string().regex(/^image\//, "Sirf image file upload karo"),
  imageBase64: z.string().min(100, "Image data missing hai"),
});

const currencyAliases: Record<string, string[]> = {
  XAU: ["gold", "xau", "bullion", "precious metal"],
  USD: ["usd", "us dollar", "dollar", "fed", "fomc", "us treasury", "us yields", "cpi", "ppi", "nfp", "inflation"],
  EUR: ["eur", "euro", "ecb", "eurozone", "lagarde"],
  GBP: ["gbp", "pound", "sterling", "boe", "bank of england", "bailey", "uk inflation"],
  JPY: ["jpy", "yen", "boj", "bank of japan", "ueda", "japan yields"],
  AUD: ["aud", "australian dollar", "rba", "australia", "iron ore", "employment"],
  CAD: ["cad", "canadian dollar", "boc", "bank of canada", "canada", "oil", "wti"],
  CHF: ["chf", "swiss franc", "snb", "switzerland", "safe haven"],
  NZD: ["nzd", "new zealand dollar", "rbnz", "new zealand", "dairy"],
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
});

const analysisResponseSchema = {
  name: "forex_chart_analysis_with_news",
  strict: true,
  schema: {
    type: "object",
    properties: {
      direction: {
        type: "string",
        enum: ["buy", "sell", "no_trade"],
      },
      entryPrice: {
        type: "string",
        description: 'Exact entry level ya "N/A"',
      },
      stopLoss: {
        type: "string",
        description: 'Exact stop loss ya "N/A"',
      },
      takeProfit: {
        type: "string",
        description: 'Exact take profit ya "N/A"',
      },
      reasoning: {
        type: "string",
        description: "Short Hinglish explanation based on price action, support-resistance, and market context.",
      },
      confidenceScore: {
        type: "integer",
        minimum: 0,
        maximum: 100,
      },
      riskWarning: {
        type: "string",
        description: "Short Hinglish risk warning.",
      },
      newsBias: {
        type: "string",
        enum: ["supportive", "neutral", "caution", "contradictory"],
      },
      newsSummary: {
        type: "string",
        description: "One-line Hinglish summary of how recent news may affect the trade setup overall.",
      },
      recentNews: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            headline: { type: "string" },
            source: { type: "string" },
            publishedAt: { type: "string" },
            impact: {
              type: "string",
              description: "One-line Hinglish impact on the trade idea.",
            },
            url: { type: "string" },
          },
          required: ["headline", "source", "publishedAt", "impact", "url"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "direction",
      "entryPrice",
      "stopLoss",
      "takeProfit",
      "reasoning",
      "confidenceScore",
      "riskWarning",
      "newsBias",
      "newsSummary",
      "recentNews",
    ],
    additionalProperties: false,
  },
} as const;

type FeedItem = {
  title: string;
  description: string;
  link: string;
  pubDate: string;
};

type ParsedAnalysis = {
  direction: "buy" | "sell" | "no_trade";
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
  reasoning: string;
  confidenceScore: number;
  riskWarning: string;
  newsBias: "supportive" | "neutral" | "caution" | "contradictory";
  newsSummary: string;
  recentNews: RecentNewsItem[];
};

function enforceNewsBias(result: ParsedAnalysis): ParsedAnalysis {
  if (result.direction === "no_trade") {
    return result;
  }

  if (result.newsBias === "contradictory") {
    return {
      ...result,
      direction: "no_trade",
      entryPrice: "N/A",
      stopLoss: "N/A",
      takeProfit: "N/A",
      confidenceScore: Math.min(result.confidenceScore, 38),
      reasoning: `${result.reasoning.trim()} Recent high-impact news is setup ke against ja rahi hai, isliye force trade avoid karo.`.trim(),
      riskWarning: `${result.riskWarning.trim()} Strong conflicting news ke against entry mat lo.`.trim(),
      newsSummary: result.newsSummary.trim() || "Recent news setup ko oppose kar rahi hai, isliye no trade better hai.",
    };
  }

  if (result.newsBias === "caution") {
    return {
      ...result,
      confidenceScore: Math.min(result.confidenceScore, 58),
      riskWarning: `${result.riskWarning.trim()} News mixed hai, isliye size chhota ya wait better hai.`.trim(),
    };
  }

  return result;
}

function sanitizeLevel(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "N/A";
}

function sanitizeConfidence(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getImageBuffer(base64: string) {
  const cleaned = base64.includes(",") ? base64.split(",").pop() ?? "" : base64;
  return Buffer.from(cleaned, "base64");
}

function getLLMContentText(raw: string | Array<{ type: string; text?: string }>) {
  if (typeof raw === "string") {
    return raw;
  }

  return raw
    .filter(part => part.type === "text" && typeof part.text === "string")
    .map(part => part.text)
    .join("\n");
}

function getPairKeywords(pair: string) {
  if (pair.length < 6) return [pair.toLowerCase()];

  const base = pair.slice(0, 3);
  const quote = pair.slice(3, 6);
  return [
    pair.toLowerCase(),
    `${base}/${quote}`.toLowerCase(),
    ...(currencyAliases[base] ?? [base.toLowerCase()]),
    ...(currencyAliases[quote] ?? [quote.toLowerCase()]),
  ];
}

function scoreNewsRelevance(item: FeedItem, pair: string) {
  const keywords = getPairKeywords(pair);
  const haystack = `${item.title} ${item.description}`.toLowerCase();

  let score = 0;
  for (const keyword of keywords) {
    if (haystack.includes(keyword)) {
      score += keyword.length > 4 ? 3 : 2;
    }
  }

  if (pair === "XAUUSD" && /(risk|geopolit|safe haven|treasury|yield)/i.test(haystack)) {
    score += 2;
  }

  if (/(inflation|cpi|ppi|nfp|rate|central bank|fed|ecb|boj|boe|rba|boc|snb|rbnz)/i.test(haystack)) {
    score += 1;
  }

  return score;
}

function toFeedItems(parsedXml: unknown): FeedItem[] {
  const channel = (parsedXml as { rss?: { channel?: { item?: unknown } } })?.rss?.channel;
  const rawItems = channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  return items
    .map(item => {
      const entry = item as Record<string, unknown>;
      return {
        title: typeof entry.title === "string" ? entry.title.trim() : "",
        description: typeof entry.description === "string" ? entry.description.trim() : "",
        link: typeof entry.link === "string" ? entry.link.trim() : "",
        pubDate: typeof entry.pubDate === "string" ? entry.pubDate.trim() : "",
      } satisfies FeedItem;
    })
    .filter(item => item.title.length > 0 && item.link.length > 0);
}

async function fetchRecentMarketNews(pair: string): Promise<RecentNewsItem[]> {
  const response = await fetch("https://www.fxstreet.com/rss/news", {
    headers: {
      "user-agent": "ProfitHunterBot/1.0",
      accept: "application/rss+xml, application/xml, text/xml",
    },
  });

  if (!response.ok) {
    throw new Error(`News feed fetch failed with status ${response.status}`);
  }

  const xml = await response.text();
  const parsedXml = parser.parse(xml);
  const items = toFeedItems(parsedXml);
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;

  const filtered = items
    .filter(item => {
      const publishedAt = Date.parse(item.pubDate);
      return Number.isFinite(publishedAt) && publishedAt >= cutoff;
    })
    .map(item => ({ item, score: scoreNewsRelevance(item, pair) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(right.item.pubDate) - Date.parse(left.item.pubDate);
    })
    .slice(0, 3)
    .map(entry => ({
      headline: entry.item.title,
      source: "FXStreet",
      publishedAt: entry.item.pubDate,
      impact: "Impact analyse ho raha hai",
      url: entry.item.link,
    }));

  if (filtered.length > 0) {
    return filtered;
  }

  return items
    .filter(item => {
      const publishedAt = Date.parse(item.pubDate);
      return Number.isFinite(publishedAt) && publishedAt >= cutoff;
    })
    .slice(0, 3)
    .map(item => ({
      headline: item.title,
      source: "FXStreet",
      publishedAt: item.pubDate,
      impact: "Impact analyse ho raha hai",
      url: item.link,
    }));
}

function buildNewsPrompt(news: RecentNewsItem[]) {
  if (news.length === 0) {
    return "Recent relevant news: Koi strong relevant news item nahi mila. Agar chart clean ho tabhi conviction do.";
  }

  return [
    "Recent relevant news from last 48h:",
    ...news.map((item, index) => `${index + 1}. ${item.headline} | Source: ${item.source} | Time: ${item.publishedAt} | URL: ${item.url ?? "N/A"}`),
    "Rule: Agar news high-impact aur chart setup ke against ho, to no_trade ya weaker conviction consider karo.",
  ].join("\n");
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  analysis: router({
    latest: publicProcedure.query(async () => {
      return getLatestChartAnalyses(10);
    }),
    create: publicProcedure.input(createAnalysisInputSchema).mutation(async ({ input }) => {
      const imageBuffer = getImageBuffer(input.imageBase64);

      if (imageBuffer.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Image read nahi ho paayi" });
      }

      if (imageBuffer.length > 8 * 1024 * 1024) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Image size bahut badi hai. 8MB se chhoti file upload karo" });
      }

      const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
      const { key, url } = await storagePut(`chart-uploads/${Date.now()}-${safeFileName}`, imageBuffer, input.mimeType);

      let recentNews: RecentNewsItem[] = [];
      try {
        recentNews = await fetchRecentMarketNews(input.pair);
      } catch (error) {
        console.error("[News] Recent news fetch failed:", error);
      }

      const llmResponse = await invokeLLM({
        messages: [
          {
            role: "system",
            content:
              "Tum ek disciplined forex chart analyst ho jo chart aur recent macro news dono dekhta hai. Tum price action aur support-resistance ko primary rakho, lekin agar recent high-impact news setup ko weak, dangerous, ya contradictory banati hai to direction ko no_trade ya lower confidence me shift kar sakte ho. Har output Hinglish me short, direct, aur practical rakho. Overconfidence mat dikhana.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Pair: ${input.pair}\nTimeframe: ${input.timeframe}\nTask: Chart screenshot ko deeply analyse karo aur structured output do. Direction sirf buy, sell, ya no_trade ho. Entry, SL, TP practical levels me do. Agar level visible nahi hai to N/A do. Reasoning 1-2 short lines Hinglish me rakho. Confidence 0 se 100 ke beech integer ho. Risk warning short aur realistic ho. News summary me ek line me batao ki recent news trade ko support kar rahi hai, oppose kar rahi hai, ya caution demand karti hai. RecentNews array me top 3 news ke liye one-line impact likho.\n\n${buildNewsPrompt(recentNews)}`,
              },
              {
                type: "image_url",
                image_url: {
                  url,
                  detail: "high",
                },
              },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: analysisResponseSchema,
        },
      });

      const rawContent = llmResponse.choices[0]?.message?.content;
      const contentText = getLLMContentText(rawContent as string | Array<{ type: string; text?: string }>);

      if (!contentText) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI response blank aaya" });
      }

      let parsed: ParsedAnalysis;

      try {
        parsed = JSON.parse(contentText) as ParsedAnalysis;
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI response parse nahi hua" });
      }

      parsed = enforceNewsBias(parsed);

      const saved = await createChartAnalysis({
        pair: input.pair,
        timeframe: input.timeframe,
        imageUrl: url,
        imageKey: key,
        direction: parsed.direction,
        entryPrice: sanitizeLevel(parsed.entryPrice),
        stopLoss: sanitizeLevel(parsed.stopLoss),
        takeProfit: sanitizeLevel(parsed.takeProfit),
        reasoning: parsed.reasoning.trim(),
        confidenceScore: sanitizeConfidence(parsed.confidenceScore),
        riskWarning: parsed.riskWarning.trim(),
        newsSummary: parsed.newsSummary.trim(),
        recentNewsJson: JSON.stringify((parsed.recentNews ?? []).slice(0, 3)),
      });

      const latest = await getLatestChartAnalyses(10);

      return {
        analysis: saved,
        latest,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
