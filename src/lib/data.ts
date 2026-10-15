import { supabase } from "@/integrations/supabase/client";

export type Order = {
  id: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone?: string | null;
  source: string;
  status: string;
  payment_method: string;
  payment_status: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  refund_amount: number;
  notes: string | null;
  delivery_address?: string | null;
  special_instructions?: string | null;
  assigned_to?: string | null;
  assigned_at?: string | null;
  assigned_by?: string | null;
  created_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  sku: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  tax_rate?: number;
  tax_amount?: number;
};

export type Product = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  variant: string | null;
  cost_price: number;
  price: number;
  stock: number;
  low_stock_threshold: number;
  hsn_code?: string | null;
  gst?: number;
  active: boolean;
  image_url?: string | null;
  sales_channel?: SalesChannel;
  created_at: string;
};

export type SalesChannel = "counter" | "online";

// Products created before the counter/online split were the WhatsApp catalogue.
export function channelOf(product: Pick<Product, "sales_channel">): SalesChannel {
  return product.sales_channel ?? "online";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Tax is charged per product at its own GST rate, on the price after any discount
// (the discount is shared across lines in proportion to their value).
export function calculateTotals(items: { product: Product; quantity: number }[], discount = 0) {
  const subtotal = round2(items.reduce((s, i) => s + Number(i.product.price) * i.quantity, 0));
  const appliedDiscount = Math.min(Math.max(0, discount), subtotal);
  const ratio = subtotal > 0 ? (subtotal - appliedDiscount) / subtotal : 0;
  const lines = items.map((i) => {
    const lineTotal = round2(Number(i.product.price) * i.quantity);
    const taxRate = Number(i.product.gst ?? 0);
    const taxAmount = round2((lineTotal * ratio * taxRate) / 100);
    return { ...i, lineTotal, taxRate, taxAmount };
  });
  const tax = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
  const total = round2(subtotal - appliedDiscount + tax);
  return { subtotal, discount: appliedDiscount, tax, total, lines };
}

export type Category = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  address?: string | null;
  customer_type: string;
  notes: string | null;
  created_at: string;
};

export type Employee = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  department: string | null;
  salary: number;
  status: string;
  join_date: string;
  password?: string;
};

export type OrderStatusHistory = {
  id: string;
  order_id: string;
  old_status: string | null;
  new_status: string;
  changed_at: string;
  changed_by: string | null;
  notes: string | null;
  created_at: string;
};

export type OrderAssignmentHistory = {
  id: string;
  order_id: string;
  old_assigned_to: string | null;
  new_assigned_to: string | null;
  assigned_at: string;
  assigned_by: string | null;
  notes: string | null;
  created_at: string;
};

export type StockMovement = {
  id: string;
  product_id: string | null;
  product_name: string;
  movement_type: string;
  quantity: number;
  note: string | null;
  created_at: string;
};

const db = supabase as unknown as {
  from: (table: string) => any;
};

// PostgREST returns at most 1,000 rows per request, so every "load everything" read
// must page; otherwise rows past the cap are silently dropped.
const PAGE_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  onProgress?: (loaded: number) => void,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    onProgress?.(out.length);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export type OrderFilters = {
  search?: string;
  status?: string;
  source?: string;
  payment?: string;
  assignedTo?: string;
  from?: string;
  to?: string;
  staffId?: string | undefined;
};

function applyOrderFilters(query: any, f: OrderFilters, snapshotIso?: string) {
  let q = query;
  if (f.staffId) q = q.eq("assigned_to", f.staffId);
  const search = f.search?.trim().replace(/[,()%*\\]/g, " ").trim();
  if (search) {
    q = q.or(
      `order_number.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`,
    );
  }
  if (f.status && f.status !== "all") q = q.eq("status", f.status);
  if (f.source && f.source !== "all") q = q.eq("source", f.source);
  if (f.payment && f.payment !== "all") q = q.eq("payment_method", f.payment);
  if (f.assignedTo && f.assignedTo !== "all") {
    q = f.assignedTo === "unassigned" ? q.is("assigned_to", null) : q.eq("assigned_to", f.assignedTo);
  }
  if (f.from) q = q.gte("created_at", new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) q = q.lte("created_at", new Date(`${f.to}T23:59:59.999`).toISOString());
  // Freeze the result set so orders arriving mid-export cannot shift page boundaries.
  if (snapshotIso) q = q.lte("created_at", snapshotIso);
  return q;
}

