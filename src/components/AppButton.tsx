import type { CSSProperties, ReactNode } from "react";

type ButtonTone = "blue" | "green" | "secondary" | "redSubtle";
type ButtonSize = "md" | "sm";

interface AppButtonProps {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: ButtonTone;
  size?: ButtonSize;
  style?: CSSProperties;
}

export function AppButton({
  children,
  onClick,
  disabled = false,
  tone = "blue",
  size = "md",
  style,
}: AppButtonProps) {
  const isSecondary = tone === "secondary";
  const isRedSubtle = tone === "redSubtle";
  const background =
    tone === "green"
      ? "var(--accent-green)"
      : isSecondary
        ? "var(--card-bg)"
        : isRedSubtle
          ? "rgba(255, 59, 48, 0.10)"
          : "var(--accent-blue)";
  const color =
    isSecondary
      ? "var(--text-primary)"
      : isRedSubtle
        ? "var(--accent-red)"
        : "white";
  const border = isSecondary
    ? "1px solid var(--card-border)"
    : isRedSubtle
      ? "1px solid rgba(255, 59, 48, 0.16)"
      : "none";
  const shadow = isSecondary
    ? "0 1px 2px rgba(0,0,0,0.05)"
    : isRedSubtle
      ? "none"
      : "0 1px 2px rgba(0,0,0,0.1), inset 0 0.5px 0 rgba(255,255,255,0.2)";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: size === "md" ? "7px 14px" : "5px 10px",
        minHeight: size === "md" ? 32 : 28,
        borderRadius: 8,
        fontSize: size === "md" ? 13 : 12,
        fontWeight: 500,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        color,
        background,
        border,
        boxShadow: shadow,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "all 0.15s ease",
        ...style,
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = "scale(0.96)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      {children}
    </button>
  );
}
