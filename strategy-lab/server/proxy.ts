/**
 * Development proxy for the market-data providers.
 *
 * Binance and Yahoo do not send CORS headers, so the browser cannot call them
 * directly. This forwards `/api/bars` server-side. It is a dev convenience with
 * no auth and no rate limiting — do not expose it publicly.
 *
 *   npm run proxy      (then npm run dev in another terminal)
 */

import { createServer, type ServerResponse } from "node:http";

import { binanceSource, yahooSource, type MarketDataSource, type Timeframe } from "../src/data/adapters";

const PORT = Number(process.env.PROXY_PORT ?? 5274);
const MAX_LIMIT = 20_000;

const SOURCES: Record<string, MarketDataSource> = {
  binance: binanceSource,
  yahoo: yahooSource,
};

const VALID_TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname !== "/api/bars") {
    send(response, 404, { error: `Nothing at ${url.pathname}. The only route is /api/bars.` });
    return;
  }

  void handleBars(url, response).catch((error: Error) => {
    send(response, 502, { error: error.message });
  });
});

async function handleBars(url: URL, response: ServerResponse): Promise<void> {
  const sourceId = url.searchParams.get("source") ?? "binance";
  const source = SOURCES[sourceId];
  if (!source) {
    send(response, 400, { error: `Unknown source "${sourceId}". Use one of: ${Object.keys(SOURCES).join(", ")}` });
    return;
  }

  const symbol = url.searchParams.get("symbol");
  if (!symbol) {
    send(response, 400, { error: `Missing symbol. ${source.symbolHint}` });
    return;
  }

  const timeframe = (url.searchParams.get("timeframe") ?? "H1") as Timeframe;
  if (!VALID_TIMEFRAMES.includes(timeframe)) {
    send(response, 400, { error: `Unknown timeframe "${timeframe}". Use one of: ${VALID_TIMEFRAMES.join(", ")}` });
    return;
  }

  const requested = Number(url.searchParams.get("limit") ?? 5000);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 10), MAX_LIMIT) : 5000;

  const started = Date.now();
  const bars = await source.fetchBars({ symbol, timeframe, limit });
  process.stdout.write(
    `  ${sourceId} ${symbol} ${timeframe} → ${bars.length} bars in ${Date.now() - started}ms\n`,
  );

  send(response, 200, { bars, source: sourceId, symbol, timeframe });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    // The Vite dev server proxies to this origin, but allow direct calls too so
    // the endpoint can be poked with curl during development.
    "Access-Control-Allow-Origin": "*",
  });
  response.end(payload);
}

server.on("clientError", (_error: Error, socket: import("node:net").Socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(PORT, () => {
  process.stdout.write(`\n  Market data proxy listening on http://localhost:${PORT}\n`);
  process.stdout.write(`  Sources: ${Object.keys(SOURCES).join(", ")}\n\n`);
});
