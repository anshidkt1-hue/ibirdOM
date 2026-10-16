// Notifications are worked out from live data (orders, stock, invoices, catalogue), so they appear
// and clear by themselves. Only "read" is remembered, per user in this browser.
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/format";

const db = supabase as unknown as { from: (table: string) => any };

export type NotificationCategory = "orders" | "payments" | "stock" | "documents" | "catalog";
export type NotificationSeverity = "critical" | "warning" | "info";

export type NotificationLink =
  | { to: "/orders/$orderId"; params: { orderId: string } }
  | { to: "/inventory"; search: { tab: string } }
  | { to: "/orders" | "/invoices" | "/coupons" };

export type AppNotification = {
  id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  description: string;
  at: string; // ISO time the event happened (for ongoing conditions: when it was last seen)
  ongoing?: boolean; // a condition that lasts until fixed (low stock, missing photo)
  link: NotificationLink;
};

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  orders: "Orders",
  payments: "Payments",
  stock: "Stock",
  documents: "Invoices & coupons",
  catalog: "WhatsApp catalogue",
};

const SUPPORTED_PHOTO = /\.(jpe?g|png)(\?|$)/i;
const HOUR = 3600_000;

export async function fetchNotifications(): Promise<AppNotification[]> {
  const since48h = new Date(Date.now() - 48 * HOUR).toISOString();
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();

  const [toPack, awaiting, paidRecent, products, unsent] = await Promise.all([
    // Paid WhatsApp orders that nobody has started processing
    db
      .from("orders")
      .select("id, order_number, customer_name, total, created_at, updated_at")
      .eq("source", "whatsapp")
      .eq("status", "pending")
      .eq("payment_status", "paid")
      .order("updated_at", { ascending: false })
      .limit(50),
    // WhatsApp orders placed in the last 48 h whose payment has not arrived
    db
      .from("orders")
      .select("id, order_number, customer_name, total, created_at")
      .eq("source", "whatsapp")
      .eq("payment_status", "unpaid")
      .neq("status", "cancelled")
      .gte("created_at", since48h)
      .order("created_at", { ascending: false })
      .limit(30),
    // Payments received in the last 48 h
    db
      .from("orders")
      .select("id, order_number, customer_name, total, updated_at")
      .eq("source", "whatsapp")
      .eq("payment_status", "paid")
      .gte("updated_at", since48h)
      .order("updated_at", { ascending: false })
      .limit(30),
    db
      .from("products")
      .select("id, name, variant, sku, stock, low_stock_threshold, active, sales_channel, image_url, created_at")
      .eq("active", true),
    // WhatsApp invoices that were not delivered to the customer (sending failed)
    db
      .from("invoices")
      .select("id, invoice_number, order_id, customer_name, issued_at")
      .eq("channel", "whatsapp")
      .is("sent_at", null)
      .lte("issued_at", tenMinAgo)
      .gte("issued_at", new Date(Date.now() - 7 * 24 * HOUR).toISOString())
      .order("issued_at", { ascending: false })
      .limit(20),
  ]);

  const out: AppNotification[] = [];
  const product = (p: any) => `${p.name}${p.variant ? ` ${p.variant}` : ""}`;

  for (const o of (toPack.data ?? []) as any[]) {
    out.push({
      id: `order-topack-${o.id}`,
      category: "orders",
      severity: "critical",
      title: `New paid order ${o.order_number}`,
      description: `${o.customer_name} · ${formatCurrency(o.total)} · ready to pack`,
      at: o.updated_at ?? o.created_at,
      link: { to: "/orders/$orderId", params: { orderId: o.id } },
    });
  }

  for (const o of (awaiting.data ?? []) as any[]) {
    out.push({
      id: `order-unpaid-${o.id}`,
      category: "orders",
      severity: "info",
      title: `Awaiting payment · ${o.order_number}`,
      description: `${o.customer_name} · ${formatCurrency(o.total)} · payment link sent`,
      at: o.created_at,
      link: { to: "/orders/$orderId", params: { orderId: o.id } },
    });
  }

  for (const o of (paidRecent.data ?? []) as any[]) {
    out.push({
      id: `payment-${o.id}`,
      category: "payments",
      severity: "info",
      title: `Payment received ${formatCurrency(o.total)}`,
      description: `${o.order_number} · ${o.customer_name} · Razorpay`,
      at: o.updated_at,
      link: { to: "/orders/$orderId", params: { orderId: o.id } },
    });
  }

  const now = new Date().toISOString();
  for (const p of (products.data ?? []) as any[]) {
    if (p.stock <= 0) {
      out.push({
        id: `stock-out-${p.id}`,
        category: "stock",
        severity: "critical",
        title: `Out of stock: ${product(p)}`,
        description: `SKU ${p.sku} · cannot be sold until restocked`,
        at: now,
        ongoing: true,
        link: { to: "/inventory", search: { tab: "alerts" } },
      });
    } else if (p.stock <= p.low_stock_threshold) {
      out.push({
        id: `stock-low-${p.id}-${p.stock}`,
        category: "stock",
        severity: "warning",
        title: `Low stock: ${product(p)}`,
        description: `${p.stock} left (reorder below ${p.low_stock_threshold}) · SKU ${p.sku}`,
        at: now,
        ongoing: true,
        link: { to: "/inventory", search: { tab: "alerts" } },
      });
    }
    if (p.sales_channel !== "counter" && !SUPPORTED_PHOTO.test(p.image_url || "")) {
      out.push({
        id: `catalog-photo-${p.id}-${p.image_url ?? "none"}`,
        category: "catalog",
        severity: "warning",
        title: `Not in WhatsApp catalogue: ${product(p)}`,
        description: p.image_url
          ? "Photo is not JPEG/PNG. Upload it again in Inventory."
          : "No photo. Add a JPEG/PNG photo in Inventory.",
        at: now,
        ongoing: true,
        link: { to: "/inventory", search: { tab: "online" } },
      });
    }
  }

  for (const inv of (unsent.data ?? []) as any[]) {
    out.push({
      id: `invoice-unsent-${inv.id}`,
      category: "documents",
      severity: "warning",
      title: `Invoice not delivered on WhatsApp: ${inv.invoice_number}`,
      description: `${inv.customer_name ?? "Customer"} · download it from the order and send it manually`,
      at: inv.issued_at,
      link: { to: "/orders/$orderId", params: { orderId: inv.order_id } },
    });
  }

  const rank: Record<NotificationSeverity, number> = { critical: 0, warning: 1, info: 2 };
  // Most urgent first, then newest
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
