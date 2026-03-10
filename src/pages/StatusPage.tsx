import { useState, useEffect, useCallback } from "react";
import {
  Play,
  Square,
  Download,
  Trash2,
  CheckCircle2,
  Circle,
  ArrowRightCircle,
} from "lucide-react";
import { AppButton } from "@/components/AppButton";
import { TerminalOverlay } from "@/components/TerminalOverlay";
import {
  getGatewayStatus,
  checkOpenclawInstalled,
  installOpenclaw,
  readConfig,
  readModelAuthStatus,
  startGateway,
  stopGateway,
  uninstallOpenclaw,
  type GatewayStatus,
  type InstallInfo,
  type ModelAuthStatus,
  type OpenClawConfig,
  updateOpenclaw,
} from "@/lib/tauri";
import type { Page } from "@/components/Sidebar";

interface StatusPageProps {
  onNavigate: (page: Page) => void;
}

interface StatusPageCache {
  status: GatewayStatus | null;
  info: InstallInfo | null;
  config: OpenClawConfig;
  modelAuth: ModelAuthStatus | null;
}

let statusPageCache: StatusPageCache | null = null;

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

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: "var(--text-primary)" }}>{children}</div>
    </div>
  );
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

type FlowState = "done" | "current" | "pending";

interface FlowStep {
  key: string;
  title: string;
  detail: string;
  state: FlowState;
}

function FlowStepRow({ step, bordered = true }: { step: FlowStep; bordered?: boolean }) {
  const tone =
    step.state === "done"
      ? "var(--accent-green)"
      : step.state === "current"
        ? "var(--accent-blue)"
        : "var(--text-tertiary)";

  const Icon =
    step.state === "done"
      ? CheckCircle2
      : step.state === "current"
        ? ArrowRightCircle
        : Circle;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        padding: "10px 0",
        borderBottom: bordered ? "1px solid var(--card-border)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Icon size={16} style={{ color: tone, marginTop: 2, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{step.title}</div>
          <div style={{ fontSize: 12, marginTop: 4, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {step.detail}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: tone, whiteSpace: "nowrap" }}>
        {step.state === "done" ? "已完成" : step.state === "current" ? "进行中" : "待完成"}
      </div>
    </div>
  );
}

