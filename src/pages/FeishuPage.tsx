import { useEffect, useRef, useState } from "react";
import { AppButton } from "@/components/AppButton";
import {
  approveFeishuPairing,
  listFeishuPairingRequests,
  readConfig,
  writeConfig,
  testFeishuConnection,
  type PairingRequest,
} from "@/lib/tauri";

const DM_POLICIES = [
  { value: "pairing", label: "配对模式" },
  { value: "open",    label: "开放模式" },
];

export function FeishuPage() {
  const [appId, setAppId]       = useState("");
  const [appSecret, setSecret]  = useState("");
  const [dmPolicy, setDmPolicy] = useState("pairing");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingRequests, setPairingRequests] = useState<PairingRequest[]>([]);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [testing, setTesting]   = useState(false);
  const [approving, setApproving] = useState(false);
  const [loadingPairings, setLoadingPairings] = useState(false);
  const [pairingsLoaded, setPairingsLoaded] = useState(false);
  const [testResult, setResult] = useState<boolean | null>(null);
  const [pairingMessage, setPairingMessage] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [ready, setReady]       = useState(false);
  const saveTimerRef = useRef<number | null>(null);

  const refreshPairings = async () => {
    setLoadingPairings(true);
    try {
      const requests = await listFeishuPairingRequests();
      setPairingRequests(requests);
      setPairingsLoaded(true);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingPairings(false);
    }
  };

  useEffect(() => {
    readConfig().then((cfg) => {
      setAppId(cfg.feishu_app_id ?? "");
      setSecret(cfg.feishu_app_secret ?? "");
      setDmPolicy(cfg.dm_policy ?? "pairing");
      setReady(true);
    });
  }, []);

  const handleSave = async (nextAppId: string, nextSecret: string, nextPolicy: string) => {
    setSaving(true); setError(null); setPairingMessage(null);
    try {
      const cur = await readConfig();
      await writeConfig({
        ...cur,
        feishu_app_id: nextAppId,
        feishu_app_secret: nextSecret,
        dm_policy: nextPolicy,
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };

  useEffect(() => {
    if (!ready) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    setSaved(false);
    saveTimerRef.current = window.setTimeout(() => {
      void handleSave(appId, appSecret, dmPolicy);
    }, 500);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [appId, appSecret, dmPolicy, ready]);

  const handleTest = async () => {
    if (!appId || !appSecret) { setError("请先填写 App ID 和 App Secret"); return; }
    setTesting(true); setResult(null); setError(null); setPairingMessage(null);
    try { setResult(await testFeishuConnection(appId, appSecret)); }
    catch (e) { setError(String(e)); setResult(false); }
    finally { setTesting(false); }
  };

  const handleApprove = async () => {
    if (!pairingCode.trim()) {
      setError("请先输入 Pairing Code");
      return;
    }

    setApproving(true);
    setError(null);
    setPairingMessage(null);
    try {
      const message = await approveFeishuPairing(pairingCode.trim());
      setError(null);
      setPairingMessage(message || `已批准配对码 ${pairingCode.trim()}`);
      setPairingCode("");
      await refreshPairings();
    } catch (e) {
      const message = String(e);
      if (message.includes("No pending pairing request found")) {
        setPairingMessage("这个 pairing code 已处理或已过期，请回飞书重新发送 hi 获取新的 code。");
        await refreshPairings();
      } else {
        setError(message);
      }
    } finally {
      setApproving(false);
    }
  };

  return (
    <div style={{ padding: "48px 40px 60px", maxWidth: 680, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.01em", margin: 0 }}>
          飞书
        </h1>
      </div>

      {/* Credentials card */}
      <div className="glass-card" style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--card-border)" }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
            应用 ID (App ID)
          </label>
          <input
            type="text"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="cli_xxxxxxxxxxxxxxxx"
            style={{
              width: 280, padding: "6px 12px", borderRadius: 8, fontSize: 13,
              background: "var(--card-bg)", border: "none", color: "var(--text-primary)",
              outline: "none", fontFamily: "var(--font-mono)",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)", textAlign: "right"
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px" }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
            应用密钥 (App Secret)
          </label>
          <input
            type="password"
            value={appSecret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="••••••••••••••••"
            style={{
              width: 280, padding: "6px 12px", borderRadius: 8, fontSize: 13,
              background: "var(--card-bg)", border: "none", color: "var(--text-primary)",
              outline: "none", fontFamily: "var(--font-mono)",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)", textAlign: "right"
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderTop: "1px solid var(--card-border)" }}>
          <div style={{ fontSize: 12, color: saved ? "var(--accent-green)" : "var(--text-tertiary)" }}>
            {saving ? "保存中…" : saved ? "已保存" : "自动保存"}
          </div>
          <AppButton
            onClick={handleTest}
            disabled={testing || !appId || !appSecret}
            tone="secondary"
            size="sm"
          >
            {testing ? "测试中..." : "测试连接"}
          </AppButton>
        </div>
      </div>

      {/* Policy card */}
      <div className="glass-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px" }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
          私信策略
        </label>
        <div style={{ position: "relative" }}>
          <select
            value={dmPolicy}
            onChange={(e) => setDmPolicy(e.target.value)}
            style={{
              width: 280, padding: "6px 28px 6px 12px", borderRadius: 8, fontSize: 13,
              background: "var(--card-bg)", border: "none", color: "var(--text-primary)",
              outline: "none", cursor: "pointer", appearance: "none",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)", textAlign: "right", direction: "rtl"
            }}
          >
            {DM_POLICIES.map((p) => <option key={p.value} value={p.value} style={{ direction: "ltr" }}>{p.label}</option>)}
          </select>
          <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-tertiary)", pointerEvents: "none" }}>▾</span>
        </div>
      </div>

      {dmPolicy === "pairing" && (
        <div className="glass-card" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--card-border)" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>配对批准</div>
            </div>
            <AppButton
              onClick={() => refreshPairings()}
              disabled={loadingPairings}
              tone="secondary"
              size="sm"
            >
              {loadingPairings ? "刷新中..." : "刷新待处理"}
            </AppButton>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--card-border)" }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
              Pairing Code
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="text"
                value={pairingCode}
                onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                placeholder="FS2HPA4D"
                style={{
                  width: 180, padding: "6px 12px", borderRadius: 8, fontSize: 13,
                  background: "var(--card-bg)", border: "none", color: "var(--text-primary)",
                  outline: "none", fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
                  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)", textAlign: "center"
                }}
              />
              <AppButton
                onClick={handleApprove}
                disabled={approving}
                size="sm"
              >
                {approving ? "批准中..." : "批准配对"}
              </AppButton>
            </div>
          </div>

          <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)" }}>
              待处理请求
            </div>
            {!pairingsLoaded ? (
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                需要时再刷新
              </div>
            ) : pairingRequests.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>当前没有待处理的配对请求。</div>
            ) : (
              pairingRequests.map((request) => (
                <button
                  key={`${request.id}-${request.code}`}
                  onClick={() => setPairingCode(request.code)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--card-bg)",
                    boxShadow: "inset 0 0 0 0.5px var(--card-border)",
                    textAlign: "left",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                      {request.code}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                      {request.id}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>点此带入</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Test result */}
      {testResult !== null && (
        <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, background: testResult ? "rgba(52,199,89,0.1)" : "rgba(255,59,48,0.1)", color: testResult ? "var(--accent-green)" : "var(--accent-red)", border: testResult ? "1px solid rgba(52,199,89,0.2)" : "1px solid rgba(255,59,48,0.2)" }}>
          {testResult ? "连接成功 — 凭证有效" : "连接失败，请检查 App ID 和 Secret"}
        </div>
      )}

      {pairingMessage && (
        <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, background: "rgba(52,199,89,0.1)", color: "var(--accent-green)", border: "1px solid rgba(52,199,89,0.2)" }}>
          {pairingMessage}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, background: "rgba(255, 59, 48, 0.1)", color: "var(--accent-red)", border: "1px solid rgba(255, 59, 48, 0.2)" }}>
          {error}
        </div>
      )}

    </div>
  );
}
