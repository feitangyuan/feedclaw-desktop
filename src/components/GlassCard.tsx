import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  padding?: "sm" | "md" | "lg" | "none";
}

const paddingMap = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export function GlassCard({ children, className, padding = "md" }: GlassCardProps) {
  return (
    <div className={cn("glass-card", paddingMap[padding], className)}>
      {children}
    </div>
  );
}
