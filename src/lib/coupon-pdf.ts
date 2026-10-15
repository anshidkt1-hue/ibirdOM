// One PDF with all giveaway coupons of an order (two per A4 page), sent on WhatsApp when an order
// has more than one coupon and downloadable from the dashboard. Keep src/lib/coupon-pdf.ts and
// whatsapp-backend/src/lib/coupon-pdf.ts identical.
import { jsPDF } from "jspdf";

export type CouponPdfEntry = {
  png: string; // coupon artwork as PNG: base64 or data: URL
  code: string;
  seq?: number | null | undefined;
  productName?: string | null | undefined;
};

export type CouponPdfMeta = {
  orderNumber: string;
  customerName?: string | null | undefined;
  storeName?: string | null | undefined;
  issuedAt?: string | null | undefined;
};

type RGB = [number, number, number];
const RED: RGB = [190, 18, 32];
const NAVY: RGB = [28, 26, 74];
const MUTED: RGB = [110, 108, 135];
const PAGE_BG: RGB = [247, 246, 251];

export function buildCouponsPdf(coupons: CouponPdfEntry[], meta: CouponPdfMeta): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const imgW = W - 2 * M;
  const imgH = (imgW * 630) / 1200;
  const total = coupons.length;
  const store = meta.storeName || "ibird";
  const date = new Date(meta.issuedAt || Date.now()).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });

  const header = (page: number, pages: number) => {
    doc.setFillColor(...PAGE_BG);
    doc.rect(0, 0, W, H, "F");
    doc.setFillColor(...RED);
    doc.rect(0, 0, W, 1.6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...NAVY);
    doc.text("Thar ROXX Giveaway Coupons", M, 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    const who = [meta.customerName, `Order ${meta.orderNumber}`, date].filter(Boolean).join("  ·  ");
    doc.text(who, M, 21.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...RED);
    doc.text(`${total} coupon${total === 1 ? "" : "s"}`, W - M, 15, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Page ${page} of ${pages}`, W - M, 21.5, { align: "right" });
  };

  const pages = Math.max(1, Math.ceil(total / 2));
  coupons.forEach((c, i) => {
    const slot = i % 2;
    if (slot === 0) {
      if (i > 0) doc.addPage();
      header(i / 2 + 1, pages);
    }
    const top = 30 + slot * (imgH + 20);
    const data = c.png.startsWith("data:") ? c.png : `data:image/png;base64,${c.png}`;
    doc.addImage(data, "PNG", M, top, imgW, imgH, undefined, "FAST");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...NAVY);
    doc.text(`Coupon ${c.seq ?? i + 1} of ${total}  ·  ${c.code}`, M, top + imgH + 6);
    if (c.productName) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      doc.text(`For: ${c.productName}`, W - M, top + imgH + 6, { align: "right" });
    }
  });

  // Footer on every page
  for (let p = 1; p <= doc.getNumberOfPages(); p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Each coupon is one entry in the Thar ROXX giveaway draw. Keep this file safe.  ·  ${store}`, W / 2, H - 10, {
      align: "center",
    });
  }
  return doc;
}

export const couponsFileName = (orderNumber: string) => `Thar-ROXX-Coupons-${orderNumber}.pdf`;
