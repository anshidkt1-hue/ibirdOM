import { useEffect, useState } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadInvoicePdf, invoicePdfUrl, type Invoice } from "@/lib/documents";

// Shows an invoice PDF inside the dashboard, with download and open-in-new-tab
export function InvoiceViewer({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoice) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setError(null);
    invoicePdfUrl(invoice)
      .then((u) => {
        objectUrl = u;
        if (cancelled) URL.revokeObjectURL(u);
        else setUrl(u);
      })
      .catch((e: Error) => !cancelled && setError(e.message || "Could not create the invoice"));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [invoice]);

  return (
    <Dialog open={!!invoice} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[92vh] max-w-[min(56rem,calc(100vw-1rem))] flex-col gap-3 p-3 sm:p-5">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">Invoice {invoice?.invoice_number}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-secondary">
          {url ? (
            <iframe src={url} title={`Invoice ${invoice?.invoice_number}`} className="size-full" />
          ) : (
            <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
              {error ?? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Preparing invoice…
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="flex-row flex-wrap justify-end gap-2">
          <Button variant="outline" className="gap-2" disabled={!url} onClick={() => url && window.open(url, "_blank")}>
            <ExternalLink className="size-4" /> Open in new tab
          </Button>
          <Button
            className="gap-2"
            disabled={!invoice}
            onClick={() => invoice && downloadInvoicePdf(invoice).catch((e: Error) => toast.error(e.message))}
          >
            <Download className="size-4" /> Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
