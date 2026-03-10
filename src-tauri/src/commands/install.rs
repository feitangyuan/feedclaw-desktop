use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::{fs, io::AsyncWriteExt};

use crate::commands::config::{cleanup_feishu_plugin_install, prepare_stock_feishu_plugin};
use crate::commands::runtime::{clean_openclaw_output, run_shell, shell_escape, spawn_shell, with_shell_path};

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct InstallInfo {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

const OPENCLAW_INSTALL_SCRIPT: &str = r#"#!/usr/bin/env bash
set -euo pipefail
exec 2>&1
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:$HOME/.local/bin:$PATH"

section() {
  printf '\n==> %s\n' "$1"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

run_privileged() {
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    "$@"
  elif command_exists sudo; then
    sudo "$@"
  else
    echo "Need root privileges but sudo is not available."
    exit 1
  fi
}

ensure_homebrew() {
  if command_exists brew; then
    return
  fi

  section "Installing Homebrew"
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_node22() {
  if command_exists node; then
    local current_major
    current_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    if [ "${current_major}" -ge 22 ]; then
      return
    fi
  fi

  section "Installing Node.js v22+"
  local os
  os="$(uname -s)"

  if [ "$os" = "Darwin" ]; then
    ensure_homebrew
    brew install node@22 || brew upgrade node@22 || true
    if [ -x "$(brew --prefix node@22)/bin/node" ]; then
      export PATH="$(brew --prefix node@22)/bin:$PATH"
    fi
  elif command_exists apt-get; then
    run_privileged apt-get update -y
    run_privileged apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_22.x | run_privileged bash -
    run_privileged apt-get install -y nodejs
  elif command_exists dnf; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | run_privileged bash -
    run_privileged dnf install -y nodejs
  elif command_exists yum; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | run_privileged bash -
    run_privileged yum install -y nodejs
  else
    echo "Unable to auto-install Node.js. Please install Node.js v22+ manually from https://nodejs.org"
    exit 1
  fi

  if ! command_exists node; then
    echo "Node.js installation failed."
    exit 1
  fi

  local installed_major
  installed_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [ "${installed_major}" -lt 22 ]; then
    echo "Node.js v22+ is required. Current: $(node -v)"
    exit 1
  fi
}

ensure_openclaw() {
  if command_exists openclaw; then
    echo "OpenClaw is already installed: $(command -v openclaw)"
    return
  fi

  section "Installing OpenClaw"
  if command_exists npm; then
    npm config set progress false >/dev/null 2>&1 || true
    if [ "${EUID:-$(id -u)}" -eq 0 ]; then
      npm install -g openclaw --registry https://registry.npmmirror.com --loglevel=error || true
    elif [ -w /opt/homebrew/lib/node_modules ] || [ -w /usr/local/lib/node_modules ]; then
      npm install -g openclaw --registry https://registry.npmmirror.com --loglevel=error || true
    elif command_exists sudo; then
      run_privileged npm install -g openclaw --registry https://registry.npmmirror.com --loglevel=error || true
    else
      npm install -g openclaw --registry https://registry.npmmirror.com --loglevel=error || true
    fi
  fi

  if ! command_exists openclaw; then
    curl -fsSL https://openclaw.ai/install.sh | bash
  fi

  if ! command_exists openclaw; then
    echo "OpenClaw installation failed."
    exit 1
  fi

  echo "OpenClaw installed: $(command -v openclaw)"
  openclaw --version 2>&1 || true
}

section "Preparing environment"
ensure_node22
ensure_openclaw

section "Done"
echo "OpenClaw CLI is ready."
"#;

async fn stream_command_output(
    window: &tauri::Window,
    mut child: tokio::process::Child,
) -> Result<(), String> {
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let mut reader = BufReader::new(stdout).lines();

    while let Some(line) = reader.next_line().await.map_err(|e| e.to_string())? {
        window
            .emit("install-output", &line)
            .map_err(|e| e.to_string())?;
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;

    if status.success() {
        window
            .emit("install-done", "success")
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        window
            .emit("install-done", "failed")
            .map_err(|e| e.to_string())?;
        Err("Installation failed".to_string())
    }
}

#[derive(serde::Deserialize, Default)]
struct PreservedRuntimeConfig {
    provider: Option<String>,
    api_key: Option<String>,
    #[serde(rename = "apiKey")]
    api_key_alt: Option<String>,
    feishu_app_id: Option<String>,
    feishu_app_secret: Option<String>,
    dm_policy: Option<String>,
}

fn openclaw_home() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".openclaw"))
        .ok_or_else(|| "Cannot determine home directory".to_string())
}

fn launch_agent_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join("Library").join("LaunchAgents").join("ai.openclaw.gateway.plist"))
        .ok_or_else(|| "Cannot determine home directory".to_string())
}

