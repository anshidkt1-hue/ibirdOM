import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: "default" | "success" | "warning" | "brand";
}) {
  const toneClass = {
    default: "bg-accent text-accent-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-warning/15 text-warning",
    brand: "bg-brand/10 text-brand",
  }[tone];

  const hintClass = {
    default: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning",
    brand: "text-brand",
  }[tone];

  return (
    <div className="card-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span className={cn("flex size-9 items-center justify-center rounded-lg", toneClass)}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-extrabold tracking-tight">{value}</p>
      {hint && <p className={cn("mt-1 text-sm", hintClass)}>{hint}</p>}
    </div>
  );
}
