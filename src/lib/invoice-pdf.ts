// Tax invoice PDF in the ibird design (red / navy, lavender panels). The same file is used by the
// dashboard (download) and the WhatsApp backend (sent after payment): keep
// src/lib/invoice-pdf.ts and whatsapp-backend/src/lib/invoice-pdf.ts identical.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type InvoiceSeller = {
  name?: string | null | undefined;
  tagline?: string | null | undefined;
  address?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  website?: string | null | undefined;
  gstin?: string | null | undefined;
};

export type InvoicePdfData = {
  invoice_number: string;
  channel: "whatsapp" | "counter";
  issued_at: string;
  order_number: string;
  payment_method?: string | null | undefined;
  customer_name?: string | null | undefined;
  customer_phone?: string | null | undefined;
  billing_address?: string | null | undefined;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  seller: InvoiceSeller;
  items: {
    name: string;
    sku?: string | null | undefined;
    hsn?: string | null | undefined;
    quantity: number;
    unit_price: number;
    line_total: number;
    tax_rate?: number | null | undefined;
    tax_amount?: number | null | undefined;
    image?: string | null | undefined; // product photo as a JPEG/PNG data: URL
  }[];
};

// Poppins TTF files as base64 (it has the ₹ sign); without them the standard font and "Rs." are used
export type InvoiceFonts = { regular: string; medium: string; semibold: string; bold: string };
export const INVOICE_FONT_FILES: Record<keyof InvoiceFonts, string> = {
  regular: "Poppins_400Regular.ttf",
  medium: "Poppins_500Medium.ttf",
  semibold: "Poppins_600SemiBold.ttf",
  bold: "Poppins_700Bold.ttf",
};

// logo: the ibird logo as a PNG data: URL (640 x 458, transparent)
export type InvoicePdfOptions = { fonts?: InvoiceFonts | null; logo?: string | null };

type RGB = [number, number, number];
// Colours of the ibird logo
const RED: RGB = [186, 12, 22];
const NAVY: RGB = [24, 6, 64];
const INK: RGB = [38, 38, 58];
const MUTED: RGB = [110, 108, 135];
const LAVENDER: RGB = [236, 234, 246];
const PAGE_BG: RGB = [247, 246, 251];
const LINE: RGB = [208, 205, 228];
const WHITE: RGB = [255, 255, 255];

