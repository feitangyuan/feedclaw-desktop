use chrono::{Duration, NaiveDate, Utc};
use crate::commands::runtime::{clean_openclaw_output, run_shell, shell_escape};
use dirs::home_dir;
use std::path::PathBuf;
use tauri::Emitter;
use tokio::fs;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct DayUsage {
    pub date: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct ModelUsage {
    pub provider: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub calls: u64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct TokenEvent {
    pub timestamp: String,
    pub provider: String,
    pub model: String,
    pub session: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub total_tokens: u64,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct TokenUsageReport {
    pub days: Vec<DayUsage>,
    pub models: Vec<ModelUsage>,
    pub recent: Vec<TokenEvent>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct TokenOptimizationAction {
    pub id: String,
    pub label: String,
    pub payload: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct TokenOptimizationFinding {
    pub id: String,
    pub level: String,
    pub title: String,
    pub summary: String,
    pub detail: Option<String>,
    pub actions: Vec<TokenOptimizationAction>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct TokenOptimizationReport {
    pub summary: String,
    pub findings: Vec<TokenOptimizationFinding>,
}

#[derive(Clone, Debug)]
struct TokenOptimizationContext {
    usage: TokenUsageReport,
    status: serde_json::Value,
    config: serde_json::Value,
    image_messages: u64,
}

fn log_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(home) = home_dir() {
        dirs.push(home.join(".openclaw").join("logs"));

        let agents_dir = home.join(".openclaw").join("agents");
        if let Ok(entries) = std::fs::read_dir(&agents_dir) {
            for entry in entries.flatten() {
                let sessions_dir = entry.path().join("sessions");
                if sessions_dir.exists() {
                    dirs.push(sessions_dir);
                }
            }
        }
    }

    dirs.push(PathBuf::from("/tmp/openclaw"));
    dirs
}

fn openclaw_config_path() -> Result<PathBuf, String> {
    home_dir()
        .map(|home| home.join(".openclaw").join("openclaw.json"))
        .ok_or_else(|| "Cannot determine home directory".to_string())
}

async fn load_openclaw_config() -> Result<serde_json::Value, String> {
    let path = openclaw_config_path()?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content = fs::read_to_string(path).await.map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

async fn read_status_usage_json() -> Result<serde_json::Value, String> {
    let raw = run_shell("openclaw status --usage --json").await?;
    let cleaned = clean_openclaw_output(&raw);
    serde_json::from_str(&cleaned).map_err(|e| format!("Failed to parse status JSON: {e}"))
}

fn value_at_path<'a>(value: &'a serde_json::Value, path: &[&str]) -> Option<&'a serde_json::Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

fn string_at_path(value: &serde_json::Value, path: &[&str]) -> Option<String> {
    value_at_path(value, path)
        .and_then(|node| node.as_str())
        .map(|node| node.to_string())
}

fn u64_at_path(value: &serde_json::Value, path: &[&str]) -> Option<u64> {
    value_at_path(value, path)
        .and_then(|node| node.as_u64().or_else(|| node.as_i64().and_then(|v| u64::try_from(v).ok())))
}

fn bool_at_path(value: &serde_json::Value, path: &[&str]) -> Option<bool> {
    value_at_path(value, path).and_then(|node| node.as_bool())
}

fn format_tokens(value: u64) -> String {
    if value >= 1_000_000 {
        format!("{:.1}M", value as f64 / 1_000_000.0)
    } else if value >= 1_000 {
        format!("{:.1}K", value as f64 / 1_000.0)
    } else {
        value.to_string()
    }
}

async fn collect_token_usage(days: u32) -> Result<TokenUsageReport, String> {
    let dirs = log_dirs();
    if dirs.is_empty() {
        return Ok(TokenUsageReport {
            days: build_empty_days(days),
            models: Vec::new(),
            recent: Vec::new(),
        });
    }

    let today = Utc::now().date_naive();
    let mut usage_map = std::collections::HashMap::<String, DayUsage>::new();
    let mut model_map = std::collections::HashMap::<(String, String), ModelUsage>::new();
    let mut recent = Vec::<TokenEvent>::new();

    // Initialize all days with zeros
    for i in 0..days {
        let date = today - Duration::days(i as i64);
        let key = date.format("%Y-%m-%d").to_string();
        usage_map.insert(
            key.clone(),
            DayUsage {
                date: key,
                input_tokens: 0,
                output_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
            },
        );
    }

    for dir in dirs {
        if !dir.exists() {
            continue;
        }

        let mut read_dir = fs::read_dir(&dir).await.map_err(|e| e.to_string())?;

        while let Some(entry) = read_dir.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

            if ext == "jsonl" || ext == "log" || ext == "json" {
                if let Ok(content) = fs::read_to_string(&path).await {
                    parse_log_content(
                        &content,
                        &path,
                        &mut usage_map,
                        &mut model_map,
                        &mut recent,
                        today,
                        days,
                    );
                }
            }
        }
    }

    // Sort by date ascending
    let cutoff = today - Duration::days(days as i64);
    let mut result: Vec<DayUsage> = usage_map
        .into_values()
        .filter(|d| {
            NaiveDate::parse_from_str(&d.date, "%Y-%m-%d")
                .map(|nd| nd > cutoff)
                .unwrap_or(false)
        })
        .collect();

    result.sort_by(|a, b| a.date.cmp(&b.date));

    let mut models: Vec<ModelUsage> = model_map.into_values().collect();
    models.sort_by(|a, b| {
        let total_a = a.input_tokens + a.output_tokens + a.cache_read_tokens + a.cache_write_tokens;
        let total_b = b.input_tokens + b.output_tokens + b.cache_read_tokens + b.cache_write_tokens;
        total_b
            .cmp(&total_a)
            .then_with(|| b.calls.cmp(&a.calls))
            .then_with(|| a.provider.cmp(&b.provider))
            .then_with(|| a.model.cmp(&b.model))
    });

    recent.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    recent.truncate(12);

    Ok(TokenUsageReport {
        days: result,
        models,
        recent,
    })
}

#[tauri::command]
pub async fn get_token_usage(days: u32) -> Result<TokenUsageReport, String> {
    collect_token_usage(days).await
}

fn parse_log_content(
    content: &str,
    path: &PathBuf,
    map: &mut std::collections::HashMap<String, DayUsage>,
    model_map: &mut std::collections::HashMap<(String, String), ModelUsage>,
    recent: &mut Vec<TokenEvent>,
    today: NaiveDate,
    days: u32,
) {
    let cutoff = today - Duration::days(days as i64);
    let session = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("unknown")
        .to_string();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Try to parse as JSON
        let Ok(val): Result<serde_json::Value, _> = serde_json::from_str(line) else {
            continue;
        };

        // Extract date from timestamp field
        let date_str = extract_date(&val);
        let Some(date_str) = date_str else {
            continue;
        };

        let Ok(nd) = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d") else {
            continue;
        };

        if nd <= cutoff || nd > today {
            continue;
        }

        // Extract token usage from common patterns
        let (input, output, cache_read, cache_write) = extract_tokens(&val);
        let total = input + output + cache_read + cache_write;
        if total == 0 {
            continue;
        }

        let entry = map.entry(date_str.clone()).or_insert(DayUsage {
            date: date_str.clone(),
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
        });

        entry.input_tokens += input;
        entry.output_tokens += output;
        entry.cache_read_tokens += cache_read;
        entry.cache_write_tokens += cache_write;

        let provider = extract_string(&val, &["provider"]).unwrap_or_else(|| "unknown".to_string());
        let model = extract_string(&val, &["model", "modelId"]).unwrap_or_else(|| "unknown".to_string());
        let model_entry = model_map
            .entry((provider.clone(), model.clone()))
            .or_insert(ModelUsage {
                provider: provider.clone(),
                model: model.clone(),
                input_tokens: 0,
                output_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
                calls: 0,
            });
        model_entry.input_tokens += input;
        model_entry.output_tokens += output;
        model_entry.cache_read_tokens += cache_read;
        model_entry.cache_write_tokens += cache_write;
        model_entry.calls += 1;

        recent.push(TokenEvent {
            timestamp: extract_timestamp(&val).unwrap_or_else(|| format!("{date_str}T00:00:00Z")),
            provider,
            model,
            session: session.clone(),
            input_tokens: input,
            output_tokens: output,
            cache_read_tokens: cache_read,
            cache_write_tokens: cache_write,
            total_tokens: total,
        });
    }
}

fn extract_date(val: &serde_json::Value) -> Option<String> {
    // Try common timestamp field names
    for field in &["timestamp", "time", "date", "created_at", "ts"] {
        if let Some(ts) = val.get(field).and_then(|v| v.as_str()) {
            if ts.len() >= 10 {
                return Some(ts[..10].to_string());
            }
        }
    }
    None
}

fn extract_timestamp(val: &serde_json::Value) -> Option<String> {
    for field in &["timestamp", "time", "date", "created_at", "ts"] {
        if let Some(ts) = val.get(field).and_then(|v| v.as_str()) {
            return Some(ts.to_string());
        }
    }
    None
}

fn extract_string(val: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = val.get(*key).and_then(|v| v.as_str()) {
            return Some(value.to_string());
        }
    }

    for container in ["message", "data", "result"] {
        if let Some(nested) = val.get(container) {
            for key in keys {
                if let Some(value) = nested.get(*key).and_then(|v| v.as_str()) {
                    return Some(value.to_string());
                }
            }
        }
    }

    None
}

fn extract_tokens(val: &serde_json::Value) -> (u64, u64, u64, u64) {
    let mut input = 0u64;
    let mut output = 0u64;
    let mut cache_read = 0u64;
    let mut cache_write = 0u64;

    for usage in find_usage_nodes(val) {
        input += read_usage_value(
            usage,
            &[
                "input_tokens",
                "inputTokens",
                "prompt_tokens",
                "promptTokens",
                "input",
            ],
        );
        output += read_usage_value(
            usage,
            &[
                "output_tokens",
                "outputTokens",
                "completion_tokens",
                "completionTokens",
                "output",
            ],
        );
        cache_read += read_usage_value(
            usage,
            &[
                "cache_read_input_tokens",
                "cacheReadInputTokens",
                "cache_read_tokens",
            ],
        );
        cache_write += read_usage_value(
            usage,
            &[
                "cache_creation_input_tokens",
                "cacheCreationInputTokens",
                "cache_write_tokens",
            ],
        );
    }

    (input, output, cache_read, cache_write)
}

fn find_usage_nodes<'a>(val: &'a serde_json::Value) -> Vec<&'a serde_json::Value> {
    let mut nodes = Vec::new();

    if let Some(usage) = val.get("usage") {
        nodes.push(usage);
    }

    if let Some(message) = val.get("message") {
        if let Some(usage) = message.get("usage") {
            nodes.push(usage);
        }
    }

    if let Some(data) = val.get("data") {
        if let Some(usage) = data.get("usage") {
            nodes.push(usage);
        }
    }

    if let Some(result) = val.get("result") {
        if let Some(usage) = result.get("usage") {
            nodes.push(usage);
        }
    }

    nodes
}

