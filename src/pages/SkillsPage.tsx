import { useState, useEffect } from "react";
import { Search, Download, Trash2, Package, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AppButton } from "@/components/AppButton";
import { TerminalOverlay } from "@/components/TerminalOverlay";
import { getInstalledSkills, installSkill, listAvailableSkills, uninstallSkill, type AvailableSkill } from "@/lib/tauri";

type CuratedSkillDef = {
  name: string;
  installName?: string;
};

const CURATED_SECTIONS: ReadonlyArray<{ title: string; skills: ReadonlyArray<CuratedSkillDef> }> = [
  {
    title: "编码开发",
    skills: [
      { name: "coding-agent" },
      { name: "tmux" },
      { name: "session-logs" },
      { name: "skill-creator" },
      { name: "git-essentials" },
      { name: "git-workflows" },
    ],
  },
  {
    title: "检索研究",
    skills: [
      { name: "tavily-search", installName: "openclaw-tavily-search" },
      { name: "deep-research-pro" },
      { name: "agent-browser" },
      { name: "summarize" },
      { name: "gemini" },
    ],
  },
  {
    title: "办公协作",
    skills: [
      { name: "feishu-doc" },
      { name: "feishu-drive" },
      { name: "feishu-perm" },
      { name: "feishu-wiki" },
      { name: "calendar" },
      { name: "weather" },
    ],
  },
  {
    title: "记忆优化",
    skills: [
      { name: "self-improvement" },
      { name: "memory-setup" },
      { name: "agent-memory" },
    ],
  },
] as const;

const SKILL_COPY: Record<string, string> = {
  "coding-agent": "编写、修改和排查代码时最常用的开发助手。",
  tmux: "用多会话方式整理长任务、日志和并行命令。",
  "session-logs": "查看和分析会话日志，方便排障和回溯问题。",
  "skill-creator": "创建或维护 skill 时使用的生成与规范助手。",
  "self-improvement": "持续回顾和优化任务过程，让 agent 越用越顺手。",
  "memory-setup": "初始化记忆能力相关配置，方便后续长期记忆工作流。",
  "git-essentials": "处理常见 Git 操作，适合日常提交、分支和回滚。",
  "git-workflows": "梳理和执行更完整的 Git 协作流程，适合多人开发。",
  "feishu-doc": "读取和处理飞书文档内容，用于总结、问答和整理。",
  "feishu-drive": "访问飞书云盘文件，方便检索和处理资料。",
  "feishu-perm": "检查和处理飞书文档、知识库等权限问题。",
  "feishu-wiki": "读取飞书知识库节点和页面，用于知识检索。",
  summarize: "快速总结网页、文档和长文本内容。",
  weather: "查询天气信息，适合日常出行和行程安排。",
  gemini: "接入 Gemini 能力，用于多模型协同处理任务。",
  "tavily-search": "接入 Tavily 搜索能力，适合联网检索和资料搜集。",
  "agent-browser": "让 agent 直接操作浏览器，适合网页任务和自动化流程。",
  calendar: "处理日程和提醒相关任务，适合安排时间与待办。",
  "agent-memory": "补强长期记忆能力，适合需要持续上下文的任务。",
  "deep-research-pro": "执行更深入的研究和资料整理，适合复杂检索任务。",
};

const FILTER_TABS = [
  { id: "all", label: "全部" },
  { id: "编码开发", label: "编码开发" },
  { id: "检索研究", label: "检索研究" },
  { id: "办公协作", label: "办公协作" },
  { id: "记忆优化", label: "记忆优化" },
  { id: "installed", label: "已安装" },
] as const;

type FilterTab = (typeof FILTER_TABS)[number]["id"];

function missingSummary(skill: AvailableSkill) {
  const parts = [
    ...skill.missing.bins,
    ...skill.missing.anyBins,
    ...skill.missing.env,
    ...skill.missing.config,
    ...skill.missing.os,
  ];
  return parts.slice(0, 3).join(" · ");
}

function localizedDescription(skill: AvailableSkill) {
  return SKILL_COPY[skill.name] ?? skill.description.trim();
}

function makeCuratedSkill(name: string): AvailableSkill {
  return {
    name,
    description: SKILL_COPY[name] ?? "",
    emoji: null,
    eligible: true,
    disabled: false,
    blockedByAllowlist: false,
    source: "clawhub",
    bundled: false,
    homepage: null,
    missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
  };
}

