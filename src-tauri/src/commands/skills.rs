use dirs::home_dir;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use tauri::Emitter;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::commands::runtime::{clean_openclaw_output, run_shell, shell_escape, spawn_shell};

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct SkillMissing {
    pub bins: Vec<String>,
    #[serde(rename = "anyBins")]
    pub any_bins: Vec<String>,
    pub env: Vec<String>,
    pub config: Vec<String>,
    pub os: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct AvailableSkill {
    pub name: String,
    pub description: String,
    pub emoji: Option<String>,
    pub eligible: bool,
    pub disabled: bool,
    #[serde(rename = "blockedByAllowlist")]
    pub blocked_by_allowlist: bool,
    pub source: String,
    pub bundled: bool,
    pub homepage: Option<String>,
    pub missing: SkillMissing,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(default)]
struct SkillListResponse {
    pub skills: Vec<AvailableSkill>,
}

fn default_workspace_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".openclaw").join("workspace"))
}

fn openclaw_config_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".openclaw").join("openclaw.json"))
}

async fn workspace_dir() -> Result<PathBuf, String> {
    let fallback = default_workspace_dir().ok_or("Cannot determine home directory")?;

    let Some(config_path) = openclaw_config_path() else {
        return Ok(fallback);
    };

    if !config_path.exists() {
        return Ok(fallback);
    }

    let content = fs::read_to_string(&config_path)
        .await
        .map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let configured = value
        .get("agents")
        .and_then(|v| v.get("defaults"))
        .and_then(|v| v.get("workspace"))
        .and_then(|v| v.as_str())
        .map(PathBuf::from);

    Ok(configured.unwrap_or(fallback))
}

fn clawhub_bootstrap_script() -> &'static str {
    r#"export CLAWHUB_DISABLE_TELEMETRY=1
if ! command -v clawhub >/dev/null 2>&1; then
  echo "首次准备 ClawHub CLI…"
  npm i -g clawhub || exit $?
fi"#
}

fn clawhub_retry_script(command: &str, label: &str) -> String {
    format!(
        r#"{bootstrap}
attempt=1
until [ $attempt -gt 3 ]
do
  echo "{label}（第 $attempt/3 次）"
  {command} && break
  status=$?
  if [ $attempt -eq 3 ]; then
    exit $status
  fi
  echo "遇到限流或网络波动，3 秒后重试…"
  sleep 3
  attempt=$((attempt + 1))
done"#,
        bootstrap = clawhub_bootstrap_script(),
        label = label,
        command = command
    )
}

fn installed_skill_dirs(workspace: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![workspace.join("skills")];

    if let Some(home) = home_dir() {
        dirs.push(home.join(".openclaw").join("skills"));
    }

    dirs
}

async fn collect_skill_names(dir: &Path, skills: &mut BTreeSet<String>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }

    let mut read_dir = fs::read_dir(dir).await.map_err(|e| e.to_string())?;

    while let Some(entry) = read_dir.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        let file_type = entry.file_type().await.map_err(|e| e.to_string())?;

        if file_type.is_dir() {
            if path.join("SKILL.md").exists() {
                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                    skills.insert(name.to_string());
                }
            }
            continue;
        }

        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                skills.insert(stem.to_string());
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn list_available_skills() -> Result<Vec<AvailableSkill>, String> {
    let output = clean_openclaw_output(&run_shell("openclaw skills list --json").await?);
    let parsed: SkillListResponse =
        serde_json::from_str(&output).map_err(|e| format!("Failed to parse skill list: {e}"))?;
    Ok(parsed.skills)
}

#[tauri::command]
pub async fn get_installed_skills() -> Result<Vec<String>, String> {
    let workspace = workspace_dir().await?;
    let mut skills = BTreeSet::new();

    for dir in installed_skill_dirs(&workspace) {
        collect_skill_names(&dir, &mut skills).await?;
    }

    Ok(skills.into_iter().collect())
}

#[tauri::command]
pub async fn install_skill(name: String, window: tauri::Window) -> Result<(), String> {
    let workspace = workspace_dir().await?;
    let workspace = shell_escape(&workspace.to_string_lossy());
    let skill = shell_escape(name.trim());
    let cmd = format!(
        "mkdir -p {workspace}; cd {workspace} && {} 2>&1",
        clawhub_retry_script(&format!("clawhub install {skill}"), &format!("安装 {}", name.trim()))
    );

    let mut child = spawn_shell(&cmd)?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let mut reader = BufReader::new(stdout).lines();

    while let Some(line) = reader.next_line().await.map_err(|e| e.to_string())? {
        window
            .emit("skill-output", &line)
            .map_err(|e| e.to_string())?;
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;

    if status.success() {
        window
            .emit("skill-done", ("success", &name))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        window
            .emit("skill-done", ("failed", &name))
            .map_err(|e| e.to_string())?;
        Err(format!("Failed to install skill: {}", name))
    }
}

#[tauri::command]
pub async fn uninstall_skill(name: String, window: tauri::Window) -> Result<(), String> {
    let workspace = workspace_dir().await?;
    let workspace = shell_escape(&workspace.to_string_lossy());
    let skill = shell_escape(name.trim());
    let cmd = format!(
        "mkdir -p {workspace}; cd {workspace} && {} 2>&1",
        clawhub_retry_script(
            &format!("clawhub uninstall --yes {skill}"),
            &format!("移除 {}", name.trim())
        )
    );

    let mut child = spawn_shell(&cmd)?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let mut reader = BufReader::new(stdout).lines();

    while let Some(line) = reader.next_line().await.map_err(|e| e.to_string())? {
        window
            .emit("skill-output", &line)
            .map_err(|e| e.to_string())?;
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;

    if status.success() {
        window
            .emit("skill-done", ("success", &name))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("Failed to uninstall skill: {}", name))
    }
}
