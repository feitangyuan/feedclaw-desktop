import { X } from "lucide-react";
import { useEffect, useRef } from "react";

interface TerminalOverlayProps {
  title: string;
  lines: string[];
  open: boolean;
  done: boolean;
  onClose: () => void;
}

export function TerminalOverlay({ title, lines, open, done, onClose }: TerminalOverlayProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  if (!open) return null;

  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0, 0, 0, 0.15)",
      backdropFilter: "blur(4px)",
      display: "flex", flexDirection: "column", justifyContent: "flex-end",
      zIndex: 999
    }}>
      {/* 底部深色毛玻璃面板 */}
      <div style={{
        background: "rgba(30, 30, 32, 0.85)",
        backdropFilter: "blur(20px)",
        borderTop: "1px solid rgba(255, 255, 255, 0.15)",
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        height: "65%", display: "flex", flexDirection: "column",
        boxShadow: "0 -10px 40px rgba(0, 0, 0, 0.2)",
      }}>

        {/* 标题栏 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 20px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)"
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255, 255, 255, 0.9)", letterSpacing: "0.03em" }}>
            {title}
          </div>
          {done && (
            <button
              onClick={onClose}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24, borderRadius: 12,
                background: "rgba(255, 255, 255, 0.1)", color: "white", cursor: "pointer",
                transition: "background 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)"}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* 终端内容区 */}
        <div style={{
          flex: 1, padding: "16px 20px", overflowY: "auto",
          fontFamily: "var(--font-mono)", fontSize: 12, color: "rgba(255, 255, 255, 0.8)", lineHeight: 1.6
        }}>
          {lines.map((l, i) => (
            <div key={i} style={{ wordBreak: "break-all", marginBottom: 4 }}>
              <span style={{ color: "var(--accent-green)", marginRight: 8 }}>➜</span>
              {l}
            </div>
          ))}
          {!done && (
            <div style={{
              display: "inline-block", width: 8, height: 14,
              background: "rgba(255, 255, 255, 0.7)", verticalAlign: "middle", marginLeft: 4
            }} />
          )}
          <div ref={bottomRef} />
        </div>

      </div>
    </div>
  );
}