const DEFAULT_NOTES = (store: string) => [
  "This invoice is valid for 15 days from the date of issue.",
  "GST is charged as applicable and shown separately.",
  "Delivery and installation charges are extra (if applicable).",
  "Warranty as per manufacturer terms; keep this bill for service claims.",
  "Goods once sold will not be taken back. Subject to availability of stock.",
  `Thank you for choosing ${store}.`,
];

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ""}`;
  return [h ? `${ONES[h]} Hundred` : "", rest].filter(Boolean).join(" ");
}

// Indian numbering: crore, lakh, thousand
export function amountInWords(amount: number) {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand) parts.push(`${below1000(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  const words = parts.join(" ") || "Zero";
  return `Rupees ${words}${paise ? ` and ${below1000(paise)} Paise` : ""} Only`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
}

export function buildInvoicePdf(data: InvoicePdfData, options: InvoicePdfOptions = {}): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const seller = data.seller || {};
  const store = seller.name || "ibird";

  // Fonts
  const fonts = options.fonts;
  const F = fonts ? "Poppins" : "helvetica";
  if (fonts) {
    (Object.keys(INVOICE_FONT_FILES) as (keyof InvoiceFonts)[]).forEach((k) => {
      doc.addFileToVFS(INVOICE_FONT_FILES[k], fonts[k]);
      doc.addFont(INVOICE_FONT_FILES[k], "Poppins", k === "regular" ? "normal" : k);
    });
  }
  const font = (style: "normal" | "medium" | "semibold" | "bold", size: number, color: RGB = INK) => {
    doc.setFont(F, fonts ? style : style === "normal" || style === "medium" ? "normal" : "bold");
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const rupee = fonts ? "₹" : "Rs.";
  // jsPDF centring ignores letter spacing, so spaced text is centred by hand
  const centred = (text: string, cx: number, ty: number, charSpace: number) => {
    const w = doc.getTextWidth(text) + charSpace * (text.length - 1);
    doc.text(text, cx - w / 2, ty, { charSpace });
  };

  const pageBackground = () => {
    doc.setFillColor(...PAGE_BG);
    doc.rect(0, 0, W, H, "F");
  };
  const panel = (x: number, y: number, w: number, h: number, fill: RGB = WHITE) => {
    doc.setFillColor(...fill);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, w, h, 3, 3, "FD");
  };
  const iconSquare = (x: number, y: number, s: number, kind: "doc" | "person") => {
    doc.setDrawColor(...RED);
    doc.setLineWidth(0.4);
    doc.setFillColor(...WHITE);
    doc.roundedRect(x, y, s, s, 1.8, 1.8, "FD");
    const cx = x + s / 2;
    const cy = y + s / 2;
    doc.setLineWidth(0.35);
    if (kind === "doc") {
      doc.roundedRect(cx - s * 0.18, cy - s * 0.24, s * 0.36, s * 0.48, 0.6, 0.6, "S");
      doc.line(cx - s * 0.09, cy + s * 0.02, cx - s * 0.02, cy + s * 0.09);
      doc.line(cx - s * 0.02, cy + s * 0.09, cx + s * 0.1, cy - s * 0.05);
    } else {
      doc.circle(cx, cy - s * 0.1, s * 0.12, "S");
      doc.ellipse(cx, cy + s * 0.2, s * 0.22, s * 0.1, "S");
    }
  };

  pageBackground();

  // ---------- Header ----------
  if (options.logo) {
    try {
      doc.addImage(options.logo, "PNG", M, 8, 34, 24.3, undefined, "FAST");
    } catch {
      /* fall back to the drawn mark below */
    }
  } else {
    // Drawn mark: red bird above the navy wordmark
    doc.setFillColor(...RED);
    doc.triangle(M + 13, 17, M + 25, 9.5, M + 22, 17, "F");
    doc.triangle(M + 18, 17, M + 33, 12, M + 25, 18, "F");
    doc.circle(M + 25.5, 15.8, 2.3, "F");
    doc.triangle(M + 27.5, 15, M + 31, 15.6, M + 27.5, 16.6, "F");
    font("bold", 26, NAVY);
    doc.text(store.toLowerCase() === "ibird" ? "ibird" : store, M, 30);
  }

  const tagline = (seller.tagline || "Kitchen Appliances").toUpperCase();
  font("semibold", 8.5, RED);
  doc.text(`—  ${tagline}  —`, 66, 18, { charSpace: 0.9 });
  if (seller.gstin) {
    font("normal", 7.5, INK);
    doc.text("GSTIN:", 66, 25);
    font("bold", 7.5, NAVY);
    doc.text(seller.gstin, 66 + doc.getTextWidth("GSTIN: ") + 0.5, 25);
  }

  // Contact column with red round markers
  const contact: string[][] = [];
  if (seller.phone) contact.push([seller.phone]);
  if (seller.email) contact.push([seller.email]);
  else if (seller.website) contact.push([seller.website]);
  font("normal", 7.5, INK);
  if (seller.address) contact.push(doc.splitTextToSize(seller.address, 52));
  let cy = 12;
  for (const lines of contact) {
    doc.setFillColor(...RED);
    doc.circle(143, cy - 1, 2.4, "F");
    doc.setFillColor(...WHITE);
    doc.circle(143, cy - 1, 0.8, "F");
    font("normal", 7.5, INK);
    doc.text(lines, 148, cy);
    cy += 4 * lines.length + 3.5;
  }
  const headerBottom = Math.max(38, cy - 2);
  doc.setFillColor(...RED);
  doc.rect(0, headerBottom, W, 1.3, "F");

  // ---------- Invoice title + bill no / date ----------
  let y = headerBottom + 6;
  panel(M, y, W - 2 * M, 26);
  iconSquare(M + 6, y + 7, 12, "doc");
  font("bold", 24, NAVY);
  doc.text("INVOICE", M + 24, y + 16.5, { charSpace: 1.6 });
  font("normal", 7.5, MUTED);
  doc.text(data.channel === "whatsapp" ? `WhatsApp order ${data.order_number}` : `Counter sale ${data.order_number}`, M + 24, y + 21.5);

  const metaRow = (label: string, value: string, ry: number) => {
    doc.setFillColor(...RED);
    doc.roundedRect(122, ry, 30, 8, 1.2, 1.2, "F");
    font("bold", 7.5, WHITE);
    doc.text(label, 125, ry + 5.3);
    doc.setFillColor(...LAVENDER);
    doc.setDrawColor(...LINE);
    doc.roundedRect(152, ry, W - M - 4 - 152, 8, 1.2, 1.2, "FD");
    font("medium", 8, NAVY);
    doc.text(value, 156, ry + 5.3);
  };
  metaRow("BILL NO.", data.invoice_number, y + 4);
  metaRow("DATE", formatDate(data.issued_at), y + 14);
  y += 30;

  // ---------- Bill to ----------
  font("normal", 7.5, MUTED);
  const toLines = [
    ...(data.customer_phone ? [`Phone: ${data.customer_phone}`] : []),
    ...(data.billing_address ? doc.splitTextToSize(data.billing_address, 100) : []),
  ];
  const toH = Math.max(18, 14 + toLines.length * 3.8);
  panel(M, y, W - 2 * M, toH);
  iconSquare(M + 6, y + 4, 10, "person");
  font("semibold", 7.5, RED);
  doc.text("To", M + 21, y + 7.5);
  font("bold", 11, NAVY);
  doc.text(data.customer_name || "Walk-in Customer", M + 21, y + 13);
  if (toLines.length) {
    font("normal", 7.5, MUTED);
    doc.text(toLines, M + 21, y + 17.2);
  }
  // Channel / payment badge in place of the sample's red button
  const badge = data.channel === "whatsapp" ? "WHATSAPP ORDER" : "COUNTER SALE";
  doc.setFillColor(...RED);
  doc.roundedRect(W - M - 46, y + 4, 40, 10, 2, 2, "F");
  font("bold", 8.5, WHITE);
  centred(badge, W - M - 26, y + 10.4, 0.5);
  if (data.payment_method) {
    font("medium", 7, MUTED);
    doc.text(`Paid by ${data.payment_method.toUpperCase()}`, W - M - 26, y + 17, { align: "center" });
  }
  y += toH + 5;

  // ---------- Items: per-product GST and product photo ----------
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const amt = (n: number) =>
    Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lineTax = (i: InvoicePdfData["items"][number]) =>
    i.tax_amount != null ? Number(i.tax_amount) : r2((Number(i.line_total) * Number(i.tax_rate ?? 0)) / 100);
  const totQty = data.items.reduce((s, i) => s + Number(i.quantity), 0);
  const totLine = r2(data.items.reduce((s, i) => s + Number(i.line_total), 0));
  const totTax = r2(data.items.reduce((s, i) => s + lineTax(i), 0));

  const PHOTO = 13;
  const hasPhotos = data.items.some((i) => i.image);
  const textX = hasPhotos ? PHOTO + 5 : 3;
  const itemW = 58;
  const nameLines = (i: InvoicePdfData["items"][number]) => {
    font("semibold", 8.5, INK);
    return doc.splitTextToSize(i.name, itemW - textX - 2) as string[];
  };
  const detailOf = (i: InvoicePdfData["items"][number]) =>
    [i.hsn ? `HSN ${i.hsn}` : null, i.sku ? `SKU ${i.sku}` : null].filter(Boolean).join("  ·  ");

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 16, bottom: 20 },
    // GST is per product (from Inventory at the time of sale), so every row carries its own rate
    head: [["No", "Item", "Qty", "Rate", "Total", "GST %", "GST Amt", "Total Value"]],
    body: data.items.map((i, idx) => {
      const tax = lineTax(i);
      return [
        String(idx + 1),
        "",
        String(i.quantity),
        amt(i.unit_price),
        amt(i.line_total),
        `${Number(i.tax_rate ?? 0)}%`,
        amt(tax),
        amt(Number(i.line_total) + tax),
      ];
    }),
    foot: [["", "Total", String(totQty), "", amt(totLine), "", amt(totTax), amt(totLine + totTax)]],
    showFoot: "lastPage",
    theme: "grid",
    styles: {
      font: F,
      fontSize: 8.3,
      textColor: INK,
      cellPadding: { top: 2.6, bottom: 2.6, left: 2.2, right: 2.2 },
      lineColor: LINE,
      lineWidth: 0.25,
      valign: "middle",
      halign: "right",
    },
    headStyles: { fillColor: LAVENDER, textColor: NAVY, fontStyle: "semibold" as any, fontSize: 8, halign: "center" },
    footStyles: { fillColor: LAVENDER, textColor: NAVY, fontStyle: "bold" as any, fontSize: 8.5 },
    bodyStyles: { fillColor: WHITE, minCellHeight: hasPhotos ? PHOTO + 4 : 11 },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: itemW, halign: "left" },
      2: { cellWidth: 14, halign: "center" },
      3: { cellWidth: 21 },
      4: { cellWidth: 22 },
      5: { cellWidth: 13, halign: "center" },
      6: { cellWidth: 21 },
      7: { cellWidth: 23, fontStyle: "semibold" as any },
    },
    willDrawPage: (hook) => {
      if (hook.pageNumber > 1) pageBackground();
    },
    didParseCell: (hook) => {
      if (hook.section === "foot" && hook.column.index === 1) hook.cell.styles.halign = "center";
      // The item cell is drawn by hand (photo, name, HSN/SKU); reserve its height with blank lines
      if (hook.section === "body" && hook.column.index === 1) {
        const item = data.items[hook.row.index]!;
        hook.cell.text = Array(nameLines(item).length + (detailOf(item) ? 1 : 0)).fill(" ");
      }
    },
    didDrawCell: (hook) => {
      if (hook.section !== "body" || hook.column.index !== 1) return;
      const item = data.items[hook.row.index]!;
      const c = hook.cell;
      if (item.image) {
        const px = c.x + 2;
        const py = c.y + (c.height - PHOTO) / 2;
        try {
          const fmt = /^data:image\/png/i.test(item.image) ? "PNG" : "JPEG";
          doc.addImage(item.image, fmt, px, py, PHOTO, PHOTO, undefined, "FAST");
        } catch {
          doc.setFillColor(...LAVENDER);
          doc.rect(px, py, PHOTO, PHOTO, "F");
        }
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.25);
        doc.roundedRect(px, py, PHOTO, PHOTO, 1, 1, "S");
      }
      const lines = nameLines(item);
      const detail = detailOf(item);
      const blockH = lines.length * 3.6 + (detail ? 3.4 : 0);
      let ty = c.y + (c.height - blockH) / 2 + 2.8;
      font("semibold", 8.5, INK);
      doc.text(lines, c.x + textX, ty);
      ty += lines.length * 3.6;
      if (detail) {
        font("normal", 6.6, MUTED);
        doc.text(detail, c.x + textX, ty);
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY as number;
  const NOTES_H = 46;
  const FOOTER_H = 34;
  const SUMMARY_H = (data.discount > 0 ? 8 : 0) + 12 + 14;
  if (y + SUMMARY_H + 6 + NOTES_H + 6 + FOOTER_H > H) {
    doc.addPage();
    pageBackground();
    y = 16;
  }

  // Discount (shared across the lines before GST), then the grand total band
  if (data.discount > 0) {
    doc.setFillColor(...WHITE);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.rect(M, y, W - 2 * M, 8, "FD");
    font("medium", 8, NAVY);
    doc.text("DISCOUNT", W - M - 40, y + 5.3, { align: "right" });
    font("semibold", 8.5, INK);
    doc.text(`- ${amt(data.discount)}`, W - M - 2.2, y + 5.3, { align: "right" });
    y += 8;
  }
  doc.setFillColor(...RED);
  doc.rect(M, y, W - 2 * M, 11, "F");
  font("bold", 10, WHITE);
  doc.text("GRAND TOTAL (INVOICE)", W - M - 40, y + 7.2, { align: "right", charSpace: 0.4 });
  doc.text(`${rupee}${amt(data.total)}`, W - M - 2.2, y + 7.2, { align: "right" });
  y += 11;

  font("semibold", 7.5, RED);
  doc.text("AMOUNT IN WORDS", M, y + 6);
  font("normal", 8, INK);
  doc.text(amountInWords(data.total), M + 30, y + 6);
  font("normal", 7.5, MUTED);
  // GST by rate, each split equally into CGST and SGST (intra-state supply)
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const i of data.items) {
    const rate = Number(i.tax_rate ?? 0);
    const cur = byRate.get(rate) ?? { taxable: 0, tax: 0 };
    cur.taxable += Number(i.line_total);
    cur.tax += lineTax(i);
    byRate.set(rate, cur);
  }
  const breakdown = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => `GST ${rate}% on ${rupee}${amt(v.taxable)}: CGST ${rupee}${amt(v.tax / 2)} + SGST ${rupee}${amt(v.tax / 2)}`)
