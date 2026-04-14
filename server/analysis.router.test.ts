import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  storagePut: vi.fn(),
  invokeLLM: vi.fn(),
  createChartAnalysis: vi.fn(),
  getLatestChartAnalyses: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("./storage", () => ({
  storagePut: mocks.storagePut,
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: mocks.invokeLLM,
}));

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    createChartAnalysis: mocks.createChartAnalysis,
    getLatestChartAnalyses: mocks.getLatestChartAnalyses,
  };
});

vi.stubGlobal("fetch", mocks.fetch);

import { appRouter } from "./routers";

function createContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as TrpcContext["res"],
  };
}

const validImageBase64 = `data:image/png;base64,${Buffer.alloc(128, 7).toString("base64")}`;

const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Gold steadies as Fed caution keeps USD soft</title>
      <link>https://example.com/gold-fed</link>
      <description>Gold and the US Dollar remain in focus after fresh Fed remarks.</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
    <item>
      <title>EUR/USD holds gains ahead of ECB comments</title>
      <link>https://example.com/eurusd-ecb</link>
      <description>Euro traders watch ECB guidance closely.</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
  </channel>
</rss>`;

describe("analysis router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(sampleRss),
    });
  });

  it("returns the latest 10 analyses from the database helper", async () => {
    const expected = [
      {
        id: 1,
        pair: "XAUUSD",
        timeframe: "H1",
        imageUrl: "https://cdn.example.com/chart.png",
        imageKey: "chart-uploads/test.png",
        direction: "buy",
        entryPrice: "3325.10",
        stopLoss: "3318.40",
        takeProfit: "3342.00",
        reasoning: "Support retest clean lag raha hai.",
        confidenceScore: 72,
        riskWarning: "News spike aaye to setup invalid ho sakta hai.",
        newsSummary: "Recent gold aur USD news setup ko halka support de rahi hai.",
        recentNews: [
          {
            headline: "Gold steadies as Fed caution keeps USD soft",
            source: "FXStreet",
            publishedAt: new Date().toUTCString(),
            impact: "Soft USD gold buy idea ko support kar sakta hai.",
            url: "https://example.com/gold-fed",
          },
        ],
        createdAt: new Date(),
      },
    ];
    mocks.getLatestChartAnalyses.mockResolvedValue(expected);

    const caller = appRouter.createCaller(createContext());
    const result = await caller.analysis.latest();

    expect(mocks.getLatestChartAnalyses).toHaveBeenCalledWith(10);
    expect(result).toEqual(expected);
  });

  it("rejects invalid non-image uploads before resolver logic runs", async () => {
    const caller = appRouter.createCaller(createContext());

    await expect(
      caller.analysis.create({
        pair: "XAUUSD",
        timeframe: "H1",
        fileName: "notes.txt",
        mimeType: "text/plain",
        imageBase64: validImageBase64,
      })
    ).rejects.toThrow();

    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.invokeLLM).not.toHaveBeenCalled();
  });

  it("stores a structured chart-plus-news analysis and returns refreshed history", async () => {
    const saved = {
      id: 11,
      pair: "XAUUSD",
      timeframe: "H1",
      imageUrl: "https://cdn.example.com/chart.png",
      imageKey: "chart-uploads/chart.png",
      direction: "buy",
      entryPrice: "3325.10",
      stopLoss: "3318.40",
      takeProfit: "3342.00",
      reasoning: "Resistance break ke baad retest hold kar raha hai aur news neutral se supportive hai.",
      confidenceScore: 76,
      riskWarning: "Lot size control me rakho.",
      newsSummary: "Recent gold aur USD headlines buy bias ko support kar rahi hain, lekin spike risk abhi bhi hai.",
      recentNews: [
        {
          headline: "Gold steadies as Fed caution keeps USD soft",
          source: "FXStreet",
          publishedAt: new Date().toUTCString(),
          impact: "Soft USD gold ke liye short-term support de sakta hai.",
          url: "https://example.com/gold-fed",
        },
      ],
      createdAt: new Date(),
    };

    mocks.storagePut.mockResolvedValue({
      key: "chart-uploads/chart.png",
      url: "https://cdn.example.com/chart.png",
    });
    mocks.invokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              direction: "buy",
              entryPrice: "3325.10",
              stopLoss: "3318.40",
              takeProfit: "3342.00",
              reasoning: "Resistance break ke baad retest hold kar raha hai aur news neutral se supportive hai.",
              confidenceScore: 76,
              riskWarning: "Lot size control me rakho.",
              newsBias: "supportive",
              newsSummary: "Recent gold aur USD headlines buy bias ko support kar rahi hain, lekin spike risk abhi bhi hai.",
              recentNews: [
                {
                  headline: "Gold steadies as Fed caution keeps USD soft",
                  source: "FXStreet",
                  publishedAt: new Date().toUTCString(),
                  impact: "Soft USD gold ke liye short-term support de sakta hai.",
                  url: "https://example.com/gold-fed",
                },
              ],
            }),
          },
        },
      ],
    });
    mocks.createChartAnalysis.mockResolvedValue(saved);
    mocks.getLatestChartAnalyses.mockResolvedValue([saved]);

    const caller = appRouter.createCaller(createContext());
    const result = await caller.analysis.create({
      pair: "xauusd",
      timeframe: "H1",
      fileName: "chart.png",
      mimeType: "image/png",
      imageBase64: validImageBase64,
    });

    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.storagePut).toHaveBeenCalledOnce();
    expect(mocks.invokeLLM).toHaveBeenCalledOnce();
    expect(mocks.createChartAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        pair: "XAUUSD",
        timeframe: "H1",
        direction: "buy",
        confidenceScore: 76,
        newsSummary: expect.stringContaining("buy bias"),
        recentNewsJson: expect.stringContaining("Gold steadies as Fed caution keeps USD soft"),
      })
    );
    expect(result).toEqual({
      analysis: saved,
      latest: [saved],
    });
  });

  it("forces no-trade when recent news strongly contradicts the chart setup", async () => {
    const saved = {
      id: 12,
      pair: "EURUSD",
      timeframe: "H1",
      imageUrl: "https://cdn.example.com/eurusd-chart.png",
      imageKey: "chart-uploads/eurusd-chart.png",
      direction: "no_trade",
      entryPrice: "N/A",
      stopLoss: "N/A",
      takeProfit: "N/A",
      reasoning: "Chart upside dikh raha tha, lekin recent high-impact news is setup ke against ja rahi hai, isliye force trade avoid karo.",
      confidenceScore: 38,
      riskWarning: "Volatility high hai. Strong conflicting news ke against entry mat lo.",
      newsSummary: "Recent news setup ko oppose kar rahi hai, isliye no trade better hai.",
      recentNews: [
        {
          headline: "EUR/USD holds gains ahead of ECB comments",
          source: "FXStreet",
          publishedAt: new Date().toUTCString(),
          impact: "ECB uncertainty buy continuation ko weak kar sakti hai.",
          url: "https://example.com/eurusd-ecb",
        },
      ],
      createdAt: new Date(),
    };

    mocks.storagePut.mockResolvedValue({
      key: "chart-uploads/eurusd-chart.png",
      url: "https://cdn.example.com/eurusd-chart.png",
    });
    mocks.invokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              direction: "buy",
              entryPrice: "1.0900",
              stopLoss: "1.0865",
              takeProfit: "1.0970",
              reasoning: "Chart upside continuation suggest kar raha hai.",
              confidenceScore: 79,
              riskWarning: "Volatility high hai.",
              newsBias: "contradictory",
              newsSummary: "Recent news setup ko oppose kar rahi hai, isliye no trade better hai.",
              recentNews: [
                {
                  headline: "EUR/USD holds gains ahead of ECB comments",
                  source: "FXStreet",
                  publishedAt: new Date().toUTCString(),
                  impact: "ECB uncertainty buy continuation ko weak kar sakti hai.",
                  url: "https://example.com/eurusd-ecb",
                },
              ],
            }),
          },
        },
      ],
    });
    mocks.createChartAnalysis.mockResolvedValue(saved);
    mocks.getLatestChartAnalyses.mockResolvedValue([saved]);

    const caller = appRouter.createCaller(createContext());
    await caller.analysis.create({
      pair: "eurusd",
      timeframe: "H1",
      fileName: "eurusd-chart.png",
      mimeType: "image/png",
      imageBase64: validImageBase64,
    });

    expect(mocks.createChartAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        pair: "EURUSD",
        direction: "no_trade",
        entryPrice: "N/A",
        stopLoss: "N/A",
        takeProfit: "N/A",
        confidenceScore: 38,
      })
    );
  });
});
