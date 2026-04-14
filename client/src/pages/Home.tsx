import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  ChartCandlestick,
  Crosshair,
  ExternalLink,
  Globe,
  Loader2,
  Newspaper,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
  Upload,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const majorPairs = [
  "XAUUSD",
  "EURUSD",
  "GBPJPY",
  "GBPUSD",
  "USDJPY",
  "AUDUSD",
  "USDCAD",
  "USDCHF",
  "NZDUSD",
  "EURJPY",
  "EURGBP",
  "GBPCHF",
  "CADJPY",
  "AUDJPY",
  "EURAUD",
  "XAUEUR",
];

const timeframeOptions = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"] as const;
const traderPrinciples = ["Patience Pehle", "Execution Clean", "Risk Controlled"];

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("File read nahi hui"));
    reader.readAsDataURL(file);
  });
}

function formatDirection(direction: string) {
  if (direction === "buy") return "Buy Setup Bana Hai";
  if (direction === "sell") return "Sell Setup Bana Hai";
  return "Trade Skip Karo";
}

function directionTone(direction: string) {
  if (direction === "buy") return "text-emerald-300 border-emerald-500/40 bg-emerald-500/10";
  if (direction === "sell") return "text-rose-300 border-rose-500/40 bg-rose-500/10";
  return "text-zinc-200 border-white/15 bg-white/5";
}

function DirectionIcon({ direction }: { direction: string }) {
  if (direction === "buy") return <TrendingUp className="h-5 w-5" />;
  if (direction === "sell") return <TrendingDown className="h-5 w-5" />;
  return <Ban className="h-5 w-5" />;
}

