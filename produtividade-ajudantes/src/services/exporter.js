'use strict';
// Exportação CSV (padrão Excel pt-BR: separador ";" e vírgula decimal) e XLSX.
const ExcelJS = require('exceljs');

// Evita injeção de fórmulas ao abrir no Excel (=, +, -, @ no início de texto).
function safeText(v) {
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function csvCell(v, col) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return col.decimals === 0 ? String(v) : v.toFixed(col.decimals ?? 2).replace('.', ',');
  const s = safeText(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const head = columns.map(c => csvCell(c.header, {})).join(';');
  const body = rows.map(r => columns.map(c => csvCell(r[c.key], c)).join(';'));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

async function toXlsx(title, columns, rows, meta = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LogiPonto';
  const ws = wb.addWorksheet(title.slice(0, 31));
  let r = 1;
  for (const line of meta) { ws.getCell(r, 1).value = line; r++; }
  if (meta.length) r++;
  const headerRow = ws.getRow(r);
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D5C' } };
    ws.getColumn(i + 1).width = c.width || 14;
    if (typeof c.decimals === 'number') ws.getColumn(i + 1).numFmt = c.decimals === 0 ? '#,##0' : '#,##0.00';
  });
  for (const row of rows) {
    r++;
    const xr = ws.getRow(r);
    columns.forEach((c, i) => {
      const v = row[c.key];
      xr.getCell(i + 1).value = typeof v === 'number' ? v : (v === null || v === undefined ? '' : safeText(v));
    });
  }
  ws.views = [{ state: 'frozen', ySplit: meta.length ? meta.length + 2 : 1 }];
  return wb.xlsx.writeBuffer();
}

module.exports = { toCsv, toXlsx, safeText };
