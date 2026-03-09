use chrono::Local;
use dirs::home_dir;
use serde_json::Value;
use std::path::PathBuf;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::{fs, time::{sleep, Duration}};

use crate::commands::runtime::{output_text, run_shell_output, shell_escape, spawn_shell};

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct GatewayStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub message: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DoctorAction {
    pub id: String,
    pub label: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DoctorFinding {
    pub id: String,
    pub level: String,
    pub title: String,
    pub summary: String,
    pub detail: Option<String>,
    pub actions: Vec<DoctorAction>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub level: String,
    pub title: String,
    pub summary: String,
    pub findings: Vec<DoctorFinding>,
}

#[derive(serde::Deserialize)]
struct PluginListResponse {
    plugins: Vec<PluginListItem>,
}

#[derive(serde::Deserialize)]
struct PluginListItem {
    id: String,
    status: String,
    enabled: Option<bool>,
}

#[derive(Clone, Debug)]
struct OfficialDoctorSection {
    title: String,
    lines: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecurityAuditReport {
    findings: Vec<SecurityAuditFinding>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecurityAuditFinding {
    check_id: String,
    severity: String,
    title: String,
    detail: Option<String>,
    remediation: Option<String>,
}

#[tauri::command]
pub async fn get_gateway_status() -> Result<GatewayStatus, String> {
    let health_result = run_shell_output("openclaw gateway health >/dev/null 2>&1").await?;
    let result = run_shell_output("openclaw gateway status 2>&1").await?;
    let combined = output_text(&result);
    let runtime_running = gateway_status_indicates_running(&combined);

    if health_result.status.success() {
        return Ok(GatewayStatus {
            running: true,
            pid: extract_runtime_pid(&combined).or_else(|| extract_pid(&combined)),
            message: if combined.trim().is_empty() {
                "Gateway running".to_string()
            } else {
                combined.trim().to_string()
            },
        });
    }

    // Parse common status patterns
    let running = combined.to_lowercase().contains("running")
        || combined.to_lowercase().contains("active")
        || combined.to_lowercase().contains("started");

    let stopped = combined.to_lowercase().contains("stopped")
        || combined.to_lowercase().contains("not running")
        || combined.to_lowercase().contains("inactive");

    if !result.status.success() && !running {
        return Ok(GatewayStatus {
            running: false,
            pid: None,
            message: if combined.trim().is_empty() {
                "Gateway not running".to_string()
            } else {
                combined.trim().to_string()
            },
        });
    }

    // Extract PID if present
    let pid = extract_pid(&combined);

    Ok(GatewayStatus {
        running: runtime_running || (running && !stopped),
        pid: extract_runtime_pid(&combined).or(pid),
        message: combined.trim().to_string(),
    })
}

fn extract_pid(output: &str) -> Option<u32> {
    for word in output.split_whitespace() {
        if let Ok(n) = word.parse::<u32>() {
            if n > 1 {
                return Some(n);
            }
        }
    }
    None
}

fn gateway_status_indicates_running(output: &str) -> bool {
    let lower = output.to_lowercase();
    lower.contains("runtime: running")
        || lower.contains("state active")
        || lower.contains("listening:")
}

fn gateway_status_is_loopback_only(output: &str) -> bool {
    output.contains("Listening: 127.0.0.1:")
        || output.contains("Probe note: Loopback-only gateway")
        || output.contains("Source: local loopback")
}

fn extract_runtime_pid(output: &str) -> Option<u32> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.to_lowercase().starts_with("runtime: running (pid ") {
            let pid_text = trimmed
                .split("pid ")
                .nth(1)
                .and_then(|rest| rest.split(',').next())
                .map(str::trim);

            if let Some(pid_text) = pid_text {
                if let Ok(pid) = pid_text.parse::<u32>() {
                    return Some(pid);
                }
            }
        }
    }

    None
}

fn home_path() -> Result<PathBuf, String> {
    home_dir().ok_or_else(|| "Cannot determine home directory".to_string())
}

fn workspace_dir() -> Result<PathBuf, String> {
    Ok(home_path()?.join(".openclaw").join("workspace"))
}

fn sessions_dir() -> Result<PathBuf, String> {
    Ok(home_path()?
        .join(".openclaw")
        .join("agents")
        .join("main")
        .join("sessions"))
}

fn prompt_file_names() -> &'static [&'static str] {
    &[
        "AGENTS.md",
        "BOOTSTRAP.md",
        "HEARTBEAT.md",
        "IDENTITY.md",
        "SOUL.md",
        "SYSTEM.md",
        "TOOLS.md",
        "USER.md",
    ]
}

