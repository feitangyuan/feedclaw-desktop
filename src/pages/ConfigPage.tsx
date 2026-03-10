import { useState, useEffect, useCallback, useRef } from "react";
import { AppButton } from "@/components/AppButton";
import { TerminalOverlay } from "@/components/TerminalOverlay";
import {
  listProviderModels,
  readThinkingDefault,
  setThinkingDefault,
  switchActiveModel,
  loginModelOauth,
  readConfig,
  readModelAuthStatus,
  resetApiRuntime,
  writeConfig,
  type ConfiguredModel,
  type ModelAuthStatus,
  type OpenClawConfig,
} from "@/lib/tauri";

const PROVIDERS = [
  { value: "kimi",      label: "Kimi Code (Moonshot)" },
  { value: "moonshot",  label: "Moonshot AI" },
  { value: "minimax",   label: "MiniMax" },
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai",    label: "OpenAI" },
];

const headerButtonStyle = {
  minWidth: 96,
};

const THINKING_OPTIONS = [
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
];

function versionWeight(key: string) {
  const match = key.match(/gpt-(\d+)(?:\.(\d+))?/i);
  if (!match) {
    return 0;
  }

  const major = Number(match[1] ?? 0);
  const minor = Number(match[2] ?? 0);
  return major * 100 + minor;
}

function preferModernOpenAiModels(
  models: ConfiguredModel[],
  configuredModels: ConfiguredModel[],
  currentKey?: string | null
) {
  const openaiModels = models.filter((model) => model.provider === "openai-codex");
  const configuredOpenAiModels = configuredModels.filter((model) => model.provider === "openai-codex");
  const normalizedCurrent = currentKey?.startsWith("openai-codex/") ? currentKey : null;
  const withCurrent = [...openaiModels];

  for (const model of configuredOpenAiModels) {
    if (!withCurrent.some((item) => item.key === model.key)) {
      withCurrent.push(model);
    }
  }

  if (normalizedCurrent && !withCurrent.some((model) => model.key === normalizedCurrent)) {
    withCurrent.unshift({
      key: normalizedCurrent,
      name: normalizedCurrent.split("/").pop()?.toUpperCase() ?? normalizedCurrent,
      provider: "openai-codex",
      is_default: true,
    });
  }

  const filtered = withCurrent.filter((model) => {
    if (model.key === normalizedCurrent) {
      return true;
    }
    return versionWeight(model.key) >= 503;
  });

  const deduped = new Map<string, ConfiguredModel>();
  for (const model of filtered) {
    deduped.set(model.key, model);
  }

  return Array.from(deduped.values()).sort((a, b) => {
    if (a.key === normalizedCurrent) return -1;
    if (b.key === normalizedCurrent) return 1;
    return versionWeight(b.key) - versionWeight(a.key);
  });
}

function currentCodexModelKey(authStatus: ModelAuthStatus | null) {
  if (!authStatus) {
    return null;
  }

  const current = authStatus.resolved_default ?? authStatus.default_model ?? null;
  if (current?.startsWith("openai-codex/")) {
    return current;
  }

  return authStatus.models.find((item) => item.provider === "openai-codex")?.key ?? null;
}

function providerLabel(provider: string) {
  switch (provider) {
    case "openai-codex":
      return "OpenAI Codex";
    case "kimi-coding":
    case "kimi":
      return "Kimi";
    case "moonshot":
      return "Moonshot";
    case "minimax":
      return "MiniMax";
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    default:
      return provider;
  }
}

function providerRouteModel(
  authStatus: ModelAuthStatus | null,
  provider: string,
  selectedOauthModel: string
) {
  if (!authStatus) {
    return "";
  }

  if (provider === "openai-codex") {
    return (selectedOauthModel.startsWith("openai-codex/") ? selectedOauthModel : "")
      || authStatus.models.find((item) => item.provider === "openai-codex")?.key
      || "";
  }

  return authStatus.models.find((item) => item.provider === provider)?.key || "";
}

function authTypeLabel(type: string) {
  switch (type) {
    case "oauth":
      return "OAuth";
    case "api_key":
      return "API Key";
    case "token":
      return "Token";
    default:
      return "已接入";
  }
}

