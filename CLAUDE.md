# 养养龙虾

仓库内部工程名仍保留 `RunClaw / runclaw`，但用户可见名称统一为“养养龙虾”。

当前项目是 `Tauri 2.x + React + TypeScript` 的 macOS 桌面 GUI，用来安装、配置并管理 `openclaw` CLI。

这份文件只保留当前工程现状、真实边界和后续收口方向，不重复 README 的产品介绍。

## 2026-03-09 更新

今天这轮收口后的基线：

- 产品用户可见名称统一为“养养龙虾”
- 页面命名统一为 `飞书` / `Skills` / `Token` / `治疗龙虾`
- 功能主链路已经完整可用
- 文档已重写到当前真实状态
- 左上角品牌 SVG 仍未定稿，已明确留作待办，不再视为已完成项

## 当前工程状态

### 前端

当前已经收成 6 个稳定页面：

- `运行状态`
- `治疗龙虾`
- `API 配置`
- `飞书`
- `Skills`
- `Token`

当前前端特点：

- 所有功能都尽量收在现有视觉体系内
- 长任务统一走底部终端浮层
- 页面大多通过 `src/lib/tauri.ts` 调用后端，不直接散落 `invoke`

### 后端

Tauri 命令当前按领域拆分：

- `install.rs`
- `gateway.rs`
- `config.rs`
- `skills.rs`
- `logs.rs`
- `runtime.rs`

其中 `runtime.rs` 已经是共享执行层，统一了：

- PATH 注入
- shell 调用
- shell escape
- openclaw 输出清洗

### 已落地主链路

当前已打通的主链路：

- 安装 `openclaw`
- 更新 `openclaw`
- API 配置同步到真实 runtime config
- 飞书配置同步
- pairing request 列表 / 批准
- Gateway 启动 / 停止 / 重启
- Skills 安装 / 卸载 / 已安装识别
- Token 用量统计
- Token 动态体检与治疗
- 治疗龙虾：常见问题检查与修复

## 当前真实能力

### 安装

养养龙虾已经内置来自 `openclaw-cn` 的部署逻辑裁剪版，只保留安装相关部分，不做初始化配置。

当前安装会处理：

- Homebrew
- Node.js 22+
- `openclaw`

### 飞书

当前飞书链路已经不只是“写配置”：

- 可测试连接
- 可写入 `channels.feishu.*`
- 可显示 pairing requests
- 可直接批准 pairing code
- 会修正 Feishu 插件依赖和重复插件副本

### Skills

当前 Skills 页已经不是占位页：

- 列表来自本机 `openclaw` / ClawHub 安装链路
- 安装和卸载都走真实终端命令
- 会自动识别本机已安装状态
- 已解决卸载时 `Pass --yes` 的问题

### Token

当前 Token 页已包含三层：

- 每日汇总
- 模型维度统计
- 最近调用明细

另外新增了一层动态 Token 体检：

- 检查最近重会话
- 检查 memory search 是否无效开启
- 检查图片输入是否偏多
- 检查上下文窗口是否过大
- 给出对应治疗项

当前治疗项包括：

- `sessions.compact`
- 关闭 `agents.defaults.memorySearch.enabled`
- 设置 `agents.defaults.imageMaxDimensionPx`
- 设置 `agents.defaults.contextTokens`

## 当前已知风险

### 1. `gateway.rs` 仍然偏重

它现在承载了：

- Gateway 控制
- doctor
- security audit
- 运行时诊断
- 一部分自动修复

这块后续还可以继续拆，但当前已可维护，不是必须马上拆。

### 2. `openclaw doctor` 本身并不可靠

当前版本 `openclaw 2026.3.7` 仍存在这些问题：

- 某些输出误报
- 某些状态自相矛盾
- `doctor --fix` 不会修掉所有发现的问题

所以养养龙虾现在的策略是：

- 参考官方 doctor / security audit
- 但不完全照单全收
- 对明显假阳性做一层过滤

### 3. Token 体检仍是“高频问题优化”

它现在已经是动态检查，不是固定按钮。

但它仍不是完整的成本治理系统。
它解决的是：

- 高输入会话
- 无效 memory search
- 图片过重
- 过大的上下文窗口

还没有做的更深层能力包括：

- 更细的按用户 / 会话 / 渠道归因
- 提示词文件体积排行
- 工具输出体积归因
- 更细的 cache 策略建议

### 4. 安装和运行仍依赖本机环境

这不是纯前端项目，开源给别人用时依然依赖：

- macOS
- 网络
- Homebrew / npm
- 本机 `openclaw` 行为

养养龙虾已经补了很多兼容层，但不是把上游运行时问题彻底消灭。

## 当前路径约定

- GUI 缓存配置：`~/.openclaw/config.json`
- Runtime 配置：`~/.openclaw/openclaw.json`
- Agent sessions：`~/.openclaw/agents/*/sessions/`
- Logs：`~/.openclaw/logs/`
- Workspace：`~/.openclaw/workspace/`
- 临时日志：`/tmp/openclaw/`

## 当前开发校验

默认完成标准：

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

当前仍存在一个历史 warning：

- Vite chunk size warning

这是已有问题，不是本轮新增 warning。

## 当前审计结论

以 2026 年 3 月 9 日本地审计结果为准：

- `npm run build` 通过
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过
- `openclaw doctor` 仍存在上游假阳性
  - `loopback` 被误报成 `0.0.0.0`
  - `Gateway not running` 和 `Runtime: running` 会同时出现
- `openclaw security audit --deep` 当前主要剩 3 条告警
  - `channels.feishu.tools.doc` 仍有文档授权扩散面
  - `plugins.allow` 未锁定白名单
  - `gateway probe failed (deep)` 在当前机器上表现为本地 `EPERM`

当前判断：

- 产品主链路已经可用
- 安全审计已经接入，但还没有把全部上游告警都自动收口
- 文档里应继续把“上游假阳性”和“真实待收紧项”分开写

## 后续最值得继续收的方向

如果继续做，优先级最高的是这几件事：

1. `彻底卸载` 功能
2. `openclaw 更新` 和 `卸载` 的最终产品闭环
3. Token 体检更细的上下文归因
4. Gateway / doctor 的上游兼容性继续收口
5. 左上角品牌 SVG / logo 定稿并替换当前临时版本

## 一句话结论

这个项目已经不是 UI 壳子了。

它现在是一套：

- 前端流程页
- Tauri 命令层
- `openclaw` runtime 适配层

组成的完整桌面控制台。
