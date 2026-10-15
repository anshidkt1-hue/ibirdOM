// Invoices and giveaway coupons: queries plus the PDF / PNG downloads used by the dashboard.
import { supabase } from "@/integrations/supabase/client";
import {
  buildInvoicePdf,
  INVOICE_FONT_FILES,
  invoiceFileName,
  type InvoiceFonts,
  type InvoicePdfData,
  type InvoiceSeller,
} from "@/lib/invoice-pdf";
import { couponSvg, COUPON_HEIGHT, COUPON_WIDTH } from "@/lib/coupon-design";

const db = supabase as unknown as { from: (table: string) => any; rpc: (fn: string, args: object) => any };

export type InvoiceChannel = "whatsapp" | "counter";

export type Invoice = {
  id: string;
  invoice_number: string;
  order_id: string;
  channel: InvoiceChannel;
  issued_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  billing_address: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  seller: InvoiceSeller;
  pdf_url: string | null;
  sent_at: string | null;
  order_number?: string | undefined;
};

export type InvoiceFilters = { channel: InvoiceChannel; search?: string; from?: string; to?: string };

// The invoices table arrives with the invoices_and_coupons migration; until then pages show a notice
export const isMissingTable = (error: any) =>
  error?.code === "PGRST205" || error?.code === "42P01" || /does not exist|schema cache/i.test(error?.message ?? "");

const cleanSearch = (s?: string) => s?.trim().replace(/[,()%*\\]/g, " ").trim() ?? "";

async function attachOrderNumbers<T extends { order_id: string | null }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.order_id).filter(Boolean))] as string[];
  if (!ids.length) return rows.map((r) => ({ ...r, order_number: undefined as string | undefined, order: undefined as any }));
  const { data } = await db.from("orders").select("id, order_number, customer_name, customer_phone").in("id", ids);
  const byId = new Map(((data ?? []) as any[]).map((o) => [o.id, o]));
  return rows.map((r) => {
    const order = r.order_id ? byId.get(r.order_id) : undefined;
    return { ...r, order_number: order?.order_number as string | undefined, order };
  });
}

export async function fetchInvoicesPage(
  f: InvoiceFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: Invoice[]; total: number }> {
  let q = db.from("invoices").select("*", { count: "exact" }).eq("channel", f.channel);
  const search = cleanSearch(f.search);
  if (search) {
    q = q.or(`invoice_number.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`);
  }
  if (f.from) q = q.gte("issued_at", new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) q = q.lte("issued_at", new Date(`${f.to}T23:59:59.999`).toISOString());
  const start = (page - 1) * pageSize;
  const { data, error, count } = await q
    .order("issued_at", { ascending: false })
    .order("invoice_number", { ascending: false })
    .range(start, start + pageSize - 1);
  if (error) throw error;
  const rows = await attachOrderNumbers((data ?? []) as Invoice[]);
  return { rows, total: count ?? 0 };
}

export async function fetchOrderInvoice(orderId: string): Promise<Invoice | null> {
  const { data, error } = await db.from("invoices").select("*").eq("order_id", orderId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data as Invoice) ?? null;
}

// Creates the invoice for a paid order if it does not exist yet (the database also does this on payment)
export async function ensureInvoice(orderId: string): Promise<Invoice> {
  const { data, error } = await db.rpc("ensure_invoice", { p_order_id: orderId });
  if (error) throw error;
  return data as Invoice;
}

async function invoicePdfData(invoice: Invoice): Promise<InvoicePdfData> {
  const [{ data: order }, { data: items, error }] = await Promise.all([
    db.from("orders").select("order_number, payment_method").eq("id", invoice.order_id).maybeSingle(),
    db.from("order_items").select("*").eq("order_id", invoice.order_id),
  ]);
  if (error) throw error;
  const productIds = ((items ?? []) as any[]).map((i) => i.product_id).filter(Boolean);
  const { data: products } = productIds.length
    ? await db.from("products").select("id, hsn_code").in("id", productIds)
    : { data: [] };
  const hsn = new Map(((products ?? []) as any[]).map((p) => [p.id, p.hsn_code]));

  return {
    invoice_number: invoice.invoice_number,
    channel: invoice.channel,
    issued_at: invoice.issued_at,
    order_number: order?.order_number ?? invoice.order_number ?? "",
    payment_method: order?.payment_method,
    customer_name: invoice.customer_name,
    customer_phone: invoice.customer_phone,
    billing_address: invoice.billing_address,
    subtotal: Number(invoice.subtotal),
    discount: Number(invoice.discount),
    tax: Number(invoice.tax),
    total: Number(invoice.total),
    seller: invoice.seller ?? {},
    items: ((items ?? []) as any[]).map((i) => ({
      name: i.product_name,
      sku: i.sku,
      hsn: hsn.get(i.product_id) ?? null,
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      line_total: Number(i.line_total),
      tax_rate: i.tax_rate,
      tax_amount: i.tax_amount,
    })),
  };
}