fn read_usage_value(usage: &serde_json::Value, keys: &[&str]) -> u64 {
    for key in keys {
        if let Some(value) = usage.get(*key).and_then(value_to_u64) {
            return value;
        }
    }

    0
}

fn value_to_u64(value: &serde_json::Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|v| u64::try_from(v).ok()))
        .or_else(|| value.as_str().and_then(|v| v.parse::<u64>().ok()))
}

fn build_empty_days(days: u32) -> Vec<DayUsage> {
    let today = Utc::now().date_naive();
    (0..days)
        .rev()
        .map(|i| {
            let date = today - Duration::days(i as i64);
            DayUsage {
                date: date.format("%Y-%m-%d").to_string(),
                input_tokens: 0,
                output_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
            }
        })
        .collect()
}

async fn count_image_messages(days: u32) -> Result<u64, String> {
    let dirs = log_dirs();
    if dirs.is_empty() {
        return Ok(0);
    }

    let today = Utc::now().date_naive();
    let cutoff = today - Duration::days(days as i64);
    let mut count = 0u64;

    for dir in dirs {
        if !dir.exists() {
            continue;
        }

        let mut read_dir = fs::read_dir(&dir).await.map_err(|e| e.to_string())?;
        while let Some(entry) = read_dir.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext != "jsonl" && ext != "json" && ext != "log" {
                continue;
            }

            let Ok(content) = fs::read_to_string(&path).await else {
                continue;
            };

            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }

                let Ok(value): Result<serde_json::Value, _> = serde_json::from_str(line) else {
                    continue;
                };

                let Some(date_str) = extract_date(&value) else {
                    continue;
                };
                let Ok(date) = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d") else {
                    continue;
                };
                if date <= cutoff || date > today {
                    continue;
                }

                let Some(message) = value.get("message") else {
                    continue;
                };
                let Some(content_items) = message.get("content").and_then(|node| node.as_array()) else {
                    continue;
                };
                if content_items.iter().any(|item| item.get("type").and_then(|node| node.as_str()) == Some("image")) {
                    count += 1;
                }
            }
        }
    }

    Ok(count)
}