const ORDER_SORT = (q: any) =>
  q.order("created_at", { ascending: false }).order("id", { ascending: false });

export async function fetchOrdersPage(
  filters: OrderFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: Order[]; total: number }> {
  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;
  const rows: Order[] = [];
  let total = 0;

  // The API returns at most PAGE_SIZE rows per request, so large pages are fetched in slices.
  for (let from = start; from <= end; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, end);
    const query = applyOrderFilters(db.from("orders").select("*", { count: "exact" }), filters);
    const { data, error, count } = await ORDER_SORT(query).range(from, to);
    if (error) throw error;
    total = count ?? 0;
    const slice = (data ?? []) as Order[];
    rows.push(...slice);
    if (slice.length < to - from + 1) break;
  }
  return { rows, total };
}

export async function fetchOrderIds(
  filters: OrderFilters,
  onProgress?: (loaded: number) => void,
): Promise<string[]> {
  const snapshot = new Date().toISOString();
  const rows = await fetchAllRows<{ id: string }>(
    (from, to) =>
      ORDER_SORT(applyOrderFilters(db.from("orders").select("id"), filters, snapshot)).range(from, to),
    onProgress,
  );
  return rows.map((r) => r.id);
}

export async function fetchOrdersMatching(
  filters: OrderFilters,
  onProgress?: (loaded: number) => void,
): Promise<Order[]> {
  const snapshot = new Date().toISOString();
  return fetchAllRows<Order>(
    (from, to) =>
      ORDER_SORT(applyOrderFilters(db.from("orders").select("*"), filters, snapshot)).range(from, to),
    onProgress,
  );
}

export async function fetchOrdersByIds(
  ids: string[],
  onProgress?: (loaded: number) => void,
): Promise<Order[]> {
  const out: Order[] = [];
  for (const part of chunk(ids, 200)) {
    const { data, error } = await db.from("orders").select("*").in("id", part);
    if (error) throw error;
    out.push(...((data ?? []) as Order[]));
    onProgress?.(out.length);
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function fetchItemsForOrders(
  orderIds: string[],
  onProgress?: (loaded: number) => void,
): Promise<OrderItem[]> {
  const parts = chunk(orderIds, 100);
  const results: OrderItem[][] = new Array(parts.length);
  let cursor = 0;
  let loaded = 0;

  // A few requests in flight at once: 2,500 orders is 25 batches, which is slow one by one.
  const worker = async () => {
    while (cursor < parts.length) {
      const index = cursor++;
      const part = parts[index] as string[];
      results[index] = await fetchAllRows<OrderItem>((from, to) =>
        db.from("order_items").select("*").in("order_id", part).order("id").range(from, to),
      );
      loaded += part.length;
      onProgress?.(loaded);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, parts.length) }, worker));
  return results.flat();
}

export async function fetchOrders(): Promise<Order[]> {
  return fetchOrdersMatching({});
}

export async function fetchRecentOrders(limit: number): Promise<Order[]> {
  const { data, error } = await ORDER_SORT(db.from("orders").select("*")).limit(limit);
  if (error) throw error;
  return (data ?? []) as Order[];
}

export async function fetchPendingOrders(limit: number): Promise<{ rows: Order[]; total: number }> {
  const { data, error, count } = await ORDER_SORT(
    db.from("orders").select("*", { count: "exact" }).eq("status", "pending"),
  ).limit(limit);
  if (error) throw error;
  return { rows: (data ?? []) as Order[], total: count ?? 0 };
}

export type DashboardStats = {
  total_count: number;
  pending_count: number;
  completed_count: number;
  revenue: number;
  daily: { day: string; total: number }[];
};

export async function fetchDashboardStats(days = 7): Promise<DashboardStats> {
  const { data, error } = await (supabase as any).rpc("dashboard_stats", { days });
  if (error) throw error;
  return data as DashboardStats;
}

