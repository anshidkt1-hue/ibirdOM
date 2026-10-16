import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Eye, FileText, Search } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { InvoiceViewer } from "@/components/invoice-viewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  downloadInvoicePdf,
  fetchInvoicesPage,
  isMissingTable,
  type Invoice,
  type InvoiceChannel,
} from "@/lib/documents";
import { formatCurrency, formatDate } from "@/lib/format";

export const Route = createFileRoute("/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices — ibird" },
      { name: "description", content: "Tax invoices for WhatsApp orders and counter sales, numbered separately, with PDF download." },
    ],
  }),
  component: InvoicesPage,
});

const PAGE_SIZE = 20;

const CHANNELS: { value: InvoiceChannel; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp orders" },
  { value: "counter", label: "Counter sales" },
];

function InvoicesPage() {
  const [channel, setChannel] = useState<InvoiceChannel>("whatsapp");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Invoice | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [channel, debounced, from, to]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["invoices", channel, debounced, from, to, page],
    queryFn: () => fetchInvoicesPage({ channel, search: debounced, from, to }, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
    retry: (count, e) => !isMissingTable(e) && count < 2,
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const download = async (invoice: Invoice) => {
    setDownloading(invoice.id);
    try {
      await downloadInvoicePdf(invoice);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the PDF");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <AppShell title="Invoices" subtitle="Tax invoices for every paid order, numbered separately per channel.">
      <Tabs value={channel} onValueChange={(v) => setChannel(v as InvoiceChannel)}>
        <TabsList>
          {CHANNELS.map((c) => (
            <TabsTrigger key={c.value} value={c.value}>
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="card-surface mt-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-0 flex-1 basis-60">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search invoice no., customer or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="text-xs text-muted-foreground">
            From
            <Input type="date" className="mt-1 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-xs text-muted-foreground">
            To
            <Input type="date" className="mt-1 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        {error && isMissingTable(error) ? (
          <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Invoices are not set up in the database yet. Run the <span className="font-mono">invoices_and_coupons.sql</span>{" "}
            migration in Supabase, then reload this page.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice no.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="whitespace-nowrap font-mono text-sm font-semibold">{inv.invoice_number}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(inv.issued_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {inv.order_number ? (
                        <Link to="/orders/$orderId" params={{ orderId: inv.order_id }} className="font-medium text-primary hover:underline">
                          {inv.order_number}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="max-w-[14rem]">
                      <p className="truncate font-medium">{inv.customer_name || "Walk-in customer"}</p>
                      {inv.customer_phone && <p className="text-xs text-muted-foreground">{inv.customer_phone}</p>}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(inv.tax)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(inv.total)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" className="mr-1 gap-1.5" onClick={() => setViewing(inv)}>
                        <Eye className="size-3.5" /> View
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={downloading === inv.id}
                        onClick={() => download(inv)}
                      >
                        <Download className="size-3.5" /> {downloading === inv.id ? "Preparing…" : "PDF"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      {isLoading ? (
                        "Loading invoices…"
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <FileText className="size-4" /> No invoices found. Invoices are created when an order is paid.
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {total > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} invoices
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="size-4" /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
      <InvoiceViewer invoice={viewing} onClose={() => setViewing(null)} />
    </AppShell>
  );
}