async fn build_token_optimization_context(days: u32) -> Result<TokenOptimizationContext, String> {
    let usage = collect_token_usage(days).await?;
    let status = read_status_usage_json().await?;
    let config = load_openclaw_config().await?;
    let image_messages = count_image_messages(days).await?;

    Ok(TokenOptimizationContext {
        usage,
        status,
        config,
        image_messages,
    })
}

fn build_token_optimization_report(context: &TokenOptimizationContext) -> TokenOptimizationReport {
    let mut findings = Vec::<TokenOptimizationFinding>::new();

    if let Some(sessions) = value_at_path(&context.status, &["sessions", "recent"]).and_then(|node| node.as_array()) {
        if let Some(heaviest) = sessions
            .iter()
            .max_by_key(|session| session.get("totalTokens").and_then(|node| node.as_u64()).unwrap_or(0))
        {
            let input_tokens = heaviest.get("inputTokens").and_then(|node| node.as_u64()).unwrap_or(0);
            let total_tokens = heaviest.get("totalTokens").and_then(|node| node.as_u64()).unwrap_or(0);
            let session_key = heaviest.get("key").and_then(|node| node.as_str()).unwrap_or("");
            let model = heaviest.get("model").and_then(|node| node.as_str()).unwrap_or("unknown");

            if !session_key.is_empty() && (input_tokens >= 4_000 || total_tokens >= 6_000) {
                findings.push(TokenOptimizationFinding {
                    id: "compact-session".to_string(),
                    level: if total_tokens >= 12_000 { "warn" } else { "info" }.to_string(),
                    title: "最近会话已经变重".to_string(),
                    summary: format!(
                        "最近最重的一条会话已经累计 {} input / {} total tokens。先压缩历史，再继续聊会更省。",
                        format_tokens(input_tokens),
                        format_tokens(total_tokens)
                    ),
                    detail: Some(format!("会话：{session_key} | 模型：{model}")),
                    actions: vec![TokenOptimizationAction {
                        id: "compactSession".to_string(),
                        label: "压缩当前会话".to_string(),
                        payload: Some(session_key.to_string()),
                    }],
                });
            }

            let context_tokens = heaviest
                .get("contextTokens")
                .and_then(|node| node.as_u64())
                .or_else(|| u64_at_path(&context.status, &["sessions", "defaults", "contextTokens"]))
                .unwrap_or(0);
            let has_explicit_cap = value_at_path(&context.config, &["agents", "defaults", "contextTokens"]).is_some();
            if !has_explicit_cap && context_tokens >= 131_072 && input_tokens >= 4_000 {
                let recommended = if context_tokens >= 262_144 { 131_072 } else { 65_536 };
                findings.push(TokenOptimizationFinding {
                    id: "cap-context-window".to_string(),
                    level: "info".to_string(),
                    title: "上下文窗口偏大".to_string(),
                    summary: format!(
                        "当前默认上下文上限是 {}，对日常飞书对话偏大。限制窗口可以避免会话越来越贵。",
                        format_tokens(context_tokens)
                    ),
                    detail: Some(format!("建议先限制到 {}。", format_tokens(recommended))),
                    actions: vec![TokenOptimizationAction {
                        id: "capContextWindow".to_string(),
                        label: "限制上下文窗口".to_string(),
                        payload: Some(recommended.to_string()),
                    }],
                });
            }
        }
    }

    let memory_provider = string_at_path(&context.status, &["memory", "provider"]);
    let memory_enabled = bool_at_path(&context.status, &["memoryPlugin", "enabled"]).unwrap_or(false);
    let memory_unavailable = string_at_path(
        &context.status,
        &["memory", "custom", "providerUnavailableReason"],
    );
    if memory_enabled && (memory_provider.as_deref() == Some("none") || memory_unavailable.is_some()) {
        findings.push(TokenOptimizationFinding {
            id: "disable-memory-search".to_string(),
            level: "warn".to_string(),
            title: "记忆搜索当前没有实际收益".to_string(),
            summary: "记忆搜索开着，但 embedding provider 没配好。现在只会增加复杂度，对当前对话省不了 token。".to_string(),
            detail: memory_unavailable,
            actions: vec![TokenOptimizationAction {
                id: "disableMemorySearch".to_string(),
                label: "关闭记忆搜索".to_string(),
                payload: None,
            }],
        });
    }

    let image_max_dimension = u64_at_path(&context.config, &["agents", "defaults", "imageMaxDimensionPx"]);
    if context.image_messages > 0 && image_max_dimension.unwrap_or(u64::MAX) > 1568 {
        findings.push(TokenOptimizationFinding {
            id: "reduce-image-size".to_string(),
            level: "info".to_string(),
            title: "最近有图片消息".to_string(),
            summary: format!(
                "最近 {} 次调用带图片。图片会直接抬高 input tokens，可以先限制图片尺寸。",
                context.image_messages
            ),
            detail: Some("建议把图片最长边限制到 1568px，通常够用。".to_string()),
            actions: vec![TokenOptimizationAction {
                id: "limitImageSize".to_string(),
                label: "限制图片尺寸".to_string(),
                payload: Some("1568".to_string()),
            }],
        });
    }

    let summary = if findings.is_empty() {
        "最近调用里没有发现明显的 Token 浪费项。".to_string()
    } else {
        format!("最近调用里检测到 {} 个可优化项。", findings.len())
    };

    TokenOptimizationReport { summary, findings }
}

