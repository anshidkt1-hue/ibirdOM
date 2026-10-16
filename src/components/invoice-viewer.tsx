import { useEffect, useState } from "react";
import { Download, ExternalLink, Loader2, Maximize2, Minimize2, Printer, Ticket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  downloadCouponsPdf,
  downloadInvoicePdf,
  invoicePdfUrl,
  openCouponsPdf,
  type CouponArtInput,
  type Invoice,
} from "@/lib/documents";

export type ViewerCoupons = { arts: CouponArtInput[]; orderNumber: string };

// Shows an invoice PDF inside the dashboard, with download and open-in-new-tab
export function InvoiceViewer({
  invoice,
  onClose,
  coupons,
}: {
  invoice: Invoice | null;
  onClose: () => void;
  // Giveaway coupons of the sale (offer products), shown under the invoice to print or download
  coupons?: ViewerCoupons | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Full screen works everywhere, including browsers or app frames that block new tabs
  const [full, setFull] = useState(false);

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
    <Dialog
      open={!!invoice}
      onOpenChange={(open) => {
        if (!open) {
          setFull(false);
          onClose();
        }
      }}
    >
      <DialogContent
        className={
          full
            ? "flex h-[100dvh] w-screen max-w-none flex-col gap-3 rounded-none p-3 sm:p-4"
            : "flex h-[92vh] max-w-[min(56rem,calc(100vw-1rem))] flex-col gap-3 p-3 sm:p-5"
        }
      >
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
        {coupons && coupons.arts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
            <Ticket className="size-4 shrink-0 text-destructive" />
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-semibold">
                {coupons.arts.length} Thar ROXX coupon{coupons.arts.length > 1 ? "s" : ""}
              </span>{" "}
              <span className="font-mono text-xs text-muted-foreground">
                {coupons.arts.map((a) => a.code).join(", ")}
              </span>
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => openCouponsPdf(coupons.arts, coupons.orderNumber).catch((e: Error) => toast.error(e.message))}
            >
              <Printer className="size-3.5" /> Print coupons
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => downloadCouponsPdf(coupons.arts, coupons.orderNumber).catch((e: Error) => toast.error(e.message))}
            >
              <Download className="size-3.5" /> Download
            </Button>
          </div>
        )}
        <DialogFooter className="flex-row flex-wrap justify-end gap-2">
          <Button variant="outline" className="gap-2" disabled={!url} onClick={() => setFull((f) => !f)}>
            {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            {full ? "Exit full screen" : "Full screen"}
          </Button>
          {/* A real link: browsers block window.open() of a PDF blob as a pop-up, but always allow a clicked link */}
          {url ? (
            <Button asChild variant="outline" className="gap-2">
              <a href={url} target="_blank" rel="noopener">
                <ExternalLink className="size-4" /> Open in new tab
              </a>
            </Button>
          ) : (
            <Button variant="outline" className="gap-2" disabled>
              <ExternalLink className="size-4" /> Open in new tab
            </Button>
          )}
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