fn preserve_root() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(format!(".openclaw-preserve-{}", chrono::Utc::now().timestamp())))
        .ok_or_else(|| "Cannot determine home directory".to_string())
}

async fn emit_uninstall_line(window: &tauri::Window, line: impl Into<String>) -> Result<(), String> {
    window
        .emit("uninstall-output", line.into())
        .map_err(|e| e.to_string())
}

async fn trim_cache_config_to_preserved_fields(openclaw_home: &Path) -> Result<Option<Vec<u8>>, String> {
    let cache_path = openclaw_home.join("config.json");
    if !cache_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&cache_path).await.map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let obj = value.as_object().cloned().unwrap_or_default();
    let mut trimmed = serde_json::Map::new();

    for key in [
        "provider",
        "api_key",
        "apiKey",
        "feishu_app_id",
        "feishu_app_secret",
        "dm_policy",
    ] {
        if let Some(v) = obj.get(key) {
            trimmed.insert(key.to_string(), v.clone());
        }
    }

    if trimmed.is_empty() {
        return Ok(None);
    }

    let bytes = serde_json::to_vec_pretty(&serde_json::Value::Object(trimmed))
        .map_err(|e| e.to_string())?;
    Ok(Some(bytes))
}

async fn move_if_exists(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }

    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }

    fs::rename(src, dst).await.map_err(|e| e.to_string())
}

async fn preserve_api_and_skills(preserve_dir: &Path) -> Result<(), String> {
    let openclaw_home = openclaw_home()?;
    let workspace_skills = openclaw_home.join("workspace").join("skills");
    let managed_skills = openclaw_home.join("skills");

    move_if_exists(&workspace_skills, &preserve_dir.join("workspace").join("skills")).await?;
    move_if_exists(&managed_skills, &preserve_dir.join("skills")).await?;

    if let Some(bytes) = trim_cache_config_to_preserved_fields(&openclaw_home).await? {
        fs::create_dir_all(preserve_dir).await.map_err(|e| e.to_string())?;
        let mut file = fs::File::create(preserve_dir.join("config.json"))
            .await
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).await.map_err(|e| e.to_string())?;
    }

    Ok(())
}

async fn restore_preserved_api_and_skills(preserve_dir: &Path) -> Result<(), String> {
    let openclaw_home = openclaw_home()?;
    fs::create_dir_all(&openclaw_home).await.map_err(|e| e.to_string())?;

    move_if_exists(
        &preserve_dir.join("workspace").join("skills"),
        &openclaw_home.join("workspace").join("skills"),
    )
    .await?;
    move_if_exists(&preserve_dir.join("skills"), &openclaw_home.join("skills")).await?;
    move_if_exists(&preserve_dir.join("config.json"), &openclaw_home.join("config.json")).await?;

    if preserve_dir.exists() {
        fs::remove_dir_all(preserve_dir).await.map_err(|e| e.to_string())?;
    }

    Ok(())
}

async fn read_preserved_runtime_config() -> Result<PreservedRuntimeConfig, String> {
    let path = openclaw_home()?.join("config.json");
    if !path.exists() {
        return Ok(PreservedRuntimeConfig::default());
    }

    let content = fs::read_to_string(path).await.map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
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

fn default_model_for_provider(provider: &str) -> Option<&'static str> {
    match provider {
        "kimi" => Some("kimi-coding/k2p5"),
        "moonshot" => Some("moonshot/moonshot-v1-8k"),
        "minimax" => Some("minimax/minimax-text-01"),
        "anthropic" => Some("anthropic/claude-opus-4-6"),
        "openai" => Some("openai/gpt-5"),
        _ => None,
    }
}

