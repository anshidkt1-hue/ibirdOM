import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
