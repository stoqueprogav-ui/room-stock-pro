import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ExportColumn<T> = { header: string; key: keyof T | string; map?: (row: T) => any };

export function exportToExcel<T extends Record<string, any>>(
  filename: string, columns: ExportColumn<T>[], rows: T[]
) {
  const data = rows.map((r) => {
    const obj: Record<string, any> = {};
    for (const c of columns) obj[c.header] = c.map ? c.map(r) : (r as any)[c.key];
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : filename + ".xlsx");
}

export function exportToPdf<T extends Record<string, any>>(
  filename: string, title: string, columns: ExportColumn<T>[], rows: T[],
  meta?: { subtitle?: string }
) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  if (meta?.subtitle) {
    doc.setFontSize(10);
    doc.text(meta.subtitle, 14, 22);
  }
  autoTable(doc, {
    startY: meta?.subtitle ? 26 : 20,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => {
      const v = c.map ? c.map(r) : (r as any)[c.key];
      return v == null ? "" : String(v);
    })),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 41, 59] },
  });
  doc.save(filename.endsWith(".pdf") ? filename : filename + ".pdf");
}

export function printElement(html: string, title = "Imprimir") {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;padding:20px;color:#111}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left}
  th{background:#1e293b;color:#fff}h1{margin:0 0 8px}</style></head>
  <body>${html}</body></html>`);
  w.document.close();
  setTimeout(() => { w.print(); }, 250);
}