export function StatusPage({ onNavigate }: StatusPageProps) {
  const [status, setStatus] = useState<GatewayStatus | null>(() => statusPageCache?.status ?? null);
  const [info, setInfo] = useState<InstallInfo | null>(() => statusPageCache?.info ?? null);
  const [config, setConfig] = useState<OpenClawConfig>(() => statusPageCache?.config ?? {});
  const [modelAuth, setModelAuth] = useState<ModelAuthStatus | null>(() => statusPageCache?.modelAuth ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(Boolean(statusPageCache));
  const [installing, setInstalling] = useState(false);
  const [installLines, setInstallLines] = useState<string[]>([]);
  const [installDone, setInstallDone] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateLines, setUpdateLines] = useState<string[]>([]);
  const [updateDone, setUpdateDone] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallLines, setUninstallLines] = useState<string[]>([]);
  const [uninstallDone, setUninstallDone] = useState(false);

  const refresh = useCallback(async () => {
    const [gatewayResult, installResult, configResult, modelAuthResult] = await Promise.allSettled([
      getGatewayStatus(),
      checkOpenclawInstalled(),
      readConfig(),
      readModelAuthStatus(),
    ]);

    const installInfo =
      installResult.status === "fulfilled"
        ? installResult.value
        : { installed: false, version: null, path: null };

    const gatewayStatus =
      gatewayResult.status === "fulfilled"
        ? gatewayResult.value
        : { running: false, pid: null, message: "Gateway not running" };

    const currentConfig = configResult.status === "fulfilled" ? configResult.value : {};
    const nextModelAuth = modelAuthResult.status === "fulfilled" ? modelAuthResult.value : null;

    setStatus(gatewayStatus);
    setInfo(installInfo);
    setConfig(currentConfig);
    setModelAuth(nextModelAuth);
    statusPageCache = {
      status: gatewayStatus,
      info: installInfo,
      config: currentConfig,
      modelAuth: nextModelAuth,
    };
    setInitialized(true);

    const firstError = [gatewayResult, installResult, configResult, modelAuthResult].find(
      (result) => result.status === "rejected"
    );
    setError(firstError?.status === "rejected" ? String(firstError.reason) : null);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleStart = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await startGateway();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const handleStop = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await stopGateway();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const handleInstall = useCallback(() => {
    setInstalling(true);
    setInstallLines([]);
    setInstallDone(false);
    setError(null);
    installOpenclaw(
      (line) => setInstallLines((prev) => [...prev, line]),
      async (result) => {
        setInstallDone(true);
        if (result === "success") {
          await refresh();
        } else {
          setError("openclaw 安装失败");
        }
      }
    );
  }, [refresh]);

  const handleUpdate = useCallback(() => {
    setUpdating(true);
    setUpdateLines([]);
    setUpdateDone(false);
    setError(null);
    updateOpenclaw(
      (line) => setUpdateLines((prev) => [...prev, line]),
      async (result) => {
        setUpdateDone(true);
        if (result === "success") {
          await refresh();
        } else {
          setError("openclaw 更新失败");
        }
      }
    );
  }, [refresh]);

  const handleUninstall = useCallback(() => {
    setUninstalling(true);
    setUninstallLines([]);
    setUninstallDone(false);
    setError(null);
    uninstallOpenclaw(
      (line) => setUninstallLines((prev) => [...prev, line]),
      async (result) => {
        setUninstallDone(true);
        if (result === "success") {
          await refresh();
        } else {
          setError("openclaw 彻底卸载失败");
        }
      }
    );
  }, [refresh]);

  const isInstalled = info?.installed ?? false;
  const isRunning = status?.running ?? false;
  const modelConfigured = Boolean(modelAuth?.has_any_auth) || (hasText(config.provider) && hasText(config.api_key));
  const feishuConfigured = hasText(config.feishu_app_id) && hasText(config.feishu_app_secret);
  const gatewayReady = isInstalled && modelConfigured && feishuConfigured;
  const currentModel = modelAuth?.resolved_default ?? modelAuth?.default_model ?? null;
  const steps: FlowStep[] = [
    {
      key: "install",
      title: "安装 openclaw",
      detail: isInstalled ? "CLI 已安装并可被养养龙虾检测到。" : "先完成 CLI 安装，后续配置和网关才能工作。",
      state: isInstalled ? "done" : "current",
    },
    {
      key: "model",
      title: "连接模型",
      detail: modelConfigured
        ? currentModel
          ? `当前默认模型：${currentModel}`
          : "模型接入已就绪。"
        : "去模型接入页配置 API Key 或 OAuth。",
      state: modelConfigured ? "done" : isInstalled ? "current" : "pending",
    },
    {
      key: "feishu",
      title: "配置飞书",
      detail: feishuConfigured ? "飞书 App ID / Secret 已填写。" : "去飞书页填写 App ID、App Secret 和私信策略。",
      state: feishuConfigured ? "done" : isInstalled && modelConfigured ? "current" : "pending",
    },
    {
      key: "gateway",
      title: "启动网关",
      detail: isRunning ? "网关正在运行，飞书消息可以转发到 openclaw。" : "启动后飞书机器人才能真正在线工作。",
      state: isRunning ? "done" : gatewayReady ? "current" : "pending",
    },
  ];

  let nextStepTitle = "下一步";
  let nextStepDescription = "按顺序完成";
  let nextStepAction: React.ReactNode = null;

  if (!isInstalled) {
    nextStepTitle = "下一步：安装 openclaw";
    nextStepDescription = "先装 CLI";
    nextStepAction = (
      <AppButton onClick={handleInstall} disabled={installing}>
        <Download size={14} />
        {installing ? "安装中…" : "一键安装 openclaw"}
      </AppButton>
    );
  } else if (!modelConfigured) {
    nextStepTitle = "下一步：连接模型";
    nextStepDescription = "去接入模型";
    nextStepAction = <AppButton onClick={() => onNavigate("config")}>去模型接入</AppButton>;
  } else if (!feishuConfigured) {
    nextStepTitle = "下一步：配置飞书";
    nextStepDescription = "去填飞书";
    nextStepAction = <AppButton onClick={() => onNavigate("feishu")}>去飞书</AppButton>;
  } else if (!isRunning) {
    nextStepTitle = "下一步：启动网关";
    nextStepDescription = "启动后才能在线";
    nextStepAction = (
      <AppButton onClick={handleStart} disabled={loading} tone="green">
        <Play size={14} />
        {loading ? "启动中…" : "启动网关"}
      </AppButton>
    );
  }

  if (!initialized) {
    return (
      <div
        style={{
          padding: "48px 40px 60px",
          maxWidth: 680,
          width: "100%",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 32,
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
          运行状态
        </h1>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionLabel>同步中</SectionLabel>
          <div className="glass-card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>正在读取本机状态…</div>
            <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6, color: "var(--text-secondary)" }}>
              正在同步状态
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "48px 48px 60px",
        maxWidth: 680,
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
        运行状态
      </h1>

      {info && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionLabel>安装状态</SectionLabel>
          <div
            className="glass-card"
            style={{
              padding: "18px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isInstalled ? "minmax(0, 1fr) minmax(0, 1fr) auto" : "minmax(0, 1fr) minmax(0, 1fr)",
                columnGap: 24,
                rowGap: 12,
                alignItems: "start",
              }}
            >
              <InfoRow label="状态">
                <span style={{ fontWeight: 600, color: isInstalled ? "var(--accent-green)" : "var(--accent-red)" }}>
                  {isInstalled ? "已安装" : "未找到"}
                </span>
              </InfoRow>
              <InfoRow label="版本">
                {info.version ? (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{info.version}</span>
                ) : (
                  <span style={{ color: "var(--text-tertiary)" }}>—</span>
                )}
              </InfoRow>
              {isInstalled && (
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", minHeight: 48 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <AppButton onClick={handleUpdate} disabled={updating || uninstalling} size="sm">
                      <Download size={12} />
                      {updating ? "更新中…" : "更新版本"}
                    </AppButton>
                    <AppButton onClick={handleUninstall} disabled={uninstalling || updating} tone="redSubtle" size="sm">
                      <Trash2 size={12} />
                      {uninstalling ? "卸载中…" : "彻底卸载"}
                    </AppButton>
                  </div>
                </div>
              )}
            </div>

            {info.path && (
              <div>
                <InfoRow label="路径">
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      wordBreak: "break-all",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {info.path}
                  </span>
                </InfoRow>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionLabel>当前进度</SectionLabel>
        <div className="glass-card" style={{ padding: "4px 20px" }}>
          {steps.map((step, index) => (
            <FlowStepRow key={step.key} step={step} bordered={index !== steps.length - 1} />
          ))}
        </div>
      </div>

      {!isRunning && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionLabel>下一步</SectionLabel>
          <div className="glass-card" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{nextStepTitle}</div>
              <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                {nextStepDescription}
              </div>
            </div>
            {nextStepAction}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionLabel>网关</SectionLabel>
        <div
          className="glass-card"
          style={{
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className={`status-dot ${loading ? "loading" : isRunning ? "running" : "stopped"}`} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                  {loading ? "处理中…" : isRunning ? "运行中" : "已停止"}
                </div>
                {status?.pid && isRunning && (
                  <div style={{ fontSize: 12, marginTop: 4, color: "var(--text-tertiary)" }}>PID {status.pid}</div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {isRunning ? (
                <AppButton onClick={handleStop} disabled={loading} tone="redSubtle" size="sm">
                  <Square size={12} />
                  停止
                </AppButton>
              ) : (
                <AppButton onClick={handleStart} disabled={loading || !gatewayReady} tone="green" size="sm">
                  <Play size={12} />
                  启动
                </AppButton>
              )}
            </div>
          </div>

          <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
            飞书机器人在线需要网关
          </div>

          {!gatewayReady && !isRunning && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "rgba(255, 149, 0, 0.10)",
                color: "var(--accent-orange)",
                fontSize: 12,
                border: "1px solid rgba(255, 149, 0, 0.18)",
              }}
            >
              先完成安装、模型接入和飞书
            </div>
          )}
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            fontSize: 13,
            background: "rgba(255, 59, 48, 0.1)",
            color: "var(--accent-red)",
            border: "1px solid rgba(255, 59, 48, 0.2)",
          }}
        >
          {error}
        </div>
      )}

      <TerminalOverlay
        title="installing openclaw"
        lines={installLines}
        open={installing}
        done={installDone}
        onClose={() => {
          if (installDone) {
            setInstalling(false);
          }
        }}
      />

      <TerminalOverlay
        title="updating openclaw"
        lines={updateLines}
        open={updating}
        done={updateDone}
        onClose={() => {
          if (updateDone) {
            setUpdating(false);
          }
        }}
      />

      <TerminalOverlay
        title="uninstalling openclaw"
        lines={uninstallLines}
        open={uninstalling}
        done={uninstallDone}
        onClose={() => {
          if (uninstallDone) {
            setUninstalling(false);
          }
        }}
      />
    </div>
  );
}
