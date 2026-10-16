// Tax invoice PDF in the ibird design (red / navy, lavender panels). The same file is used by the
// dashboard (download) and the WhatsApp backend (sent after payment): keep
// src/lib/invoice-pdf.ts and whatsapp-backend/src/lib/invoice-pdf.ts identical.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { INVOICE_ICONS, type InvoiceIcon } from "./invoice-icons";

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
  const CW = W - 2 * M;
  const PAD = 6; // inner padding of every panel
  const seller = data.seller || {};
  const store = seller.name || "ibird";

  // ---------- Fonts and drawing helpers ----------
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
  const serif = (size: number, color: RGB) => {
    doc.setFont("times", "bold");
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const rupee = fonts ? "₹" : "Rs.";
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const amt = (n: number) =>
    Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Width of text with letter spacing (jsPDF alignment ignores charSpace)
  const spacedWidth = (text: string, cs: number) => doc.getTextWidth(text) + cs * (text.length - 1);
  const spaced = (text: string, x: number, y: number, cs: number, align: "left" | "center" | "right" = "left") => {
    const w = spacedWidth(text, cs);
    doc.text(text, align === "left" ? x : align === "center" ? x - w / 2 : x - w, y, { charSpace: cs });
  };
  // Baseline that vertically centres a single text line in a box (cap height ≈ 0.7 em)
  const mid = (top: number, height: number, size: number) => top + height / 2 + (size * 0.3528 * 0.7) / 2;
  const icon = (key: InvoiceIcon, x: number, y: number, s: number) => {
    try {
      doc.addImage(INVOICE_ICONS[key], "PNG", x, y, s, s, undefined, "FAST");
    } catch {
      /* icons are decorative */
    }
  };
  const pageBackground = () => {
    doc.setFillColor(...PAGE_BG);
    doc.rect(0, 0, W, H, "F");
  };
  const panel = (x: number, y: number, w: number, h: number) => {
    doc.setFillColor(...WHITE);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, 3, 3, "FD");
  };
  const iconTile = (key: InvoiceIcon, x: number, y: number, s: number) => {
    doc.setFillColor(...WHITE);
    doc.setDrawColor(...RED);
    doc.setLineWidth(0.45);
    doc.roundedRect(x, y, s, s, 2.2, 2.2, "FD");
    icon(key, x + s * 0.22, y + s * 0.22, s * 0.56);
  };

  pageBackground();

  // ---------- Header: logo | HOME APPLIANCES + GSTIN | contact ----------
  const logoH = 24;
  if (options.logo) {
    try {
      doc.addImage(options.logo, "PNG", M, 9, logoH * (640 / 458), logoH, undefined, "FAST");
    } catch {
      font("bold", 26, NAVY);
      doc.text(store, M, 28);
    }
  } else {
    font("bold", 26, NAVY);
    doc.text(store, M, 28);
  }
  const brandX = M + logoH * (640 / 458) + 6;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.4);
  doc.line(brandX, 12, brandX, 31);

  const tagX = brandX + 6;
  font("semibold", 10, RED);
  spaced((seller.tagline || "Home Appliances").toUpperCase(), tagX, 19.5, 1.4);
  if (seller.gstin) {
    font("bold", 7, RED);
    const labelW = doc.getTextWidth("GSTIN");
    font("semibold", 7.5, NAVY);
    const valueW = doc.getTextWidth(seller.gstin);
    const pillW = 3 + labelW + 3 + valueW + 3;
    doc.setFillColor(...LAVENDER);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.roundedRect(tagX, 23.5, pillW, 7, 1.6, 1.6, "FD");
    font("bold", 7, RED);
    doc.text("GSTIN", tagX + 3, mid(23.5, 7, 7.5));
    font("semibold", 7.5, NAVY);
    doc.text(seller.gstin, tagX + 3 + labelW + 3, mid(23.5, 7, 7.5));
  }

  const contactX = 132;
  const contactTextX = contactX + 8.5;
  const contactW = W - M - contactTextX;
  const contacts: [InvoiceIcon, string[]][] = [];
  font("normal", 7.5, INK);
  if (seller.phone) contacts.push(["circle_phone", [seller.phone]]);
  if (seller.email) contacts.push(["circle_atSign", [seller.email]]);
  if (seller.address) contacts.push(["circle_mapPin", doc.splitTextToSize(seller.address, contactW)]);
  let cy = 9;
  for (const [key, lines] of contacts) {
    icon(key, contactX, cy, 6);
    font("normal", 7.5, INK);
    doc.text(lines, contactTextX, mid(cy, 6, 7.5), { lineHeightFactor: 1.35 });
    cy += Math.max(6, 6 + (lines.length - 1) * 3.6) + 1.8;
  }
  const headerBottom = Math.max(38, cy + 1);
  doc.setFillColor(...RED);
  doc.rect(0, headerBottom, W, 1.2, "F");

  // ---------- Title: INVOICE + bill no / date ----------
  let y = headerBottom + 5;
  const titleH = 24;
  panel(M, y, CW, titleH);
  iconTile("red_fileCheckCorner", M + PAD, y + 5, 14);
  font("bold", 24, NAVY);
  spaced("INVOICE", M + PAD + 14 + 6, y + 13.8, 1.6);
  font("normal", 7.5, MUTED);
  doc.text(
    `${data.channel === "whatsapp" ? "WhatsApp order" : "Counter sale"}  ·  ${data.order_number}`,
    M + PAD + 14 + 6.3,
    y + 19.4,
  );

  const metaX = W - M - PAD - 78;
  const labelW = 26;
  const metaRow = (label: string, value: string, ry: number) => {
    doc.setFillColor(...LAVENDER);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.roundedRect(metaX, ry, 78, 7.5, 1.6, 1.6, "FD");
    doc.setFillColor(...RED);
    doc.roundedRect(metaX, ry, labelW, 7.5, 1.6, 1.6, "F");
    doc.rect(metaX + labelW - 2, ry, 2, 7.5, "F");
    font("bold", 7.5, WHITE);
    spaced(label, metaX + 3.5, mid(ry, 7.5, 7.5), 0.4);
    font("semibold", 8.5, NAVY);
    doc.text(value, metaX + labelW + 4, mid(ry, 7.5, 8.5));
  };
  metaRow("BILL NO.", data.invoice_number, y + 3.5);
  metaRow("DATE", formatDate(data.issued_at), y + 13);
  y += titleH + 4;

  // ---------- Bill to ----------
  const toTextX = M + PAD + 12 + 6;
  font("normal", 7.5, INK);
  const addressLines: string[] = data.billing_address ? doc.splitTextToSize(data.billing_address, 92) : [];
  const detailRows = (data.customer_phone ? 1 : 0) + addressLines.length;
  const toH = Math.max(22, 5 + 4 + 6 + detailRows * 4.4 + 4);
  panel(M, y, CW, toH);
  iconTile("red_userRound", M + PAD, y + (toH - 12) / 2, 12);
  font("semibold", 7, RED);
  spaced("BILL TO", toTextX, y + 7.4, 0.8);
  font("bold", 11.5, NAVY);
  doc.text(data.customer_name || "Walk-in Customer", toTextX, y + 13.6);
  let ry = y + 18.6;
  if (data.customer_phone) {
    icon("red_phone", toTextX, ry - 2.7, 3.3);
    font("normal", 7.5, INK);
    doc.text(data.customer_phone, toTextX + 5, ry);
    ry += 4.4;
  }
  if (addressLines.length) {
    icon("red_mapPin", toTextX, ry - 2.7, 3.3);
    font("normal", 7.5, INK);
    doc.text(addressLines, toTextX + 5, ry, { lineHeightFactor: 1.5 });
  }
  // Channel pill and payment method, centred vertically on the right
  const pillW = 48;
  const pillH = 10;
  const pillX = W - M - PAD - pillW;
  const pillY = y + (toH - pillH) / 2 - (data.payment_method ? 2.4 : 0);
  doc.setFillColor(...RED);
  doc.roundedRect(pillX, pillY, pillW, pillH, 2.2, 2.2, "F");
  const pillText = data.channel === "whatsapp" ? "WHATSAPP ORDER" : "COUNTER SALE";
  font("bold", 8, WHITE);
  const pillContentW = 4.4 + 2 + spacedWidth(pillText, 0.4);
  const pillStart = pillX + (pillW - pillContentW) / 2;
  icon(data.channel === "whatsapp" ? "white_messageCircle" : "white_receipt", pillStart, pillY + (pillH - 4.4) / 2, 4.4);
  spaced(pillText, pillStart + 6.4, mid(pillY, pillH, 8), 0.4);
  if (data.payment_method) {
    font("medium", 7, MUTED);
    doc.text(`Paid by ${data.payment_method.toUpperCase()}`, pillX + pillW / 2, pillY + pillH + 4.2, { align: "center" });
  }
  y += toH + 4;

  // ---------- Items: per-product GST and product photo ----------
  const lineTax = (i: InvoicePdfData["items"][number]) =>
    i.tax_amount != null ? Number(i.tax_amount) : r2((Number(i.line_total) * Number(i.tax_rate ?? 0)) / 100);
  const totQty = data.items.reduce((s, i) => s + Number(i.quantity), 0);
  const totLine = r2(data.items.reduce((s, i) => s + Number(i.line_total), 0));
  const totTax = r2(data.items.reduce((s, i) => s + lineTax(i), 0));

  // Column widths add up to the content width (182 mm)
  const COLS = [
    { head: "No", w: 11, align: "center" },
    { head: "Item", w: 59, align: "left" },
    { head: "Qty", w: 13, align: "center" },
    { head: "Rate", w: 21, align: "right" },
    { head: "Total", w: 22, align: "right" },
    { head: "GST %", w: 14, align: "center" },
    { head: "GST Amt", w: 20, align: "right" },
    { head: "Total Value", w: 22, align: "right" },
  ] as const;
  const CELL_X = 3;
  const PHOTO = 11;
  const hasPhotos = data.items.some((i) => i.image);
  const itemTextX = hasPhotos ? CELL_X + PHOTO + 3 : CELL_X;
  const itemTextW = COLS[1].w - itemTextX - CELL_X;
  const nameLines = (i: InvoicePdfData["items"][number]) => {
    font("semibold", 8.5, NAVY);
    return doc.splitTextToSize(i.name, itemTextW) as string[];
  };
  const detailOf = (i: InvoicePdfData["items"][number]) =>
    [i.hsn ? `HSN ${i.hsn}` : null, i.sku ? `SKU ${i.sku}` : null].filter(Boolean).join("  ·  ");

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 16, bottom: 20 },
    head: [COLS.map((c) => c.head)],
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
    foot: [["", "TOTAL", String(totQty), "", amt(totLine), "", amt(totTax), amt(totLine + totTax)]],
    showFoot: "lastPage",
    theme: "grid",
    styles: {
      font: F,
      fontSize: 8.3,
      textColor: INK,
      cellPadding: { top: 2.5, bottom: 2.5, left: CELL_X, right: CELL_X },
      lineColor: LINE,
      lineWidth: 0.2,
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: "semibold" as any, fontSize: 7.8, minCellHeight: 9 },
    footStyles: { fillColor: LAVENDER, textColor: NAVY, fontStyle: "bold" as any, fontSize: 8.5, minCellHeight: 9 },
    bodyStyles: { minCellHeight: hasPhotos ? PHOTO + 5 : 10 },
    alternateRowStyles: { fillColor: [251, 250, 254] },
    columnStyles: Object.fromEntries(
      COLS.map((c, i) => [i, { cellWidth: c.w, halign: c.align, ...(i === 7 ? { fontStyle: "semibold" as any, textColor: NAVY } : {}) }]),
    ) as any,
    willDrawPage: (hook) => {
      if (hook.pageNumber > 1) pageBackground();
    },
    didParseCell: (hook) => {
      const col = COLS[hook.column.index]!;
      // Column titles are centred; values keep their own alignment (text left, numbers right)
      hook.cell.styles.halign = hook.section === "head" ? "center" : col.align;
      // TOTAL lines up with the product names
      if (hook.section === "foot" && hook.column.index === 1) {
        hook.cell.styles.cellPadding = { top: 2.5, bottom: 2.5, left: itemTextX, right: CELL_X };
      }
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
        const px = c.x + CELL_X;
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
        doc.roundedRect(px, py, PHOTO, PHOTO, 1.2, 1.2, "S");
      }
      const lines = nameLines(item);
      const detail = detailOf(item);
      const LINE_H = 3.6;
      const blockH = lines.length * LINE_H + (detail ? 3.4 : 0);
      let ty = c.y + (c.height - blockH) / 2 + 2.7;
      font("semibold", 8.5, NAVY);
      doc.text(lines, c.x + itemTextX, ty, { lineHeightFactor: 1.2 });
      ty += lines.length * LINE_H;
      if (detail) {
        font("normal", 6.6, MUTED);
        doc.text(detail, c.x + itemTextX, ty + 0.4);
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY as number;
  const NOTES_H = 36;
  const FOOTER_H = 30;
  const rateRows = new Set(data.items.map((i) => Number(i.tax_rate ?? 0))).size;
  const SUMMARY_H = Math.max(26, PAD + 7.6 + rateRows * 4.6 + PAD);
  const bandBlock = (data.discount > 0 ? 8 : 0) + 11;
  // Keep the totals with the table when they fit; only the notes move to the next page
  if (y + bandBlock + 4 + SUMMARY_H > H - FOOTER_H - 4) {
    doc.addPage();
    pageBackground();
    y = 16;
  }

  // Discount (shared across the lines before GST), then the grand total band
  const valueColX = W - M - COLS[7].w;
  if (data.discount > 0) {
    doc.setFillColor(...WHITE);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.rect(M, y, CW, 8, "FD");
    font("semibold", 8, NAVY);
    doc.text("DISCOUNT", valueColX - 4, mid(y, 8, 8), { align: "right" });
    doc.text(`- ${amt(data.discount)}`, W - M - CELL_X, mid(y, 8, 8), { align: "right" });
    y += 8;
  }
  doc.setFillColor(...RED);
  doc.roundedRect(M, y, CW, 11, 2.5, 2.5, "F");
  doc.rect(M, y, CW, 5, "F");
  font("bold", 9.5, WHITE);
  spaced("GRAND TOTAL (INVOICE)", valueColX - 4, mid(y, 11, 9.5), 0.6, "right");
  font("bold", 10.5, WHITE);
  doc.text(`${rupee}${amt(data.total)}`, W - M - CELL_X, mid(y, 11, 10.5), { align: "right" });
  y += 11 + 4;

  // ---------- Amount in words | GST summary by rate ----------
  const leftW = 92;
  const rightX = M + leftW + 4;
  const rightW = CW - leftW - 4;
  panel(M, y, leftW, SUMMARY_H);
  font("semibold", 7, RED);
  spaced("AMOUNT IN WORDS", M + PAD, y + PAD + 2.4, 0.6);
  font("medium", 8.5, NAVY);
  doc.text(doc.splitTextToSize(amountInWords(data.total), leftW - 2 * PAD), M + PAD, y + PAD + 8, { lineHeightFactor: 1.35 });

  panel(rightX, y, rightW, SUMMARY_H);
  font("semibold", 7, RED);
  spaced("GST SUMMARY", rightX + PAD, y + PAD + 2.4, 0.6);
  const gx = {
    rate: rightX + PAD,
    taxable: rightX + PAD + 33,
    cgst: rightX + rightW - PAD - 20,
    sgst: rightX + rightW - PAD,
  };
  font("medium", 6.6, MUTED);
  let gy = y + PAD + 7.6;
  doc.text("Rate", gx.rate, gy);
  doc.text("Taxable", gx.taxable, gy, { align: "right" });
  doc.text("CGST", gx.cgst, gy, { align: "right" });
  doc.text("SGST", gx.sgst, gy, { align: "right" });
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.2);
  doc.line(rightX + PAD, gy + 1.4, rightX + rightW - PAD, gy + 1.4);
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const i of data.items) {
    const rate = Number(i.tax_rate ?? 0);
    const cur = byRate.get(rate) ?? { taxable: 0, tax: 0 };
    cur.taxable += Number(i.line_total);
    cur.tax += lineTax(i);
    byRate.set(rate, cur);
  }
  font("normal", 7.5, INK);
  for (const [rate, v] of [...byRate.entries()].sort((a, b) => a[0] - b[0])) {
    gy += 4.6;
    doc.text(`${rate}%`, gx.rate, gy);
    doc.text(amt(v.taxable), gx.taxable, gy, { align: "right" });
    doc.text(amt(v.tax / 2), gx.cgst, gy, { align: "right" });
    doc.text(amt(v.tax / 2), gx.sgst, gy, { align: "right" });
  }
  y += SUMMARY_H + 4;

  // ---------- Invoice note | prepared by (sits at the bottom of the page) ----------
  if (y + NOTES_H > H - FOOTER_H - 4) {
    doc.addPage();
    pageBackground();
    y = 16;
  }
  const notesTop = Math.max(y, H - FOOTER_H - 4 - NOTES_H);
  panel(M, notesTop, CW, NOTES_H);
  const dividerX = W - M - 56;
  font("bold", 8.5, RED);
  spaced("INVOICE NOTE", M + PAD, notesTop + 5 + 2.8, 0.6);
  font("normal", 6.9, INK);
  DEFAULT_NOTES(store).forEach((note, i) => {
    const ny = notesTop + 5 + 8.4 + i * 3.75;
    doc.setFillColor(...RED);
    doc.circle(M + PAD + 0.8, ny - 0.95, 0.65, "F");
    doc.text(note, M + PAD + 3.6, ny);
  });
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(dividerX, notesTop + 5, dividerX, notesTop + NOTES_H - 5);
  const prepX = dividerX + PAD;
  font("bold", 7, RED);
  spaced("PREPARED BY", prepX, notesTop + 5 + 2.8, 0.6);
  font("bold", 12, NAVY);
  spaced(store.toUpperCase(), prepX, notesTop + 5 + 9.6, 1);
  font("normal", 7, MUTED);
  doc.text(formatDate(data.issued_at), prepX, notesTop + 5 + 14);
  doc.text(["Computer-generated invoice;", "no signature required."], prepX, notesTop + NOTES_H - 5 - 3.6, {
    lineHeightFactor: 1.4,
  });

  // ---------- Footer on every page: slogan + four promises ----------
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
  doc.setPage(page);
  const fy = H - FOOTER_H;
  panel(M, fy, CW, 10);
  serif(9, NAVY);
  spaced("QUALITY APPLIANCES   •   RELIABLE PERFORMANCE   •   FOR YOUR HOME", W / 2, mid(fy, 10, 9), 0.6, "center");

  const badges: [InvoiceIcon, string, string][] = [
    ["circle_shieldCheck", "MANUFACTURER", "WARRANTY"],
    ["circle_wrench", "AFTER-SALES", "SERVICE"],
    ["circle_truck", "FAST", "DELIVERY"],
    ["circle_star", "QUALITY", "YOU CAN TRUST"],
  ];
  const colW = CW / 4;
  const badgeTop = fy + 14;
  const BADGE = 9;
  badges.forEach(([key, top, bottom], i) => {
    const bx = M + i * colW + 5;
    icon(key, bx, badgeTop, BADGE);
    serif(7.8, NAVY);
    doc.text(top, bx + BADGE + 3, badgeTop + BADGE / 2 - 0.6);
    serif(7, RED);
    doc.text(bottom, bx + BADGE + 3, badgeTop + BADGE / 2 + 3.2);
    if (i > 0) {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.4);
      doc.line(M + i * colW, badgeTop - 1, M + i * colW, badgeTop + BADGE + 1);
    }
  });
  }

  return doc;
}

// File name without the slashes used in invoice numbers
export const invoiceFileName = (invoiceNumber: string) => `Invoice-${invoiceNumber.replace(/\//g, "-")}.pdf`;
