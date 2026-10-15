import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, IndianRupee, Percent, Receipt, TrendingUp, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ExportMenu } from "@/components/export-menu";
import { StatCard } from "@/components/stat-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchCustomers, fetchOrderItems, fetchOrders, fetchProducts, type Order } from "@/lib/data";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { useRole } from "@/components/role-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PIE_COLORS = [
  "var(--color-primary)",
  "var(--color-success)",
  "var(--color-brand)",
  "var(--color-warning)",
];

type Channel = "all" | "whatsapp" | "counter";

const CHANNELS: { value: Channel; label: string }[] = [
  { value: "all", label: "Combined" },
  { value: "whatsapp", label: "WhatsApp orders" },
  { value: "counter", label: "Counter sale" },
];

const CHANNEL_NAME: Record<Channel, string> = {
  all: "Combined",
  whatsapp: "WhatsApp",
  counter: "Counter sale",
};

// Dashboard-created ("manual") orders are in-store sales, so they count as counter sales
const channelOf = (o: Order): Exclude<Channel, "all"> => (o.source === "whatsapp" ? "whatsapp" : "counter");

const RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
  { value: "90d", label: "Last 90 days" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom dates" },
];

function rangeBounds(range: string, from: string, to: string): { start: Date | null; end: Date | null } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (n: number) => new Date(startOfToday.getTime() - (n - 1) * 86400000);
  switch (range) {
    case "today":
      return { start: startOfToday, end: null };
    case "7d":
      return { start: daysAgo(7), end: null };
    case "30d":
      return { start: daysAgo(30), end: null };
    case "month":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null };
    case "90d":
      return { start: daysAgo(90), end: null };
    case "year":
      return { start: new Date(now.getFullYear(), 0, 1), end: null };
    case "custom":
      return {
        start: from ? new Date(`${from}T00:00:00`) : null,
        end: to ? new Date(`${to}T23:59:59.999`) : null,
      };
    default:
      return { start: null, end: null };
  }
}

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports & Analytics — ibird Sales Insights" },
      {
        name: "description",
        content:
          "ibird analytics for WhatsApp orders, counter sales and both combined: revenue trends, GST, top products, customers and inventory turnover.",
      },
      { property: "og:title", content: "Reports & Analytics — ibird Sales Insights" },
      {
        property: "og:description",
        content: "Daily, weekly, monthly and yearly performance per sales channel with downloadable reports.",
      },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { role } = useRole();

  // Restrict reports access for Staff role
  if (role === "staff") {
    return (
      <AppShell title="Reports & Analytics" subtitle="Sales insights and performance metrics">
        <div className="card-surface rounded-lg border border-warning/30 bg-warning/5 p-8 text-center">
          <AlertTriangle className="mx-auto mb-4 size-12 text-warning" />
          <h2 className="mb-2 text-xl font-bold text-foreground">Access Restricted</h2>
          <p className="mb-6 text-muted-foreground">
            Staff members don't have access to reports and analytics. These insights are reserved for Admin and
            Manager roles to maintain data security.
          </p>
          <Button asChild>
            <Link to="/">Back to Dashboard</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  return <ReportsContent />;
}

function ReportsContent() {
  const { data: orders = [] } = useQuery({ queryKey: ["orders"], queryFn: fetchOrders });
  const { data: items = [] } = useQuery({ queryKey: ["order-items"], queryFn: fetchOrderItems });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });

  const [channel, setChannel] = useState<Channel>("all");
  const [granularity, setGranularity] = useState("daily");
  const [range, setRange] = useState("90d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [orderScope, setOrderScope] = useState("valid");

  // Orders in the date range and order filter, for every channel (used for the channel comparison)
  const inRange = useMemo(() => {
    const { start, end } = rangeBounds(range, from, to);
    return orders.filter((o) => {
      const d = new Date(o.created_at);
      if (start && d < start) return false;
      if (end && d > end) return false;
      if (orderScope === "paid") return o.payment_status === "paid";
      return o.status !== "cancelled";
    });
  }, [orders, range, from, to, orderScope]);

  const scoped = useMemo(
    () => (channel === "all" ? inRange : inRange.filter((o) => channelOf(o) === channel)),
    [inRange, channel],
  );

  const revenue = scoped.reduce((s, o) => s + Number(o.total), 0);
  const gst = scoped.reduce((s, o) => s + Number(o.tax), 0);
  const avg = scoped.length ? revenue / scoped.length : 0;
  const activeCustomers = new Set(scoped.map((o) => o.customer_id).filter(Boolean)).size;

  const bucketKey = (d: Date) => {
    if (granularity === "yearly") return `${d.getFullYear()}`;
    if (granularity === "monthly") return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    if (granularity === "weekly") {
      const start = new Date(d);
      start.setDate(d.getDate() - d.getDay());
      return `w/c ${start.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
    }
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  // Per period: totals plus the WhatsApp / counter split
  const trend = useMemo(() => {
    type Bucket = {
      period: string;
      revenue: number;
      orders: number;
      gst: number;
      whatsapp: number;
      whatsappOrders: number;
      counter: number;
      counterOrders: number;
    };
    const map = new Map<string, Bucket>();
    for (const o of [...scoped].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
      const key = bucketKey(new Date(o.created_at));
      const cur =
        map.get(key) ??
        { period: key, revenue: 0, orders: 0, gst: 0, whatsapp: 0, whatsappOrders: 0, counter: 0, counterOrders: 0 };
      const total = Number(o.total);
      cur.revenue += total;
      cur.orders += 1;
      cur.gst += Number(o.tax);
      if (channelOf(o) === "whatsapp") {
        cur.whatsapp += total;
        cur.whatsappOrders += 1;
      } else {
        cur.counter += total;
        cur.counterOrders += 1;
      }
      map.set(key, cur);
    }
    return Array.from(map.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, granularity]);

  const comparison = useMemo(() => {
    const rows = (["whatsapp", "counter"] as const).map((c) => {
      const list = inRange.filter((o) => channelOf(o) === c);
      const rev = list.reduce((s, o) => s + Number(o.total), 0);
      return {
        channel: c,
        orders: list.length,
        revenue: rev,
        gst: list.reduce((s, o) => s + Number(o.tax), 0),
        avg: list.length ? rev / list.length : 0,
      };
    });
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    return rows.map((r) => ({ ...r, share: totalRevenue ? Math.round((r.revenue / totalRevenue) * 100) : 0 }));
  }, [inRange]);

  const scopedIds = useMemo(() => new Set(scoped.map((o) => o.id)), [scoped]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const i of items) {
      if (!scopedIds.has(i.order_id)) continue;
      const cur = map.get(i.product_name) ?? { name: i.product_name, qty: 0, revenue: 0 };
      cur.qty += i.quantity;
      cur.revenue += Number(i.line_total);
      map.set(i.product_name, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [items, scopedIds]);

  const paymentMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of scoped) map.set(o.payment_method, (map.get(o.payment_method) ?? 0) + Number(o.total));
    return Array.from(map, ([name, value]) => ({ name, value }));
  }, [scoped]);

  const geo = useMemo(() => {
    const byCustomer = new Map(customers.map((c) => [c.id, c]));
    const map = new Map<string, number>();
    for (const o of scoped) {
      const city = (o.customer_id && byCustomer.get(o.customer_id)?.city) || "Unknown";
      map.set(city, (map.get(city) ?? 0) + Number(o.total));
    }
    return Array.from(map, ([city, value]) => ({ city, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [scoped, customers]);

  const repeatSplit = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of scoped) if (o.customer_id) counts.set(o.customer_id, (counts.get(o.customer_id) ?? 0) + 1);
    let repeat = 0;
    let fresh = 0;
    counts.forEach((c) => (c > 1 ? repeat++ : fresh++));
    return [
      { name: "New", value: fresh },
      { name: "Repeat", value: repeat },
    ];
  }, [scoped]);

  const turnover = useMemo(() => {
    const sold = new Map<string, number>();
    for (const i of items) {
      if (!scopedIds.has(i.order_id)) continue;
      sold.set(i.product_name, (sold.get(i.product_name) ?? 0) + i.quantity);
    }
    return products
      .map((p) => {
        const units = sold.get(p.name) ?? 0;
        return {
          id: p.id,
          name: p.variant ? `${p.name} ${p.variant}` : p.name,
          sku: p.sku,
          stock: p.stock,
          sold: units,
          ratio: p.stock ? Math.round((units / p.stock) * 100) / 100 : units,
        };
      })
      .sort((a, b) => b.ratio - a.ratio);
  }, [products, items, scopedIds]);

  const customReport = trend.map((t) =>
    channel === "all"
      ? {
          Period: t.period,
          "WhatsApp orders": t.whatsappOrders,
          "WhatsApp revenue": t.whatsapp,
          "Counter orders": t.counterOrders,
          "Counter revenue": t.counter,
          "Total orders": t.orders,
          "Total revenue": t.revenue,
          GST: Math.round(t.gst * 100) / 100,
        }
      : {
          Period: t.period,
          Orders: t.orders,
          Revenue: t.revenue,
          GST: Math.round(t.gst * 100) / 100,
          "Avg order": t.orders ? Math.round(t.revenue / t.orders) : 0,
        },
  );

  const rangeLabel =
    range === "custom"
      ? `${from ? formatDate(`${from}T00:00:00`) : "start"} → ${to ? formatDate(`${to}T00:00:00`) : "today"}`
      : (RANGES.find((r) => r.value === range)?.label ?? "");
  const reportTitle = `${CHANNEL_NAME[channel]} report · ${rangeLabel}`;
  const fileTag = channel === "all" ? "combined" : channel;

  return (
    <AppShell
      title="Reports & Analytics"
      subtitle="WhatsApp orders, counter sales, or both combined."
      actions={<ExportMenu filename={`ibird-${fileTag}-report`} title={reportTitle} rows={customReport} />}
    >
      {/* Sales channel */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Sales channel">
        {CHANNELS.map((c) => (
          <button
            key={c.value}
            type="button"
            role="tab"
            aria-selected={channel === c.value}
            onClick={() => setChannel(c.value)}
            className={cn(
              "flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              channel === c.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="card-surface mt-4 grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <Label>Date range</Label>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {range === "custom" && (
          <>
            <div>
              <Label>From</Label>
              <Input type="date" className="mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" className="mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}
        <div>
          <Label>Orders</Label>
          <Select value={orderScope} onValueChange={setOrderScope}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="valid">All orders (excl. cancelled)</SelectItem>
              <SelectItem value="paid">Paid orders only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Group by</Label>
          <Select value={granularity} onValueChange={setGranularity}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Day</SelectItem>
              <SelectItem value="weekly">Week</SelectItem>
              <SelectItem value="monthly">Month</SelectItem>
              <SelectItem value="yearly">Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Revenue" value={formatCurrency(revenue)} hint={CHANNEL_NAME[channel]} icon={IndianRupee} tone="success" />
        <StatCard label="Orders" value={formatNumber(scoped.length)} hint={rangeLabel} icon={Receipt} />
        <StatCard label="Avg order value" value={formatCurrency(avg)} icon={TrendingUp} tone="brand" />
        <StatCard label="GST collected" value={formatCurrency(gst)} icon={Percent} />
        <StatCard label="Active customers" value={formatNumber(activeCustomers)} icon={Users} tone="warning" />
      </div>

      {channel === "all" && (
        <div className="card-surface mt-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Channel comparison</h2>
            <ExportMenu
              filename="ibird-channel-comparison"
              title={`Channel comparison · ${rangeLabel}`}
              rows={comparison.map((c) => ({
                Channel: CHANNEL_NAME[c.channel],
                Orders: c.orders,
                Revenue: c.revenue,
                GST: Math.round(c.gst * 100) / 100,
                "Avg order": Math.round(c.avg),
                "Revenue share %": c.share,
              }))}
            />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {comparison.map((c) => (
              <button
                key={c.channel}
                type="button"
                onClick={() => setChannel(c.channel)}
                className="rounded-xl border border-border p-4 text-left transition-colors hover:border-primary hover:bg-secondary"
                title={`Show the ${CHANNEL_NAME[c.channel]} report`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{CHANNEL_NAME[c.channel]}</p>
                  <span className="text-sm font-bold text-primary">{c.share}%</span>
                </div>
                <p className="mt-1 text-2xl font-extrabold">{formatCurrency(c.revenue)}</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn("h-full rounded-full", c.channel === "whatsapp" ? "bg-success" : "bg-primary")}
                    style={{ width: `${c.share}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatNumber(c.orders)} orders · avg {formatCurrency(c.avg)} · GST {formatCurrency(c.gst)}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      <Tabs defaultValue="overview" className="mt-5">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="products">Product performance</TabsTrigger>
          <TabsTrigger value="customers">Customer analytics</TabsTrigger>
          <TabsTrigger value="turnover">Inventory turnover</TabsTrigger>
          <TabsTrigger value="custom">Period report</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 xl:grid-cols-3">
          <div className="card-surface p-5 xl:col-span-2">
            <h2 className="text-lg font-bold">
              Revenue trend{channel === "all" ? " by channel" : ` · ${CHANNEL_NAME[channel]}`}
            </h2>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="period" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  {channel === "all" ? (
                    <>
                      <Legend />
                      <Line type="monotone" name="Total" dataKey="revenue" stroke="var(--color-foreground)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                      <Line type="monotone" name="WhatsApp" dataKey="whatsapp" stroke="var(--color-success)" strokeWidth={2.5} dot={false} />
                      <Line type="monotone" name="Counter sale" dataKey="counter" stroke="var(--color-primary)" strokeWidth={2.5} dot={false} />
                    </>
                  ) : (
                    <Line type="monotone" name="Revenue" dataKey="revenue" stroke="var(--color-primary)" strokeWidth={2.5} dot={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card-surface p-5">
            <h2 className="text-lg font-bold">Payment method mix</h2>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={paymentMix} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90}>
                    {paymentMix.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="products" className="card-surface mt-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Top sellers · {CHANNEL_NAME[channel]}</h2>
            <ExportMenu
              filename={`ibird-${fileTag}-product-performance`}
              title={`Product performance · ${CHANNEL_NAME[channel]} · ${rangeLabel}`}
              rows={topProducts.map((p) => ({ Product: p.name, Units: p.qty, Revenue: p.revenue }))}
            />
          </div>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProducts.slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} interval={0} height={60} angle={-20} textAnchor="end" />
                <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="revenue" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Units sold</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topProducts.slice(0, 15).map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-right">{p.qty}</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(p.revenue)}</TableCell>
                  </TableRow>
                ))}
                {!topProducts.length && <EmptyRow cols={3} />}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="customers" className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="card-surface p-5">
            <h2 className="text-lg font-bold">New vs repeat</h2>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={repeatSplit} dataKey="value" nameKey="name" outerRadius={90}>
                    {repeatSplit.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card-surface p-5">
            <h2 className="text-lg font-bold">Geographic distribution</h2>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={geo} layout="vertical" margin={{ left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" fontSize={12} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                  <YAxis type="category" dataKey="city" fontSize={12} width={90} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="value" fill="var(--color-brand)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="turnover" className="card-surface mt-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Inventory turnover · {CHANNEL_NAME[channel]}</h2>
            <ExportMenu
              filename={`ibird-${fileTag}-inventory-turnover`}
              title={`Inventory turnover · ${CHANNEL_NAME[channel]} · ${rangeLabel}`}
              rows={turnover.map((t) => ({ Product: t.name, SKU: t.sku, Stock: t.stock, Sold: t.sold, Turnover: t.ratio }))}
            />
          </div>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Turnover</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {turnover.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground">{t.sku}</TableCell>
                    <TableCell className="text-right">{t.stock}</TableCell>
                    <TableCell className="text-right">{t.sold}</TableCell>
                    <TableCell className="text-right font-semibold">{t.ratio}x</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="custom" className="card-surface mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold">Period report · {CHANNEL_NAME[channel]}</h2>
              <p className="text-sm text-muted-foreground">
                By {granularity === "daily" ? "day" : granularity.replace("ly", "")} · {rangeLabel}
                {orderScope === "paid" ? " · paid orders only" : ""}
              </p>
            </div>
            <ExportMenu filename={`ibird-${fileTag}-report`} title={reportTitle} rows={customReport} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  {channel === "all" ? (
                    <>
                      <TableHead className="text-right">WhatsApp</TableHead>
                      <TableHead className="text-right">Counter sale</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">GST</TableHead>
                      <TableHead className="text-right">Total revenue</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">GST</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Avg order</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {trend.map((t) => (
                  <TableRow key={t.period}>
                    <TableCell className="whitespace-nowrap font-medium">{t.period}</TableCell>
                    {channel === "all" ? (
                      <>
                        <TableCell className="whitespace-nowrap text-right">
                          {formatCurrency(t.whatsapp)}
                          <span className="block text-xs text-muted-foreground">{t.whatsappOrders} orders</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {formatCurrency(t.counter)}
                          <span className="block text-xs text-muted-foreground">{t.counterOrders} orders</span>
                        </TableCell>
                        <TableCell className="text-right">{t.orders}</TableCell>
                        <TableCell className="text-right">{formatCurrency(t.gst)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(t.revenue)}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="text-right">{t.orders}</TableCell>
                        <TableCell className="text-right">{formatCurrency(t.gst)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(t.revenue)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(t.orders ? t.revenue / t.orders : 0)}</TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
                {trend.length > 0 && (
                  <TableRow className="border-t-2 font-bold">
                    <TableCell>Total</TableCell>
                    {channel === "all" ? (
                      <>
                        <TableCell className="text-right">{formatCurrency(comparison[0]?.revenue ?? 0)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(comparison[1]?.revenue ?? 0)}</TableCell>
                        <TableCell className="text-right">{scoped.length}</TableCell>
                        <TableCell className="text-right">{formatCurrency(gst)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(revenue)}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="text-right">{scoped.length}</TableCell>
                        <TableCell className="text-right">{formatCurrency(gst)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(revenue)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(avg)}</TableCell>
                      </>
                    )}
                  </TableRow>
                )}
                {!trend.length && <EmptyRow cols={channel === "all" ? 6 : 5} />}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-8 text-center text-muted-foreground">
        No orders match these filters.
      </TableCell>
    </TableRow>
  );
}
