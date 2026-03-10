import { useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar, type Page } from "./components/Sidebar";
import { StatusPage } from "./pages/StatusPage";
import { DiagnosisPage } from "./pages/DiagnosisPage";
import { ConfigPage } from "./pages/ConfigPage";
import { SkillsPage } from "./pages/SkillsPage";
import { TokenUsagePage } from "./pages/TokenUsagePage";
import { FeishuPage } from "./pages/FeishuPage";
import { AboutPage } from "./pages/AboutPage";

export default function App() {
  const [page, setPage] = useState<Page>("status");
  const [visitedPages, setVisitedPages] = useState<Page[]>(["status"]);
  const handleDragStart = () => {
    void getCurrentWindow().startDragging();
  };

  const handlePageChange = (nextPage: Page) => {
    setPage(nextPage);
    setVisitedPages((prev) => (prev.includes(nextPage) ? prev : [...prev, nextPage]));
  };

  const pageContent: Record<Page, ReactNode> = {
    status: <StatusPage onNavigate={handlePageChange} />,
    config: <ConfigPage />,
    feishu: <FeishuPage />,
    skills: <SkillsPage />,
    usage: <TokenUsagePage />,
    about: <AboutPage />,
    diagnosis: <DiagnosisPage onNavigate={handlePageChange} />,
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

      <Sidebar current={page} onChange={handlePageChange} />

      <main style={{ flex: 1, height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>

        {/* Page content */}
        <div style={{ flex: 1, position: "relative" }}>
          {visitedPages.map((entry) => (
            <div
              key={entry}
              style={{
                position: "absolute",
                inset: 0,
                overflowY: "auto",
                display: page === entry ? "block" : "none",
              }}
            >
              {pageContent[entry]}
            </div>
          ))}
        </div>

      </main>
    </div>
  );
}