async fn restore_runtime_from_preserved_config(window: &tauri::Window) -> Result<(), String> {
    let preserved = read_preserved_runtime_config().await?;
    let provider = preserved.provider.as_deref().map(normalize_provider);
    let api_key = preserved.api_key.as_deref().or(preserved.api_key_alt.as_deref());

    if let (Some(provider), Some(api_key)) = (provider, api_key) {
        let (auth_choice, api_flag) = match provider {
            "kimi" => ("kimi-code-api-key", "--kimi-code-api-key"),
            "moonshot" => ("moonshot-api-key", "--moonshot-api-key"),
            "minimax" => ("minimax-api", "--minimax-api-key"),
            "anthropic" => ("anthropic-api-key", "--anthropic-api-key"),
            "openai" => ("openai-api-key", "--openai-api-key"),
            _ => ("", ""),
        };

        if !auth_choice.is_empty() {
            window
                .emit("install-output", "正在恢复已保留的 API 配置…")
                .map_err(|e| e.to_string())?;
            run_shell("openclaw doctor --fix >/dev/null 2>&1 || true").await?;
            run_shell(&format!(
                "openclaw onboard --non-interactive --accept-risk --mode local \
                 --auth-choice {auth_choice} {api_flag} {} \
                 --skip-channels --skip-daemon --skip-skills --skip-ui --skip-health \
                 --gateway-bind loopback --gateway-port 18789",
                shell_escape(api_key)
            ))
            .await?;
            run_shell("openclaw config set gateway.mode local").await?;
            run_shell("openclaw config set gateway.bind custom").await?;
            run_shell("openclaw config set gateway.customBindHost 127.0.0.1").await?;
            if let Some(model_key) = default_model_for_provider(provider) {
                run_shell(&format!(
                    "openclaw config set agents.defaults.model.primary {}",
                    shell_escape(model_key)
                ))
                .await?;
            }
        }
    }

    if let (Some(app_id), Some(app_secret)) = (
        preserved.feishu_app_id.as_deref(),
        preserved.feishu_app_secret.as_deref(),
    ) {
        let dm_policy = preserved.dm_policy.as_deref().unwrap_or("pairing");
        window
            .emit("install-output", "正在恢复已保留的飞书配置…")
            .map_err(|e| e.to_string())?;
        prepare_stock_feishu_plugin().await?;
        run_shell("openclaw config set plugins.entries.feishu.enabled true").await?;
        run_shell("openclaw config set channels.feishu.enabled true").await?;
        run_shell("openclaw config set channels.feishu.defaultAccount main").await?;
        run_shell("openclaw config set channels.feishu.accounts.main.enabled true").await?;
        run_shell("openclaw config set channels.feishu.accounts.default.enabled false").await?;
        run_shell(&format!(
            "openclaw config set channels.feishu.accounts.main.appId {}",
            shell_escape(app_id)
        ))
        .await?;
        run_shell(&format!(
            "openclaw config set channels.feishu.accounts.main.appSecret {}",
            shell_escape(app_secret)
        ))
        .await?;
        run_shell(&format!(
            "openclaw config set channels.feishu.accounts.main.dmPolicy {}",
            shell_escape(dm_policy)
        ))
        .await?;
        if dm_policy == "open" {
            run_shell(r#"openclaw config set channels.feishu.allowFrom '["*"]' --strict-json"#).await?;
        } else {
            run_shell("openclaw config unset channels.feishu.allowFrom >/dev/null 2>&1 || true").await?;
        }
        cleanup_feishu_plugin_install().await?;
    }

    Ok(())
}

async fn stop_gateway_and_remove_service() -> Result<(), String> {
    run_shell(
        r#"openclaw gateway stop >/dev/null 2>&1 || true;
launchctl bootout "gui/$(id -u)/ai.openclaw.gateway" >/dev/null 2>&1 || true"#,
    )
    .await?;

    let launch_agent = launch_agent_path()?;
    if launch_agent.exists() {
        fs::remove_file(launch_agent).await.map_err(|e| e.to_string())?;
    }

    Ok(())
}

async fn uninstall_openclaw_cli() -> Result<String, String> {
    let output = run_shell(
        r#"export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:$HOME/.local/bin:$PATH";
if command -v npm >/dev/null 2>&1; then
  npm uninstall -g openclaw --loglevel=error 2>&1 || true
fi
if command -v npm >/dev/null 2>&1; then
  PKG_DIR="$(npm root -g 2>/dev/null)/openclaw"
  if [ -d "$PKG_DIR" ]; then
    rm -rf "$PKG_DIR"
  fi
fi
if command -v openclaw >/dev/null 2>&1; then
  BIN_PATH="$(command -v openclaw)"
  if [ -L "$BIN_PATH" ] || [ -f "$BIN_PATH" ]; then
    rm -f "$BIN_PATH" || true
  fi
fi
command -v openclaw >/dev/null 2>&1 && exit 1 || exit 0"#,
    )
    .await?;

    Ok(clean_openclaw_output(&output))
}

async fn remove_runtime_data() -> Result<(), String> {
    let openclaw_home = openclaw_home()?;
    if openclaw_home.exists() {
        fs::remove_dir_all(&openclaw_home).await.map_err(|e| e.to_string())?;
    }

    let tmp_openclaw = PathBuf::from("/tmp/openclaw");
    if tmp_openclaw.exists() {
        fs::remove_dir_all(tmp_openclaw).await.map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn check_openclaw_installed() -> Result<InstallInfo, String> {
    // Try `which openclaw`
    let path_result = Command::new("sh")
        .arg("-c")
        .arg(with_shell_path("which openclaw 2>/dev/null"))
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let path_str = String::from_utf8_lossy(&path_result.stdout)
        .trim()
        .to_string();

    if path_str.is_empty() {
        return Ok(InstallInfo {
            installed: false,
            version: None,
            path: None,
        });
    }

    // Get version
    let version_result = Command::new("sh")
        .arg("-c")
        .arg(with_shell_path("openclaw --version 2>&1"))
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let version_str = String::from_utf8_lossy(&version_result.stdout)
        .trim()
        .to_string();

    let version = if version_str.is_empty() {
        None
    } else {
        Some(version_str)
    };

    Ok(InstallInfo {
        installed: true,
        version,
        path: Some(path_str),
    })
}

#[tauri::command]
pub async fn install_openclaw(window: tauri::Window) -> Result<(), String> {
    let child = Command::new("bash")
        .arg("-lc")
        .arg(OPENCLAW_INSTALL_SCRIPT)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    stream_command_output(&window, child).await?;
    restore_runtime_from_preserved_config(&window).await?;
    run_shell("openclaw gateway install >/dev/null 2>&1 || true").await?;
    run_shell("openclaw gateway restart >/dev/null 2>&1 || true").await?;
    Ok(())
}

#[tauri::command]
pub async fn update_openclaw(window: tauri::Window) -> Result<(), String> {
    let mut child = spawn_shell("openclaw update 2>&1")?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let mut reader = BufReader::new(stdout).lines();

    while let Some(line) = reader.next_line().await.map_err(|e| e.to_string())? {
        window
            .emit("update-output", &line)
            .map_err(|e| e.to_string())?;
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("Failed to update openclaw".to_string());
    }

    prepare_stock_feishu_plugin().await?;
    cleanup_feishu_plugin_install().await?;
    Ok(())
}

#[tauri::command]
pub async fn uninstall_openclaw(window: tauri::Window) -> Result<(), String> {
    let result: Result<(), String> = async {
        emit_uninstall_line(&window, "开始彻底卸载 openclaw…").await?;
        emit_uninstall_line(&window, "会保留 API、飞书配置和已安装的 Skills，其它运行数据会清空。").await?;

        emit_uninstall_line(&window, "正在停止网关并移除后台服务…").await?;
        stop_gateway_and_remove_service().await?;

        emit_uninstall_line(&window, "正在卸载 openclaw CLI…").await?;
        let uninstall_output = uninstall_openclaw_cli().await?;
        if !uninstall_output.is_empty() {
            for line in uninstall_output.lines() {
                emit_uninstall_line(&window, line).await?;
            }
        }

        emit_uninstall_line(&window, "正在暂存 API、飞书配置和 Skills…").await?;
        let preserve_dir = preserve_root()?;
        if preserve_dir.exists() {
            fs::remove_dir_all(&preserve_dir).await.map_err(|e| e.to_string())?;
        }
        preserve_api_and_skills(&preserve_dir).await?;

        let cleanup_result: Result<(), String> = async {
            emit_uninstall_line(&window, "正在清理运行时目录、日志、会话和飞书数据…").await?;
            remove_runtime_data().await?;

            emit_uninstall_line(&window, "正在恢复保留的 API、飞书配置和 Skills…").await?;
            restore_preserved_api_and_skills(&preserve_dir).await?;
            Ok(())
        }
        .await;

        if let Err(error) = cleanup_result {
            let _ = restore_preserved_api_and_skills(&preserve_dir).await;
            return Err(error);
        }

        emit_uninstall_line(&window, "彻底卸载完成。").await?;
        Ok(())
    }
    .await;

    let status = if result.is_ok() { "success" } else { "failed" };
    window
        .emit("uninstall-done", status)
        .map_err(|e| e.to_string())?;

    result
}