// Poppins (served from /fonts) gives the invoice its look and the ₹ sign; loaded once per session
let fontsPromise: Promise<InvoiceFonts | null> | null = null;
function loadInvoiceFonts() {
  fontsPromise ??= (async () => {
    try {
      const entries = await Promise.all(
        (Object.entries(INVOICE_FONT_FILES) as [keyof InvoiceFonts, string][]).map(async ([k, file]) => {
          const buf = new Uint8Array(await (await fetch(`/fonts/${file}`)).arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          return [k, btoa(bin)] as const;
        }),
      );
      return Object.fromEntries(entries) as InvoiceFonts;
    } catch {
      fontsPromise = null;
      return null;
    }
  })();
  return fontsPromise;
}

export async function downloadInvoicePdf(invoice: Invoice) {
  const [data, fonts] = await Promise.all([invoicePdfData(invoice), loadInvoiceFonts()]);
  buildInvoicePdf(data, { fonts }).save(invoiceFileName(invoice.invoice_number));
}

// ---------- Coupons ----------

export type Coupon = {
  id: string;
  coupon_code: string;
  campaign: string | null;
  customer_id: string | null;
  order_id: string | null;
  created_at: string;
  image_url: string | null;
  sent_at: string | null;
  order_number?: string | undefined;
  customer_name?: string | null | undefined;
  customer_phone?: string | null | undefined;
};

export async function fetchCouponsPage(
  search: string,
  page: number,
  pageSize: number,
): Promise<{ rows: Coupon[]; total: number }> {
  let q = db.from("coupons").select("*", { count: "exact" }).eq("campaign", "thar-roxx-giveaway");
  const s = cleanSearch(search);
  if (s) q = q.ilike("coupon_code", `%${s}%`);
  const start = (page - 1) * pageSize;
  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .range(start, start + pageSize - 1);
  if (error) throw error;

  const rows = await attachOrderNumbers((data ?? []) as Coupon[]);
  // Older coupons have no order; take the name and phone from the customer record
  const customerIds = [...new Set(rows.filter((r) => !r.order && r.customer_id).map((r) => r.customer_id))];
  const { data: customers } = customerIds.length
    ? await db.from("customers").select("id, name, phone").in("id", customerIds)
    : { data: [] };
  const byId = new Map(((customers ?? []) as any[]).map((c) => [c.id, c]));

  return {
    rows: rows.map(({ order, ...r }) => ({
      ...r,
      customer_name: order?.customer_name ?? byId.get(r.customer_id)?.name ?? null,
      customer_phone: order?.customer_phone ?? byId.get(r.customer_id)?.phone ?? null,
    })),
    total: count ?? 0,
  };
}

export async function fetchCouponStats(): Promise<{ total: number; today: number; sent: number }> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const base = () => db.from("coupons").select("id", { count: "exact", head: true }).eq("campaign", "thar-roxx-giveaway");
  const [all, today, sent] = await Promise.all([
    base(),
    base().gte("created_at", start.toISOString()),
    base().not("sent_at", "is", null),
  ]);
  return { total: all.count ?? 0, today: today.count ?? 0, sent: sent.error ? 0 : (sent.count ?? 0) };
}

async function toDataUri(url: string): Promise<string | null> {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export type CouponArtInput = {
  code: string;
  customerName?: string | null | undefined;
  orderNumber?: string | null | undefined;
  issuedAt?: string | null | undefined;
  storeName?: string | null | undefined;
  imageUrl?: string | null | undefined;
};

// The image is inlined so the SVG renders on a canvas (and as an <img>) without CORS issues
export async function couponSvgFor(c: CouponArtInput) {
  return couponSvg({ ...c, imageHref: c.imageUrl ? await toDataUri(c.imageUrl) : null });
}

export async function downloadCouponPng(c: CouponArtInput) {
  const svg = await couponSvgFor(c);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = COUPON_WIDTH;
  canvas.height = COUPON_HEIGHT;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the image"))), "image/png"),
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Coupon-${c.code}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Thar ROXX photo used on every coupon (stored as JPEG in the public product-images bucket)
export async function uploadGiveawayImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image conversion failed"))), "image/jpeg", 0.88),
  );
  const name = `giveaway/thar-roxx-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("product-images").upload(name, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  return supabase.storage.from("product-images").getPublicUrl(name).data.publicUrl;
}
