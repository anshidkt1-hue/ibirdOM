import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Eye, ImagePlus, Search, Send, Ticket, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ScopedExportMenu, type ExportScope } from "@/components/export-menu";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRole } from "@/components/role-provider";
import { fetchSettings, saveSettings } from "@/lib/data";
import {
  couponSvgFor,
  downloadCouponPng,
  fetchCouponsPage,
  fetchCouponStats,
  fetchAllCoupons,
  couponExportRows,
  type CouponChannel,
  uploadGiveawayImage,
  type Coupon,
  type CouponArtInput,
} from "@/lib/documents";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/coupons")({
  head: () => ({
    meta: [
      { title: "Coupons — ibird" },
      { name: "description", content: "Thar ROXX giveaway coupons issued for paid WhatsApp orders, with the coupon design." },
    ],
  }),
  component: CouponsPage,
});

const PAGE_SIZE = 20;
const SAMPLE_DATE = new Date().toISOString();

function CouponsPage() {
  const queryClient = useQueryClient();
  const { can } = useRole();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState<CouponChannel | "all">("all");
  const [preview, setPreview] = useState<Coupon | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debounced, channel]);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => fetchSettings().catch(() => ({}) as Awaited<ReturnType<typeof fetchSettings>>),
  });
  const { data: stats } = useQuery({ queryKey: ["coupon-stats", channel], queryFn: () => fetchCouponStats(channel) });
  const { data, isLoading } = useQuery({
    queryKey: ["coupons", channel, debounced, page],
    queryFn: () => fetchCouponsPage(debounced, page, PAGE_SIZE, channel),
    placeholderData: keepPreviousData,
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const imageUrl = settings?.giveaway_image_url ?? null;
  const storeName = settings?.company_name || "ibird";

  const setImage = useMutation({
    mutationFn: async (file: File | null) =>
      saveSettings({ giveaway_image_url: file ? await uploadGiveawayImage(file) : null }),
    onSuccess: (_, file) => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success(file ? "Thar ROXX photo updated. New coupons will use it." : "Photo removed. Coupons use the drawn SUV.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Export by channel from any tab; "this page" and "matching search" follow what is on screen
  const whatsappCount = stats?.whatsapp ?? 0;
  const counterCount = stats?.counter ?? 0;
  const exportScopes: ExportScope[] = [
    {
      key: "page",
      label: `This page (${rows.length})`,
      getRows: async () => couponExportRows(rows),
    },
    {
      key: "search",
      label: `Matching "${debounced.trim()}" (${total})`,
      hidden: !debounced.trim(),
      getRows: (onProgress) => fetchAllCoupons(channel, debounced, onProgress).then(couponExportRows),
    },
    {
      key: "all",
      label: `All coupons (${whatsappCount + counterCount})`,
      getRows: (onProgress) => fetchAllCoupons("all", "", onProgress).then(couponExportRows),
    },
    {
      key: "whatsapp",
      label: `WhatsApp order coupons (${whatsappCount})`,
      getRows: (onProgress) => fetchAllCoupons("whatsapp", "", onProgress).then(couponExportRows),
    },
    {
      key: "counter",
      label: `Counter sale coupons (${counterCount})`,
      getRows: (onProgress) => fetchAllCoupons("counter", "", onProgress).then(couponExportRows),
    },
  ];

  const artFor = (c: Coupon): CouponArtInput => ({
    code: c.coupon_code,
    customerName: c.customer_name,
    orderNumber: c.order_number,
    issuedAt: c.created_at,
    productName: c.product_name,
    seq: c.coupon_seq,
    total: c.coupon_total,
    storeName,
    imageUrl,
  });

  const download = async (c: Coupon) => {
    try {
      await downloadCouponPng(artFor(c));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the image");
    }
  };

  return (
    <AppShell
      title="Coupons"
      subtitle="Thar ROXX giveaway coupons: one for every offer product sold, on WhatsApp and at the counter."
      actions={<ScopedExportMenu scopes={exportScopes} filename="ibird-coupons" title="Thar ROXX coupons" />}
    >
      {/* Coupons kept apart by where they were issued */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Coupon channel">
        {(
          [
            ["all", "All coupons", (stats?.whatsapp ?? 0) + (stats?.counter ?? 0)],
            ["whatsapp", "WhatsApp orders", stats?.whatsapp ?? 0],
            ["counter", "Counter sale", stats?.counter ?? 0],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={channel === value}
            onClick={() => setChannel(value)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              channel === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {label}
            <span
              className={`rounded-full px-1.5 text-xs ${channel === value ? "bg-primary-foreground/20" : "bg-secondary"}`}
            >
              {formatNumber(count)}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={channel === "all" ? "Coupons issued" : channel === "whatsapp" ? "WhatsApp coupons" : "Counter sale coupons"}
          value={formatNumber(stats?.total ?? 0)}
          icon={Ticket}
        />
        <StatCard label="Issued today" value={formatNumber(stats?.today ?? 0)} icon={CalendarDays} tone="brand" />
        {channel === "counter" ? (
          <StatCard label="Handed over at the counter" value={formatNumber(stats?.total ?? 0)} hint="Printed or downloaded with the bill" icon={Send} tone="success" />
        ) : (
          <StatCard label="Sent on WhatsApp" value={formatNumber(stats?.sent ?? 0)} icon={Send} tone="success" />
        )}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="card-surface min-w-0 p-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search coupon code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Coupon</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap font-mono text-sm font-bold">{c.coupon_code}</TableCell>
                    <TableCell className="max-w-[12rem]">
                      <p className="truncate">{c.product_name || "—"}</p>
                      {c.coupon_total && c.coupon_total > 1 && (
                        <p className="text-xs text-muted-foreground">
                          Coupon {c.coupon_seq} of {c.coupon_total}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[12rem]">
                      <p className="truncate font-medium">{c.customer_name || "—"}</p>
                      {c.customer_phone && <p className="text-xs text-muted-foreground">{c.customer_phone}</p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {c.order_id && c.order_number ? (
                        <>
                          <Link to="/orders/$orderId" params={{ orderId: c.order_id }} className="font-medium text-primary hover:underline">
                            {c.order_number}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {(c.channel ?? c.order_source) === "whatsapp" ? "WhatsApp" : "Counter sale"}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(c.created_at)}</TableCell>
                    <TableCell>
                      {c.sent_at ? (
                        <Badge variant="secondary" title={formatDateTime(c.sent_at)}>Sent on WhatsApp</Badge>
                      ) : c.channel === "counter" ? (
                        <span className="text-xs text-muted-foreground">At counter</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Code only</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button size="icon" variant="ghost" title="Preview" onClick={() => setPreview(c)}>
                        <Eye className="size-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="Download image" onClick={() => download(c)}>
                        <Download className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      {isLoading ? "Loading coupons…" : "No coupons yet. Coupons are issued for offer products when a WhatsApp order is paid or a counter sale is completed."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {total > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} coupons
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

        <div className="card-surface h-fit min-w-0 p-4">
          <h2 className="text-lg font-bold">Coupon design</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sent to the customer on WhatsApp with the payment confirmation and invoice.
          </p>
          <CouponPreview
            className="mt-3"
            art={{ code: "THAR-AB12CD", customerName: "Customer name", orderNumber: "WA-261015-100001", issuedAt: SAMPLE_DATE, storeName, imageUrl }}
          />
          {can("edit") && (
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setImage.mutate(file);
                  e.target.value = "";
                }}
              />
              <Button className="gap-2" disabled={setImage.isPending} onClick={() => fileRef.current?.click()}>
                <ImagePlus className="size-4" />
                {setImage.isPending ? "Uploading…" : imageUrl ? "Change Thar ROXX photo" : "Upload Thar ROXX photo"}
              </Button>
              {imageUrl && (
                <Button variant="outline" className="gap-2" disabled={setImage.isPending} onClick={() => setImage.mutate(null)}>
                  <Trash2 className="size-4" /> Remove photo
                </Button>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Use a landscape photo of the car (it fills the left side). Without a photo, a drawn SUV is shown.
          </p>
        </div>
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Coupon {preview?.coupon_code}</DialogTitle>
          </DialogHeader>
          {preview && <CouponPreview art={artFor(preview)} />}
          <DialogFooter>
            <Button className="gap-2" onClick={() => preview && download(preview)}>
              <Download className="size-4" /> Download image
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function CouponPreview({ art, className = "" }: { art: CouponArtInput; className?: string }) {
  const { data: svg } = useQuery({
    queryKey: ["coupon-svg", art],
    queryFn: () => couponSvgFor(art),
    staleTime: Infinity,
  });
  return (
    <div className={`aspect-[1200/630] w-full overflow-hidden rounded-xl bg-secondary ${className}`}>
      {svg && (
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          alt={`Coupon ${art.code}`}
          className="size-full object-contain"
        />
      )}
    </div>
  );
}
