import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";

export type ExportColumn<T> = { header: string; key: keyof T | string; map?: (row: T) => any };

export type ReportMeta = {
  title: string;
  subtitle?: string;
  companyName?: string;
  logoUrl?: string | null;
  user?: string | null;
};

const COMPANY_DEFAULT = "Estoque Pro";

function nowLabel() {
  return new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

async function loadImageDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

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

/** Legacy basic PDF export (kept for backwards compat). */
export function exportToPdf<T extends Record<string, any>>(
  filename: string, title: string, columns: ExportColumn<T>[], rows: T[],
  meta?: { subtitle?: string }
) {
  return exportReportPdf(filename, columns, rows, { title, subtitle: meta?.subtitle });
}

/** Professional PDF: company header (logo + name + date + user) and page X de Y footer. */
export async function exportReportPdf<T extends Record<string, any>>(
  filename: string,
  columns: ExportColumn<T>[],
  rows: T[],
  meta: ReportMeta
) {
  const doc = new jsPDF({ orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const company = meta.companyName ?? COMPANY_DEFAULT;

  let logoData: string | null = null;
  if (meta.logoUrl) logoData = await loadImageDataUrl(meta.logoUrl);

  const drawHeader = () => {
    if (logoData) {
      try { doc.addImage(logoData, "PNG", 14, 8, 14, 14); } catch { /* noop */ }
    }
    doc.setFontSize(13);
    doc.setTextColor(20);
    doc.text(company, logoData ? 32 : 14, 15);
    doc.setFontSize(14);
    doc.text(meta.title, logoData ? 32 : 14, 22);
    if (meta.subtitle) {
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(meta.subtitle, logoData ? 32 : 14, 27);
    }
    doc.setFontSize(9);
    doc.setTextColor(90);
    const rightLine1 = `Emitido em: ${nowLabel()}`;
    const rightLine2 = meta.user ? `Por: ${meta.user}` : "";
    doc.text(rightLine1, pageW - 14, 12, { align: "right" });
    if (rightLine2) doc.text(rightLine2, pageW - 14, 17, { align: "right" });
    doc.setDrawColor(200);
    doc.line(14, 31, pageW - 14, 31);
  };

  autoTable(doc, {
    startY: 36,
    margin: { top: 36, bottom: 16, left: 14, right: 14 },
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => {
      const v = c.map ? c.map(r) : (r as any)[c.key];
      return v == null ? "" : String(v);
    })),
    styles: { fontSize: 9, textColor: 30 },
    headStyles: { fillColor: [240, 240, 240], textColor: 20, lineWidth: 0.1, lineColor: [180, 180, 180] },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    didDrawPage: () => { drawHeader(); },
  });

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(`Emitido em ${nowLabel()}${meta.user ? ` por ${meta.user}` : ""}`, 14, pageH - 6);
    doc.text(`Página ${i} de ${total}`, pageW - 14, pageH - 6, { align: "right" });
  }

  doc.save(filename.endsWith(".pdf") ? filename : filename + ".pdf");
}

/** Legacy print (kept). Prefer printReport. */
export function printElement(html: string, title = "Imprimir") {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;padding:20px;color:#111}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left}
  th{background:#f4f4f4;color:#111}h1{margin:0 0 8px}</style></head>
  <body>${html}</body></html>`);
  w.document.close();
  setTimeout(() => { w.print(); }, 250);
}

/** Ink-friendly printable report with header (logo+company+date+user) and footer with date+user. */
export function printReport<T extends Record<string, any>>(
  columns: ExportColumn<T>[],
  rows: T[],
  meta: ReportMeta
) {
  const company = meta.companyName ?? COMPANY_DEFAULT;
  const emitted = nowLabel();
  const headerCells = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const bodyRows = rows.map((r) => {
    const tds = columns.map((c) => {
      const v = c.map ? c.map(r) : (r as any)[c.key];
      return `<td>${v == null ? "" : escapeHtml(String(v))}</td>`;
    }).join("");
    return `<tr>${tds}</tr>`;
  }).join("");

  const logo = meta.logoUrl ? `<img src="${meta.logoUrl}" alt="" class="logo" />` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(meta.title)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:24px 28px}
  .doc-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #333;padding-bottom:10px;margin-bottom:14px}
  .doc-header .left{display:flex;gap:10px;align-items:center}
  .logo{height:36px;width:auto;object-fit:contain}
  .company{font-weight:700;font-size:14px}
  .title{font-size:16px;font-weight:700;margin-top:2px}
  .subtitle{font-size:11px;color:#444;margin-top:2px}
  .meta{font-size:10px;color:#444;text-align:right;line-height:1.4}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{border:1px solid #999;padding:5px 7px;font-size:11px;text-align:left;vertical-align:top}
  th{background:#f0f0f0;font-weight:700}
  tbody tr:nth-child(even) td{background:#fafafa}
  .doc-footer{position:fixed;bottom:8px;left:28px;right:28px;display:flex;justify-content:space-between;border-top:1px solid #999;padding-top:4px;font-size:9px;color:#444}
  @media print{
    .doc-footer{position:fixed;bottom:0}
    @page{margin:16mm 12mm 18mm 12mm}
  }
</style></head><body>
<div class="doc-header">
  <div class="left">${logo}<div><div class="company">${escapeHtml(company)}</div>
    <div class="title">${escapeHtml(meta.title)}</div>
    ${meta.subtitle ? `<div class="subtitle">${escapeHtml(meta.subtitle)}</div>` : ""}
  </div></div>
  <div class="meta">
    <div>Emitido em: <strong>${emitted}</strong></div>
    ${meta.user ? `<div>Por: <strong>${escapeHtml(meta.user)}</strong></div>` : ""}
  </div>
</div>
<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows || `<tr><td colspan="${columns.length}" style="text-align:center;color:#666;padding:20px">Sem dados</td></tr>`}</tbody></table>
<div class="doc-footer">
  <span>Emitido em ${emitted}${meta.user ? ` · Por ${escapeHtml(meta.user)}` : ""}</span>
  <span>${escapeHtml(company)}</span>
</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.print(); }, 300);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
