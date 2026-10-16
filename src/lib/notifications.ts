// Notifications are worked out from live data (orders, stock, invoices, catalogue), so they appear
// and clear by themselves. Only "read" is remembered, per user in this browser.
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/format";

const db = supabase as unknown as { from: (table: string) => any };

export type NotificationCategory = "enquiries" | "assignments" | "orders" | "payments" | "stock" | "documents" | "catalog";
export type NotificationSeverity = "critical" | "warning" | "info";

export type NotificationLink =
  | { to: "/orders/$orderId"; params: { orderId: string } }
  | { to: "/inventory"; search: { tab: string } }
  | { to: "/orders"; search: { assignedTo: string } }
  | { to: "/inbox"; search: { phone: string } }
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
  enquiries: "WhatsApp enquiries",
  assignments: "Assignments",
  orders: "Orders",
  payments: "Payments",
  stock: "Stock",
  documents: "Invoices & coupons",
  catalog: "WhatsApp catalogue",
};

const SUPPORTED_PHOTO = /\.(jpe?g|png)(\?|$)/i;
const HOUR = 3600_000;

// Who is looking: staff see their own orders and assignments; admins and managers see everything
export type NotificationViewer = { userId: string | null; role: string | null };

const ASSIGNMENT_WINDOW_MS = 2 * 60_000; // rows from one bulk assignment are written seconds apart

export async function fetchNotifications(viewer: NotificationViewer = { userId: null, role: null }): Promise<AppNotification[]> {
  const since48h = new Date(Date.now() - 48 * HOUR).toISOString();
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const isStaff = viewer.role === "staff";
  // Staff only hear about orders assigned to them
  const mine = (q: any) => (isStaff && viewer.userId ? q.eq("assigned_to", viewer.userId) : q);

  const [toPack, awaiting, paidRecent, products, unsent, assignments, waiting] = await Promise.all([
    // Paid WhatsApp orders that nobody has started processing
    mine(
      db
        .from("orders")
        .select("id, order_number, customer_name, total, created_at, updated_at")
        .eq("source", "whatsapp")
        .eq("status", "pending")
        .eq("payment_status", "paid"),
    )
      .order("updated_at", { ascending: false })
      .limit(50),
    // WhatsApp orders placed in the last 48 h whose payment has not arrived
    mine(
      db
        .from("orders")
        .select("id, order_number, customer_name, total, created_at")
        .eq("source", "whatsapp")
        .eq("payment_status", "unpaid")
        .neq("status", "cancelled")
        .gte("created_at", since48h),
    )
      .order("created_at", { ascending: false })
      .limit(30),
    // Payments received in the last 48 h
    mine(
      db
        .from("orders")
        .select("id, order_number, customer_name, total, updated_at")
        .eq("source", "whatsapp")
        .eq("payment_status", "paid")
        .gte("updated_at", since48h),
    )
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
    // Orders assigned to or taken away from this user in the last 7 days
    viewer.userId
      ? db
          .from("order_assignment_history")
          .select("id, order_id, old_assigned_to, new_assigned_to, assigned_by, assigned_at")
          .or(`new_assigned_to.eq.${viewer.userId},old_assigned_to.eq.${viewer.userId}`)
          .gte("assigned_at", new Date(Date.now() - 7 * 24 * HOUR).toISOString())
          .order("assigned_at", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] }),
    // Customers waiting for a reply from the team in the WhatsApp inbox
    db
      .from("whatsapp_sessions")
      .select("phone_number, profile_name, form_data, last_inbound_at")
      .eq("needs_reply", true)
      .order("last_inbound_at", { ascending: false })
      .limit(30),
  ]);

  const enquiries: AppNotification[] = [];
  const waitingRows = (waiting.data ?? []) as any[];
  if (waitingRows.length) {
    const { data: lastMsgs } = await db
      .from("whatsapp_messages")
      .select("phone_number, body, created_at")
      .in("phone_number", waitingRows.map((w) => w.phone_number))
      .eq("message_type", "inbound")
      .not("body", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);
    const lastBody = new Map<string, string>();
    for (const m of (lastMsgs ?? []) as any[]) if (!lastBody.has(m.phone_number)) lastBody.set(m.phone_number, m.body);
    for (const w of waitingRows) {
      const who = w.form_data?.name || w.profile_name || `+${w.phone_number}`;
      const said = lastBody.get(w.phone_number) ?? "";
      enquiries.push({
        // a new message from the same customer shows as unread again
        id: `enquiry-${w.phone_number}-${w.last_inbound_at}`,
        category: "enquiries",
        severity: "critical",
        title: `${who} is waiting for a reply`,
        description: said ? `"${said.length > 90 ? `${said.slice(0, 90)}…` : said}"` : "Open the WhatsApp inbox to reply",
        at: w.last_inbound_at,
        link: { to: "/inbox", search: { phone: w.phone_number } },
      });
    }
  }

  const out: AppNotification[] = [...enquiries];
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

  out.push(...(await assignmentNotifications((assignments.data ?? []) as AssignmentRow[], viewer.userId)));

  // Admin tasks (undelivered invoices, catalogue photos) are not shown to staff
  const visible = isStaff ? out.filter((n) => n.category !== "documents" && n.category !== "catalog") : out;

  const rank: Record<NotificationSeverity, number> = { critical: 0, warning: 1, info: 2 };
  // Most urgent first, then newest
  return visible.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

