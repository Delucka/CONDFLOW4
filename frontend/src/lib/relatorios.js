// Engine de relatórios (client-side, zero dependência nova — usa pdf-lib + file-saver
// que já estão no projeto). Serve a Central de Relatórios da Auditoria: recebe colunas
// + linhas e baixa em CSV (abre no Excel) ou PDF (tabela paginada).
//
// columns: [{ key, label, width?, value?(row) }]
//   - key: nome do campo em row (usado se value não vier)
//   - value: função opcional (row) => texto (pra formatar/derivar)
//   - width: peso relativo da coluna no PDF (default 1)
import { saveAs } from 'file-saver';

const cell = (col, row) => {
  const v = typeof col.value === 'function' ? col.value(row) : row[col.key];
  return v == null ? '' : String(v);
};

// ---- CSV (Excel PT-BR usa ';' como separador; BOM p/ acentos) ----
function csvEscape(s) {
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function gerarCsv(filename, columns, rows) {
  const SEP = ';';
  const head = columns.map((c) => csvEscape(c.label)).join(SEP);
  const body = rows.map((r) => columns.map((c) => csvEscape(cell(c, r))).join(SEP)).join('\r\n');
  const csv = '﻿' + head + '\r\n' + body;
  saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

// ---- PDF (tabela paginada, A4 paisagem, desenhada com pdf-lib) ----
export async function gerarPdfTabela({ titulo, subtitulo, columns, rows, filename }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold);

  const PW = 842, PH = 595, M = 32;           // A4 paisagem
  const usableW = PW - M * 2;
  const totalW = columns.reduce((s, c) => s + (c.width || 1), 0);
  const colW = columns.map((c) => ((c.width || 1) / totalW) * usableW);
  const FS = 8, HFS = 8.5, ROW = 15, TFS = 14, SFS = 9;
  const cinza = rgb(0.2, 0.2, 0.25);

  const trunc = (txt, w, f, size) => {
    let s = txt == null ? '' : String(txt);
    if (f.widthOfTextAtSize(s, size) <= w) return s;
    while (s.length > 1 && f.widthOfTextAtSize(s + '…', size) > w) s = s.slice(0, -1);
    return s + '…';
  };

  let page, y;
  const header = () => {
    page.drawRectangle({ x: M, y: y - ROW, width: usableW, height: ROW, color: rgb(0.93, 0.94, 0.97) });
    let x = M;
    columns.forEach((c, i) => {
      page.drawText(trunc(c.label, colW[i] - 6, fontB, HFS), { x: x + 3, y: y - ROW + 4.5, size: HFS, font: fontB, color: rgb(0.15, 0.15, 0.2) });
      x += colW[i];
    });
    y -= ROW;
  };
  const novaPagina = (comTitulo) => {
    page = doc.addPage([PW, PH]);
    y = PH - M;
    if (comTitulo && titulo) {
      page.drawText(titulo, { x: M, y: y - TFS, size: TFS, font: fontB, color: rgb(0.1, 0.1, 0.15) });
      y -= TFS + 5;
      if (subtitulo) { page.drawText(subtitulo, { x: M, y: y - SFS, size: SFS, font, color: rgb(0.42, 0.42, 0.48) }); y -= SFS + 8; }
      else y -= 6;
    }
    header();
  };

  novaPagina(true);
  rows.forEach((r, idx) => {
    if (y - ROW < M) novaPagina(false);
    if (idx % 2 === 1) page.drawRectangle({ x: M, y: y - ROW, width: usableW, height: ROW, color: rgb(0.975, 0.975, 0.985) });
    let x = M;
    columns.forEach((c, i) => {
      page.drawText(trunc(cell(c, r), colW[i] - 6, font, FS), { x: x + 3, y: y - ROW + 4.5, size: FS, font, color: cinza });
      x += colW[i];
    });
    y -= ROW;
  });
  if (rows.length === 0) {
    page.drawText('Nenhum registro no período.', { x: M, y: y - 16, size: 10, font, color: rgb(0.5, 0.5, 0.55) });
  }

  const bytes = await doc.save();
  saveAs(new Blob([bytes], { type: 'application/pdf' }), filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