fn timestamp_tag() -> String {
    Local::now().format("%Y%m%d-%H%M%S").to_string()
}

fn finding(
    id: &str,
    level: &str,
    title: impl Into<String>,
    summary: impl Into<String>,
    detail: Option<String>,
    actions: Vec<DoctorAction>,
) -> DoctorFinding {
    DoctorFinding {
        id: id.to_string(),
        level: level.to_string(),
        title: title.into(),
        summary: summary.into(),
        detail,
        actions,
    }
}

fn action(id: &str, label: &str) -> DoctorAction {
    DoctorAction {
        id: id.to_string(),
        label: label.to_string(),
    }
}

fn summarize_gateway_health(raw: &str) -> Option<String> {
    let lines = raw
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| {
            !line.starts_with("Service:")
                && !line.starts_with("File logs:")
                && !line.starts_with("Command:")
                && !line.starts_with("Service file:")
                && !line.starts_with("Service env:")
                && !line.starts_with("Config ")
                && !line.starts_with("Gateway:")
                && !line.starts_with("Probe target:")
                && !line.starts_with("Dashboard:")
                && !line.starts_with("Runtime:")
                && !line.starts_with("Listening:")
                && !line.starts_with("Troubles")
                && !line.starts_with("Troubleshooting:")
        })
        .take(4)
        .collect::<Vec<_>>();

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn normalize_box_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("▄▄")
        || trimmed.contains("🦞 OPENCLAW")
        || trimmed == "┌  OpenClaw doctor"
        || trimmed == "│"
        || trimmed.starts_with("Run \"openclaw doctor --fix\"")
        || trimmed == "└  Doctor complete."
    {
        return None;
    }

    if let Some(rest) = trimmed.strip_prefix("◇") {
        return Some(format!("SECTION:{}", rest.trim()));
    }

    if let Some(rest) = trimmed.strip_prefix('│') {
        let content = rest
            .trim()
            .trim_matches('│')
            .trim_matches('|')
            .trim();
        if content.is_empty() {
            return None;
        }
        return Some(content.trim_start_matches("- ").to_string());
    }

    if let Some(rest) = trimmed.strip_prefix("└") {
        let content = rest
            .trim()
            .trim_matches('│')
            .trim_matches('|')
            .trim();
        if !content.is_empty() {
            return Some(content.trim_start_matches("- ").to_string());
        }
    }

    None
}

fn has_negative_security_phrase(text: &str) -> bool {
    text.contains("no channel security warnings detected")
}

fn has_real_warning(text: &str) -> bool {
    text.contains("warning") && !has_negative_security_phrase(text)
}

fn clean_section_title(raw: &str) -> String {
    raw.split('─').next().unwrap_or(raw).trim().to_string()
}

fn parse_official_doctor_sections(raw: &str) -> Vec<OfficialDoctorSection> {
    let mut sections = Vec::new();
    let mut current: Option<OfficialDoctorSection> = None;

    for line in raw.lines() {
        let Some(normalized) = normalize_box_line(line) else {
            continue;
        };

        if let Some(title) = normalized.strip_prefix("SECTION:") {
            if let Some(section) = current.take() {
                if !section.lines.is_empty() {
                    sections.push(section);
                }
            }

            current = Some(OfficialDoctorSection {
                title: clean_section_title(title),
                lines: Vec::new(),
            });
            continue;
        }

        if let Some(section) = current.as_mut() {
            section.lines.push(normalized);
        }
    }

    if let Some(section) = current {
        if !section.lines.is_empty() {
            sections.push(section);
        }
    }

    sections
}

fn is_problem_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    has_real_warning(&lower)
        || lower.contains("recommend")
        || lower.contains("does not match")
        || lower.contains("not running")
        || lower.contains("not configured")
        || lower.contains("already in use")
        || lower.contains("failed")
        || lower.contains("too open")
        || lower.contains("not ready")
        || lower.contains("no embedding provider")
        || lower.contains("runtime error")
        || lower.contains("permission")
}

fn official_section_level(title: &str, lines: &[String]) -> Option<String> {
    let joined = lines.join("\n").to_lowercase();
    let title_lower = title.to_lowercase();

    if joined.contains("gateway not running") {
        return Some("error".to_string());
    }

    if joined.contains("not configured") && joined.contains("feishu") {
        return Some("error".to_string());
    }

    if joined.contains("does not match the current install")
        || joined.contains("too open")
        || joined.contains("already in use")
        || has_real_warning(&joined)
        || joined.contains("not ready")
    {
        return Some("warn".to_string());
    }

    if title_lower.contains("memory search") && joined.contains("no embedding provider") {
        return Some("info".to_string());
    }

    if lines.iter().any(|line| is_problem_line(line)) {
        return Some("warn".to_string());
    }

    None
}

