import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar, type Page } from "./components/Sidebar";
import { StatusPage } from "./pages/StatusPage";
import { DiagnosisPage } from "./pages/DiagnosisPage";
import { ConfigPage } from "./pages/ConfigPage";
import { SkillsPage } from "./pages/SkillsPage";
import { TokenUsagePage } from "./pages/TokenUsagePage";
import { FeishuPage } from "./pages/FeishuPage";

export default function App() {
  const [page, setPage] = useState<Page>("status");
  const handleDragStart = () => {
    void getCurrentWindow().startDragging();
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        background: "var(--window-bg)",
        position: "relative",
      }}
    >

      <div
        onMouseDown={handleDragStart}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 44,
          zIndex: 20,
          cursor: "default",
        }}
      />

      <Sidebar current={page} onChange={setPage} />

      <main style={{ flex: 1, height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>

        {/* Page content */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {page === "status"  && <StatusPage onNavigate={setPage} />}
          {page === "diagnosis" && <DiagnosisPage onNavigate={setPage} />}
          {page === "config"  && <ConfigPage />}
          {page === "skills"  && <SkillsPage />}
          {page === "usage"   && <TokenUsagePage />}
          {page === "feishu"  && <FeishuPage />}
        </div>

      </main>
    </div>
  );
}
