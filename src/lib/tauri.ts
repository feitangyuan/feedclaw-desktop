import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ──────────────────────────────────────────────

export interface GatewayStatus {
  running: boolean;
  pid: number | null;
  message: string;
}

export interface DoctorAction {
  id: string;
  label: string;
}

export interface DoctorFinding {
  id: string;
  level: "ok" | "info" | "warn" | "error";
  title: string;
  summary: string;
  detail: string | null;
  actions: DoctorAction[];
}

export interface DoctorReport {
  level: "ok" | "info" | "warn" | "error";
  title: string;
  summary: string;
  findings: DoctorFinding[];
}

export interface InstallInfo {
  installed: boolean;
  version: string | null;
  path: string | null;
}

export interface OpenClawConfig {
  provider?: string;
  api_key?: string;
  feishu_app_id?: string;
  feishu_app_secret?: string;
  dm_policy?: string;
  [key: string]: unknown;
}

export interface ModelAuthProviderStatus {
  provider: string;
  auth_type: string;
  status: string;
  profile_count: number;
}

export interface ConfiguredModel {
  key: string;
  name: string;
  provider: string;
  is_default: boolean;
}

export interface ModelAuthStatus {
  default_model?: string | null;
  resolved_default?: string | null;
  current_provider?: string | null;
  has_any_auth: boolean;
  has_api_key: boolean;
  has_oauth: boolean;
  openai_codex_logged_in: boolean;
  codex_cli_auth_detected: boolean;
  providers: ModelAuthProviderStatus[];
  models: ConfiguredModel[];
}

export interface PairingRequest {
  id: string;
  code: string;
  created_at: string;
  last_seen_at: string;
}