fn official_section_actions(title: &str, lines: &[String]) -> Vec<DoctorAction> {
    let joined = lines.join("\n").to_lowercase();
    let title_lower = title.to_lowercase();
    let mut actions = Vec::new();

    if joined.contains("gateway not running") {
        actions.push(action("startGateway", "启动网关"));
    }

    if joined.contains("feishu: not configured") || (joined.contains("not configured") && joined.contains("feishu")) {
        actions.push(action("goFeishu", "去飞书配置"));
    }

    if title_lower.contains("state integrity") || joined.contains("too open") {
        actions.push(action("tightenStatePermissions", "收紧目录权限"));
    }

    if title_lower.contains("gateway service config")
        || joined.contains("does not match the current install")
        || joined.contains("already in use")
    {
        actions.push(action("repairGatewayService", "修复网关服务"));
    }

    if title_lower.contains("memory search") && joined.contains("no embedding provider") {
        actions.push(action("disableMemorySearch", "关闭记忆搜索"));
    }

    if actions.is_empty() && has_real_warning(&joined) {
        actions.push(action("officialFix", "尝试自动修复"));
    }

    actions
}

fn official_section_title(title: &str, lines: &[String]) -> String {
    let joined = lines.join("\n").to_lowercase();
    let title_lower = title.to_lowercase();

    if joined.contains("gateway not running") {
        return "网关未运行".to_string();
    }

    if joined.contains("feishu: not configured") || (joined.contains("not configured") && joined.contains("feishu")) {
        return "飞书未配置".to_string();
    }

    if title_lower.contains("state integrity") {
        return "本地状态目录权限过宽".to_string();
    }

    if title_lower.contains("gateway service config") {
        return "网关服务配置过期".to_string();
    }

    if title_lower.contains("security") {
        return "存在安全风险".to_string();
    }

    if title_lower.contains("memory search") {
        return "记忆搜索未完整配置".to_string();
    }

    if title_lower.contains("gateway port") {
        return "网关端口冲突".to_string();
    }

    title.to_string()
}

fn official_section_summary(title: &str, lines: &[String]) -> String {
    let title_lower = title.to_lowercase();
    let joined = lines.join("\n");

    if title_lower.contains("state integrity") {
        return "本地状态目录权限太宽，建议收紧权限。".to_string();
    }

    if title_lower.contains("gateway service config") {
        return "当前网关服务指向的安装入口已经过期。".to_string();
    }

    if title_lower.contains("security") {
        return "当前网关暴露方式有安全风险。".to_string();
    }

    if joined.to_lowercase().contains("gateway not running") {
        return "网关当前没有正常工作。".to_string();
    }

    if joined.to_lowercase().contains("feishu: not configured") {
        return "当前飞书通道没有配置完成。".to_string();
    }

    if title_lower.contains("memory search") {
        return "记忆检索没配嵌入模型，这不是主链路必需项，可以直接关闭。".to_string();
    }

    if title_lower.contains("gateway port") {
        return "网关端口被占用，可能有重复进程或旧服务残留。".to_string();
    }

    lines.first().cloned().unwrap_or_else(|| format!("{title} 中发现了问题。"))
}

async fn official_doctor_findings() -> Result<Vec<DoctorFinding>, String> {
    let output = run_shell_output("openclaw doctor --no-workspace-suggestions 2>&1").await?;
    let raw = output_text(&output);
    let sections = parse_official_doctor_sections(&raw);
    let mut findings = Vec::new();

    for section in sections {
        let Some(level) = official_section_level(&section.title, &section.lines) else {
            continue;
        };

        let detail = Some(section.lines.join("\n"));
        findings.push(finding(
            &format!("official-{}", section.title.to_lowercase().replace(' ', "-")),
            &level,
            official_section_title(&section.title, &section.lines),
            official_section_summary(&section.title, &section.lines),
            detail,
            official_section_actions(&section.title, &section.lines),
        ));
    }

    Ok(findings)
}

fn should_hide_official_finding(item: &DoctorFinding, gateway_status_text: &str) -> bool {
    if item.title == "存在安全风险" && gateway_status_is_loopback_only(gateway_status_text) {
        return true;
    }

    if item.title == "网关未运行" && gateway_status_indicates_running(gateway_status_text) {
        return true;
    }

    if item.title == "网关端口冲突" {
        if let Some(runtime_pid) = extract_runtime_pid(gateway_status_text) {
            if item
                .detail
                .as_ref()
                .is_some_and(|detail| detail.contains(&format!("pid {runtime_pid}:")))
            {
                return true;
            }
        }
    }

    false
}

