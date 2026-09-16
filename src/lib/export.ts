import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ExportRow = Record<string, string | number>;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCSV(rows: ExportRow[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0] as ExportRow);
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
  download(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${filename}.csv`);
}

export function exportExcel(rows: ExportRow[], filename: string) {
  if (!rows.length) return;
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Data");
  XLSX.writeFile(book, `${filename}.xlsx`);
}

export function exportPDF(rows: ExportRow[], filename: string, title: string) {
  if (!rows.length) return;
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.text(`ibird · generated ${new Date().toLocaleString("en-IN")}`, 14, 22);
  autoTable(doc, {
    startY: 28,
    head: [Object.keys(rows[0] as ExportRow)],
    body: rows.map((r) => Object.values(r).map((v) => String(v ?? ""))),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [37, 99, 235] },
  });
  doc.save(`${filename}.pdf`);
}
