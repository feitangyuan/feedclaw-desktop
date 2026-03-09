import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { BarChart3 } from "lucide-react";
import { AppButton } from "@/components/AppButton";
import { TerminalOverlay } from "@/components/TerminalOverlay";
import {
  getTokenOptimizationReport,
  getTokenUsage,
  runTokenAudit,
  runTokenTreatment,
  type TokenOptimizationAction,
  type TokenOptimizationReport,
  type TokenUsageReport,
} from "@/lib/tauri";

const RANGES = [{ label: "7d", value: 7 }, { label: "14d", value: 14 }, { label: "30d", value: 30 }];
const optimizationCache = new Map<number, TokenOptimizationReport>();

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function shortDate(s: string) {
  const d = new Date(`${s}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function shortTime(s: string) {
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function modelLabel(provider: string, model: string) {
  if (!provider || provider === "unknown") return model;
  if (!model) return provider;
  return `${provider}/${model}`;
}

function tone(level: string) {
  if (level === "warn" || level === "error") {
    return {
      color: "var(--accent-orange)",
      background: "rgba(255, 149, 0, 0.10)",
      border: "1px solid rgba(255, 149, 0, 0.18)",
    };
  }

  return {
    color: "var(--accent-blue)",
    background: "rgba(10, 132, 255, 0.10)",
    border: "1px solid rgba(10, 132, 255, 0.18)",
  };
}

export function TokenUsagePage() {
  const [range, setRange] = useState(7);
  const [report, setReport] = useState<TokenUsageReport>({ days: [], models: [], recent: [] });
  const [loading, setLoading] = useState(true);
  const [optimization, setOptimization] = useState<TokenOptimizationReport | null>(optimizationCache.get(7) ?? null);
  const [optimizationMessage, setOptimizationMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayDone, setOverlayDone] = useState(false);
  const [overlayTitle, setOverlayTitle] = useState("检查过程");
  const [overlayLines, setOverlayLines] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const refresh = (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      getTokenUsage(range)
        .then((next) => {
          if (!cancelled) {
            setReport(next);
          }
        })
        .finally(() => {
          if (!cancelled && showLoading) {
            setLoading(false);
          }
        });
    };

    refresh(true);
    const timer = setInterval(() => refresh(false), 10000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [range]);

  useEffect(() => {
    setOptimization(optimizationCache.get(range) ?? null);
    setOptimizationMessage(null);
  }, [range]);

  const data = report.days;
  const models = report.models;
  const recent = report.recent;
  const totalIn = data.reduce((s, d) => s + d.input_tokens, 0);
  const totalOut = data.reduce((s, d) => s + d.output_tokens, 0);
  const totalCache = data.reduce((s, d) => s + d.cache_read_tokens + d.cache_write_tokens, 0);
  const totalCalls = models.reduce((s, d) => s + d.calls, 0);
  const hasData = data.some((d) => d.input_tokens + d.output_tokens > 0);
  const chartData = useMemo(
    () => data.map((d) => ({ date: shortDate(d.date), Input: d.input_tokens, Output: d.output_tokens })),
    [data]
  );

  const refreshOptimization = async () => {
    const next = await getTokenOptimizationReport(range);
    optimizationCache.set(range, next);
    setOptimization(next);
    return next;
  };

  const runCheck = () => {
    setChecking(true);
    setOptimizationMessage(null);
    setOverlayTitle("检查过程");
    setOverlayLines([`已开始最近 ${range} 天的 Token 检查`]);
    setOverlayDone(false);
    setOverlayOpen(true);

    runTokenAudit(
      range,
      (line) => setOverlayLines((prev) => [...prev, line]),
      async () => {
        setOverlayDone(true);
        setChecking(false);
        try {
          const next = await refreshOptimization();
          setOptimizationMessage(next.summary);
        } catch (error) {
          setOptimizationMessage(`读取检查结果失败：${String(error)}`);
        }
      },
      (error) => {
        setOverlayLines((prev) => [...prev, `检查失败：${String(error)}`]);
        setOverlayDone(true);
        setChecking(false);
      }
    );
  };

  const runAction = (findingId: string, action: TokenOptimizationAction) => {
    const key = `${findingId}:${action.id}`;
    setActionKey(key);
    setOptimizationMessage(null);
    setOverlayTitle("治疗过程");
    setOverlayLines([`开始处理：${action.label}`]);
    setOverlayDone(false);
    setOverlayOpen(true);

    runTokenTreatment(
      action.id,
      action.payload,
      (line) => setOverlayLines((prev) => [...prev, line]),
      async () => {
        setOverlayDone(true);
        setActionKey(null);
        try {
          await Promise.all([refreshOptimization(), getTokenUsage(range).then((next) => setReport(next))]);
          setOptimizationMessage("处理完成，已更新当前检查结果。");
        } catch (error) {
          setOptimizationMessage(`处理完成，但刷新结果失败：${String(error)}`);
        }
      },
      (error) => {
        setOverlayLines((prev) => [...prev, `处理失败：${String(error)}`]);
        setOverlayDone(true);
        setActionKey(null);
      }
    );
  };

  return (
    <div style={{ padding: "48px 40px 60px", maxWidth: 760, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em", margin: 0 }}>Token</h1>
        <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "var(--card-border)" }}>
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              style={{
                padding: "4px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                transition: "all 0.15s",
                border: "none",
                cursor: "pointer",
                color: range === r.value ? "var(--text-primary)" : "var(--text-secondary)",
                background: range === r.value ? "var(--card-bg)" : "transparent",
                boxShadow: range === r.value ? "0 1px 3px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(0,0,0,0.04)" : "none",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        {[
          { label: "Input", value: totalIn, color: "#007AFF" },
          { label: "Output", value: totalOut, color: "#AF52DE" },
          { label: "缓存", value: totalCache, color: "#30B0C7" },
          { label: "调用", value: totalCalls, color: "var(--text-primary)" },
        ].map((item) => (
          <div key={item.label} className="glass-card" style={{ padding: "16px 20px" }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)", margin: 0 }}>{item.label}</p>
            <p style={{ fontSize: 22, fontWeight: 600, fontFamily: "var(--font-mono)", color: item.color, margin: "6px 0 0" }}>
              {loading ? "—" : fmt(item.value)}
            </p>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          Token 体检
        </div>
        <div className="glass-card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>动态检查</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                找出高消耗项
              </div>
            </div>
            <AppButton onClick={runCheck} disabled={checking} size="sm">
              {checking ? "检查中…" : "开始检查"}
            </AppButton>
          </div>

          {optimizationMessage && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {optimizationMessage}
            </div>
          )}

          {optimization && optimization.findings.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {optimization.findings.map((finding) => {
                const currentTone = tone(finding.level);
                return (
                  <div
                    key={finding.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      padding: "14px 16px",
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.58)",
                      border: "1px solid var(--card-border)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{finding.title}</div>
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 600,
                              ...currentTone,
                            }}
                          >
                            建议处理
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{finding.summary}</div>
                        {finding.detail && (
                          <div style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.6 }}>
                            {finding.detail}
                          </div>
                        )}
                      </div>
                      {finding.actions.length > 0 && (
                        <div style={{ display: "flex", flexShrink: 0, gap: 6, alignItems: "flex-start" }}>
                          {finding.actions.map((action) => {
                            const currentActionKey = `${finding.id}:${action.id}`;
                            return (
                              <AppButton
                                key={currentActionKey}
                                onClick={() => runAction(finding.id, action)}
                                disabled={actionKey === currentActionKey}
                                size="sm"
                              >
                                {actionKey === currentActionKey ? "处理中…" : action.label}
                              </AppButton>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {optimization && optimization.findings.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              当前没有检测到明显的 Token 浪费项。
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          趋势
        </div>
        <div className="glass-card" style={{ padding: "20px 24px" }}>
          {loading ? (
            <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--text-tertiary)" }}>
              加载中…
            </div>
          ) : !hasData ? (
            <div style={{ height: 220, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
              <BarChart3 size={36} style={{ color: "var(--text-tertiary)", opacity: 0.4 }} />
              <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0 }}>
                当前日志中没有可解析的 Tokens 数据
              </p>
              <p style={{ fontSize: 12, opacity: 0.6, color: "var(--text-tertiary)", margin: 0 }}>
                扫描本机日志和会话
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
                <Line type="monotone" dataKey="Input" stroke="var(--accent-blue)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="Output" stroke="var(--accent-purple)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          模型明细
        </div>
        <div className="glass-card" style={{ padding: "8px 0" }}>
          {!loading && models.length === 0 ? (
            <div style={{ padding: "20px 24px", fontSize: 13, color: "var(--text-tertiary)" }}>
              暂时还没有可解析的模型记录
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 0.75fr) minmax(0, 0.75fr) minmax(0, 0.75fr) minmax(0, 0.55fr)",
                  gap: 12,
                  padding: "10px 24px 8px",
                  borderBottom: "1px solid var(--card-border)",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  color: "var(--text-tertiary)",
                }}
              >
                <div>模型</div>
                <div style={{ textAlign: "right" }}>Input</div>
                <div style={{ textAlign: "right" }}>Output</div>
                <div style={{ textAlign: "right" }}>缓存</div>
                <div style={{ textAlign: "right" }}>调用</div>
              </div>
              {models.slice(0, 8).map((item, index) => (
                <div
                  key={`${item.provider}-${item.model}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 0.75fr) minmax(0, 0.75fr) minmax(0, 0.75fr) minmax(0, 0.55fr)",
                    gap: 12,
                    padding: "14px 24px",
                    alignItems: "center",
                    borderTop: index === 0 ? "none" : "1px solid var(--card-border)",
                  }}
                >
                  <div style={{ minWidth: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                    {modelLabel(item.provider, item.model)}
                  </div>
                  <div style={{ textAlign: "right", minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                    {fmt(item.input_tokens)}
                  </div>
                  <div style={{ textAlign: "right", minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                    {fmt(item.output_tokens)}
                  </div>
                  <div style={{ textAlign: "right", minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                    {fmt(item.cache_read_tokens + item.cache_write_tokens)}
                  </div>
                  <div style={{ textAlign: "right", minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                    {fmt(item.calls)}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          最近调用
        </div>
        <div className="glass-card" style={{ padding: "8px 0" }}>
          {!loading && recent.length === 0 ? (
            <div style={{ padding: "20px 24px", fontSize: 13, color: "var(--text-tertiary)" }}>
              还没有最近调用记录
            </div>
          ) : (
            recent.slice(0, 8).map((item, index) => (
              <div
                key={`${item.timestamp}-${item.session}-${index}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 0.8fr) minmax(0, 0.8fr)",
                  gap: 12,
                  padding: "16px 24px",
                  alignItems: "center",
                  borderTop: index === 0 ? "none" : "1px solid var(--card-border)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{shortTime(item.timestamp)}</div>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>{item.session}</div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    {modelLabel(item.provider, item.model)}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Input / Output</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                    {fmt(item.input_tokens)} / {fmt(item.output_tokens)}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>总计</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                    {fmt(item.total_tokens)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <TerminalOverlay
        title={overlayTitle}
        lines={overlayLines}
        open={overlayOpen}
        done={overlayDone}
        onClose={() => setOverlayOpen(false)}
      />
    </div>
  );
}