async fn list_workspace_prompt_files() -> Result<Vec<String>, String> {
    let workspace = workspace_dir()?;
    let mut files = Vec::new();

    for name in prompt_file_names() {
        if workspace.join(name).exists() {
            files.push((*name).to_string());
        }
    }

    Ok(files)
}

fn strip_front_matter(raw: &str) -> String {
    if !raw.starts_with("---\n") {
        return raw.trim().to_string();
    }

    if let Some(end_index) = raw[4..].find("\n---\n") {
        return raw[(end_index + 8)..].trim().to_string();
    }

    raw.trim().to_string()
}

async fn load_default_template_variants(file_name: &str) -> Result<Vec<String>, String> {
    let output = run_shell_output("npm root -g 2>/dev/null").await?;
    let npm_root = output_text(&output).trim().to_string();
    if npm_root.is_empty() {
        return Ok(Vec::new());
    }

    let base = PathBuf::from(npm_root).join("openclaw").join("docs");
    let candidates = [
        base.join("reference").join("templates").join(file_name),
        base.join("zh-CN").join("reference").join("templates").join(file_name),
    ];

    let mut variants = Vec::new();
    for path in candidates {
        if path.exists() {
            let content = fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
            variants.push(strip_front_matter(&content));
        }
    }

    Ok(variants)
}

async fn list_suspicious_workspace_prompt_files() -> Result<Vec<String>, String> {
    let workspace = workspace_dir()?;
    let files = list_workspace_prompt_files().await?;
    let mut suspicious = Vec::new();

    for file_name in files {
        let current_path = workspace.join(&file_name);
        let current_content = fs::read_to_string(&current_path)
            .await
            .map_err(|e| e.to_string())?;
        let normalized_current = current_content.trim().to_string();
        let variants = load_default_template_variants(&file_name).await?;
        let is_official_default = variants
            .iter()
            .any(|variant| variant == &normalized_current);

        if !is_official_default {
            suspicious.push(file_name);
        }
    }

    Ok(suspicious)
}

async fn get_feishu_session_count() -> Result<usize, String> {
    let sessions_path = sessions_dir()?.join("sessions.json");
    if !sessions_path.exists() {
        return Ok(0);
    }

    let content = fs::read_to_string(&sessions_path)
        .await
        .map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let count = value
        .as_object()
        .map(|obj| obj.keys().filter(|key| key.contains(":feishu:")).count())
        .unwrap_or(0);
    Ok(count)
}

async fn get_feishu_plugin_status() -> Result<Option<String>, String> {
    let output = run_shell_output("openclaw plugins list --json 2>&1").await?;
    let cleaned = crate::commands::runtime::clean_openclaw_output(&output_text(&output));
    if cleaned.is_empty() {
        return Ok(None);
    }

    let parsed: PluginListResponse =
        serde_json::from_str(&cleaned).map_err(|e| format!("Failed to parse plugins list: {e}"))?;
    Ok(parsed
        .plugins
        .into_iter()
        .find(|plugin| plugin.id == "feishu")
        .map(|plugin| plugin.status))
}

fn security_level(severity: &str) -> String {
    match severity {
        "critical" => "error".to_string(),
        "warn" => "warn".to_string(),
        "info" => "info".to_string(),
        _ => "info".to_string(),
    }
}

fn security_title(check_id: &str, fallback: &str) -> String {
    match check_id {
        "summary.attack_surface" => "攻击面概览".to_string(),
        "gateway.trusted_proxies_missing" => "未配置受信任代理".to_string(),
        "channels.feishu.doc_owner_open_id" => "飞书文档工具权限偏宽".to_string(),
        "plugins.extensions_no_allowlist" => "插件白名单未锁定".to_string(),
        "gateway.probe_failed" => "安全探测未通过".to_string(),
        _ => fallback.to_string(),
    }
}

fn security_summary(check_id: &str, fallback: &str) -> String {
    match check_id {
        "summary.attack_surface" => "当前会列出最主要的安全暴露面，方便你快速判断风险边界。".to_string(),
        "gateway.trusted_proxies_missing" => {
            "如果你会用反向代理暴露 Control UI，就必须配置 trustedProxies；纯本机使用可暂时忽略。".to_string()
        }
        "channels.feishu.doc_owner_open_id" => {
            "飞书文档工具允许按请求者身份分配文档权限，不需要时建议直接关闭。".to_string()
        }
        "plugins.extensions_no_allowlist" => {
            "当前没有显式插件白名单，后续发现到的扩展插件可能被加载。".to_string()
        }
        "gateway.probe_failed" => "安全审计的实时探测没有通过，需要结合网关状态一起排查。".to_string(),
        _ => fallback.to_string(),
    }
}

