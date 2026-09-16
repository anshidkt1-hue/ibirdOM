import { createFileRoute } from "@tanstack/react-router";
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
import { AlertTriangle, IndianRupee, Receipt, TrendingUp, Users } from "lucide-react";
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
import { fetchCustomers, fetchOrderItems, fetchOrders, fetchProducts } from "@/lib/data";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { useRole } from "@/components/role-provider";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

const PIE_COLORS = [
  "var(--color-primary)",
  "var(--color-success)",
  "var(--color-brand)",
  "var(--color-warning)",
];

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports & Analytics — ibird Sales Insights" },
      {
        name: "description",
        content:
          "ibird analytics: revenue trends, top products, customer behaviour, inventory turnover and a custom report builder with exports.",
      },
      { property: "og:title", content: "Reports & Analytics — ibird Sales Insights" },
      {
        property: "og:description",
        content: "Daily, weekly, monthly and yearly performance with downloadable reports.",
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
      <AppShell
        title="Reports & Analytics"
        subtitle="Sales insights and performance metrics"
      >
        <div className="card-surface rounded-lg border border-warning/30 bg-warning/5 p-8 text-center">
          <AlertTriangle className="mx-auto size-12 text-warning mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Access Restricted</h2>
          <p className="text-muted-foreground mb-6">
            Staff members don't have access to reports and analytics. These insights are reserved for Admin and Manager roles to maintain data security.
          </p>
          <Button asChild>
            <Link to="/">
              Back to Dashboard
            </Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const { data: orders = [] } = useQuery({ queryKey: ["orders"], queryFn: fetchOrders });
  const { data: items = [] } = useQuery({ queryKey: ["order-items"], queryFn: fetchOrderItems });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });

  const [granularity, setGranularity] = useState("daily");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const scoped = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    return orders.filter((o) => {
      const d = new Date(o.created_at);
      if (from && d < new Date(`${from}T00:00:00`)) return false;
      if (to && d > new Date(`${to}T23:59:59`)) return false;
      if (!from && !to && d < cutoff) return false;
      return o.status !== "cancelled";
    });
  }, [orders, from, to]);

  const revenue = scoped.reduce((s, o) => s + Number(o.total), 0);
  const avg = scoped.length ? revenue / scoped.length : 0;

  const bucketKey = (d: Date) => {
    if (granularity === "yearly") return `${d.getFullYear()}`;
    if (granularity === "monthly")
      return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    if (granularity === "weekly") {
      const start = new Date(d);
      start.setDate(d.getDate() - d.getDay());
      return `w/c ${start.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
    }
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  const trend = useMemo(() => {
    const map = new Map<string, { period: string; revenue: number; orders: number }>();
    for (const o of [...scoped].reverse()) {
      const key = bucketKey(new Date(o.created_at));
      const cur = map.get(key) ?? { period: key, revenue: 0, orders: 0 };
      cur.revenue += Number(o.total);
      cur.orders += 1;
      map.set(key, cur);
    }
    return Array.from(map.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, granularity]);

  const scopedIds = new Set(scoped.map((o) => o.id));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, scoped]);

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
          name: p.name,
          sku: p.sku,
          stock: p.stock,
          sold: units,
          ratio: p.stock ? Math.round((units / p.stock) * 100) / 100 : units,
        };
      })
      .sort((a, b) => b.ratio - a.ratio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, items, scoped]);

  const customReport = trend.map((t) => ({
    Period: t.period,
    Orders: t.orders,
    Revenue: t.revenue,
    "Avg order": t.orders ? Math.round(t.revenue / t.orders) : 0,
  }));

  return (
    <AppShell
      title="Reports & Analytics"
      subtitle="Sales performance, product insight and customer analytics."
      actions={
        <ExportMenu filename="ibird-report" title="Custom report" rows={customReport} />
      }
    >
      <div className="card-surface grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <Label>Granularity</Label>
          <Select value={granularity} onValueChange={setGranularity}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>From</Label>
          <Input type="date" className="mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" className="mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue" value={formatCurrency(revenue)} icon={IndianRupee} tone="success" />
        <StatCard label="Orders" value={formatNumber(scoped.length)} icon={Receipt} />
        <StatCard label="Avg order value" value={formatCurrency(avg)} icon={TrendingUp} tone="brand" />
        <StatCard
          label="Active customers"
          value={formatNumber(new Set(scoped.map((o) => o.customer_id)).size)}
          icon={Users}
          tone="warning"
        />
      </div>

      <Tabs defaultValue="overview" className="mt-5">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="products">Product performance</TabsTrigger>
          <TabsTrigger value="customers">Customer analytics</TabsTrigger>
          <TabsTrigger value="turnover">Inventory turnover</TabsTrigger>
          <TabsTrigger value="custom">Custom report</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 xl:grid-cols-3">
          <div className="card-surface p-5 xl:col-span-2">
            <h2 className="text-lg font-bold">Revenue trend</h2>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="period" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                  />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="var(--color-primary)"
                    strokeWidth={2.5}
                    dot={false}
                  />
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
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Top sellers</h2>
            <ExportMenu
              filename="ibird-product-performance"
              title="Product performance"
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
          <Table className="mt-4">
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
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(p.revenue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Inventory turnover</h2>
            <ExportMenu
              filename="ibird-inventory-turnover"
              title="Inventory turnover"
              rows={turnover.map((t) => ({
                Product: t.name,
                SKU: t.sku,
                Stock: t.stock,
                Sold: t.sold,
                Turnover: t.ratio,
              }))}
            />
          </div>
          <Table className="mt-4">
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
                <TableRow key={t.sku}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground">{t.sku}</TableCell>
                  <TableCell className="text-right">{t.stock}</TableCell>
                  <TableCell className="text-right">{t.sold}</TableCell>
                  <TableCell className="text-right font-semibold">{t.ratio}x</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="custom" className="card-surface mt-4 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Custom report</h2>
              <p className="text-sm text-muted-foreground">
                {granularity} breakdown{from || to ? ` · ${from || "start"} → ${to || "today"}` : " · last 90 days"}
              </p>
            </div>
            <ExportMenu filename="ibird-custom-report" title="Custom report" rows={customReport} />
          </div>
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Avg order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customReport.map((r) => (
                <TableRow key={r.Period}>
                  <TableCell className="font-medium">{r.Period}</TableCell>
                  <TableCell className="text-right">{r.Orders}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(r.Revenue)}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(r["Avg order"])}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Latest order in range: {scoped[0] ? formatDate(scoped[0].created_at) : "—"}
          </p>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