;
  doc.text(breakdown, M, y + 11);
  y += 10 + breakdown.length * 3.6;

  // ---------- Invoice note ----------
  // Notes and footer sit at the bottom of the page, like the printed bill
  const notesTop = Math.max(y, H - FOOTER_H - 6 - NOTES_H);
  panel(M, notesTop, W - 2 * M, NOTES_H);
  font("bold", 8.5, RED);
  doc.text("INVOICE NOTE:", M + 5, notesTop + 7);
  font("normal", 7, INK);
  DEFAULT_NOTES(store).forEach((note, i) => {
    const ny = notesTop + 12 + i * 3.9;
    doc.setFillColor(...INK);
    doc.circle(M + 6, ny - 0.9, 0.5, "F");
    doc.text(note, M + 8.5, ny);
  });
  font("bold", 7, RED);
  doc.text("PREPARED BY", W - M - 50, notesTop + 7);
  font("bold", 11, NAVY);
  doc.text(store.toUpperCase(), W - M - 50, notesTop + 13, { charSpace: 0.8 });
  font("normal", 7, MUTED);
  doc.text(formatDate(data.issued_at), W - M - 50, notesTop + 17.5);
  doc.text("Computer-generated invoice;", W - M - 50, notesTop + 37);
  doc.text("no signature required.", W - M - 50, notesTop + 40.5);

  // ---------- Footer ----------
  const fy = H - FOOTER_H;
  panel(M, fy, W - 2 * M, 10);
  doc.setFont("times", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  centred("QUALITY APPLIANCES   •   RELIABLE PERFORMANCE   •   FOR YOUR KITCHEN", W / 2, fy + 6.6, 0.6);

  const badges: [string, string, "shield" | "wrench" | "truck" | "star"][] = [
    ["MANUFACTURER", "WARRANTY", "shield"],
    ["AFTER-SALES", "SERVICE", "wrench"],
    ["FAST", "DELIVERY", "truck"],
    ["QUALITY", "YOU CAN TRUST", "star"],
  ];
  const colW = (W - 2 * M) / 4;
  badges.forEach(([top, bottom, icon], i) => {
    const bx = M + i * colW + 6;
    const by = fy + 21;
    doc.setFillColor(...RED);
    doc.circle(bx, by, 4.6, "F");
    doc.setDrawColor(...WHITE);
    doc.setFillColor(...WHITE);
    doc.setLineWidth(0.5);
    if (icon === "shield") {
      doc.lines([[2.4, 0.9], [0, 1.8], [-2.4, 2.2], [-2.4, -2.2], [0, -1.8]], bx, by - 2.6, [1, 1], "S", true);
      doc.line(bx - 1, by, bx - 0.2, by + 0.9);
      doc.line(bx - 0.2, by + 0.9, bx + 1.2, by - 0.8);
    } else if (icon === "wrench") {
      doc.setLineWidth(0.9);
      doc.line(bx - 2, by + 2, bx + 1.2, by - 1.2);
      doc.setLineWidth(0.5);
      doc.circle(bx + 1.8, by - 1.8, 1.1, "S");
    } else if (icon === "truck") {
      doc.rect(bx - 2.8, by - 1.6, 3.4, 2.6, "F");
      doc.rect(bx + 0.8, by - 0.6, 1.9, 1.6, "F");
      doc.setFillColor(...RED);
      doc.setFillColor(...WHITE);
      doc.circle(bx - 1.8, by + 1.6, 0.7, "F");
      doc.circle(bx + 1.7, by + 1.6, 0.7, "F");
    } else {
      const pts: number[][] = [];
      for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? 2.8 : 1.2;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        pts.push([bx + r * Math.cos(a), by + r * Math.sin(a)]);
      }
      const rel = pts.slice(1).map((p, k) => [p[0]! - pts[k]![0]!, p[1]! - pts[k]![1]!]);
      doc.lines(rel, pts[0]![0]!, pts[0]![1]!, [1, 1], "F", true);
    }
    doc.setFont("times", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...NAVY);
    doc.text(top, bx + 7, by - 0.6);
    doc.setTextColor(...RED);
    doc.setFontSize(6.8);
    doc.text(bottom, bx + 7, by + 3);
    if (i > 0) {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.4);
      doc.line(M + i * colW - 1, fy + 15, M + i * colW - 1, fy + 27);
    }
  });

  return doc;
}

// File name without the slashes used in invoice numbers
export const invoiceFileName = (invoiceNumber: string) => `Invoice-${invoiceNumber.replace(/\//g, "-")}.pdf`;
