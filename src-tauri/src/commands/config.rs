use dirs::home_dir;
use regex::Regex;
use std::io::ErrorKind;
use std::path::PathBuf;
use tauri::Emitter;
use tokio::fs;
use tokio::process::Command;

use crate::commands::gateway::reset_feishu_sessions;
use crate::commands::runtime::{clean_openclaw_output, run_shell, shell_escape};

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct OpenClawConfig {
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub feishu_app_id: Option<String>,
    pub feishu_app_secret: Option<String>,
    pub dm_policy: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct PairingRequest {
    pub id: String,
    pub code: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "lastSeenAt")]
    pub last_seen_at: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
struct PairingListResponse {
    pub requests: Vec<PairingRequest>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct ModelAuthProviderStatus {
    pub provider: String,
    pub auth_type: String,
    pub status: String,
    pub profile_count: usize,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct ConfiguredModel {
    pub key: String,
    pub name: String,
    pub provider: String,
    pub is_default: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct ModelAuthStatus {
    pub default_model: Option<String>,
    pub resolved_default: Option<String>,
    pub current_provider: Option<String>,
    pub has_any_auth: bool,
    pub has_api_key: bool,
    pub has_oauth: bool,
    pub openai_codex_logged_in: bool,
    pub codex_cli_auth_detected: bool,
    pub providers: Vec<ModelAuthProviderStatus>,
    pub models: Vec<ConfiguredModel>,
}

fn cache_config_path() -> Result<PathBuf, String> {
    home_dir()
        .map(|h| h.join(".openclaw").join("config.json"))
        .ok_or_else(|| "Cannot determine home directory".to_string())
}

fn runtime_config_path() -> Result<PathBuf, String> {
    home_dir()
        .map(|h| h.join(".openclaw").join("openclaw.json"))
        .ok_or_else(|| "Cannot determine home directory".to_string())
}

fn main_agent_dir() -> Result<PathBuf, String> {
    home_dir()
        .map(|h| h.join(".openclaw").join("agents").join("main").join("agent"))
        .ok_or_else(|| "Cannot determine home directory".to_string())
}

fn auth_profiles_path() -> Result<PathBuf, String> {
    Ok(main_agent_dir()?.join("auth-profiles.json"))
}

async fn clear_agent_model_cache() -> Result<(), String> {
    let path = main_agent_dir()?.join("models.json");
    if path.exists() {
        match fs::remove_file(path).await {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

async fn sanitize_legacy_agent_model_cache() -> Result<(), String> {
    let path = main_agent_dir()?.join("models.json");
    if !path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
    if content.contains("requiresOpenAiAnthropicToolPayload") {
        match fs::remove_file(path).await {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    Ok(())
}

async fn read_json_value_if_exists(path: &PathBuf) -> Result<Option<serde_json::Value>, String> {
    match fs::read_to_string(path).await {
        Ok(content) => {
            let value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
            Ok(Some(value))
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

async fn run_shell_with_legacy_model_retry(command: &str) -> Result<String, String> {
    match run_shell(command).await {
        Ok(output) => Ok(output),
        Err(error) if error.contains("requiresOpenAiAnthropicToolPayload") => {
            clear_agent_model_cache().await?;
            run_shell(command).await
        }
        Err(error) => Err(error),
    }
}

fn global_feishu_extension_dir() -> Result<PathBuf, String> {
    home_dir()
        .map(|h| h.join(".openclaw").join("extensions").join("feishu"))
        .ok_or_else(|| "Cannot determine home directory".to_string())
}

fn codex_auth_path() -> Result<PathBuf, String> {
    home_dir()
        .map(|h| h.join(".codex").join("auth.json"))
        .ok_or_else(|| "Cannot determine home directory".to_string())
}

fn provider_from_model(model: &str) -> Option<String> {
    model
        .split('/')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn provider_label(provider: &str) -> &str {
    match provider {
        "openai-codex" => "OpenAI Codex",
        "kimi-coding" | "kimi" => "Kimi",
        "moonshot" => "Moonshot",
        "minimax" => "MiniMax",
        "anthropic" => "Anthropic",
        "openai" => "OpenAI",
        _ => provider,
    }
}

fn model_name_from_value(entry: &serde_json::Value) -> String {
    entry.get("name")
        .and_then(|v| v.as_str())
        .or_else(|| entry.get("key").and_then(|v| v.as_str()))
        .unwrap_or("unknown")
        .to_string()
}

fn parse_models_from_value(value: &serde_json::Value) -> Vec<ConfiguredModel> {
    let mut models = Vec::new();

    if let Some(entries) = value.get("models").and_then(|v| v.as_array()) {
        for entry in entries {
            let key = entry
                .get("key")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let provider = provider_from_model(&key).unwrap_or_else(|| "unknown".to_string());
            let is_default = entry
                .get("tags")
                .and_then(|v| v.as_array())
                .is_some_and(|tags| tags.iter().any(|tag| tag.as_str() == Some("default")));

            models.push(ConfiguredModel {
                key,
                name: model_name_from_value(entry),
                provider,
                is_default,
            });
        }
    }

    models
}

fn configured_model_key_for_provider(provider: &str) -> Option<&'static str> {
    match provider {
        "kimi-coding" | "kimi" => Some("kimi-coding/k2p5"),
        "moonshot" => Some("moonshot/moonshot-v1-8k"),
        "minimax" => Some("minimax/minimax-text-01"),
        "anthropic" => Some("anthropic/claude-opus-4-6"),
        "openai" => Some("openai/gpt-5"),
        "openai-codex" => Some("openai-codex/gpt-5.4"),
        _ => None,
    }
}

async fn sync_primary_model(model: &str) -> Result<(), String> {
    run_shell_with_legacy_model_retry(&format!(
        "openclaw config set agents.defaults.model.primary {}",
        shell_escape(model)
    ))
    .await?;
    Ok(())
}

fn applescript_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn parse_openclaw_version_triplet(raw: &str) -> Option<(u32, u32, u32)> {
    let regex = Regex::new(r"(\d{4})\.(\d{1,2})\.(\d{1,2})").ok()?;
    let captures = regex.captures(raw)?;
    let year = captures.get(1)?.as_str().parse().ok()?;
    let month = captures.get(2)?.as_str().parse().ok()?;
    let day = captures.get(3)?.as_str().parse().ok()?;
    Some((year, month, day))
}

async fn ensure_openai_codex_oauth_supported() -> Result<(), String> {
    let version_output = run_shell("openclaw --version 2>&1").await?;
    let Some(current) = parse_openclaw_version_triplet(&version_output) else {
        return Ok(());
    };

    let minimum = (2026, 3, 7);
    if current < minimum {
        return Err(format!(
            "当前 OpenClaw 版本过旧（检测到 {}）。请先在“运行状态”页更新 OpenClaw 到 2026.3.7 或更新版本后，再使用 OAuth 登录。",
            version_output.trim()
        ));
    }

    Ok(())
}

fn normalize_provider(provider: &str) -> &str {
    match provider.trim().to_lowercase().as_str() {
        "kimi" | "kimi-code" | "kimicode" => "kimi",
        "moonshot" | "moon" => "moonshot",
        "minimax" => "minimax",
        "anthropic" => "anthropic",
        "openai" => "openai",
        _ => provider,
    }
}

fn ui_provider_from_runtime(provider: &str) -> Option<String> {
    match provider.trim().to_lowercase().as_str() {
        "kimi-coding" | "kimi" => Some("kimi".to_string()),
        "moonshot" => Some("moonshot".to_string()),
        "minimax" => Some("minimax".to_string()),
        "anthropic" => Some("anthropic".to_string()),
        "openai" => Some("openai".to_string()),
        _ => None,
    }
}

fn nested_string(value: &serde_json::Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current.as_str().map(str::to_string)
}

async fn sync_provider_config(config: &OpenClawConfig) -> Result<(), String> {
    sanitize_legacy_agent_model_cache().await?;

    let Some(provider) = config.provider.as_deref() else {
        return Ok(());
    };
    let Some(api_key) = config.api_key.as_deref() else {
        return Ok(());
    };

    let provider = normalize_provider(provider);

    let (auth_choice, api_flag) = match provider {
        "kimi" => ("kimi-code-api-key", "--kimi-code-api-key"),
        "moonshot" => ("moonshot-api-key", "--moonshot-api-key"),
        "minimax" => ("minimax-api", "--minimax-api-key"),
        "anthropic" => ("anthropic-api-key", "--anthropic-api-key"),
        "openai" => ("openai-api-key", "--openai-api-key"),
        _ => {
            return Err(format!(
                "未知 provider: {provider}。当前仅支持 Kimi / Moonshot / MiniMax / Anthropic / OpenAI。"
            ))
        }
    };

    let api_key = shell_escape(api_key);
    run_shell_with_legacy_model_retry("openclaw doctor --fix >/dev/null 2>&1 || true").await?;
    run_shell_with_legacy_model_retry(&format!(
        "openclaw onboard --non-interactive --accept-risk --mode local \
         --auth-choice {auth_choice} {api_flag} {api_key} \
         --skip-channels --skip-daemon --skip-skills --skip-ui --skip-health \
         --gateway-bind loopback --gateway-port 18789"
    ))
    .await?;
    run_shell_with_legacy_model_retry("openclaw config set gateway.bind custom").await?;
    run_shell_with_legacy_model_retry("openclaw config set gateway.customBindHost 127.0.0.1")
        .await?;
    if let Some(model_key) = configured_model_key_for_provider(provider) {
        sync_primary_model(model_key).await?;
    }

    Ok(())
}

async fn sync_feishu_config(config: &OpenClawConfig) -> Result<(), String> {
    sanitize_legacy_agent_model_cache().await?;

    let Some(app_id) = config.feishu_app_id.as_deref() else {
        return Ok(());
    };
    let Some(app_secret) = config.feishu_app_secret.as_deref() else {
        return Ok(());
    };

    let dm_policy = config.dm_policy.as_deref().unwrap_or("pairing");
    let app_id = shell_escape(app_id);
    let app_secret = shell_escape(app_secret);
    let dm_policy = shell_escape(dm_policy);

    prepare_stock_feishu_plugin().await?;
    run_shell_with_legacy_model_retry("openclaw config set plugins.entries.feishu.enabled true")
        .await?;
    run_shell_with_legacy_model_retry("openclaw config set channels.feishu.enabled true").await?;
    run_shell_with_legacy_model_retry("openclaw config set channels.feishu.defaultAccount main")
        .await?;
    run_shell_with_legacy_model_retry("openclaw config set channels.feishu.accounts.main.enabled true")
        .await?;
    run_shell_with_legacy_model_retry(
        "openclaw config set channels.feishu.accounts.default.enabled false",
    )
    .await?;
    run_shell_with_legacy_model_retry(&format!(
        "openclaw config set channels.feishu.accounts.main.appId {app_id}"
    ))
    .await?;
    run_shell_with_legacy_model_retry(&format!(
        "openclaw config set channels.feishu.accounts.main.appSecret {app_secret}"
    ))
    .await?;
    run_shell_with_legacy_model_retry(&format!(
        "openclaw config set channels.feishu.accounts.main.dmPolicy {dm_policy}"
    ))
    .await?;

    if config.dm_policy.as_deref() == Some("open") {
        run_shell_with_legacy_model_retry(
            r#"openclaw config set channels.feishu.allowFrom '["*"]' --strict-json"#,
        )
        .await?;
    } else {
        run_shell_with_legacy_model_retry(
            "openclaw config unset channels.feishu.allowFrom >/dev/null 2>&1 || true",
        )
        .await?;
    }

    cleanup_feishu_plugin_install().await?;

    Ok(())
}

pub async fn cleanup_feishu_plugin_install() -> Result<(), String> {
    sanitize_legacy_agent_model_cache().await?;
    run_shell_with_legacy_model_retry(
        "openclaw config unset plugins.installs.feishu >/dev/null 2>&1 || true",
    )
    .await?;

    let global_dir = global_feishu_extension_dir()?;
    if global_dir.exists() {
        fs::remove_dir_all(global_dir)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub async fn prepare_stock_feishu_plugin() -> Result<(), String> {
    sanitize_legacy_agent_model_cache().await?;
    run_shell_with_legacy_model_retry(r#"npm install --prefix "$(npm root -g)/openclaw/extensions/feishu""#).await?;
    Ok(())
}

#[tauri::command]
pub async fn read_model_auth_status() -> Result<ModelAuthStatus, String> {
    sanitize_legacy_agent_model_cache().await?;
    let output = clean_openclaw_output(&run_shell("openclaw models status --json").await?);
    let value: serde_json::Value =
        serde_json::from_str(&output).map_err(|e| format!("Failed to parse model status: {e}"))?;
    let models_output = clean_openclaw_output(&run_shell("openclaw models list --json").await?);
    let models_value: serde_json::Value = serde_json::from_str(&models_output)
        .map_err(|e| format!("Failed to parse configured models: {e}"))?;

    let default_model = value
        .get("defaultModel")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let resolved_default = value
        .get("resolvedDefault")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let mut providers = Vec::new();
    let mut has_api_key = false;
    let mut has_oauth = false;

    if let Some(entries) = value
        .get("auth")
        .and_then(|v| v.get("oauth"))
        .and_then(|v| v.get("providers"))
        .and_then(|v| v.as_array())
    {
        for entry in entries {
            let provider = entry
                .get("provider")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let status = entry
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("configured")
                .to_string();
            let profiles = entry
                .get("profiles")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            let auth_type = if profiles.iter().any(|profile| {
                profile.get("type").and_then(|v| v.as_str()) == Some("oauth")
            }) {
                has_oauth = true;
                "oauth"
            } else if profiles.iter().any(|profile| {
                profile.get("type").and_then(|v| v.as_str()) == Some("api_key")
            }) {
                has_api_key = true;
                "api_key"
            } else if profiles.iter().any(|profile| {
                profile.get("type").and_then(|v| v.as_str()) == Some("token")
            }) {
                "token"
            } else {
                "configured"
            };

            let has_usable_profile = !profiles.is_empty();
            let is_missing = status == "missing";
            if is_missing && !has_usable_profile {
                continue;
            }

            providers.push(ModelAuthProviderStatus {
                provider,
                auth_type: auth_type.to_string(),
                status,
                profile_count: profiles.len(),
            });
        }
    }

    providers.sort_by(|a, b| a.provider.cmp(&b.provider));
    let mut models = parse_models_from_value(&models_value);
    for provider in &providers {
        if models.iter().any(|item| item.provider == provider.provider) {
            continue;
        }
        if let Some(key) = configured_model_key_for_provider(&provider.provider) {
            models.push(ConfiguredModel {
                key: key.to_string(),
                name: key.split('/').nth(1).unwrap_or(key).to_string(),
                provider: provider.provider.clone(),
                is_default: false,
            });
        }
    }

    let raw_current_provider = resolved_default
        .as_deref()
        .and_then(provider_from_model)
        .or_else(|| default_model.as_deref().and_then(provider_from_model));
    let current_provider = raw_current_provider
        .filter(|provider| providers.iter().any(|entry| entry.provider == *provider))
        .or_else(|| providers.first().map(|entry| entry.provider.clone()));
    let effective_default = current_provider.as_ref().and_then(|provider| {
        models
            .iter()
            .find(|item| item.provider == *provider && item.is_default)
            .or_else(|| models.iter().find(|item| item.provider == *provider))
            .map(|item| item.key.clone())
    });

    Ok(ModelAuthStatus {
        default_model: effective_default.clone().or(default_model),
        resolved_default: effective_default.or(resolved_default),
        current_provider,
        has_any_auth: !providers.is_empty(),
        has_api_key,
        has_oauth,
        openai_codex_logged_in: providers.iter().any(|entry| entry.provider == "openai-codex"),
        codex_cli_auth_detected: codex_auth_path()?.exists(),
        providers,
        models,
    })
}

#[tauri::command]
pub async fn list_provider_models(provider: String) -> Result<Vec<ConfiguredModel>, String> {
    sanitize_legacy_agent_model_cache().await?;
    let provider = provider.trim();
    if provider.is_empty() {
        return Ok(Vec::new());
    }

    let output = clean_openclaw_output(&run_shell(&format!(
        "openclaw models list --all --provider {} --json",
        shell_escape(provider)
    ))
    .await?);
    let value: serde_json::Value =
        serde_json::from_str(&output).map_err(|e| format!("Failed to parse provider models: {e}"))?;
    Ok(parse_models_from_value(&value))
}

#[tauri::command]
pub async fn read_thinking_default() -> Result<Option<String>, String> {
    sanitize_legacy_agent_model_cache().await?;
    match run_shell("openclaw config get agents.defaults.thinkingDefault").await {
        Ok(output) => {
            let cleaned = clean_openclaw_output(&output);
            if cleaned.is_empty() {
                Ok(None)
            } else {
                Ok(Some(cleaned))
            }
        }
        Err(error) if error.contains("Config path not found") => Ok(None),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub async fn set_thinking_default(level: String) -> Result<(), String> {
    sanitize_legacy_agent_model_cache().await?;
    let normalized = level.trim().to_lowercase();
    let allowed = ["low", "medium", "high"];
    if !allowed.contains(&normalized.as_str()) {
        return Err("仅支持 low / medium / high".to_string());
    }

    run_shell(&format!(
        "openclaw config set agents.defaults.thinkingDefault {}",
        shell_escape(&normalized)
    ))
    .await?;
    Ok(())
}

fn merge_cache_into_config(
    obj: &serde_json::Map<String, serde_json::Value>,
    config: &mut OpenClawConfig,
) {
    if config.provider.is_none() {
        config.provider = obj
            .get("provider")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
    if config.api_key.is_none() {
        config.api_key = obj
            .get("api_key")
            .or_else(|| obj.get("apiKey"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
    if config.feishu_app_id.is_none() {
        config.feishu_app_id = obj
            .get("feishu_app_id")
            .or_else(|| obj.get("feishuAppId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
    if config.feishu_app_secret.is_none() {
        config.feishu_app_secret = obj
            .get("feishu_app_secret")
            .or_else(|| obj.get("feishuAppSecret"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
    if config.dm_policy.is_none() {
        config.dm_policy = obj
            .get("dm_policy")
            .or_else(|| obj.get("dmPolicy"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
    config.extra = obj.clone();
}

fn merge_runtime_into_config(value: &serde_json::Value, config: &mut OpenClawConfig) {
    if config.feishu_app_id.is_none() {
        config.feishu_app_id =
            nested_string(value, &["channels", "feishu", "accounts", "main", "appId"]);
    }
    if config.feishu_app_secret.is_none() {
        config.feishu_app_secret = nested_string(
            value,
            &["channels", "feishu", "accounts", "main", "appSecret"],
        );
    }
    if config.dm_policy.is_none() {
        config.dm_policy = nested_string(
            value,
            &["channels", "feishu", "accounts", "default", "dmPolicy"],
        );
    }
}

fn merge_auth_profiles_into_config(value: &serde_json::Value, config: &mut OpenClawConfig) {
    let Some(profiles) = value.get("profiles").and_then(|v| v.as_object()) else {
        return;
    };

    let preferred_provider = config.provider.clone();
    let mut fallback_provider = None;
    let mut fallback_key = None;

    for profile in profiles.values() {
        let profile_type = profile.get("type").and_then(|v| v.as_str()).unwrap_or_default();
        if profile_type != "api_key" {
            continue;
        }

        let Some(runtime_provider) = profile.get("provider").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(ui_provider) = ui_provider_from_runtime(runtime_provider) else {
            continue;
        };

        let key = profile
            .get("key")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        if fallback_provider.is_none() {
            fallback_provider = Some(ui_provider.clone());
            fallback_key = key.clone();
        }

        if preferred_provider.as_deref().is_some_and(|value| value == ui_provider) {
            if config.provider.is_none() {
                config.provider = Some(ui_provider);
            }
            if config.api_key.is_none() {
                config.api_key = key;
            }
            return;
        }
    }

    if config.provider.is_none() {
        config.provider = fallback_provider;
    }
    if config.api_key.is_none() {
        config.api_key = fallback_key;
    }
}

#[tauri::command]
pub async fn read_config() -> Result<OpenClawConfig, String> {
    let mut config = OpenClawConfig::default();
    let cache_path = cache_config_path()?;
    if let Some(value) = read_json_value_if_exists(&cache_path).await? {
        let obj = value.as_object().cloned().unwrap_or_default();
        merge_cache_into_config(&obj, &mut config);
    }

    let runtime_path = runtime_config_path()?;
    if let Some(value) = read_json_value_if_exists(&runtime_path).await? {
        merge_runtime_into_config(&value, &mut config);
    }

    let auth_path = auth_profiles_path()?;
    if let Some(value) = read_json_value_if_exists(&auth_path).await? {
        merge_auth_profiles_into_config(&value, &mut config);
    }

    Ok(config)
}

#[tauri::command]
pub async fn write_config(config: OpenClawConfig) -> Result<(), String> {
    sanitize_legacy_agent_model_cache().await?;
    let path = cache_config_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let mut obj: serde_json::Map<String, serde_json::Value> = if path.exists() {
        let content = fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
        serde_json::from_str::<serde_json::Value>(&content)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    if let Some(v) = &config.provider {
        obj.insert("provider".to_string(), serde_json::Value::String(v.clone()));
    }
    if let Some(v) = &config.api_key {
        obj.insert("api_key".to_string(), serde_json::Value::String(v.clone()));
        if obj.contains_key("apiKey") {
            obj.insert("apiKey".to_string(), serde_json::Value::String(v.clone()));
        }
    }
    if let Some(v) = &config.feishu_app_id {
        obj.insert(
            "feishu_app_id".to_string(),
            serde_json::Value::String(v.clone()),
        );
    }
    if let Some(v) = &config.feishu_app_secret {
        obj.insert(
            "feishu_app_secret".to_string(),
            serde_json::Value::String(v.clone()),
        );
    }
    if let Some(v) = &config.dm_policy {
        obj.insert(
            "dm_policy".to_string(),
            serde_json::Value::String(v.clone()),
        );
    }

    let json = serde_json::to_string_pretty(&obj).map_err(|e| e.to_string())?;
    fs::write(&path, json).await.map_err(|e| e.to_string())?;

    let mut merged = config.clone();
    merge_cache_into_config(&obj, &mut merged);

    sync_provider_config(&merged).await?;
    sync_feishu_config(&merged).await?;

    Ok(())
}

#[tauri::command]
pub async fn list_feishu_pairing_requests() -> Result<Vec<PairingRequest>, String> {
    sanitize_legacy_agent_model_cache().await?;
    let output = clean_openclaw_output(&run_shell("openclaw pairing list feishu --json").await?);
    let parsed: PairingListResponse =
        serde_json::from_str(&output).map_err(|e| format!("Failed to parse pairing list: {e}"))?;
    Ok(parsed.requests)
}

#[tauri::command]
pub async fn approve_feishu_pairing(code: String) -> Result<String, String> {
    sanitize_legacy_agent_model_cache().await?;
    let code = code.trim();
    if code.is_empty() {
        return Err("Pairing code is required".to_string());
    }

    let output = clean_openclaw_output(
        &run_shell(&format!(
        "openclaw pairing approve feishu {}",
        shell_escape(code)
    ))
        .await?,
    );

    Ok(if output.is_empty() {
        format!("已批准配对码 {code}")
    } else {
        output
    })
}

async fn emit_api_reset_line(window: &tauri::Window, line: impl Into<String>) -> Result<(), String> {
    window
        .emit("api-reset-output", line.into())
        .map_err(|e| e.to_string())
}

async fn emit_oauth_line(window: &tauri::Window, line: impl Into<String>) -> Result<(), String> {
    window
        .emit("oauth-output", line.into())
        .map_err(|e| e.to_string())
}

async fn emit_model_switch_line(
    window: &tauri::Window,
    line: impl Into<String>,
) -> Result<(), String> {
    window
        .emit("model-switch-output", line.into())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_api_runtime(window: tauri::Window) -> Result<(), String> {
    sanitize_legacy_agent_model_cache().await?;
    emit_api_reset_line(&window, "开始重置 API 运行环境…").await?;
    emit_api_reset_line(&window, "正在清理 openclaw 当前加载的 provider / auth 配置…").await?;

    for command in [
        "openclaw config unset auth.profiles >/dev/null 2>&1 || true",
        "openclaw config unset models.providers >/dev/null 2>&1 || true",
        "openclaw config unset agents.defaults.model >/dev/null 2>&1 || true",
        "openclaw config unset agents.defaults.models >/dev/null 2>&1 || true",
    ] {
        run_shell(command).await?;
    }

    let agent_dir = main_agent_dir()?;
    for file_name in ["auth-profiles.json", "models.json"] {
        let path = agent_dir.join(file_name);
        if path.exists() {
            fs::remove_file(&path).await.map_err(|e| e.to_string())?;
            emit_api_reset_line(&window, format!("已删除 {}", path.display())).await?;
        }
    }

    emit_api_reset_line(&window, "正在重启网关，让新的 API 配置能重新加载…").await?;
    let restart_output = run_shell("openclaw gateway restart 2>&1").await?;
    let cleaned = clean_openclaw_output(&restart_output);
    if !cleaned.is_empty() {
        for line in cleaned.lines() {
            emit_api_reset_line(&window, line).await?;
        }
    }

    emit_api_reset_line(&window, "API 运行环境已重置。请保存新的 API 配置。").await?;
    window
        .emit("api-reset-done", "success")
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn login_model_oauth(provider: String, window: tauri::Window) -> Result<(), String> {
    sanitize_legacy_agent_model_cache().await?;
    let provider = provider.trim().to_lowercase();
    if provider != "openai-codex" {
        return Err("当前只支持 OpenAI Codex 的 OAuth 登录。".to_string());
    }
    ensure_openai_codex_oauth_supported().await?;

    emit_oauth_line(
        &window,
        format!("开始连接 {}…", provider_label(&provider)),
    )
    .await?;
    clear_agent_model_cache().await?;

    if codex_auth_path()?.exists() {
        emit_oauth_line(&window, "已检测到本机 Codex 登录信息，可以直接继续 OAuth 登录。").await?;
    }

    let command = format!(
        "{}; openclaw models auth login --provider {} --set-default; openclaw config set agents.defaults.model.primary openai-codex/gpt-5.4; openclaw gateway restart; echo; echo 'OAuth 登录完成，可以回养养龙虾继续切模型。'",
        crate::commands::runtime::SHELL_PATH_PREFIX,
        shell_escape(&provider)
    );
    let script = format!(
        "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
        applescript_escape(&command)
    );

    Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    emit_oauth_line(&window, "已打开 Terminal。请在终端里完成 OAuth 登录。").await?;
    emit_oauth_line(&window, "登录完成后回到养养龙虾，这里会自动识别新的模型。").await?;
    window
        .emit("oauth-done", "success")
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn switch_active_model(model: String, window: tauri::Window) -> Result<(), String> {
    sanitize_legacy_agent_model_cache().await?;
    let model = model.trim().to_string();
    if model.is_empty() {
        return Err("模型不能为空".to_string());
    }

    emit_model_switch_line(&window, format!("开始切换到 {model}…")).await?;
    run_shell(&format!("openclaw models set {}", shell_escape(&model))).await?;
    sync_primary_model(&model).await?;
    clear_agent_model_cache().await?;
    emit_model_switch_line(&window, "默认模型已更新，正在重启网关…").await?;

    let restart_output = run_shell("openclaw gateway restart 2>&1").await?;
    let cleaned = clean_openclaw_output(&restart_output);
    if !cleaned.is_empty() {
        for line in cleaned.lines() {
            emit_model_switch_line(&window, line).await?;
        }
    }

    match reset_feishu_sessions().await {
        Ok(message) => {
            emit_model_switch_line(&window, "已重置飞书会话，下一条消息会按新模型起新会话。")
                .await?;
            emit_model_switch_line(&window, message).await?;
        }
        Err(error) => {
            emit_model_switch_line(
                &window,
                format!("模型已切换，但重置飞书会话失败：{error}"),
            )
            .await?;
        }
    }

    emit_model_switch_line(&window, "模型切换完成。").await?;
    window
        .emit("model-switch-done", "success")
        .map_err(|e| e.to_string())?;
    Ok(())
}
