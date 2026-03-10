# FeedClaw Desktop

FeedClaw Desktop，也叫「养养龙虾」，面向 `OpenClaw` 的 macOS 桌面控制台。

![养养龙虾预览](public/preview.png)

## ✨ 它能做什么

- 一键安装、更新、彻底卸载 `openclaw`
- 接入模型：`API Key` 和 `OpenAI Codex OAuth`
- 配置飞书、测试连接、批准配对
- 启动 / 停止 / 修复 Gateway
- 安装、卸载、识别 Skills
- 查看 Token 趋势、模型明细、最近调用
- 做常见问题检查和修复

## 🚀 安装方式

### 方式一：直接下载 app

安装包放在 GitHub 的 **Releases** 页面：

- https://github.com/feitangyuan/feedclaw-desktop/releases

当前推荐下载：

- `养养龙虾.app.zip`

下载后解压，把 `养养龙虾.app` 拖到 `应用程序` 即可。

如果 macOS 首次打开拦截，可以执行：

```bash
xattr -dr com.apple.quarantine /Applications/养养龙虾.app
```

### 方式二：一条命令安装

仓库根目录提供了 `install.sh`，会自动：

- 解压 `.app.zip`
- 安装到 `/Applications`
- 去掉 quarantine
- 打开 app

本地使用：

```bash
./install.sh /path/to/养养龙虾.app.zip
```

## 👀 适用对象

适合这几类用户：

- 想用 `OpenClaw`，但不想先记一堆命令
- 想在 GUI 里完成 API、飞书、Gateway、Skills 管理
- 想把常用运维动作收进一个桌面面板

## ✅ 当前支持

- macOS
- `OpenClaw` 本地安装与更新
- `API Key` / `OpenAI Codex OAuth`
- 飞书接入、配对、Gateway 管理
- Skills 安装与卸载
- Token 查看与基础诊断

如果你本机的 `OpenClaw` 版本较旧，建议先在 app 的“运行状态”页更新，再使用 `OAuth` 登录。

`OpenAI Codex OAuth` 会拉起系统 `Terminal` 完成官方授权流程，这是当前 `OpenClaw` CLI 的要求。

## 目录结构

```text
src/
├── App.tsx
├── components/
│   ├── Sidebar.tsx
│   └── TerminalOverlay.tsx
├── lib/
│   └── tauri.ts
└── pages/
    ├── StatusPage.tsx
    ├── DiagnosisPage.tsx
    ├── ConfigPage.tsx
    ├── FeishuPage.tsx
    ├── SkillsPage.tsx
    └── TokenUsagePage.tsx

src-tauri/
├── src/
│   ├── lib.rs
│   ├── main.rs
│   └── commands/
│       ├── config.rs
│       ├── gateway.rs
│       ├── install.rs
│       ├── logs.rs
│       ├── runtime.rs
│       └── skills.rs
└── tauri.conf.json
```

## 🛠️ 开发

```bash
npm install
npm run tauri dev
```

构建正式包：

```bash
npm run tauri build
```

校验命令：

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 🧩 技术栈

- Tauri 2
- React 19
- TypeScript
- Rust