function currentStatusSummary(authStatus: ModelAuthStatus | null) {
  if (!authStatus) {
    return "正在读取本机模型状态…";
  }

  const current = authStatus.current_provider
    ? authStatus.providers.find((item) => item.provider === authStatus.current_provider) ?? null
    : null;
  if (current) {
    const model = authStatus.resolved_default ?? authStatus.default_model;
    if (model) {
      return `${providerLabel(current.provider)} · ${authTypeLabel(current.auth_type)} · ${model}`;
    }
    return `${providerLabel(current.provider)} · ${authTypeLabel(current.auth_type)}`;
  }

  if (authStatus.codex_cli_auth_detected) {
    return "已检测到本机 Codex 登录";
  }

  return "还没接入模型";
}

function SummaryCard({ value }: { value: string }) {
  return (
    <div className="glass-card" style={{ padding: "18px 20px" }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)", marginBottom: 6 }}>
        当前状态
      </div>
      <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.6 }}>
        {value}
      </div>
    </div>
  );
}

function CardTitle({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        padding: "16px 20px",
        borderBottom: "1px solid var(--card-border)",
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5 }}>
          {description}
        </div>
      </div>
      {action}
    </div>
  );
}

export function ConfigPage() {
  const [config, setConfig] = useState<OpenClawConfig>({});
  const [authStatus, setAuthStatus] = useState<ModelAuthStatus | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [resetLines, setResetLines] = useState<string[]>([]);
  const [oauthing, setOauthing] = useState(false);
  const [oauthHint, setOauthHint] = useState<string | null>(null);
  const [oauthModels, setOauthModels] = useState<ConfiguredModel[]>([]);
  const [selectedOauthModel, setSelectedOauthModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState("low");
  const [updatingThinking, setUpdatingThinking] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [switchModelDone, setSwitchModelDone] = useState(false);
  const [switchModelLines, setSwitchModelLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextConfig, nextAuthStatus] = await Promise.all([
      readConfig(),
      readModelAuthStatus(),
    ]);
    setConfig(nextConfig);
    setAuthStatus(nextAuthStatus);
    setError(null);
    lastSavedSignatureRef.current = JSON.stringify({
      provider: nextConfig.provider ?? "",
      api_key: nextConfig.api_key ?? "",
    });
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  useEffect(() => {
    readThinkingDefault()
      .then((value) => {
        setThinkingLevel(value ?? "low");
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!authStatus?.openai_codex_logged_in) {
      setOauthModels([]);
      setSelectedOauthModel("");
      return;
    }

    listProviderModels("openai-codex")
      .then((models) => {
        const normalized = preferModernOpenAiModels(
          models,
          authStatus?.models ?? [],
          currentCodexModelKey(authStatus)
        );
        setOauthModels(normalized);
        const current = normalized.find((item) => item.is_default)?.key ?? normalized[0]?.key ?? "";
        setSelectedOauthModel(current);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [authStatus?.openai_codex_logged_in, authStatus?.resolved_default, authStatus?.default_model]);

  useEffect(() => {
    if (lastSavedSignatureRef.current === null) {
      return;
    }

    const nextSignature = JSON.stringify({
      provider: config.provider ?? "",
      api_key: config.api_key ?? "",
    });

    if (nextSignature === lastSavedSignatureRef.current) {
      return;
    }

    const timer = window.setTimeout(async () => {
      setSaving(true);
      setError(null);
      try {
        await writeConfig(config);
        lastSavedSignatureRef.current = nextSignature;
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(false);
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [config.provider, config.api_key, config, refresh]);

  const handleResetApi = () => {
    setResetting(true);
    setResetDone(false);
    setResetLines([]);
    setError(null);
    resetApiRuntime(
      (line) => setResetLines((prev) => [...prev, line]),
      async (result) => {
        setResetDone(true);
        if (result !== "success") {
          setError("API 重置失败");
          return;
        }
        try {
          await refresh();
        } catch (e) {
          setError(String(e));
        }
      }
    );
  };

  const handleOauthLogin = () => {
    setOauthing(true);
    setOauthHint(null);
    setError(null);
    loginModelOauth(
      "openai-codex",
      (line) => {
        if (line) {
          setOauthHint(line);
        }
      },
      async (result) => {
        setOauthing(false);
        if (result !== "success") {
          setError("OAuth 登录失败");
          return;
        }
        setOauthHint("已打开 Terminal。请在终端里完成 OAuth 登录，完成后回到养养龙虾即可。");
        try {
          await refresh();
        } catch (e) {
          setError(String(e));
        }
      }
    );
  };

  const handleSwitchModel = (model: string) => {
    setSwitchingModel(true);
    setSwitchModelDone(false);
    setSwitchModelLines([]);
    setError(null);
    switchActiveModel(
      model,
      (line) => setSwitchModelLines((prev) => [...prev, line]),
      async (result) => {
        setSwitchModelDone(true);
        if (result !== "success") {
          setError("模型切换失败");
          return;
        }
        try {
          await refresh();
        } catch (e) {
          setError(String(e));
        }
      }
    );
  };

  const handleSwitchOauthModel = () => {
    if (!selectedOauthModel) {
      return;
    }
    handleSwitchModel(selectedOauthModel);
  };

  const handleThinkingChange = async (level: string) => {
    setThinkingLevel(level);
    setUpdatingThinking(true);
    setError(null);
    try {
      await setThinkingDefault(level);
    } catch (e) {
      setError(String(e));
    } finally {
      setUpdatingThinking(false);
    }
  };

  const set = (k: keyof OpenClawConfig, v: string) =>
    setConfig((prev) => ({ ...prev, [k]: v }));

  return (
    <div
      style={{
        padding: "48px 40px 60px",
        maxWidth: 680,
        width: "100%",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em", margin: 0 }}>
          模型接入
        </h1>
      </div>

      <SummaryCard value={currentStatusSummary(authStatus)} />

      {authStatus && authStatus.providers.length > 1 && (
        <div className="glass-card" style={{ display: "flex", flexDirection: "column" }}>
          <CardTitle
            title="已接入方式"
            description="切当前接入路线"
          />
          <div style={{ display: "flex", flexDirection: "column", padding: "0 20px" }}>
            {authStatus.providers.map((provider, index) => {
              const isCurrent = authStatus.current_provider === provider.provider;
              const targetModel = providerRouteModel(authStatus, provider.provider, selectedOauthModel);
              return (
              <div
                key={provider.provider}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "14px 0",
                  borderBottom: index === authStatus.providers.length - 1 ? "none" : "1px solid var(--card-border)",
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                    {providerLabel(provider.provider)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                    {provider.provider === "openai-codex"
                      ? (currentCodexModelKey(authStatus) || "OpenAI 模型")
                      : (authStatus.models.find((item) => item.provider === provider.provider)?.key || authTypeLabel(provider.auth_type))}
                  </div>
                </div>
                {isCurrent ? (
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent-green)" }}>当前</div>
                ) : (
                  <AppButton
                    onClick={() => handleSwitchModel(targetModel)}
                    disabled={switchingModel || saving || resetting || oauthing || !targetModel}
                    tone="secondary"
                    size="sm"
                  >
                    切换
                  </AppButton>
                )}
              </div>
            )})}
          </div>
        </div>
      )}

      <div className="glass-card" style={{ display: "flex", flexDirection: "column" }}>
        <CardTitle
          title="API Key"
          description="Kimi / Moonshot / MiniMax"
          action={
            <AppButton
              onClick={handleResetApi}
              disabled={resetting || saving || oauthing}
              tone="secondary"
              size="md"
              style={headerButtonStyle}
            >
              {resetting ? "重置中..." : "重置 API"}
            </AppButton>
          }
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--card-border)" }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
            提供商
          </label>
          <div style={{ position: "relative" }}>
            <select
              value={config.provider ?? ""}
              onChange={(e) => set("provider", e.target.value)}
              style={{
                width: 280,
                padding: "6px 28px 6px 12px",
                borderRadius: 8,
                fontSize: 13,
                background: "var(--card-bg)",
                border: "none",
                color: "var(--text-primary)",
                outline: "none",
                cursor: "pointer",
                appearance: "none",
                boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)",
                textAlign: "right",
              }}
            >
              <option value="" disabled>选择提供商</option>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-tertiary)", pointerEvents: "none" }}>▾</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px" }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
            API 密钥
          </label>
          <div style={{ position: "relative", width: 280 }}>
            <input
              type={showKey ? "text" : "password"}
              value={config.api_key ?? ""}
              onChange={(e) => set("api_key", e.target.value)}
              placeholder="sk-..."
              style={{
                width: "100%",
                padding: "6px 50px 6px 12px",
                borderRadius: 8,
                fontSize: 13,
                background: "var(--card-bg)",
                border: "none",
                color: "var(--text-primary)",
                outline: "none",
                fontFamily: "var(--font-mono)",
                boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)",
                textAlign: "right",
              }}
            />
            <button
              onClick={() => setShowKey((prev) => !prev)}
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 12,
                color: "var(--text-secondary)",
                cursor: "pointer",
                background: "none",
                border: "none",
                padding: 4,
              }}
            >
              {showKey ? "隐藏" : "显示"}
            </button>
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ display: "flex", flexDirection: "column" }}>
        <CardTitle
          title="OAuth"
          description="OpenAI Codex / GPT"
          action={
            <AppButton
              onClick={handleOauthLogin}
              disabled={oauthing || saving || resetting}
              tone={authStatus?.openai_codex_logged_in ? "green" : "blue"}
              size="md"
              style={headerButtonStyle}
            >
              {oauthing ? "登录中..." : authStatus?.openai_codex_logged_in ? "重新登录" : "OAuth 登录"}
            </AppButton>
          }
        />

        <div style={{ display: "grid", gap: 16, padding: "16px 20px" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)", marginBottom: 4 }}>
              服务
            </div>
            <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5 }}>OpenAI Codex</div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)", marginBottom: 4 }}>
              状态
            </div>
            <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5 }}>
              {authStatus?.openai_codex_logged_in ? "已登录到 openclaw" : "还没接入到 openclaw"}
            </div>
          </div>
          {authStatus?.codex_cli_auth_detected && !authStatus?.openai_codex_logged_in && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)", marginBottom: 4 }}>
                本机提示
              </div>
              <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5 }}>
                已检测到本机 Codex 登录。直接点 OAuth 登录即可继续接入。
              </div>
            </div>
          )}
          {authStatus?.openai_codex_logged_in && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)", marginBottom: 4 }}>
                  思考强度
                </div>
                <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5 }}>
                  默认 thinking level
                </div>
              </div>
              <div style={{ position: "relative" }}>
                <select
                  value={thinkingLevel}
                  onChange={(e) => void handleThinkingChange(e.target.value)}
                  disabled={updatingThinking}
                  style={{
                    width: 160,
                    padding: "6px 28px 6px 12px",
                    borderRadius: 8,
                    fontSize: 13,
                    background: "var(--card-bg)",
                    border: "none",
                    color: "var(--text-primary)",
                    outline: "none",
                    cursor: "pointer",
                    appearance: "none",
                    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)",
                  }}
                >
                  {THINKING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-tertiary)", pointerEvents: "none" }}>▾</span>
              </div>
            </div>
          )}
          {authStatus?.openai_codex_logged_in && oauthModels.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)", marginBottom: 4 }}>
                    切换 OpenAI 模型
                  </div>
                  <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5 }}>
                    直接切 GPT
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ position: "relative" }}>
                    <select
                      value={selectedOauthModel}
                      onChange={(e) => setSelectedOauthModel(e.target.value)}
                      style={{
                        width: 240,
                        padding: "6px 28px 6px 12px",
                        borderRadius: 8,
                        fontSize: 13,
                        background: "var(--card-bg)",
                        border: "none",
                        color: "var(--text-primary)",
                        outline: "none",
                        cursor: "pointer",
                        appearance: "none",
                        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)",
                      }}
                    >
                      {oauthModels.map((model) => (
                        <option key={model.key} value={model.key}>
                          {model.name} · {model.key}
                        </option>
                      ))}
                    </select>
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-tertiary)", pointerEvents: "none" }}>▾</span>
                  </div>
                  <AppButton
                    onClick={handleSwitchOauthModel}
                    disabled={switchingModel || !selectedOauthModel}
                    tone="secondary"
                    size="sm"
                  >
                    切换
                  </AppButton>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {oauthHint && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            background: "rgba(52, 199, 89, 0.1)",
            color: "var(--accent-green)",
            border: "1px solid rgba(52, 199, 89, 0.18)",
          }}
        >
          {oauthHint}
        </div>
      )}

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, background: "rgba(255, 59, 48, 0.1)", color: "var(--accent-red)", border: "1px solid rgba(255, 59, 48, 0.2)" }}>
          {error}
        </div>
      )}

      <TerminalOverlay
        title="resetting api"
        lines={resetLines}
        open={resetting}
        done={resetDone}
        onClose={() => {
          if (resetDone) {
            setResetting(false);
          }
        }}
      />

      <TerminalOverlay
        title="switching model"
        lines={switchModelLines}
        open={switchingModel}
        done={switchModelDone}
        onClose={() => {
          if (switchModelDone) {
            setSwitchingModel(false);
          }
        }}
      />
    </div>
  );
}