fn security_actions(check_id: &str) -> Vec<DoctorAction> {
    match check_id {
        "channels.feishu.doc_owner_open_id" => {
            vec![action("disableFeishuDocTool", "关闭飞书文档工具")]
        }
        "plugins.extensions_no_allowlist" => {
            vec![action("lockPluginAllowlist", "锁定插件白名单")]
        }
        "gateway.probe_failed" => vec![action("repairGatewayService", "修复网关服务")],
        _ => Vec::new(),
    }
}

async fn security_audit_findings() -> Result<Vec<DoctorFinding>, String> {
    let output = run_shell_output("openclaw security audit --deep --json 2>&1").await?;
    let cleaned = output_text(&output);
    let parsed: SecurityAuditReport =
        serde_json::from_str(&cleaned).map_err(|e| format!("Failed to parse security audit: {e}"))?;

    Ok(parsed
        .findings
        .into_iter()
        .map(|item| {
            let mut detail_parts = Vec::new();
            if let Some(detail) = item.detail.clone() {
                detail_parts.push(detail);
            }
            if let Some(remediation) = item.remediation.clone() {
                detail_parts.push(format!("建议：{remediation}"));
            }

            finding(
                &format!("security-{}", item.check_id.replace('.', "-")),
                &security_level(&item.severity),
                security_title(&item.check_id, &item.title),
                security_summary(&item.check_id, &item.title),
                if detail_parts.is_empty() {
                    None
                } else {
                    Some(detail_parts.join("\n"))
                },
                security_actions(&item.check_id),
            )
        })
        .collect())
}

fn overall_level(findings: &[DoctorFinding]) -> String {
    if findings.iter().any(|item| item.level == "error") {
        "error".to_string()
    } else if findings.iter().any(|item| item.level == "warn") {
        "warn".to_string()
    } else if findings.iter().any(|item| item.level == "info") {
        "info".to_string()
    } else {
        "ok".to_string()
    }
}

fn overall_summary(findings: &[DoctorFinding]) -> (String, String) {
    let error_count = findings.iter().filter(|item| item.level == "error").count();
    let warn_count = findings.iter().filter(|item| item.level == "warn").count();
    let info_count = findings.iter().filter(|item| item.level == "info").count();

    if error_count > 0 {
        let mut parts = vec![format!("{error_count} 个需要立即处理的问题")];
        if warn_count > 0 {
            parts.push(format!("{warn_count} 个建议处理项"));
        }
        (
            "发现使用问题".to_string(),
            format!("本次检查发现 {}。按下面提示处理后，再回飞书测试。", parts.join("，")),
        )
    } else if warn_count > 0 {
        let mut parts = vec![format!("{warn_count} 个建议处理项")];
        if info_count > 0 {
            parts.push(format!("{info_count} 个可选优化项"));
        }
        (
            "发现可修复项".to_string(),
            format!("当前主链路基本可用，但还有 {}。", parts.join("，")),
        )
    } else if info_count > 0 {
        (
            "当前状态基本正常".to_string(),
            "主链路已就绪。如果机器人回复串台，可按下面建议做重置。".to_string(),
        )
    } else {
        (
            "当前状态正常".to_string(),
            "安装、配置、飞书插件和网关都没有发现明显问题。".to_string(),
        )
    }
}

#[tauri::command]
pub async fn start_gateway() -> Result<(), String> {
    let _ = run_shell_output(
        "openclaw config set gateway.bind loopback >/dev/null 2>&1 || true; \
         openclaw config set gateway.customBindHost 127.0.0.1 >/dev/null 2>&1 || true; \
         openclaw gateway install >/dev/null 2>&1 || true",
    )
    .await;

    let result = run_shell_output("openclaw gateway start 2>&1").await?;

    if result.status.success() {
        return Ok(());
    }

    let fallback = run_shell_output(
        "mkdir -p \"$HOME/.openclaw\"; \
         nohup openclaw gateway run --bind custom >/tmp/openclaw_gateway.log 2>&1 </dev/null & \
         echo $! > \"$HOME/.openclaw/runclaw-gateway.pid\"; \
         sleep 2; openclaw gateway health 2>&1",
    )
    .await?;

    if fallback.status.success() {
        Ok(())
    } else {
        Err(format!("{}{}", output_text(&result), output_text(&fallback))
            .trim()
            .to_string())
    }
}