export async function fetchOrder(id: string): Promise<{ order: Order; items: OrderItem[] }> {
  const { data, error } = await db.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  const { data: items, error: itemsError } = await db
    .from("order_items")
    .select("*")
    .eq("order_id", id);
  if (itemsError) throw itemsError;
  return { order: data as Order, items: (items ?? []) as OrderItem[] };
}

export async function fetchOrderCoupon(orderId: string): Promise<string | null> {
  const { data, error } = await db
    .from("coupons")
    .select("coupon_code")
    .eq("order_id", orderId)
    .eq("campaign", "thar-roxx-giveaway")
    .maybeSingle();
  if (error) throw error;
  return (data?.coupon_code as string | undefined) ?? null;
}

export async function fetchOrderItems(): Promise<OrderItem[]> {
  return fetchAllRows<OrderItem>((from, to) =>
    db.from("order_items").select("*").order("id").range(from, to),
  );
}

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await db.from("products").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await db.from("categories").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Category[];
}

export async function createCategory(name: string, description?: string): Promise<Category> {
  const { data, error } = await db
    .from("categories")
    .insert({ name, description: description || null })
    .select("*")
    .single();
  if (error) throw error;
  return data as Category;
}

export async function updateCategory(id: string, name: string, description?: string): Promise<Category> {
  const { data, error } = await db
    .from("categories")
    .update({ name, description: description || null })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Category;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await db.from("categories").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await db
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Customer[];
}

export async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await db.from("employees").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Employee[];
}

