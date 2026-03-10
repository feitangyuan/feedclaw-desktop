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
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0, 0, 0, 0.18)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 999,
      }}
    >
      <div
        style={{
          width: "min(860px, 100%)",
          height: "min(560px, 72vh)",
          background: "rgba(28, 28, 30, 0.92)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: 18,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.28)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 20px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
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

        <div
          style={{
            flex: 1,
            padding: "16px 20px",
            overflowY: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "rgba(255, 255, 255, 0.8)",
            lineHeight: 1.6,
          }}
        >
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