#[tauri::command]
pub async fn stop_gateway() -> Result<(), String> {
    let result = run_shell_output(
        "openclaw gateway stop >/dev/null 2>&1 || true; \
         if [ -f \"$HOME/.openclaw/runclaw-gateway.pid\" ]; then \
           kill \"$(cat \"$HOME/.openclaw/runclaw-gateway.pid\")\" >/dev/null 2>&1 || true; \
           rm -f \"$HOME/.openclaw/runclaw-gateway.pid\"; \
         fi; \
         echo stopped",
    )
    .await?;

    if result.status.success() {
        Ok(())
    } else {
        Err(output_text(&result))
    }
}

#[tauri::command]
pub async fn restart_gateway() -> Result<(), String> {
    let result = run_shell_output("openclaw gateway restart 2>&1").await?;
    if result.status.success() {
        sleep(Duration::from_secs(2)).await;
        return Ok(());
    }

    stop_gateway().await?;
    start_gateway().await?;
    sleep(Duration::from_secs(2)).await;
    Ok(())
}

#[tauri::command]
pub async fn disable_memory_search() -> Result<String, String> {
    let result = run_shell_output(
        "openclaw config set agents.defaults.memorySearch.enabled false 2>&1",
    )
    .await?;

    if result.status.success() {
        Ok("已关闭记忆搜索。".to_string())
    } else {
        Err(output_text(&result))
    }
}

#[tauri::command]
pub async fn tighten_state_permissions() -> Result<String, String> {
    let state_dir = home_path()?.join(".openclaw");
    let command = format!("chmod 700 {}", shell_escape(&state_dir.display().to_string()));
    let result = run_shell_output(&command).await?;

    if result.status.success() {
        Ok("已收紧本地状态目录权限。".to_string())
    } else {
        Err(output_text(&result))
    }
}

#[tauri::command]
pub async fn repair_gateway_service() -> Result<String, String> {
    let plist_path = home_path()?
        .join("Library")
        .join("LaunchAgents")
        .join("ai.openclaw.gateway.plist");
    let plist_escaped = shell_escape(&plist_path.display().to_string());

    let _ = run_shell_output(
        "openclaw config set gateway.bind loopback >/dev/null 2>&1 || true; \
         openclaw config set gateway.customBindHost 127.0.0.1 >/dev/null 2>&1 || true",
    )
    .await?;

    let _ =
        run_shell_output("launchctl bootout gui/$(id -u)/ai.openclaw.gateway >/dev/null 2>&1 || true").await?;
    let install = run_shell_output("openclaw gateway install --force 2>&1 || true").await?;
    let install_text = output_text(&install);
    let _ = run_shell_output(&format!(
        "launchctl bootstrap gui/$(id -u) {} >/dev/null 2>&1 || true",
        plist_escaped
    ))
    .await?;
    let _ = run_shell_output(
        "openclaw gateway restart >/dev/null 2>&1 || openclaw gateway start >/dev/null 2>&1 || true",
    )
    .await?;
    sleep(Duration::from_secs(2)).await;

    let status = run_shell_output("openclaw gateway status 2>&1").await?;
    let status_text = output_text(&status);

    if status_text.contains("dist/index.js") {
        Ok("已重装并重新加载网关服务。".to_string())
    } else if install_text.is_empty() {
        Err(status_text)
    } else {
        Err(format!("{install_text}\n{status_text}").trim().to_string())
    }
}

#[tauri::command]
pub async fn disable_feishu_doc_tool() -> Result<String, String> {
    let result =
        run_shell_output("openclaw config set channels.feishu.tools.doc false 2>&1").await?;
    if !result.status.success() {
        return Err(output_text(&result));
    }

    let _ = restart_gateway().await;
    Ok("已关闭飞书文档工具，并尝试重启网关。".to_string())
}

#[tauri::command]
pub async fn lock_plugin_allowlist() -> Result<String, String> {
    let output = run_shell_output("openclaw plugins list --json 2>&1").await?;
    let cleaned = crate::commands::runtime::clean_openclaw_output(&output_text(&output));
    let parsed: PluginListResponse =
        serde_json::from_str(&cleaned).map_err(|e| format!("Failed to parse plugins list: {e}"))?;

    let allowed = parsed
        .plugins
        .into_iter()
        .filter(|plugin| plugin.enabled.unwrap_or(false))
        .map(|plugin| plugin.id)
        .collect::<Vec<_>>();

    if allowed.is_empty() {
        return Err("当前没有可锁定的已启用插件。".to_string());
    }

    let payload = serde_json::to_string(&allowed).map_err(|e| e.to_string())?;
    let command = format!("openclaw config set plugins.allow {} 2>&1", shell_escape(&payload));
    let result = run_shell_output(&command).await?;
    if !result.status.success() {
        return Err(output_text(&result));
    }

    let _ = restart_gateway().await;
    Ok(format!("已锁定插件白名单：{}。", allowed.join("、")))
}