export async function fetchStockMovements(): Promise<StockMovement[]> {
  const { data, error } = await db
    .from("stock_movements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as StockMovement[];
}

export async function updateOrderStatus(ids: string[], patch: Record<string, unknown>) {
  const { error } = await db.from("orders").update(patch).in("id", ids);
  if (error) throw error;
}

export async function deleteOrders(ids: string[]) {
  for (const part of chunk(ids, 200)) {
    const { error } = await db.from("orders").delete().in("id", part);
    if (error) throw error;
  }
}

export async function bulkChangeStatus(
  ids: string[],
  status: string,
  changedBy: string | null,
  onProgress?: (done: number) => void,
) {
  let done = 0;
  for (const part of chunk(ids, 200)) {
    const { data: before, error: readError } = await db
      .from("orders")
      .select("id, status")
      .in("id", part);
    if (readError) throw readError;

    const { error } = await db.from("orders").update({ status }).in("id", part);
    if (error) throw error;

    // Payment state only changes where it makes sense, so a paid WhatsApp order never reverts to unpaid.
    if (status === "completed") {
      const { error: payError } = await db
        .from("orders")
        .update({ payment_status: "paid" })
        .in("id", part)
        .in("payment_status", ["unpaid", "pending"]);
      if (payError) throw payError;
    } else if (status === "cancelled") {
      const { error: refundError } = await db
        .from("orders")
        .update({ payment_status: "refunded" })
        .in("id", part)
        .eq("payment_status", "paid");
      if (refundError) throw refundError;
    }

    const history = ((before ?? []) as { id: string; status: string }[])
      .filter((o) => o.status !== status)
      .map((o) => ({
        order_id: o.id,
        old_status: o.status,
        new_status: status,
        changed_by: changedBy,
        changed_at: new Date().toISOString(),
      }));
    if (history.length) {
      const { error: historyError } = await db.from("order_status_history").insert(history);
      if (historyError) throw historyError;
    }

    done += part.length;
    onProgress?.(done);
  }
}

export async function createOrLinkCustomer(customerData: {
  name: string;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  email?: string | null;
}): Promise<string | null> {
  // If no phone, can't link or create
  if (!customerData.phone) return null;

  // Same person whatever the format: +91 97459 88637, 9745988637 and 919745988637 share the last 10 digits
  const phoneKey = customerData.phone.replace(/\D/g, "").slice(-10);
  if (phoneKey.length < 10) return null;

  const { data: existing } = await db
    .from("customers")
    .select("id")
    .eq("phone_key", phoneKey)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  // Create new customer
  const { data: newCustomer, error } = await db
    .from("customers")
    .insert({
      name: customerData.name,
      phone: customerData.phone,
      email: customerData.email || null,
      city: customerData.city || null,
      state: customerData.state || null,
      customer_type: "retail",
    })
    .select("id")
    .single();

  if (error) {
    console.warn("Failed to create customer:", error);
    return null;
  }

  return newCustomer?.id || null;
}

export async function createOrder(payload: {
  customer_id: string | null;
  customer_name: string;
  customer_phone?: string | null;
  source: string;
  payment_method: string;
  payment_status: string;
  status: string;
  notes: string | null;
  delivery_address?: string | null;
  special_instructions?: string | null;
  items: { product: Product; quantity: number }[];
  discount: number;
}) {
  const totals = calculateTotals(payload.items, payload.discount);
  const { subtotal, tax, total } = totals;

  const orderNumber = await nextCounterOrderNumber();

  // Try to create or link customer if phone is provided
  let customerId = payload.customer_id;
  if (!customerId && payload.customer_phone) {
    customerId = await createOrLinkCustomer({
      name: payload.customer_name,
      phone: payload.customer_phone,
    });
  }

  const { data, error } = await db
    .from("orders")
    .insert({
      order_number: orderNumber,
      customer_id: customerId,
      customer_name: payload.customer_name,
      customer_phone: payload.customer_phone || null,
      source: payload.source,
      status: payload.status,
      payment_method: payload.payment_method,
      payment_status: payload.payment_status,
      subtotal,
      discount: totals.discount,
      tax,
      total,
      notes: payload.notes,
      delivery_address: payload.delivery_address || null,
      special_instructions: payload.special_instructions || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  const order = data as Order;

  const items = totals.lines.map((l) => ({
    order_id: order.id,
    product_id: l.product.id,
    product_name: l.product.name,
    sku: l.product.sku,
    quantity: l.quantity,
    unit_price: l.product.price,
    line_total: l.lineTotal,
    tax_rate: l.taxRate,
    tax_amount: l.taxAmount,
  }));
  let { error: itemsError } = await db.from("order_items").insert(items);
  if (itemsError && /tax_(rate|amount)/.test(itemsError.message ?? "")) {
    // Tax columns not migrated yet: save the lines without them rather than lose the sale
    ({ error: itemsError } = await db
      .from("order_items")
      .insert(items.map(({ tax_rate, tax_amount, ...rest }) => rest)));
  }
  if (itemsError) throw itemsError;

  await deductOrderStock(order.id, orderNumber, payload.items);
  return order;
}

// Sequence-backed number so two counters billing at once can never clash.
async function nextCounterOrderNumber(): Promise<string> {
  const { data, error } = await (supabase as any).rpc("next_counter_order_number");
  if (!error && typeof data === "string" && data) return data;
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CS-${stamp}-${rand}`;
}

// One atomic database call, so a WhatsApp payment landing at the same moment cannot cause a wrong stock figure.
async function deductOrderStock(
  orderId: string,
  orderNumber: string,
  items: { product: Product; quantity: number }[],
) {
  const { error } = await (supabase as any).rpc("apply_order_stock", { p_order_id: orderId });
  if (!error) return;

  // Fallback until the database function is installed
  for (const i of items) {
    const { data: current } = await db.from("products").select("stock").eq("id", i.product.id).maybeSingle();
    const stock = Number(current?.stock ?? i.product.stock);
    await db
      .from("products")
      .update({ stock: Math.max(0, stock - i.quantity) })
      .eq("id", i.product.id);
    await db.from("stock_movements").insert({
      product_id: i.product.id,
      product_name: i.product.name,
      movement_type: "sale",
      quantity: -i.quantity,
      note: `Order ${orderNumber}`,
    });
  }
}

// Scanned code → active counter product, matched on barcode first, then SKU.
export async function findCounterProductByCode(code: string): Promise<Product | null> {
  const value = code.trim();
  if (!value || /[,()"]/.test(value)) return null;
  const { data, error } = await db
    .from("products")
    .select("*")
    .eq("active", true)
    .or(`barcode.eq.${value},sku.eq.${value}`);
  if (error) throw error;
  const matches = ((data ?? []) as Product[]).filter((p) => channelOf(p) === "counter");
  return matches.find((p) => p.barcode === value) ?? matches[0] ?? null;
}

// Counter and online stock are separate, so the copy starts at zero stock with its own SKU.
export async function copyProductToChannel(product: Product, channel: SalesChannel): Promise<Product> {
  const suffix = channel === "online" ? "W" : "C";
  const { id, created_at, ...rest } = product;
  for (let attempt = 0; attempt < 5; attempt++) {
    const sku = attempt === 0 ? `${product.sku}-${suffix}` : `${product.sku}-${suffix}${attempt + 1}`;
    const { data, error } = await db
      .from("products")
      .insert({ ...rest, sku, stock: 0, sales_channel: channel })
      .select("*")
      .single();
    if (!error) return data as Product;
    if (error.code !== "23505") throw error;
  }
  throw new Error("Could not create a unique SKU for the copy");
}

export async function adjustStock(product: Product, quantity: number, type: string, note: string) {
  const { error } = await db
    .from("products")
    .update({ stock: Math.max(0, product.stock + quantity) })
    .eq("id", product.id);
  if (error) throw error;
  await db.from("stock_movements").insert({
    product_id: product.id,
    product_name: product.name,
    movement_type: type,
    quantity,
    note,
  });
}

export async function upsertRecord(table: string, values: Record<string, unknown>, id?: string) {
  if (id) {
    const { error } = await db.from(table).update(values).eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await db.from(table).insert(values);
    if (error) throw error;
  }
}

export async function deleteRecord(table: string, id: string) {
  const { error } = await db.from(table).delete().eq("id", id);
  if (error) throw error;
}

// Product management functions
export async function createProduct(product: Omit<Product, 'id' | 'created_at'>) {
  const { data, error } = await db
    .from("products")
    .insert(product)
    .select("*")
    .single();
  if (error) throw error;
  return data as Product;
}

export async function updateProduct(id: string, updates: Partial<Product>) {
  const { data, error } = await db
    .from("products")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Product;
}

export async function deleteProduct(id: string) {
  const { error } = await db.from("products").delete().eq("id", id);
  if (error) throw error;
}

// Image upload function
// WhatsApp only shows JPEG/PNG product photos (max 5 MB), so every upload is
// converted to a JPEG of at most 1200 px; AVIF/WebP/HEIC photos would otherwise never arrive.
async function toWhatsAppJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // transparent PNG areas become white instead of black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image conversion failed"))), "image/jpeg", 0.85),
  );
}

export async function uploadProductImage(file: File, productId: string): Promise<string> {
  try {
    console.log("Starting image upload for product:", productId, "File:", file.name);

    let body: Blob = file;
    let ext = file.name.split(".").pop() || "jpg";
    try {
      body = await toWhatsAppJpeg(file);
      ext = "jpg";
    } catch (conversionError) {
      console.warn("Could not convert image, uploading original:", conversionError);
    }

    const timestamp = Date.now();
    const filename = `product-${productId}-${timestamp}.${ext}`;
    console.log("Generated filename:", filename);

    const { data, error } = await supabase.storage
      .from("product-images")
      .upload(filename, body, { upsert: true, contentType: ext === "jpg" ? "image/jpeg" : file.type });

    if (error) {
      console.error("Image upload error:", error);
      console.error("Error message:", error.message);
      console.error("Error status:", error.status);
      // Return empty string if upload fails - continue without image
      return "";
    }

    console.log("Upload successful, data:", data);

    const { data: urlData } = supabase.storage
      .from("product-images")
      .getPublicUrl(filename);

    console.log("Public URL:", urlData.publicUrl);
    return urlData.publicUrl;
  } catch (error) {
    console.error("Image upload exception:", error);
    // Continue without throwing - allow product to be saved without image
    return "";
  }
}

export type Settings = {
  id?: string;
  company_name?: string;
  company_email?: string;
  company_phone?: string;
  company_website?: string;
  company_address?: string;
  company_description?: string;
  tax_rate?: number;
  tax_id?: string;
  registration_number?: string;
  currency?: string;
  timezone?: string;
  date_format?: string;
  language?: string;
  low_stock_threshold?: number;
  enable_email_notifications?: boolean;
  enable_sms_notifications?: boolean;
  enable_low_stock_alerts?: boolean;
  whatsapp_api_key?: string;
  discount_type?: string;
  giveaway_image_url?: string | null;
  created_at?: string;
  updated_at?: string;
};

export async function fetchSettings(): Promise<Settings> {
  const { data, error } = await db
    .from("settings")
    .select("*")
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows found, which is fine for settings
    throw error;
  }

  // Return default settings if no record exists
  return data || {
    tax_rate: 5,
    currency: "INR",
    timezone: "Asia/Kolkata",
    date_format: "DD-MM-YYYY",
    language: "en",
    low_stock_threshold: 10,
    enable_low_stock_alerts: true,
    discount_type: "fixed",
  };
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  // Check if settings record exists
  const { data: existing } = await db
    .from("settings")
    .select("id")
    .single();

  if (existing) {
    // Update existing settings
    const { data, error } = await db
      .from("settings")
      .update(settings)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) throw error;
    return data as Settings;
  } else {
    // Create new settings record
    const { data, error } = await db
      .from("settings")
      .insert(settings)
      .select("*")
      .single();

    if (error) throw error;
    return data as Settings;
  }
}

// Order assignment functions
async function reassignOrders(
  orderIds: string[],
  employeeId: string | null,
  assignedById: string | null,
  onProgress?: (done: number) => void,
) {
  let done = 0;
  for (const part of chunk(orderIds, 200)) {
    const { data: before, error: readError } = await db
      .from("orders")
      .select("id, assigned_to")
      .in("id", part);
    if (readError) throw readError;

    const { error } = await db
      .from("orders")
      .update({
        assigned_to: employeeId,
        assigned_at: employeeId ? new Date().toISOString() : null,
        assigned_by: employeeId ? assignedById || null : null,
      })
      .in("id", part);
    if (error) throw error;

    const history = ((before ?? []) as { id: string; assigned_to: string | null }[])
      .filter((o) => o.assigned_to !== employeeId)
      .map((o) => ({
        order_id: o.id,
        old_assigned_to: o.assigned_to,
        new_assigned_to: employeeId,
        assigned_by: assignedById || null,
        assigned_at: new Date().toISOString(),
      }));
    if (history.length) {
      const { error: historyError } = await db.from("order_assignment_history").insert(history);
      if (historyError) throw historyError;
    }

    done += part.length;
    onProgress?.(done);
  }
}

export async function assignOrders(
  orderIds: string[],
  employeeId: string,
  assignedById: string,
  onProgress?: (done: number) => void,
): Promise<void> {
  await reassignOrders(orderIds, employeeId, assignedById, onProgress);
}

export async function unassignOrders(
  orderIds: string[],
  assignedById?: string | null,
  onProgress?: (done: number) => void,
): Promise<void> {
  await reassignOrders(orderIds, null, assignedById ?? null, onProgress);
}

// Order history functions
export async function recordStatusChange(
  orderId: string,
  oldStatus: string | null,
  newStatus: string,
  changedBy: string | null,
  notes?: string
): Promise<void> {
  const { error } = await db
    .from("order_status_history")
    .insert({
      order_id: orderId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      notes: notes || null,
      changed_at: new Date().toISOString(),
    });
  if (error) throw error;
}

export async function recordAssignmentChange(
  orderId: string,
  oldAssignedTo: string | null,
  newAssignedTo: string | null,
  assignedBy: string | null,
  notes?: string
): Promise<void> {
  const { error } = await db
    .from("order_assignment_history")
    .insert({
      order_id: orderId,
      old_assigned_to: oldAssignedTo,
      new_assigned_to: newAssignedTo,
      assigned_by: assignedBy,
      notes: notes || null,
      assigned_at: new Date().toISOString(),
    });
  if (error) throw error;
}

export async function fetchOrderStatusHistory(orderId: string): Promise<OrderStatusHistory[]> {
  const { data, error } = await db
    .from("order_status_history")
    .select("*")
    .eq("order_id", orderId)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as OrderStatusHistory[];
}

export async function fetchOrderAssignmentHistory(orderId: string): Promise<OrderAssignmentHistory[]> {
  const { data, error } = await db
    .from("order_assignment_history")
    .select("*")
    .eq("order_id", orderId)
    .order("assigned_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as OrderAssignmentHistory[];
}