function curatedInstallName(name: string) {
  for (const section of CURATED_SECTIONS) {
    const matched = section.skills.find((skill) => skill.name === name);
    if (matched) {
      return matched.installName ?? matched.name;
    }
  }

  return name;
}

export function SkillsPage() {
  const [skills, setSkills] = useState<AvailableSkill[]>([]);
  const [installedSet, setInstalledSet] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [loading, setLoading] = useState(true);
  const [activeSkill, setActive] = useState<string | null>(null);
  const [termLines, setTermLines] = useState<string[]>([]);
  const [termDone, setTermDone] = useState(false);
  const [termTitle, setTermTitle] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const [available, local] = await Promise.all([listAvailableSkills(), getInstalledSkills()]);
      setSkills(available);
      setInstalledSet(new Set(local));
    }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const doInstall = (name: string) => {
    const skillName = name.trim();
    if (!skillName) return;
    setActive(skillName);
    setTermLines([]);
    setTermDone(false);
    setTermTitle(`安装 ${skillName}`);
    const installName = curatedInstallName(skillName);
    installSkill(installName, (l) => setTermLines((p) => [...p, l]), async ([res]) => {
      setTermDone(true);
      if (res === "success") {
        setTermLines((p) => [
          ...p,
          "已安装。",
          "新会话里生效。",
        ]);
        await refresh();
      }
    });
  };
  const doUninstall = (name: string) => {
    setActive(name);
    setTermLines([]);
    setTermDone(false);
    setTermTitle(`卸载 ${name}`);
    const uninstallName = curatedInstallName(name);
    uninstallSkill(uninstallName, (l) => setTermLines((p) => [...p, l]), async ([res]) => {
      setTermDone(true);
      if (res === "success") {
        setTermLines((p) => [
          ...p,
          "已移除。",
          "新会话里生效。",
        ]);
        await refresh();
      }
    });
  };

  const q = query.toLowerCase();
  const skillMap = new Map(skills.map((skill) => [skill.name, skill]));
  const curatedNames = new Set<string>(CURATED_SECTIONS.flatMap((section) => section.skills.map((skill) => skill.name)));
  const curatedSkills = CURATED_SECTIONS.map((section) => ({
    ...section,
    items: section.skills
      .map((skill) => skillMap.get(skill.name) ?? makeCuratedSkill(skill.name)),
  }));

  const filteredSections = curatedSkills
    .map((section) => ({
      ...section,
      items: section.items.filter((skill) =>
        !q
        || skill.name.toLowerCase().includes(q)
        || localizedDescription(skill).toLowerCase().includes(q)
      ),
    }))
    .filter((section) => activeFilter === "all" || activeFilter === section.title)
    .filter((section) => section.items.length > 0);

  const installedExtras = [...installedSet]
    .filter((name) => !curatedNames.has(name))
    .map((name) => skillMap.get(name) ?? {
      name,
      description: "本地安装",
      eligible: true,
      disabled: false,
      blockedByAllowlist: false,
      source: "workspace",
      bundled: false,
      missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
    })
    .filter((skill) =>
      !q
      || skill.name.toLowerCase().includes(q)
      || localizedDescription(skill).toLowerCase().includes(q)
    );

  const showInstalledOnly = activeFilter === "installed";
  const readyCuratedSkills = curatedSkills
    .flatMap((section) => section.items)
    .filter((skill) => installedSet.has(skill.name) || skill.bundled || skill.source === "openclaw-extra");
  const visibleSections = showInstalledOnly ? [] : filteredSections;
  const visibleInstalledExtras = showInstalledOnly ? [...installedExtras, ...readyCuratedSkills] : installedExtras;
  const installedSkillsMap = new Map<string, AvailableSkill>();
  for (const skill of visibleInstalledExtras) {
    installedSkillsMap.set(skill.name, skill);
  }
  const installedOnlyList = [...installedSkillsMap.values()].filter((skill) =>
    !q
    || skill.name.toLowerCase().includes(q)
    || localizedDescription(skill).toLowerCase().includes(q)
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "48px 40px 16px", maxWidth: 680, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 24, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em", margin: 0 }}>Skills</h1>
          <button
            onClick={() => openUrl("https://clawhub.ai/skills").catch(() => undefined)}
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              border: "none",
              background: "var(--card-bg)",
              boxShadow: "inset 0 0 0 0.5px var(--card-border), 0 1px 2px rgba(0,0,0,0.05)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--text-tertiary)",
              flexShrink: 0,
            }}
          >
            <ExternalLink size={14} />
          </button>
        </div>

        <div className="glass-card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px" }}>
          <Search size={14} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 Skills…"
            style={{ flex: 1, fontSize: 13, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontFamily: "inherit" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {FILTER_TABS.map((tab) => {
            const active = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: "none",
                  background: active ? "rgba(0,122,255,0.10)" : "transparent",
                  color: active ? "var(--accent-blue)" : "var(--text-secondary)",
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 60 }}>
        <div style={{ maxWidth: 680, width: "100%", margin: "0 auto", padding: "0 40px", display: "flex", flexDirection: "column", gap: 10 }}>
          {loading ? (
            <p style={{ textAlign: "center", padding: "40px 0", fontSize: 13, color: "var(--text-tertiary)", margin: 0 }}>
              正在读取本机技能列表…
            </p>
          ) : visibleSections.length === 0 && installedOnlyList.length === 0 && visibleInstalledExtras.length === 0 ? (
            <div className="glass-card" style={{ padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <Package size={36} style={{ color: "var(--text-tertiary)", opacity: 0.4 }} />
              <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0 }}>
                {skills.length === 0
                  ? "当前没有可显示的技能"
                  : showInstalledOnly
                    ? "当前还没有已安装的技能"
                    : "没有匹配的精选技能"}
              </p>
            </div>
          ) : (
            <>
              {visibleSections.map((section) => (
                <div key={section.title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {section.items.map((skill) => (
                    <SkillRow
                      key={skill.name}
                      skill={skill}
                      installed={installedSet.has(skill.name)}
                      onInstall={() => doInstall(skill.name)}
                      onUninstall={() => doUninstall(skill.name)}
                    />
                  ))}
                </div>
              ))}

              {showInstalledOnly && installedOnlyList.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {installedOnlyList.map((skill) => (
                    <SkillRow
                      key={skill.name}
                      skill={skill}
                      installed
                      onInstall={() => doInstall(skill.name)}
                      onUninstall={() => doUninstall(skill.name)}
                    />
                  ))}
                </div>
              )}

              {!showInstalledOnly && visibleInstalledExtras.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {visibleInstalledExtras.map((skill) => (
                    <SkillRow
                      key={skill.name}
                      skill={skill}
                      installed
                      onInstall={() => doInstall(skill.name)}
                      onUninstall={() => doUninstall(skill.name)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <TerminalOverlay title={termTitle} lines={termLines}
        open={activeSkill !== null} done={termDone}
        onClose={() => { if (termDone) setActive(null); }} />
    </div>
  );
}

function SkillRow({ skill, installed, onInstall, onUninstall }:
  { skill: AvailableSkill; installed: boolean; onInstall: () => void; onUninstall: () => void; }) {
  const isBuiltIn = skill.bundled || skill.source === "openclaw-extra";
  const canInstall = !installed && !isBuiltIn && !skill.disabled && !skill.blockedByAllowlist;
  const statusText = installed || isBuiltIn
    ? "已安装"
    : skill.eligible
      ? "可安装"
      : "缺少依赖";

  return (
    <div className="glass-card" style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {skill.name}
          </span>
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 20,
            flexShrink: 0,
            background: installed
              || isBuiltIn
              ? "rgba(52,199,89,0.12)"
              : skill.eligible
                ? "rgba(0,122,255,0.10)"
                : "rgba(255,149,0,0.10)",
            color: installed
              || isBuiltIn
              ? "var(--accent-green)"
              : skill.eligible
                ? "var(--accent-blue)"
                : "var(--accent-orange)",
          }}>
            {statusText}
          </span>
        </div>
        {localizedDescription(skill) && (
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4, lineHeight: 1.5 }}>
            {localizedDescription(skill)}
          </div>
        )}
        {!skill.eligible && !installed && !isBuiltIn && missingSummary(skill) && (
          <div style={{ fontSize: 11, color: "var(--accent-orange)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            依赖未满足：{missingSummary(skill)}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {installed ? (
          <AppButton
            onClick={onUninstall}
            tone="redSubtle"
            size="sm"
            style={{ flexShrink: 0 }}
          >
            <Trash2 size={13} />
            移除
          </AppButton>
        ) : canInstall ? (
          <AppButton
            onClick={onInstall}
            size="sm"
            style={{ flexShrink: 0 }}
          >
            <Download size={13} />
            安装
          </AppButton>
        ) : null}
      </div>
    </div>
  );
}
