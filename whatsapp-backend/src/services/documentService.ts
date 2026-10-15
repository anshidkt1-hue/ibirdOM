import fs from 'fs';
import path from 'path';
import { Resvg } from '@resvg/resvg-js';
import { supabase } from '../server';
import {
  buildInvoicePdf,
  INVOICE_FONT_FILES,
  invoiceFileName,
  type InvoiceFonts,
  type InvoicePdfData,
} from '../lib/invoice-pdf';
import { couponSvg, COUPON_WIDTH } from '../lib/coupon-design';
import { buildCouponsPdf, couponsFileName } from '../lib/coupon-pdf';
import { sendDocument, sendImage, STORE_NAME } from './whatsappService';

const BUCKET = 'documents';

// Poppins ships as TTF files in this package; the server has no system fonts to rely on
const FONT_DIR = path.dirname(require.resolve('@expo-google-fonts/poppins/package.json'));
const FONT_FILES = ['400Regular', '500Medium', '600SemiBold', '700Bold', '800ExtraBold'].map((w) =>
  path.join(FONT_DIR, w, `Poppins_${w}.ttf`)
);

// The same Poppins files, base64-encoded for the invoice PDF (₹ sign and the invoice look)
const INVOICE_FONTS = Object.fromEntries(
  Object.entries(INVOICE_FONT_FILES).map(([k, file]) => {
    const weight = file.replace(/^Poppins_|\.ttf$/g, '');
    return [k, fs.readFileSync(path.join(FONT_DIR, weight, file)).toString('base64')];
  })
) as InvoiceFonts;