function formatNewsTime(value?: string) {
  if (!value) return "Time unclear hai";

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;

  const diffHours = Math.round((Date.now() - timestamp) / (1000 * 60 * 60));
  if (diffHours <= 1) return "1 ghante ke andar";
  if (diffHours < 24) return `${diffHours} ghante pehle`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} din pehle`;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const utils = trpc.useUtils();
  const historyQuery = trpc.analysis.latest.useQuery();
  const [selectedPair, setSelectedPair] = useState("XAUUSD");
  const [selectedTimeframe, setSelectedTimeframe] = useState<(typeof timeframeOptions)[number]>("H1");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [dragging, setDragging] = useState(false);

  const analysisMutation = trpc.analysis.create.useMutation({
    onSuccess: async () => {
      toast.success("Analysis ready hai");
      await utils.analysis.latest.invalidate();
    },
    onError: error => {
      toast.error(error.message || "Analysis fail ho gaya");
    },
  });

  const latestHistory = useMemo(() => {
    if (analysisMutation.data?.latest) {
      return analysisMutation.data.latest;
    }
    return historyQuery.data ?? [];
  }, [analysisMutation.data?.latest, historyQuery.data]);

  const latestAnalysis = analysisMutation.data?.analysis ?? latestHistory[0] ?? null;

  const pickFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Sirf image screenshot upload karo");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("File 8MB se chhoti honi chahiye");
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    pickFile(event.target.files?.[0] ?? null);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    pickFile(event.dataTransfer.files?.[0] ?? null);
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      toast.error("Pehle chart screenshot upload karo");
      return;
    }

    const imageBase64 = await fileToBase64(selectedFile);
    await analysisMutation.mutateAsync({
      pair: selectedPair,
      timeframe: selectedTimeframe,
      fileName: selectedFile.name,
      mimeType: selectedFile.type,
      imageBase64,
    });
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.15),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.08),transparent_24%)]" />
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:72px_72px]" />

      <section className="relative container py-8 sm:py-10 lg:py-14">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="inline-flex items-center gap-2 border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-zinc-300">
            <Crosshair className="h-3.5 w-3.5 text-primary" />
            Trader Focus Mode
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {traderPrinciples.map(item => (
              <div key={item} className="inline-flex items-center border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-[0.24em] text-zinc-300">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <p className="text-xs uppercase tracking-[0.34em] text-primary">Profit Hunter</p>
            <h1 className="display-title mt-4 max-w-4xl text-[3.3rem] leading-[0.84] sm:text-[5.4rem] lg:text-[7.4rem]">
              Calm Raho. Sharp Socho. Clean Trade Lo.
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-zinc-300">
              Ab system sirf chart nahi dekh raha. Ye chart ke saath recent market news bhi check karta hai taaki setup blind na rahe. Simple rule: structure clean ho, context support kare, tabhi conviction banta hai.
            </p>
          </div>

          <div className="command-panel p-5 sm:p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-400">Mindset Check</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="data-card">
                <p className="data-label">Rule 01</p>
                <p className="data-value text-xl">Confirmation Ke Bina Entry Nahi</p>
              </div>
              <div className="data-card">
                <p className="data-label">Rule 02</p>
                <p className="data-value text-xl">Risk Pehle, Reward Baad Me</p>
              </div>
              <div className="data-card">
                <p className="data-label">Rule 03</p>
                <p className="data-value text-xl">News Against Ho To Force Mat Karo</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="divider-line" />

      <section className="relative container py-8 sm:py-10 lg:py-14">
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <div className="command-panel p-5 sm:p-6">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="panel-kicker">Setup Intake</p>
                  <h2 className="mt-2 text-3xl sm:text-4xl">Chart Daal, Bias Nikaal</h2>
                </div>
                <ChartCandlestick className="h-9 w-9 shrink-0 text-primary" />
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileInput}
                style={{ display: "none" }}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={event => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={`upload-zone ${dragging ? "upload-zone-active" : ""}`}
              >
                <Upload className="h-12 w-12 text-primary" />
                <p className="mt-5 text-2xl font-semibold uppercase tracking-wide">Drag & drop ya tap karke screenshot daalo</p>
                <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">
                  Chart clean, zoomed aur readable hona chahiye. Weak screenshot ka matlab weak analysis. Market me excuse count nahi hota.
                </p>
                <span className="action-chip mt-6">File Picker Khol</span>
              </button>

              <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="border border-white/10 bg-black/40 p-3">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Uploaded chart preview" className="h-72 w-full object-cover sm:h-80" />
                  ) : (
                    <div className="flex h-72 items-center justify-center bg-[linear-gradient(135deg,rgba(245,158,11,0.08),rgba(255,255,255,0.02))] text-center text-sm leading-6 text-zinc-400 sm:h-80">
                      Screenshot preview yahan dikhega. Clear image daalo, warna AI ko structure pakadne me problem hogi.
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="data-card">
                    <p className="data-label">Selected File</p>
                    <p className="data-value break-all text-lg">{selectedFile?.name ?? "Abhi koi file nahi"}</p>
                  </div>
                  <div className="data-card">
                    <p className="data-label">Execution Note</p>
                    <p className="text-sm leading-6 text-zinc-300">
                      Agar price labels, candles aur key zones clear nahi dikh rahe, to AI no trade bhi de sakta hai. Ye flaw nahi, disciplined output hai.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="command-panel p-5 sm:p-6">
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="form-label">Currency Pair</label>
                  <Select value={selectedPair} onValueChange={setSelectedPair}>
                    <SelectTrigger className="form-trigger">
                      <SelectValue placeholder="Pair select karo" />
                    </SelectTrigger>
                    <SelectContent className="rounded-none border-white/10 bg-[#0a0d12] text-white">
                      {majorPairs.map(pair => (
                        <SelectItem key={pair} value={pair} className="rounded-none text-base text-white focus:bg-white/10 focus:text-white">
                          {pair}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="form-label">Timeframe</label>
                  <Select value={selectedTimeframe} onValueChange={value => setSelectedTimeframe(value as (typeof timeframeOptions)[number])}>
                    <SelectTrigger className="form-trigger">
                      <SelectValue placeholder="Timeframe select karo" />
                    </SelectTrigger>
                    <SelectContent className="rounded-none border-white/10 bg-[#0a0d12] text-white">
                      {timeframeOptions.map(frame => (
                        <SelectItem key={frame} value={frame} className="rounded-none text-base text-white focus:bg-white/10 focus:text-white">
                          {frame}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={analysisMutation.isPending}
                className="submit-button mt-5"
              >
                {analysisMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Target className="h-5 w-5" />}
                {analysisMutation.isPending ? "Chart + News Analysis Chal Rahi Hai" : "AI Se Setup Nikaalo"}
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="command-panel p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="panel-kicker">Live Read</p>
                  <h2 className="mt-2 text-3xl sm:text-4xl">AI Kya Bol Raha Hai</h2>
                </div>
                <div className={`inline-flex items-center gap-2 border px-3 py-2 text-sm font-semibold uppercase tracking-[0.18em] ${latestAnalysis ? directionTone(latestAnalysis.direction) : "border-white/15 bg-white/5 text-zinc-200"}`}>
                  <DirectionIcon direction={latestAnalysis?.direction ?? "no_trade"} />
                  {latestAnalysis ? formatDirection(latestAnalysis.direction) : "Result Abhi Pending Hai"}
                </div>
              </div>

              {latestAnalysis ? (
                <div className="mt-6 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="data-card">
                      <p className="data-label">Entry Level</p>
                      <p className="data-value">{latestAnalysis.entryPrice}</p>
                    </div>
                    <div className="data-card">
                      <p className="data-label">Stop Loss</p>
                      <p className="data-value">{latestAnalysis.stopLoss}</p>
                    </div>
                    <div className="data-card">
                      <p className="data-label">Target Level</p>
                      <p className="data-value">{latestAnalysis.takeProfit}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="data-card">
                      <p className="data-label">Pair / Timeframe</p>
                      <p className="data-value text-2xl">{latestAnalysis.pair} · {latestAnalysis.timeframe}</p>
                    </div>
                    <div className="data-card">
                      <p className="data-label">Confidence</p>
                      <p className="data-value text-2xl">{latestAnalysis.confidenceScore}%</p>
                    </div>
                  </div>

                  <div className="data-card">
                    <p className="data-label">Short Reason</p>
                    <p className="text-sm leading-6 text-zinc-200">{latestAnalysis.reasoning}</p>
                  </div>

                  <div className="border border-sky-500/20 bg-sky-500/10 p-4">
                    <div className="flex items-center gap-2 text-sky-200">
                      <Globe className="h-4 w-4" />
                      <p className="text-xs uppercase tracking-[0.24em]">News Context</p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-zinc-100">
                      {latestAnalysis.newsSummary || "Abhi direct market impact summary available nahi hai."}
                    </p>
                  </div>

                  <div className="border border-amber-500/20 bg-amber-500/10 p-4">
                    <div className="flex items-center gap-2 text-amber-200">
                      <ShieldAlert className="h-4 w-4" />
                      <p className="text-xs uppercase tracking-[0.24em]">Risk Warning Dhyan Se</p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-zinc-200">{latestAnalysis.riskWarning}</p>
                  </div>
                </div>
              ) : (
                <div className="mt-6 border border-white/10 bg-white/5 p-5 text-sm leading-6 text-zinc-300">
                  Screenshot upload karo aur analysis run karo. Yahan wahi output dikhaya jayega jo trade lene se pehle tumhe discipline ke saath dekhna chahiye.
                </div>
              )}
            </div>

            <div className="command-panel p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="panel-kicker">Market Pulse</p>
                  <h2 className="mt-2 text-3xl sm:text-4xl">Recent News Kya Bol Rahi Hai</h2>
                </div>
                <Newspaper className="h-8 w-8 shrink-0 text-primary" />
              </div>

              {latestAnalysis?.recentNews?.length ? (
                <div className="mt-6 space-y-3">
                  {latestAnalysis.recentNews.map((item, index) => (
                    <div key={`${item.headline}-${index}`} className="border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-zinc-400">
                        <span>{item.source}</span>
                        <span className="text-primary">/</span>
                        <span>{formatNewsTime(item.publishedAt)}</span>
                      </div>
                      <p className="mt-3 text-base font-semibold leading-6 text-white">{item.headline}</p>
                      <p className="mt-3 text-sm leading-6 text-zinc-300">{item.impact}</p>
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-primary transition hover:text-primary/80"
                        >
                          Source Dekho <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-6 border border-white/10 bg-white/5 p-4 text-sm leading-6 text-zinc-300">
                  Yahan top 3 relevant news dikhegi. Agar pair ke around koi strong recent headline nahi milti, to system chart ko primary weight dega lekin overconfidence fir bhi avoid karega.
                </div>
              )}
            </div>

            <div className="command-panel p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="panel-kicker">Memory Log</p>
                  <h2 className="mt-2 text-3xl sm:text-4xl">Pichhle 10 Analyses</h2>
                </div>
                <AlertTriangle className="h-8 w-8 shrink-0 text-primary" />
              </div>

              <div className="mt-6 space-y-3">
                {historyQuery.isLoading ? (
                  <div className="flex items-center gap-3 border border-white/10 bg-white/5 p-4 text-zinc-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    History abhi load ho rahi hai
                  </div>
                ) : latestHistory.length === 0 ? (
                  <div className="border border-white/10 bg-white/5 p-4 text-sm leading-6 text-zinc-300">
                    Abhi tak koi analysis save nahi hui. Pehla chart daalo, fir dekhna kaise history tumhari decision memory banati hai.
                  </div>
                ) : (
                  latestHistory.slice(0, 10).map(item => (
                    <div key={item.id} className="history-row">
                      <img src={item.imageUrl} alt={`${item.pair} ${item.timeframe}`} className="h-22 w-[96px] object-cover" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-lg font-semibold text-white">{item.pair}</p>
                          <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{item.timeframe}</span>
                          <span className={`inline-flex border px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${directionTone(item.direction)}`}>
                            {formatDirection(item.direction)}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm leading-5 text-zinc-300">{item.reasoning}</p>
                        {item.newsSummary ? <p className="mt-2 text-xs uppercase tracking-[0.12em] text-sky-300">News: {item.newsSummary}</p> : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