#[tauri::command]
pub async fn reset_feishu_sessions() -> Result<String, String> {
    let sessions_root = sessions_dir()?;
    let sessions_path = sessions_root.join("sessions.json");
    if !sessions_path.exists() {
        return Ok("当前没有可重置的飞书会话。".to_string());
    }

    let content = fs::read_to_string(&sessions_path)
        .await
        .map_err(|e| e.to_string())?;
    let mut value: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let Some(obj) = value.as_object_mut() else {
        return Err("会话文件格式异常，无法重置。".to_string());
    };

    let keys = obj
        .keys()
        .filter(|key| key.contains(":feishu:"))
        .cloned()
        .collect::<Vec<_>>();

    if keys.is_empty() {
        return Ok("当前没有可重置的飞书会话。".to_string());
    }

    let backup_dir = sessions_root.join(format!(".runclaw-backup-{}", timestamp_tag()));
    fs::create_dir_all(&backup_dir)
        .await
        .map_err(|e| e.to_string())?;
    fs::copy(&sessions_path, backup_dir.join("sessions.json.bak"))
        .await
        .map_err(|e| e.to_string())?;

    let mut moved_files = 0usize;
    for key in keys {
        let session_file = obj
            .get(&key)
            .and_then(|entry| entry.get("sessionFile"))
            .and_then(|file| file.as_str())
            .map(PathBuf::from);

        obj.remove(&key);

        if let Some(path) = session_file {
            if path.exists() {
                let file_name = path
                    .file_name()
                    .ok_or_else(|| "Invalid session file path".to_string())?;
                fs::rename(&path, backup_dir.join(file_name))
                    .await
                    .map_err(|e| e.to_string())?;
                moved_files += 1;
            }
        }
    }

    let updated = serde_json::to_string_pretty(&Value::Object(obj.clone()))
        .map_err(|e| e.to_string())?;
    fs::write(&sessions_path, updated)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!(
        "已重置飞书会话，并备份了 {moved_files} 个历史会话文件。"
    ))
}

