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

export type InvoicePdfOptions = { fonts?: InvoiceFonts | null; logo?: string | null };

type RGB = [number, number, number];
const RED: RGB = [190, 18, 32];
const NAVY: RGB = [28, 26, 74];
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

// Whole rupees without decimals (2,999); otherwise always two decimals (2,042.50)
const num = (n: number) => {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const d = Number.isInteger(v) ? 0 : 2;
  return v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
};

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
      doc.addImage(options.logo, M, 9, 40, 22, undefined, "FAST");
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

  // ---------- Items ----------
  const cols = { sno: M, desc: M + 16, items: 118, amount: 148, end: W - M };
  const tableTop = y;
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 16, bottom: 20 },
    head: [["S.NO", "ITEM DESCRIPTION", "ITEMS", `AMOUNT (${rupee})`]],
    body: data.items.map((i, idx) => {
      const details = [
        i.hsn ? `HSN ${i.hsn}` : null,
        `GST ${Number(i.tax_rate ?? 0)}%`,
        `${rupee}${num(i.unit_price)} each`,
      ].filter(Boolean).join("  ·  ");
      return [`${idx + 1}.`, `${i.name}\n${details}`, String(i.quantity), num(i.line_total)];
    }),
    theme: "plain",
    styles: {
      font: F,
      fontSize: 8.5,
      textColor: INK,
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
      lineColor: LINE,
      lineWidth: { bottom: 0.25 },
      valign: "middle",
    },
    headStyles: { fillColor: LAVENDER, textColor: NAVY, fontStyle: "semibold" as any, fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: cols.desc - cols.sno, halign: "center" },
      1: { cellWidth: cols.items - cols.desc },
      2: { cellWidth: cols.amount - cols.items, halign: "center" },
      3: { cellWidth: cols.end - cols.amount, halign: "right", fontStyle: "semibold" as any },
    },
    willDrawPage: (hook) => {
      if (hook.pageNumber > 1) pageBackground();
    },
    didParseCell: (hook) => {
      if (hook.section === "head" && hook.column.index === 3) hook.cell.styles.halign = "right";
      // The description is drawn by hand below (name + small details line); keep two blank lines for height
      if (hook.section === "body" && hook.column.index === 1) hook.cell.text = [" ", " "];
    },
    didDrawCell: (hook) => {
      // Second line of the description in small grey text
      if (hook.section === "body" && hook.column.index === 1) {
        const [name, details] = String(hook.cell.raw).split("\n");
        const c = hook.cell;
        font("normal", 8.5, INK);
        doc.text(name ?? "", c.x + 3, c.y + c.height / 2 - 0.8);
        font("normal", 6.8, MUTED);
        doc.text(details ?? "", c.x + 3, c.y + c.height / 2 + 3);
      }
    },
    bodyStyles: { fillColor: WHITE, minCellHeight: 13 },
  });

  const tableEnd = (doc as any).lastAutoTable.finalY as number;
  const lastTablePage = doc.getNumberOfPages();

  // Totals block (right two columns), with the amount in words on the left
  const totals: [string, string][] = [
    ["TOTAL ITEMS", String(data.items.reduce((s, i) => s + Number(i.quantity), 0))],
    ["SUBTOTAL", num(data.subtotal)],
    ...(data.discount > 0 ? ([["DISCOUNT", `- ${num(data.discount)}`]] as [string, string][]) : []),
    ["CGST", num(data.tax / 2)],
    ["SGST", num(data.tax / 2)],
  ];
  const rowH = 7;
  const totalsH = totals.length * rowH + 10;
  const NOTES_H = 46;
  const FOOTER_H = 34;
  const reserved = totalsH + 6 + NOTES_H + 6 + FOOTER_H;

  let blockTop = tableEnd;
  if (blockTop + reserved > H) {
    doc.addPage();
    pageBackground();
    blockTop = 16;
  }
  // Stretch the table body down so the notes and footer sit at the bottom, like the printed bill
  const fillTo = H - FOOTER_H - 6 - NOTES_H - 6 - totalsH;
  const onTablePage = doc.getNumberOfPages() === lastTablePage;
  const extendFrom = onTablePage ? tableEnd : blockTop;
  const totalsTop = Math.max(blockTop, fillTo);

  doc.setFillColor(...WHITE);
  doc.rect(M, extendFrom, W - 2 * M, totalsTop - extendFrom, "F");
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.25);
  // Column rules through the body and the empty area
  const ruleTop = onTablePage ? tableTop : blockTop;
  for (const x of [cols.desc, cols.items, cols.amount]) {
    doc.line(x, ruleTop, x, totalsTop);
  }
  doc.line(cols.items, totalsTop, cols.items, totalsTop + totalsH);

  // Totals rows
  doc.setFillColor(...WHITE);
  doc.rect(M, totalsTop, W - 2 * M, totalsH, "F");
  doc.line(M, totalsTop, W - M, totalsTop);
  totals.forEach(([label, value], i) => {
    const ry = totalsTop + i * rowH + 4.8;
    font("medium", 7.5, NAVY);
    doc.text(label, (cols.items + cols.amount) / 2, ry, { align: "center" });
    font("semibold", 8.5, INK);
    doc.text(value, cols.end - 3, ry, { align: "right" });
  });
  const bandY = totalsTop + totals.length * rowH + 1;
  // Red band whose bottom-right corner follows the rounded table frame
  doc.setFillColor(...RED);
  doc.roundedRect(cols.items, bandY, cols.end - cols.items, 9, 3, 3, "F");
  doc.rect(cols.items, bandY, cols.end - cols.items, 5, "F");
  doc.rect(cols.items, bandY, cols.end - cols.items - 4, 9, "F");
  font("bold", 9, WHITE);
  doc.text("TOTAL INVOICE", (cols.items + cols.amount) / 2, bandY + 6, { align: "center" });
  doc.text(`${rupee}${num(data.total)}`, cols.end - 3, bandY + 6, { align: "right" });

  font("semibold", 7.5, RED);
  doc.text("AMOUNT IN WORDS", M + 4, totalsTop + 6);
  font("normal", 8, INK);
  doc.text(doc.splitTextToSize(amountInWords(data.total), cols.items - M - 8), M + 4, totalsTop + 11);

  // Frame around the whole table
  const frameTop = onTablePage ? tableTop : blockTop;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.35);
  doc.roundedRect(M, frameTop, W - 2 * M, totalsTop + totalsH - frameTop, 3, 3, "S");

  // ---------- Invoice note ----------
  const notesTop = totalsTop + totalsH + 6;
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