export interface DayUsage {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface ModelUsage {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  calls: number;
}

export interface TokenEvent {
  timestamp: string;
  provider: string;
  model: string;
  session: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
}

export interface TokenUsageReport {
  days: DayUsage[];
  models: ModelUsage[];
  recent: TokenEvent[];
}

export interface TokenOptimizationAction {
  id: string;
  label: string;
  payload?: string | null;
}

export interface TokenOptimizationFinding {
  id: string;
  level: "info" | "warn" | "error" | "ok";
  title: string;
  summary: string;
  detail?: string | null;
  actions: TokenOptimizationAction[];
}

export interface TokenOptimizationReport {
  summary: string;
  findings: TokenOptimizationFinding[];
}

export interface AvailableSkill {
  name: string;
  description: string;
  emoji?: string | null;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  source: string;
  bundled: boolean;
  homepage?: string | null;
  missing: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
}

// ── Gateway ────────────────────────────────────────────

export const getGatewayStatus = () =>
  invoke<GatewayStatus>("get_gateway_status");

export const startGateway = () => invoke<void>("start_gateway");

export const stopGateway = () => invoke<void>("stop_gateway");

export const restartGateway = () => invoke<void>("restart_gateway");

export const disableMemorySearch = () => invoke<string>("disable_memory_search");
export const disableFeishuDocTool = () =>
  invoke<string>("disable_feishu_doc_tool");
export const lockPluginAllowlist = () =>
  invoke<string>("lock_plugin_allowlist");

export const tightenStatePermissions = () =>
  invoke<string>("tighten_state_permissions");

export const repairGatewayService = () =>
  invoke<string>("repair_gateway_service");

export const diagnoseRuntime = () => invoke<DoctorReport>("diagnose_runtime");

export const resetFeishuSessions = () => invoke<string>("reset_feishu_sessions");

export const quarantineWorkspacePrompts = () =>
  invoke<string>("quarantine_workspace_prompts");

export const runDoctor = (
  onLine: (line: string) => void,
  onDone: () => void,
  onError?: (error: unknown) => void
) => {
  const unlistenLine = listen<string>("doctor-output", (e) => onLine(e.payload));
  const unlistenDone = listen<void>("doctor-done", () => {
    onDone();
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("run_doctor").catch((error) => {
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
    onError?.(error);
    console.error(error);
  });
};

export const runDoctorFix = (
  onLine: (line: string) => void,
  onDone: () => void,
  onError?: (error: unknown) => void
) => {
  const unlistenLine = listen<string>("doctor-output", (e) => onLine(e.payload));
  const unlistenDone = listen<void>("doctor-done", () => {
    onDone();
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("run_doctor_fix").catch((error) => {
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
    onError?.(error);
    console.error(error);
  });
};

export const runFullDiagnosis = (
  onLine: (line: string) => void,
  onDone: () => void,
  onError?: (error: unknown) => void
) => {
  const unlistenLine = listen<string>("doctor-output", (e) => onLine(e.payload));
  const unlistenDone = listen<void>("doctor-done", () => {
    onDone();
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("run_full_diagnosis").catch((error) => {
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
    onError?.(error);
    console.error(error);
  });
};

export const runFullFix = (
  onLine: (line: string) => void,
  onDone: () => void,
  onError?: (error: unknown) => void
) => {
  const unlistenLine = listen<string>("doctor-output", (e) => onLine(e.payload));
  const unlistenDone = listen<void>("doctor-done", () => {
    onDone();
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("run_full_fix").catch((error) => {
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
    onError?.(error);
    console.error(error);
  });
};

// ── Install ────────────────────────────────────────────

export const checkOpenclawInstalled = () =>
  invoke<InstallInfo>("check_openclaw_installed");

export const installOpenclaw = (
  onLine: (line: string) => void,
  onDone: (result: string) => void
) => {
  const unlistenLine = listen<string>("install-output", (e) => onLine(e.payload));
  const unlistenDone = listen<string>("install-done", (e) => {
    onDone(e.payload);
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("install_openclaw").catch(console.error);
};

export const updateOpenclaw = (
  onLine: (line: string) => void,
  onDone: (result: string) => void
) => {
  const unlisten = listen<string>("update-output", (e) => onLine(e.payload));
  invoke("update_openclaw")
    .then(() => {
      onDone("success");
      return unlisten.then((f) => f());
    })
    .catch((error) => {
      onDone("failed");
      console.error(error);
      return unlisten.then((f) => f());
    });
};

export const uninstallOpenclaw = (
  onLine: (line: string) => void,
  onDone: (result: string) => void
) => {
  const unlistenLine = listen<string>("uninstall-output", (e) => onLine(e.payload));
  const unlistenDone = listen<string>("uninstall-done", (e) => {
    onDone(e.payload);
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("uninstall_openclaw").catch((error) => {
    console.error(error);
  });
};

export const resetApiRuntime = (
  onLine: (line: string) => void,
  onDone: (result: string) => void
) => {
  const unlistenLine = listen<string>("api-reset-output", (e) => onLine(e.payload));
  const unlistenDone = listen<string>("api-reset-done", (e) => {
    onDone(e.payload);
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("reset_api_runtime").catch((error) => {
    console.error(error);
  });
};

// ── Config ─────────────────────────────────────────────

export const readConfig = () => invoke<OpenClawConfig>("read_config");

export const readModelAuthStatus = () =>
  invoke<ModelAuthStatus>("read_model_auth_status");

export const listProviderModels = (provider: string) =>
  invoke<ConfiguredModel[]>("list_provider_models", { provider });

export const readThinkingDefault = () =>
  invoke<string | null>("read_thinking_default");

export const setThinkingDefault = (level: string) =>
  invoke<void>("set_thinking_default", { level });

export const writeConfig = (config: OpenClawConfig) =>
  invoke<void>("write_config", { config });

export const loginModelOauth = (
  provider: string,
  onLine: (line: string) => void,
  onDone: (result: string) => void
) => {
  const unlistenLine = listen<string>("oauth-output", (e) => onLine(e.payload));
  const unlistenDone = listen<string>("oauth-done", (e) => {
    onDone(e.payload);
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("login_model_oauth", { provider }).catch((error) => {
    onLine(String(error));
    onDone("error");
    console.error(error);
  });
};

export const switchActiveModel = (
  model: string,
  onLine: (line: string) => void,
  onDone: (result: string) => void
) => {
  const unlistenLine = listen<string>("model-switch-output", (e) => onLine(e.payload));
  const unlistenDone = listen<string>("model-switch-done", (e) => {
    onDone(e.payload);
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("switch_active_model", { model }).catch((error) => {
    onLine(String(error));
    onDone("error");
    console.error(error);
  });
};

// ── Skills ─────────────────────────────────────────────

export const getInstalledSkills = () =>
  invoke<string[]>("get_installed_skills");

export const listAvailableSkills = () =>
  invoke<AvailableSkill[]>("list_available_skills");

export const installSkill = (
  name: string,
  onLine: (line: string) => void,
  onDone: (result: [string, string]) => void
) => {
  const unlistenLine = listen<string>("skill-output", (e) => onLine(e.payload));
  const unlistenDone = listen<[string, string]>("skill-done", (e) => {
    onDone(e.payload);
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("install_skill", { name }).catch(console.error);
};

export const uninstallSkill = (
  name: string,
  onLine: (line: string) => void,
  onDone: (result: [string, string]) => void
) => {
  const unlistenLine = listen<string>("skill-output", (e) => onLine(e.payload));
  const unlistenDone = listen<[string, string]>("skill-done", (e) => {
    onDone(e.payload);
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("uninstall_skill", { name }).catch(console.error);
};

// ── Token Usage / Feishu ───────────────────────────────

export const getTokenUsage = (days: number) =>
  invoke<TokenUsageReport>("get_token_usage", { days });

export const getTokenOptimizationReport = (days: number) =>
  invoke<TokenOptimizationReport>("get_token_optimization_report", { days });

export const runTokenAudit = (
  days: number,
  onLine: (line: string) => void,
  onDone: () => void,
  onError?: (error: unknown) => void
) => {
  const unlistenLine = listen<string>("token-output", (e) => onLine(e.payload));
  const unlistenDone = listen<void>("token-done", () => {
    onDone();
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("run_token_audit", { days }).catch((error) => {
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
    onError?.(error);
    console.error(error);
  });
};

export const runTokenTreatment = (
  actionId: string,
  payload: string | null | undefined,
  onLine: (line: string) => void,
  onDone: () => void,
  onError?: (error: unknown) => void
) => {
  const unlistenLine = listen<string>("token-output", (e) => onLine(e.payload));
  const unlistenDone = listen<void>("token-done", () => {
    onDone();
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
  });

  invoke("run_token_treatment", { actionId, payload }).catch((error) => {
    Promise.all([unlistenLine, unlistenDone]).then((fns) => fns.forEach((f) => f()));
    onError?.(error);
    console.error(error);
  });
};

export const testFeishuConnection = (appId: string, appSecret: string) =>
  invoke<boolean>("test_feishu_connection", { appId, appSecret });

export const listFeishuPairingRequests = () =>
  invoke<PairingRequest[]>("list_feishu_pairing_requests");

export const approveFeishuPairing = (code: string) =>
  invoke<string>("approve_feishu_pairing", { code });
