use std::process::{Output, Stdio};
use tokio::process::{Child, Command};

pub const SHELL_PATH_PREFIX: &str = r#"export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:$HOME/.local/bin:$PATH""#;

pub fn with_shell_path(command: &str) -> String {
    format!("{SHELL_PATH_PREFIX}; {command}")
}

pub fn shell_escape(value: &str) -> String {
    let escaped = value.replace('\'', r#"'\''"#);
    format!("'{escaped}'")
}

pub fn output_text(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    format!("{stdout}{stderr}").trim().to_string()
}

pub fn clean_openclaw_output(raw: &str) -> String {
    raw.lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty()
                && !trimmed.starts_with("Config warnings:")
                && !trimmed.starts_with("[plugins]")
                && !trimmed.contains("duplicate plugin id detected")
                && !trimmed.starts_with("│")
                && !trimmed.starts_with("╰")
                && !trimmed.starts_with("╮")
                && !trimmed.starts_with("├")
                && !trimmed.starts_with("◇")
                && !trimmed.starts_with("╯")
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

pub async fn run_shell(command: &str) -> Result<String, String> {
    let output = run_shell_output(command).await?;
    let combined = output_text(&output);

    if output.status.success() {
        Ok(combined)
    } else if combined.is_empty() {
        Err("Command failed".to_string())
    } else {
        Err(combined)
    }
}

pub async fn run_shell_output(command: &str) -> Result<Output, String> {
    Command::new("sh")
        .arg("-c")
        .arg(with_shell_path(command))
        .output()
        .await
        .map_err(|e| e.to_string())
}

pub fn spawn_shell(command: &str) -> Result<Child, String> {
    Command::new("sh")
        .arg("-c")
        .arg(with_shell_path(command))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())
}
