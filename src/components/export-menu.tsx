import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportCSV, exportExcel, exportPDF, type ExportRow } from "@/lib/export";
import { toast } from "sonner";

export function ExportMenu({
  rows,
  filename,
  title,
  label = "Export",
}: {
  rows: ExportRow[];
  filename: string;
  title: string;
  label?: string;
}) {
  const guard = (fn: () => void) => {
    if (!rows.length) {
      toast.error("Nothing to export");
      return;
    }
    fn();
    toast.success(`${title} exported`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Download className="size-4" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => guard(() => exportCSV(rows, filename))}>
          Download CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => guard(() => exportExcel(rows, filename))}>
          Download Excel
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => guard(() => exportPDF(rows, filename, title))}>
          Download PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type ExportScope = {
  key: string;
  label: string;
  hidden?: boolean;
  getRows: (onProgress: (loaded: number) => void) => Promise<ExportRow[]>;
};

type Format = "csv" | "xlsx" | "pdf";

const PDF_ROW_LIMIT = 2500;

export function ScopedExportMenu({
  scopes,
  filename,
  title,
  label = "Export",
}: {
  scopes: ExportScope[];
  filename: string;
  title: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const visible = scopes.filter((s) => !s.hidden);

  const run = async (scope: ExportScope, format: Format) => {
    if (busy) return;
    setBusy(true);
    const toastId = toast.loading(`Preparing ${scope.label.toLowerCase()}…`);
    try {
      const rows = await scope.getRows((loaded) =>
        toast.loading(`Preparing export… ${loaded.toLocaleString("en-IN")} rows`, { id: toastId }),
      );
      if (!rows.length) {
        toast.error("Nothing to export", { id: toastId });
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const name = `${filename}-${scope.key}-${stamp}`;
      if (format === "pdf") {
        if (rows.length > PDF_ROW_LIMIT) {
          toast.error(
            `PDF is limited to ${PDF_ROW_LIMIT.toLocaleString("en-IN")} rows. Use CSV or Excel for ${rows.length.toLocaleString("en-IN")} rows.`,
            { id: toastId },
          );
          return;
        }
        exportPDF(rows, name, title);
      } else if (format === "xlsx") {
        exportExcel(rows, name);
      } else {
        exportCSV(rows, name);
      }
      toast.success(`${rows.length.toLocaleString("en-IN")} rows exported`, { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed", { id: toastId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        {visible.map((scope, index) => (
          <div key={scope.key}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{scope.label}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => run(scope, "csv")}>Download CSV</DropdownMenuItem>
            <DropdownMenuItem onClick={() => run(scope, "xlsx")}>Download Excel</DropdownMenuItem>
            <DropdownMenuItem onClick={() => run(scope, "pdf")}>Download PDF</DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