type AssignmentRow = {
  id: string;
  order_id: string;
  old_assigned_to: string | null;
  new_assigned_to: string | null;
  assigned_by: string | null;
  assigned_at: string;
};

// "Anshid assigned 10 orders to you": rows by the same person within a couple of minutes are one action
async function assignmentNotifications(rows: AssignmentRow[], me: string | null): Promise<AppNotification[]> {
  if (!me || !rows.length) return [];
  // Assigning to yourself is not news
  const relevant = rows.filter((r) => r.assigned_by !== me && r.old_assigned_to !== r.new_assigned_to);

  type Group = { kind: "to" | "from"; by: string | null; to: string | null; rows: AssignmentRow[] };
  const groups: Group[] = [];
  for (const r of relevant) {
    const kind = r.new_assigned_to === me ? "to" : "from";
    const last = groups[groups.length - 1];
    const prev = last?.rows[last.rows.length - 1];
    if (
      last &&
      prev &&
      last.kind === kind &&
      last.by === r.assigned_by &&
      (kind === "to" || last.to === r.new_assigned_to) &&
      Math.abs(new Date(prev.assigned_at).getTime() - new Date(r.assigned_at).getTime()) <= ASSIGNMENT_WINDOW_MS
    ) {
      last.rows.push(r);
    } else {
      groups.push({ kind, by: r.assigned_by, to: r.new_assigned_to, rows: [r] });
    }
  }
  if (!groups.length) return [];

  const people = [...new Set(groups.flatMap((g) => [g.by, g.to]).filter(Boolean))] as string[];
  const orderIds = [...new Set(groups.flatMap((g) => g.rows.map((r) => r.order_id)))];
  const [{ data: emps }, { data: orders }] = await Promise.all([
    people.length ? db.from("employees").select("id, name").in("id", people) : Promise.resolve({ data: [] }),
    db.from("orders").select("id, order_number").in("id", orderIds.slice(0, 300)),
  ]);
  const nameOf = new Map(((emps ?? []) as any[]).map((e) => [e.id, e.name as string]));
  const numberOf = new Map(((orders ?? []) as any[]).map((o) => [o.id, o.order_number as string]));

  return groups.map((g) => {
    const who = (g.by && nameOf.get(g.by)) || "An admin";
    const count = g.rows.length;
    const numbers = g.rows.map((r) => numberOf.get(r.order_id)).filter(Boolean) as string[];
    const list = numbers.slice(0, 3).join(", ") + (numbers.length > 3 ? ` +${numbers.length - 3} more` : "");
    const single = count === 1 && g.rows[0];
    if (g.kind === "to") {
      return {
        id: `assign-to-${g.rows[0]!.id}-${count}`,
        category: "assignments" as const,
        severity: "critical" as const,
        title: single
          ? `${who} assigned order ${numbers[0] ?? ""} to you`.replace("order  to", "an order to")
          : `${who} assigned ${count} orders to you`,
        description: single ? "Open the order to start processing it" : list,
        at: g.rows[0]!.assigned_at,
        link: single
          ? { to: "/orders/$orderId" as const, params: { orderId: single.order_id } }
          : { to: "/orders" as const, search: { assignedTo: me } },
      };
    }
    const toName = g.to ? nameOf.get(g.to) ?? "someone else" : null;
    return {
      id: `assign-from-${g.rows[0]!.id}-${count}`,
      category: "assignments" as const,
      severity: "info" as const,
      title: toName
        ? `${who} moved ${count === 1 ? "an order" : `${count} orders`} from you to ${toName}`
        : `${who} unassigned ${count === 1 ? "an order" : `${count} orders`} from you`,
      description: list || "No action needed",
      at: g.rows[0]!.assigned_at,
      link: single
        ? { to: "/orders/$orderId" as const, params: { orderId: single.order_id } }
        : { to: "/orders" as const },
    };
  });
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
