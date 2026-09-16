import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/format";

const MAP: Record<string, string> = {
  completed: "bg-success/12 text-success border-success/25",
  paid: "bg-success/12 text-success border-success/25",
  active: "bg-success/12 text-success border-success/25",
  pending: "bg-warning/15 text-warning border-warning/30",
  unpaid: "bg-warning/15 text-warning border-warning/30",
  on_leave: "bg-warning/15 text-warning border-warning/30",
  processing: "bg-info/12 text-info border-info/25",
  shipped: "bg-brand/12 text-brand border-brand/25",
  cancelled: "bg-destructive/10 text-destructive border-destructive/25",
  refunded: "bg-destructive/10 text-destructive border-destructive/25",
  whatsapp: "bg-success/12 text-success border-success/25",
  "walk-in": "bg-secondary text-secondary-foreground border-border",
  manual: "bg-accent text-accent-foreground border-transparent",
};

export function StatusBadge({ value, className }: { value: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full font-semibold capitalize", MAP[value] ?? "", className)}
    >
      {titleCase(value)}
    </Badge>
  );
}
