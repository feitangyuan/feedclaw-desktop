import { useCallback, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Wrench,
  XCircle,
} from "lucide-react";
import { AppButton } from "@/components/AppButton";
import {
  disableFeishuDocTool,
  disableMemorySearch,
  diagnoseRuntime,
  lockPluginAllowlist,
  quarantineWorkspacePrompts,
  repairGatewayService,
  resetFeishuSessions,
  restartGateway,
  runFullDiagnosis,
  runFullFix,
  startGateway,
  tightenStatePermissions,
  type DoctorAction,
  type DoctorReport,
} from "@/lib/tauri";
import { TerminalOverlay } from "@/components/TerminalOverlay";
import type { Page } from "@/components/Sidebar";

interface DiagnosisPageProps {
  onNavigate: (page: Page) => void;
}

type DoctorLevel = DoctorReport["level"];

interface DiagnosisPageCache {
  report: DoctorReport | null;
}

let diagnosisPageCache: DiagnosisPageCache | null = null;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
      }}
    >
      {children}
    </div>
  );
}

function doctorTone(level: DoctorLevel) {
  if (level === "error") {
    return {
      color: "var(--accent-red)",
      background: "rgba(255, 59, 48, 0.10)",
      border: "1px solid rgba(255, 59, 48, 0.18)",
    };
  }

  if (level === "warn") {
    return {
      color: "var(--accent-orange)",
      background: "rgba(255, 149, 0, 0.10)",
      border: "1px solid rgba(255, 149, 0, 0.18)",
    };
  }

  if (level === "info") {
    return {
      color: "var(--accent-blue)",
      background: "rgba(10, 132, 255, 0.10)",
      border: "1px solid rgba(10, 132, 255, 0.18)",
    };
  }

  return {
    color: "var(--accent-green)",
    background: "rgba(52, 199, 89, 0.10)",
    border: "1px solid rgba(52, 199, 89, 0.18)",
  };
}

function DoctorLevelIcon({ level }: { level: DoctorLevel }) {
  if (level === "error") {
    return <XCircle size={16} style={{ color: "var(--accent-red)", flexShrink: 0 }} />;
  }

  if (level === "warn") {
    return <AlertTriangle size={16} style={{ color: "var(--accent-orange)", flexShrink: 0 }} />;
  }

  if (level === "info") {
    return <Info size={16} style={{ color: "var(--accent-blue)", flexShrink: 0 }} />;
  }

  return <CheckCircle2 size={16} style={{ color: "var(--accent-green)", flexShrink: 0 }} />;
}