fn emit_token_line(window: &tauri::Window, line: impl Into<String>) -> Result<(), String> {
    window
        .emit("token-output", line.into())
        .map_err(|e| e.to_string())
}

async fn restart_gateway_after_token_config_change(window: &tauri::Window) -> Result<(), String> {
    emit_token_line(window, "正在重启网关以应用新配置...")?;
    run_shell("openclaw gateway restart").await?;
    emit_token_line(window, "已重启网关，新配置已生效。")?;
    Ok(())
}

fn summarize_config_update_output(raw: &str) -> Option<String> {
    let cleaned = clean_openclaw_output(raw);
    let lines: Vec<&str> = cleaned
        .lines()
        .map(|line| line.trim())
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with("Updated ")
                && !line.starts_with("Config overwrite:")
                && !line.starts_with("Restart the gateway to apply.")
        })
        .collect();

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

#[tauri::command]
pub async fn get_token_optimization_report(days: u32) -> Result<TokenOptimizationReport, String> {
    let context = build_token_optimization_context(days).await?;
    Ok(build_token_optimization_report(&context))
}

#[tauri::command]
pub async fn run_token_audit(window: tauri::Window, days: u32) -> Result<(), String> {
    emit_token_line(&window, format!("已开始最近 {days} 天的 Token 检查"))?;
    emit_token_line(&window, "=== openclaw status --usage --json ===")?;

    let context = build_token_optimization_context(days).await?;

    if let Some(sessions) = value_at_path(&context.status, &["sessions", "recent"]).and_then(|node| node.as_array()) {
        emit_token_line(&window, format!("活跃会话数：{}", sessions.len()))?;
        if let Some(heaviest) = sessions
            .iter()
            .max_by_key(|session| session.get("totalTokens").and_then(|node| node.as_u64()).unwrap_or(0))
        {
            let key = heaviest.get("key").and_then(|node| node.as_str()).unwrap_or("unknown");
            let model = heaviest.get("model").and_then(|node| node.as_str()).unwrap_or("unknown");
            let total = heaviest.get("totalTokens").and_then(|node| node.as_u64()).unwrap_or(0);
            let input = heaviest.get("inputTokens").and_then(|node| node.as_u64()).unwrap_or(0);
            emit_token_line(
                &window,
                format!(
                    "最重会话：{key} | 模型：{model} | input={} | total={}",
                    format_tokens(input),
                    format_tokens(total)
                ),
            )?;
        }
    }

    let total_calls: u64 = context.usage.models.iter().map(|model| model.calls).sum();
    emit_token_line(&window, "=== Session 日志汇总 ===")?;
    emit_token_line(&window, format!("最近 {days} 天模型调用：{total_calls} 次"))?;
    if let Some(model) = context.usage.models.first() {
        emit_token_line(
            &window,
            format!(
                "最重模型：{}/{} | input={} | output={}",
                model.provider,
                model.model,
                format_tokens(model.input_tokens),
                format_tokens(model.output_tokens)
            ),
        )?;
    }

    emit_token_line(
        &window,
        format!("最近图片消息：{} 次", context.image_messages),
    )?;

    if let Some(provider) = string_at_path(&context.status, &["memory", "provider"]) {
        emit_token_line(&window, format!("memory provider：{provider}"))?;
    }

    let report = build_token_optimization_report(&context);
    emit_token_line(&window, "=== 检查结论 ===")?;
    emit_token_line(&window, report.summary.clone())?;
    for finding in &report.findings {
        emit_token_line(&window, format!("{}：{}", finding.title, finding.summary))?;
    }

    window.emit("token-done", ()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn run_token_treatment(
    window: tauri::Window,
    action_id: String,
    payload: Option<String>,
) -> Result<(), String> {
    emit_token_line(&window, "已开始处理 Token 优化项")?;

    match action_id.as_str() {
        "compactSession" => {
            let key = payload
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "Missing session key".to_string())?;
            emit_token_line(&window, format!("压缩会话：{key}"))?;
            let params = serde_json::json!({
                "key": key,
                "maxLines": 160
            })
            .to_string();
            let result = run_shell(&format!(
                "openclaw gateway call sessions.compact --json --params {}",
                shell_escape(&params)
            ))
            .await?;

            let parsed: serde_json::Value =
                serde_json::from_str(&result).map_err(|e| format!("Failed to parse compact result: {e}"))?;
            let compacted = parsed.get("compacted").and_then(|node| node.as_bool()).unwrap_or(false);
            let kept = parsed.get("kept").and_then(|node| node.as_u64()).unwrap_or(0);

            if compacted {
                emit_token_line(&window, format!("会话已压缩完成，保留最近 {kept} 行。"))?;
            } else if kept > 0 {
                emit_token_line(&window, format!("当前会话本来就不长，暂时不用压缩。当前保留 {kept} 行。"))?;
            } else {
                emit_token_line(&window, "当前没有可压缩的会话内容。")?;
            }
        }
        "disableMemorySearch" => {
            emit_token_line(&window, "关闭记忆搜索...")?;
            let result = run_shell("openclaw config set agents.defaults.memorySearch.enabled false").await?;
            if let Some(message) = summarize_config_update_output(&result) {
                emit_token_line(&window, message)?;
            }
            restart_gateway_after_token_config_change(&window).await?;
        }
        "limitImageSize" => {
            let size = payload.unwrap_or_else(|| "1568".to_string());
            emit_token_line(&window, format!("限制图片最长边到 {size}px..."))?;
            let result = run_shell(&format!(
                "openclaw config set agents.defaults.imageMaxDimensionPx {}",
                size
            ))
            .await?;
            if let Some(message) = summarize_config_update_output(&result) {
                emit_token_line(&window, message)?;
            }
            restart_gateway_after_token_config_change(&window).await?;
        }
        "capContextWindow" => {
            let limit = payload.unwrap_or_else(|| "131072".to_string());
            emit_token_line(&window, format!("限制默认上下文窗口到 {limit}..."))?;
            let result = run_shell(&format!(
                "openclaw config set agents.defaults.contextTokens {}",
                limit
            ))
            .await?;
            if let Some(message) = summarize_config_update_output(&result) {
                emit_token_line(&window, message)?;
            }
            restart_gateway_after_token_config_change(&window).await?;
        }
        _ => return Err(format!("Unknown token treatment action: {action_id}")),
    }

    emit_token_line(&window, "处理完成。")?;

    window.emit("token-done", ()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn test_feishu_connection(app_id: String, app_secret: String) -> Result<bool, String> {
    // Call Feishu auth endpoint to verify credentials
    let client = reqwest::Client::new();
    let resp = client
        .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
        .json(&serde_json::json!({
            "app_id": app_id,
            "app_secret": app_secret
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let code = body.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
    Ok(code == 0)
}
