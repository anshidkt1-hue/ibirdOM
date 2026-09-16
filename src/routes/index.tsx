import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  FilePlus2,
  IndianRupee,
  Receipt,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { StatCard } from "@/components/stat-card";

import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/components/export-menu";
import { fetchOrders, fetchProducts } from "@/lib/data";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { useRole } from "@/components/role-provider";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ibird Dashboard — Sales, Orders & Inventory Overview" },
      {
        name: "description",
        content:
          "Live ibird business dashboard: revenue, order volume, average order value, low-stock alerts and recent sales in one place.",
      },
      { property: "og:title", content: "ibird Dashboard — Sales, Orders & Inventory Overview" },
      {
        property: "og:description",
        content: "Track revenue, orders and stock health across the ibird business in real time.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { role } = useRole();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const ordersQuery = useQuery({ queryKey: ["orders"], queryFn: fetchOrders });
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: fetchProducts });

  const orders = ordersQuery.data ?? [];
  const products = productsQuery.data ?? [];

  const completed = orders.filter((o) => o.status === "completed");
  const revenue = completed.reduce((s, o) => s + Number(o.total), 0);
  const avgOrder = completed.length ? revenue / completed.length : 0;
  const lowStock = products.filter((p) => p.stock <= p.low_stock_threshold);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const chartData = days.map((d) => {
    const key = d.toDateString();
    const total = completed
      .filter((o) => new Date(o.created_at).toDateString() === key)
      .reduce((s, o) => s + Number(o.total), 0);
    return { day: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), total };
  });

  const recent = orders.slice(0, 6);
  const canViewReports = role !== "staff";

  return (
    <AppShell
      title="Dashboard"
      subtitle="Welcome back! Here's what's happening today."
      actions={
        <>
          {canViewReports && (
            <ExportMenu
              title="Dashboard report"
              filename="ibird-dashboard"
              label="Download Report"
              rows={orders.map((o) => ({
                Order: o.order_number,
                Customer: o.customer_name,
                Source: o.source,
                Status: o.status,
                Total: Number(o.total),
                Date: formatDate(o.created_at),
              }))}
            />
          )}
          <Button
            className="gap-2"
            onClick={async () => {
              setIsRefreshing(true);
              try {
                await Promise.all([
                  ordersQuery.refetch(),
                  productsQuery.refetch(),
                ]);
                toast.success("Data refreshed successfully", {
                  description: "All dashboard data has been updated",
                });
              } catch (error) {
                toast.error("Failed to refresh data", {
                  description: error instanceof Error ? error.message : "Please try again",
                });
              } finally {
                setIsRefreshing(false);
              }
            }}
            disabled={isRefreshing || ordersQuery.isLoading || productsQuery.isLoading}
          >
            <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing..." : "Refresh Data"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Button asChild size="lg" className="h-14 gap-2 text-base">
          <Link to="/pos">
            <FilePlus2 className="size-5" /> New Order
          </Link>
        </Button>
        <Button
          asChild
          size="lg"
          className="h-14 gap-2 bg-success text-base text-success-foreground hover:bg-success/90"
        >
          <Link to="/orders">
            <ShoppingBag className="size-5" /> WhatsApp Orders
          </Link>
        </Button>
        {canViewReports && (
          <Button
            asChild
            size="lg"
            className="h-14 gap-2 bg-brand text-base text-brand-foreground hover:bg-brand/90"
          >
            <Link to="/reports">
              <TrendingUp className="size-5" /> Reports & Analytics
            </Link>
          </Button>
        )}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Low Stock"
          value={formatNumber(lowStock.length)}
          hint="Needs attention"
          icon={AlertTriangle}
          tone="warning"
        />
        {canViewReports && (
          <>
            <StatCard
              label="Total Revenue"
              value={formatCurrency(revenue)}
              hint={`${completed.length} completed orders`}
              icon={IndianRupee}
              tone="success"
            />
            <StatCard
              label="Transactions"
              value={formatNumber(orders.length)}
              hint={`${orders.length} total`}
              icon={Receipt}
            />
            <StatCard
              label="Avg. Order"
              value={formatCurrency(avgOrder)}
              hint="Per completed order"
              icon={TrendingUp}
              tone="brand"
            />
          </>
        )}
        {!canViewReports && (
          <StatCard
            label="Transactions"
            value={formatNumber(orders.length)}
            hint={`${orders.length} total`}
            icon={Receipt}
          />
        )}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        {canViewReports && (
          <div className="card-surface p-5 xl:col-span-2">
            <h2 className="text-lg font-bold">Revenue Overview</h2>
            <p className="text-sm text-muted-foreground">Daily sales performance (last 7 days)</p>
            <div className="mt-5 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ left: 8, right: 8 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    stroke="var(--color-muted-foreground)"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    stroke="var(--color-muted-foreground)"
                    tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid var(--color-border)",
                      background: "var(--color-card)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="var(--color-primary)"
                    strokeWidth={2.5}
                    fill="url(#rev)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className={`card-surface p-5 ${!canViewReports ? "xl:col-span-3" : ""}`}>
          <h2 className="text-lg font-bold">Recent Sales</h2>
          <p className="text-sm text-muted-foreground">Latest transactions</p>
          <div className="mt-4 space-y-3">
            {recent.map((o) => (
              <Link
                key={o.id}
                to="/orders/$orderId"
                params={{ orderId: o.id }}
                className="flex items-center gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-secondary"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                  {o.customer_name
                    .split(" ")
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{o.customer_name}</p>
                  <p className="text-xs text-muted-foreground">{o.order_number}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-success">+{formatCurrency(o.total)}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(o.created_at)}</p>
                </div>
              </Link>
            ))}
            {!recent.length && <p className="text-sm text-muted-foreground">No sales yet.</p>}
          </div>
        </div>
      </div>

      <div className="mt-5 card-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Low stock alerts</h2>
            <p className="text-sm text-muted-foreground">Products at or below threshold</p>
          </div>
          <Button asChild variant="outline">
            <Link to="/inventory">Manage inventory</Link>
          </Button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lowStock.slice(0, 6).map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{p.name}</p>
                <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                  Low
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                SKU {p.sku} · {p.stock} left of {p.low_stock_threshold}
              </p>
            </div>
          ))}
          {!lowStock.length && <p className="text-sm text-muted-foreground">Stock levels healthy.</p>}
        </div>
      </div>
    </AppShell>
  );
}