export function DiagnosisPage({ onNavigate }: DiagnosisPageProps) {
  const [diagnosing, setDiagnosing] = useState(false);
  const [report, setReport] = useState<DoctorReport | null>(() => diagnosisPageCache?.report ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [doctorDone, setDoctorDone] = useState(false);
  const [doctorLines, setDoctorLines] = useState<string[]>([]);
  const [doctorTitle, setDoctorTitle] = useState("详细诊断");
  const runDiagnosis = useCallback(async () => {
    setDiagnosing(true);
    setMessage(null);
    try {
      const next = await diagnoseRuntime();
      setReport(next);
      diagnosisPageCache = { report: next };
    } catch (error) {
      setMessage(`诊断失败：${String(error)}`);
    } finally {
      setDiagnosing(false);
    }
  }, []);

  const runDoctorFixWithOverlay = useCallback(async (title: string, seedLines: string[] = []) => {
    setDoctorTitle(title);
    setDoctorLines(seedLines);
    setDoctorDone(false);
    setDoctorOpen(true);

    await new Promise<void>((resolve, reject) => {
      runFullFix(
        (line) => setDoctorLines((prev) => [...prev, line]),
        () => {
          setDoctorDone(true);
          resolve();
        },
        (error) => {
          setDoctorLines((prev) => [...prev, `处理失败：${String(error)}`]);
          setDoctorDone(true);
          reject(error);
        }
      );
    });
  }, []);

  const runDiagnosisWithOverlay = useCallback(async () => {
    setDoctorTitle("检查过程");
    setDoctorLines(["➜ 已开始完整检查"]);
    setDoctorDone(false);
    setDoctorOpen(true);

    await new Promise<void>((resolve, reject) => {
      runFullDiagnosis(
        (line) => setDoctorLines((prev) => [...prev, line]),
        () => {
          setDoctorDone(true);
          resolve();
        },
        (error) => {
          setDoctorLines((prev) => [...prev, `检查失败：${String(error)}`]);
          setDoctorDone(true);
          reject(error);
        }
      );
    });
  }, []);

  const handleAction = useCallback(
    async (itemId: string, action: DoctorAction) => {
      setMessage(null);

      if (action.id === "goConfig") {
        onNavigate("config");
        return;
      }

      if (action.id === "goFeishu") {
        onNavigate("feishu");
        return;
      }

      if (action.id === "installOpenclaw") {
        onNavigate("status");
        return;
      }

      const nextActionKey = `${itemId}:${action.id}`;
      setActionKey(nextActionKey);
      try {
        let nextMessage = "";

        if (action.id === "startGateway") {
          await startGateway();
          nextMessage = "网关已尝试启动。";
        } else if (action.id === "restartGateway") {
          await restartGateway();
          nextMessage = "网关已重启。";
        } else if (action.id === "tightenStatePermissions") {
          nextMessage = await tightenStatePermissions();
        } else if (action.id === "repairGatewayService") {
          nextMessage = await repairGatewayService();
        } else if (action.id === "disableFeishuDocTool") {
          nextMessage = await disableFeishuDocTool();
        } else if (action.id === "lockPluginAllowlist") {
          nextMessage = await lockPluginAllowlist();
        } else if (action.id === "disableMemorySearch") {
          nextMessage = await disableMemorySearch();
        } else if (action.id === "officialFix") {
          await runDoctorFixWithOverlay("详细修复");
          nextMessage = "已尝试执行自动修复。";
        } else if (action.id === "resetFeishuSessions") {
          nextMessage = await resetFeishuSessions();
        } else if (action.id === "quarantineWorkspacePrompts") {
          nextMessage = await quarantineWorkspacePrompts();
        }

        if (nextMessage) {
          setMessage(nextMessage);
        }

        await runDiagnosis();
      } catch (error) {
        setMessage(`处理失败：${String(error)}`);
      } finally {
        setActionKey(null);
      }
    },
    [onNavigate, runDiagnosis, runDoctorFixWithOverlay]
  );

  const handleFullCheck = useCallback(async () => {
    setDiagnosing(true);
    setMessage(null);

    try {
      await runDiagnosisWithOverlay();
      await runDiagnosis();
      setMessage("检查完成。下面是当前发现的问题和可处理项。");
    } catch (error) {
      setMessage(`检查失败：${String(error)}`);
    } finally {
      setDiagnosing(false);
    }
  }, [runDiagnosis, runDiagnosisWithOverlay]);

  return (
    <div
      style={{
        padding: "48px 40px 60px",
        maxWidth: 720,
        width: "100%",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <h1
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: "var(--text-primary)",
          letterSpacing: "-0.01em",
          margin: 0,
        }}
      >
        治疗龙虾
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionLabel>当前结论</SectionLabel>
        <div className="glass-card" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                {report?.title ?? "还没有开始检查"}
              </div>
              <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                {report?.summary ?? "点开始检查"}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
              <AppButton onClick={() => void handleFullCheck()} disabled={diagnosing} tone="blue" size="sm">
                {diagnosing ? "检查中…" : "开始检查"}
              </AppButton>
            </div>
          </div>

          {message && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "rgba(10, 132, 255, 0.10)",
                border: "1px solid rgba(10, 132, 255, 0.18)",
                color: "var(--accent-blue)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              {message}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionLabel>检查项</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {report?.findings.map((item) => {
            const tone = doctorTone(item.level);

            return (
              <div
                key={item.id}
                className="glass-card"
                style={{
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <DoctorLevelIcon level={item.level} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{item.title}</div>
                      <div style={{ fontSize: 12, lineHeight: 1.6, marginTop: 4, color: "var(--text-secondary)" }}>
                        {item.summary}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      ...tone,
                    }}
                  >
                    {item.level === "error"
                      ? "需处理"
                      : item.level === "warn"
                        ? "建议处理"
                        : item.level === "info"
                          ? "可选"
                          : "正常"}
                  </div>
                </div>

                {item.detail && (
                  <div
                    style={{
                      fontSize: 12,
                      lineHeight: 1.6,
                      color: "var(--text-secondary)",
                      paddingLeft: 26,
                      whiteSpace: "pre-line",
                    }}
                  >
                    {item.detail}
                  </div>
                )}

                {item.actions.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingLeft: 26 }}>
                    {item.actions.map((action) => {
                      const nextActionKey = `${item.id}:${action.id}`;

                      return (
                        <AppButton
                          key={nextActionKey}
                          onClick={() => void handleAction(item.id, action)}
                          disabled={actionKey === nextActionKey}
                          tone={action.id === "quarantineWorkspacePrompts" ? "redSubtle" : "blue"}
                          size="sm"
                        >
                          {action.id === "quarantineWorkspacePrompts" && <Wrench size={12} />}
                          {actionKey === nextActionKey ? "处理中…" : action.label}
                        </AppButton>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {!report && !diagnosing && (
            <div className="glass-card" style={{ padding: "16px 20px", fontSize: 13, color: "var(--text-secondary)" }}>
              还没有结果
            </div>
          )}
        </div>
      </div>

      <TerminalOverlay
        title={doctorTitle}
        lines={doctorLines}
        open={doctorOpen}
        done={doctorDone}
        onClose={() => setDoctorOpen(false)}
      />
    </div>
  );
}