#[tauri::command]
pub async fn quarantine_workspace_prompts() -> Result<String, String> {
    let workspace = workspace_dir()?;
    let files = list_suspicious_workspace_prompt_files().await?;

    if files.is_empty() {
        return Ok("当前没有需要隔离的异常提示词文件。".to_string());
    }

    let backup_dir = workspace.join(format!(".runclaw-disabled-prompts-{}", timestamp_tag()));
    fs::create_dir_all(&backup_dir)
        .await
        .map_err(|e| e.to_string())?;

    for file in &files {
        let source = workspace.join(file);
        if source.exists() {
            fs::rename(&source, backup_dir.join(file))
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(format!(
        "已隔离 {} 个异常提示词文件，防止继续污染机器人回复。",
        files.len()
    ))
}

#[tauri::command]
pub async fn diagnose_runtime() -> Result<DoctorReport, String> {
    let mut findings = Vec::new();

    let install_check = run_shell_output("command -v openclaw >/dev/null 2>&1").await?;
    let is_installed = install_check.status.success();

    if !is_installed {
        findings.push(finding(
            "install",
            "error",
            "openclaw 还没安装",
            "当前机器还没有可用的 openclaw CLI，后续网关和飞书都不会工作。",
            None,
            vec![action("installOpenclaw", "去安装状态")],
        ));
    } else {
        findings.push(finding(
            "install",
            "ok",
            "openclaw 已安装",
            "CLI 已安装，养养龙虾可以继续检查配置、飞书和网关状态。",
            None,
            vec![],
        ));
    }

    if is_installed {
        let gateway_status_text = output_text(&run_shell_output("openclaw gateway status 2>&1").await?);
        findings.extend(
            official_doctor_findings()
                .await?
                .into_iter()
                .filter(|item| !should_hide_official_finding(item, &gateway_status_text)),
        );
        findings.extend(security_audit_findings().await?);

        let workspace_files = list_suspicious_workspace_prompt_files().await?;
        if workspace_files.is_empty() {
            findings.push(finding(
                "workspace",
                "ok",
                "没有发现异常提示词文件",
                "养养龙虾没有发现偏离 OpenClaw 默认模板的额外提示词文件。",
                None,
                vec![],
            ));
        } else {
            findings.push(finding(
                "workspace",
                "warn",
                "发现异常提示词文件",
                "这些文件不是 OpenClaw 默认模板，可能会污染机器人的人格和回复内容。",
                Some(format!("已检测到：{}", workspace_files.join("、"))),
                vec![action("quarantineWorkspacePrompts", "隔离这些文件")],
            ));
        }

        let feishu_session_count = get_feishu_session_count().await?;
        if feishu_session_count == 0 {
            findings.push(finding(
                "sessions",
                "ok",
                "当前没有历史飞书会话",
                "新的私聊消息会从干净会话开始。",
                None,
                vec![],
            ));
        } else {
            findings.push(finding(
                "sessions",
                "info",
                "发现历史飞书会话",
                format!(
                    "当前保留了 {feishu_session_count} 个飞书会话。如果机器人一直接着旧话题回复，可以直接重置。"
                ),
                None,
                vec![action("resetFeishuSessions", "重置飞书会话")],
            ));
        }

        let gateway = get_gateway_status().await?;
        let health_output = run_shell_output("openclaw gateway health 2>&1").await?;
        let health_text = crate::commands::runtime::clean_openclaw_output(&output_text(&health_output));
        if gateway.running && !health_output.status.success() {
            findings.push(finding(
                "gateway-probe",
                "warn",
                "养养龙虾发现网关探测异常",
                "虽然进程在运行，但本地探测没有完全通过。这类问题有时详细诊断里也不会直接说清。",
                summarize_gateway_health(&health_text),
                vec![action("restartGateway", "重启网关"), action("repairGatewayService", "修复网关服务")],
            ));
        }

        if let Some(status) = get_feishu_plugin_status().await? {
            if status != "loaded" {
                findings.push(finding(
                    "feishu-plugin",
                    "warn",
                    "养养龙虾发现飞书插件状态异常",
                    "飞书插件没有正常加载时，长连接和消息收发会不稳定。",
                    Some(format!("当前插件状态：{status}")),
                    vec![action("restartGateway", "重启网关"), action("goFeishu", "去飞书配置")],
                ));
            }
        }
    }

    let level = overall_level(&findings);
    let (title, summary) = overall_summary(&findings);

    Ok(DoctorReport {
        level,
        title,
        summary,
        findings,
    })
}

#[tauri::command]
pub async fn run_doctor(window: tauri::Window) -> Result<(), String> {
    stream_doctor_command(window, "openclaw doctor 2>&1").await
}

#[tauri::command]
pub async fn run_doctor_fix(window: tauri::Window) -> Result<(), String> {
    stream_doctor_command(window, "openclaw doctor --fix 2>&1").await
}

#[tauri::command]
pub async fn run_full_diagnosis(window: tauri::Window) -> Result<(), String> {
    stream_overlay_commands(
        window,
        &[
            ("OpenClaw doctor", "openclaw doctor 2>&1"),
            ("OpenClaw security audit --deep", "openclaw security audit --deep 2>&1"),
        ],
    )
    .await
}

#[tauri::command]
pub async fn run_full_fix(window: tauri::Window) -> Result<(), String> {
    stream_overlay_commands(
        window,
        &[
            ("OpenClaw security audit --fix", "openclaw security audit --fix 2>&1"),
            ("OpenClaw doctor --fix", "openclaw doctor --fix 2>&1"),
        ],
    )
    .await
}

async fn stream_doctor_command(window: tauri::Window, command: &str) -> Result<(), String> {
    let mut child = spawn_shell(command)?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let mut reader = BufReader::new(stdout).lines();

    while let Some(line) = reader.next_line().await.map_err(|e| e.to_string())? {
        window
            .emit("doctor-output", &line)
            .map_err(|e| e.to_string())?;
    }

    child.wait().await.map_err(|e| e.to_string())?;
    window.emit("doctor-done", ()).map_err(|e| e.to_string())?;
    Ok(())
}

async fn stream_overlay_commands(
    window: tauri::Window,
    commands: &[(&str, &str)],
) -> Result<(), String> {
    for (index, (title, command)) in commands.iter().enumerate() {
        if index > 0 {
            window.emit("doctor-output", "").map_err(|e| e.to_string())?;
        }
        window
            .emit("doctor-output", &format!("➜=== {title} ==="))
            .map_err(|e| e.to_string())?;

        let mut child = spawn_shell(command)?;
        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let mut reader = BufReader::new(stdout).lines();

        while let Some(line) = reader.next_line().await.map_err(|e| e.to_string())? {
            window.emit("doctor-output", &line).map_err(|e| e.to_string())?;
        }

        child.wait().await.map_err(|e| e.to_string())?;
    }

    window.emit("doctor-done", ()).map_err(|e| e.to_string())?;
    Ok(())
}
