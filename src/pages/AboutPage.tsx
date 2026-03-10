import { useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import pkg from "../../package.json";
import { AppButton } from "@/components/AppButton";

const REPO_URL = "https://github.com/feitangyuan/feedclaw-desktop";
const RELEASES_URL = `${REPO_URL}/releases`;

interface ReleaseStatus {
  latestVersion: string | null;
  url: string | null;
  message: string;
  updateAvailable: boolean;
}

function normalizeVersion(value: string) {
  return value.trim().replace(/^v/i, "");
}

function compareVersions(a: string, b: string) {
  const left = normalizeVersion(a).split(".").map((part) => Number(part) || 0);
  const right = normalizeVersion(b).split(".").map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function AboutPage() {
  const currentVersion = useMemo(() => pkg.version, []);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<ReleaseStatus | null>(null);

  const checkUpdates = async () => {
    setChecking(true);
    try {
      const response = await fetch("https://api.github.com/repos/feitangyuan/feedclaw-desktop/releases/latest", {
        headers: {
          Accept: "application/vnd.github+json",
        },
      });

      let payload: any;
      if (response.ok) {
        payload = await response.json();
      } else if (response.status === 404) {
        const fallback = await fetch("https://api.github.com/repos/feitangyuan/feedclaw-desktop/releases?per_page=1", {
          headers: {
            Accept: "application/vnd.github+json",
          },
        });
        if (!fallback.ok) {
          throw new Error(`GitHub 返回 ${fallback.status}`);
        }
        const releases = await fallback.json();
        payload = Array.isArray(releases) ? releases[0] : null;
        if (!payload) {
          setStatus({
            latestVersion: null,
            url: RELEASES_URL,
            updateAvailable: false,
            message: "暂时还没有发布版本",
          });
          return;
        }
      } else {
        throw new Error(`GitHub 返回 ${response.status}`);
      }

      const latestVersion = normalizeVersion(payload.tag_name ?? payload.name ?? "");
      const htmlUrl = typeof payload.html_url === "string" ? payload.html_url : RELEASES_URL;
      const updateAvailable = latestVersion
        ? compareVersions(latestVersion, currentVersion) > 0
        : false;

      setStatus({
        latestVersion: latestVersion || null,
        url: htmlUrl,
        updateAvailable,
        message: latestVersion
          ? updateAvailable
            ? `发现新版本 v${latestVersion}`
            : `当前已是最新版本 v${currentVersion}`
          : "暂时没有读取到版本信息",
      });
    } catch (error) {
      setStatus({
        latestVersion: null,
        url: RELEASES_URL,
        updateAvailable: false,
        message: `检查失败：${String(error)}`,
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      style={{
        padding: "48px 40px 60px",
        maxWidth: 680,
        width: "100%",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em", margin: 0 }}>
          关于
        </h1>
      </div>

      <div className="glass-card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)", marginBottom: 6 }}>
            当前版本
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)" }}>
            v{currentVersion}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <AppButton
            onClick={() => openUrl(REPO_URL).catch(() => undefined)}
            tone="secondary"
            size="sm"
          >
            GitHub 仓库
          </AppButton>
          <AppButton
            onClick={() => openUrl(RELEASES_URL).catch(() => undefined)}
            tone="secondary"
            size="sm"
          >
            Releases
          </AppButton>
          <AppButton
            onClick={checkUpdates}
            disabled={checking}
            size="sm"
          >
            {checking ? "检查中..." : "检查更新"}
          </AppButton>
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: 14,
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)", marginBottom: 6 }}>
            更新状态
          </div>
          <div
            style={{
              fontSize: 14,
              color: status?.updateAvailable ? "var(--accent-orange)" : "var(--text-primary)",
              lineHeight: 1.6,
            }}
          >
            {status?.message ?? "需要时再检查"}
          </div>
          {status?.latestVersion && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
              最新版本：v{status.latestVersion}
            </div>
          )}
          {status?.url && (
            <button
              onClick={() => openUrl(status.url!).catch(() => undefined)}
              style={{
                marginTop: 10,
                border: "none",
                background: "transparent",
                color: "var(--accent-blue)",
                padding: 0,
                fontSize: 12,
                fontWeight: 600,
                cursor: "default",
              }}
            >
              打开下载页
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