async function upload(filePath: string, body: Buffer, contentType: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(filePath, body, { contentType, upsert: true });
  if (error) throw new Error(`Upload ${filePath} failed: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(filePath).data.publicUrl;
}

export async function buildInvoiceData(orderId: string): Promise<InvoicePdfData | null> {
  const { data: invoice, error } = await supabase.rpc('ensure_invoice', { p_order_id: orderId });
  if (error) throw new Error(`Invoice creation failed: ${error.message}`);
  if (!invoice?.id) return null;

  const [{ data: order }, { data: items }] = await Promise.all([
    supabase.from('orders').select('order_number, payment_method').eq('id', orderId).single(),
    supabase.from('order_items').select('*').eq('order_id', orderId),
  ]);

  const productIds = (items || []).map((i: any) => i.product_id).filter(Boolean);
  const { data: products } = productIds.length
    ? await supabase.from('products').select('id, hsn_code').in('id', productIds)
    : { data: [] as any[] };
  const hsn = new Map((products || []).map((p: any) => [p.id, p.hsn_code]));

  return {
    invoice_number: invoice.invoice_number,
    channel: invoice.channel,
    issued_at: invoice.issued_at,
    order_number: order?.order_number || '',
    payment_method: order?.payment_method,
    customer_name: invoice.customer_name,
    customer_phone: invoice.customer_phone,
    billing_address: invoice.billing_address,
    subtotal: Number(invoice.subtotal),
    discount: Number(invoice.discount),
    tax: Number(invoice.tax),
    total: Number(invoice.total),
    seller: invoice.seller || {},
    items: (items || []).map((i: any) => ({
      name: i.product_name,
      sku: i.sku,
      hsn: hsn.get(i.product_id) || null,
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      line_total: Number(i.line_total),
      tax_rate: i.tax_rate,
      tax_amount: i.tax_amount,
    })),
  };
}

async function imageAsDataUri(url: string | null | undefined) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!/image\/(jpe?g|png)/.test(type)) return null;
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  } catch {
    return null;
  }
}

type CouponRow = {
  id: string;
  coupon_code: string;
  created_at: string | null;
  product_name: string | null;
  coupon_seq: number | null;
  coupon_total: number | null;
};

async function couponArtSettings() {
  const { data: settings } = await supabase
    .from('settings')
    .select('company_name, giveaway_image_url')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  return {
    storeName: settings?.company_name || STORE_NAME,
    imageHref: await imageAsDataUri(settings?.giveaway_image_url),
  };
}

export async function renderCouponPng(
  coupon: CouponRow,
  order: { order_number?: string | null; customer_name?: string | null },
  art: { storeName: string; imageHref: string | null }
) {
  const svg = couponSvg({
    code: coupon.coupon_code,
    customerName: order.customer_name,
    orderNumber: order.order_number,
    issuedAt: coupon.created_at,
    productName: coupon.product_name,
    seq: coupon.coupon_seq,
    total: coupon.coupon_total,
    ...art,
  });

  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: COUPON_WIDTH },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Poppins' },
  }).render().asPng();
  return Buffer.from(png);
}

// After payment: the invoice PDF, then the giveaway coupon(s)
export async function sendPaymentDocuments(orderId: string, phoneNumber: string) {
  try {
    const data = await buildInvoiceData(orderId);
    if (data) {
      const pdf = Buffer.from(buildInvoicePdf(data, { fonts: INVOICE_FONTS }).output('arraybuffer'));
      const fileName = invoiceFileName(data.invoice_number);
      const link = await upload(`invoices/${fileName}`, pdf, 'application/pdf');
      await sendDocument(phoneNumber, link, fileName, `🧾 Invoice ${data.invoice_number} for order ${data.order_number}`);
      await supabase
        .from('invoices')
        .update({ pdf_url: link, sent_at: new Date() })
        .eq('invoice_number', data.invoice_number);
    }
  } catch (error: any) {
    console.error('❌ Invoice send failed:', error.response?.data || error.message);
  }

  // Coupons: one product unit = one coupon. A single coupon goes as an image; several go as one PDF
  try {
    const { data: rows } = await supabase
      .from('coupons')
      .select('id, coupon_code, created_at, product_name, coupon_seq, coupon_total')
      .eq('order_id', orderId)
      .eq('campaign', 'thar-roxx-giveaway')
      .order('coupon_seq');
    const coupons = (rows || []) as CouponRow[];
    if (!coupons.length) return;

    const { data: order } = await supabase
      .from('orders')
      .select('order_number, customer_name')
      .eq('id', orderId)
      .single();
    const art = await couponArtSettings();
    const pngs = coupons.map((c) => renderCouponPng(c, order || {}, art));
    const ids = coupons.map((c) => c.id);

    if (coupons.length === 1) {
      const c = coupons[0];
      const link = await upload(`coupons/${c.coupon_code}.png`, await pngs[0], 'image/png');
      await sendImage(
        phoneNumber,
        link,
        `🎁 Your Thar ROXX giveaway coupon: *${c.coupon_code}*${c.product_name ? `\nFor: ${c.product_name}` : ''}\nKeep it safe. It is your entry in the draw.`
      );
      await supabase.from('coupons').update({ image_url: link, sent_at: new Date() }).in('id', ids);
      return;
    }

    const images = await Promise.all(pngs);
    const pdf = buildCouponsPdf(
      coupons.map((c, i) => ({
        png: images[i].toString('base64'),
        code: c.coupon_code,
        seq: c.coupon_seq,
        productName: c.product_name,
      })),
      { orderNumber: order?.order_number || '', customerName: order?.customer_name, storeName: art.storeName }
    );
    const fileName = couponsFileName(order?.order_number || orderId);
    const link = await upload(`coupons/${fileName}`, Buffer.from(pdf.output('arraybuffer')), 'application/pdf');
    await sendDocument(
      phoneNumber,
      link,
      fileName,
      `🎁 Your ${coupons.length} Thar ROXX giveaway coupons for order ${order?.order_number}, one for each product`
    );
    await supabase.from('coupons').update({ image_url: link, sent_at: new Date() }).in('id', ids);
  } catch (error: any) {
    console.error('❌ Coupon send failed:', error.response?.data || error.message);
  }
}
