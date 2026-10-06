// src/routes/reports.js — relatório de agendamentos com totais e exportação CSV / Excel / PDF
'use strict';

const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { getDb } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { audit } = require('../audit');
const { ah, formatBRL, formatDateTimeBR } = require('../util');
const { buildFilter } = require('./bookings');

const STATUS_LABEL = {
  pending: 'Pendente', confirmed: 'Confirmado', cancelled: 'Cancelado', completed: 'Concluído', no_show: 'Não compareceu',
};
const MAX_ROWS = 20000;

function loadReport(query) {
  const { sql, params, filters } = buildFilter(query);
  const db = getDb();
  const rows = db.prepare(`
    SELECT b.id, s.name AS site_name, b.starts_at, b.service_name, b.professional_name, b.client_name, b.client_phone,
           b.client_email, b.price_cents, b.status, b.source, b.created_at
    FROM bookings b JOIN sites s ON s.id = b.site_id ${sql}
    ORDER BY b.starts_at, b.id LIMIT ${MAX_ROWS + 1}`).all(...params);
  const truncated = rows.length > MAX_ROWS;
  if (truncated) rows.length = MAX_ROWS;

  // Totais calculados no SQL sobre o filtro inteiro (não dependem do limite de linhas)
  const agg = (groupCol) => db.prepare(`
    SELECT ${groupCol} AS label, COUNT(*) AS count,
      SUM(CASE WHEN b.status = 'completed' THEN b.price_cents ELSE 0 END) AS revenue_done_cents,
      SUM(CASE WHEN b.status IN ('pending','confirmed','completed') THEN b.price_cents ELSE 0 END) AS revenue_expected_cents
    FROM bookings b JOIN sites s ON s.id = b.site_id ${sql}
    GROUP BY ${groupCol} ORDER BY count DESC, label`).all(...params);
  const statusRows = db.prepare(`SELECT b.status, COUNT(*) AS n FROM bookings b ${sql} GROUP BY b.status`).all(...params);
  const byStatus = Object.fromEntries(Object.keys(STATUS_LABEL).map((k) => [k, 0]));
  for (const r of statusRows) byStatus[r.status] = r.n;
  const sums = db.prepare(`SELECT COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN b.status = 'completed' THEN b.price_cents END), 0) AS revenue_done_cents,
      COALESCE(SUM(CASE WHEN b.status IN ('pending','confirmed','completed') THEN b.price_cents END), 0) AS revenue_expected_cents
    FROM bookings b ${sql}`).get(...params);

  return {
    filters,
    rows,
    truncated,
    totals: {
      ...sums,
      by_status: byStatus,
      by_service: agg('b.service_name'),
      by_professional: agg("COALESCE(b.professional_name, '—')"),
      by_site: agg('s.name'),
    },
  };
}

// Evita injeção de fórmula ao abrir no Excel/Sheets
function safeCell(v) {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function toCsv(report) {
  const head = ['ID', 'Site', 'Data/hora', 'Serviço', 'Profissional', 'Cliente', 'WhatsApp', 'E-mail', 'Valor (R$)', 'Status', 'Origem'];
  const lines = [head.join(';')];
  for (const r of report.rows) {
    lines.push([
      r.id, r.site_name, formatDateTimeBR(r.starts_at), r.service_name, r.professional_name || '', r.client_name,
      r.client_phone, r.client_email || '', (r.price_cents / 100).toFixed(2).replace('.', ','), STATUS_LABEL[r.status], r.source,
    ].map((v) => `"${safeCell(v).replace(/"/g, '""')}"`).join(';'));
  }
  lines.push('');
  lines.push(`"Total de agendamentos";${report.totals.count}`);
  lines.push(`"Receita realizada (concluídos)";"${(report.totals.revenue_done_cents / 100).toFixed(2).replace('.', ',')}"`);
  lines.push(`"Receita prevista (pendentes + confirmados + concluídos)";"${(report.totals.revenue_expected_cents / 100).toFixed(2).replace('.', ',')}"`);
  return '﻿' + lines.join('\r\n');
}

async function toXlsx(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Versal Estúdio';
  wb.created = new Date();
  const ws = wb.addWorksheet('Agendamentos');
  ws.columns = [
    { header: 'ID', key: 'id', width: 8 }, { header: 'Site', key: 'site', width: 24 },
    { header: 'Data/hora', key: 'when', width: 18 }, { header: 'Serviço', key: 'service', width: 26 },
    { header: 'Profissional', key: 'prof', width: 20 }, { header: 'Cliente', key: 'client', width: 24 },
    { header: 'WhatsApp', key: 'phone', width: 16 }, { header: 'E-mail', key: 'email', width: 26 },
    { header: 'Valor', key: 'price', width: 12, style: { numFmt: '"R$" #,##0.00' } },
    { header: 'Status', key: 'status', width: 16 }, { header: 'Origem', key: 'source', width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of report.rows) {
    ws.addRow({
      id: r.id, site: safeCell(r.site_name), when: formatDateTimeBR(r.starts_at), service: safeCell(r.service_name),
      prof: safeCell(r.professional_name || ''), client: safeCell(r.client_name), phone: r.client_phone, email: safeCell(r.client_email || ''),
      price: r.price_cents / 100, status: STATUS_LABEL[r.status], source: r.source,
    });
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const sum = wb.addWorksheet('Resumo');
  sum.columns = [{ width: 48 }, { width: 16 }, { width: 20 }, { width: 22 }];
  sum.addRow(['Total de agendamentos', report.totals.count]).font = { bold: true };
  sum.addRow(['Receita realizada (concluídos)', report.totals.revenue_done_cents / 100]).getCell(2).numFmt = '"R$" #,##0.00';
  sum.addRow(['Receita prevista (pend. + conf. + concl.)', report.totals.revenue_expected_cents / 100]).getCell(2).numFmt = '"R$" #,##0.00';
  sum.addRow([]);
  sum.addRow(['Status', 'Quantidade']).font = { bold: true };
  for (const [k, n] of Object.entries(report.totals.by_status)) sum.addRow([STATUS_LABEL[k], n]);
  sum.addRow([]);
  sum.addRow(['Serviço', 'Quantidade', 'Realizado', 'Previsto']).font = { bold: true };
  for (const r of report.totals.by_service) {
    const row = sum.addRow([safeCell(r.label), r.count, r.revenue_done_cents / 100, r.revenue_expected_cents / 100]);
    row.getCell(3).numFmt = '"R$" #,##0.00'; row.getCell(4).numFmt = '"R$" #,##0.00';
  }
  return wb.xlsx.writeBuffer();
}

function toPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: 'Relatório de agendamentos', Author: 'Versal Estúdio' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const f = report.filters;
    doc.font('Helvetica-Bold').fontSize(16).text('Relatório de agendamentos');
    doc.moveDown(0.3).font('Helvetica').fontSize(9).fillColor('#555')
      .text(`Período: ${f.from ? formatDateTimeBR(f.from) : 'início'} a ${f.to ? formatDateTimeBR(f.to) : 'hoje em diante'}`
        + `${f.status ? ' · Status: ' + STATUS_LABEL[f.status] : ''} · Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
    doc.moveDown(0.6).fillColor('#000').fontSize(11)
      .text(`Total: ${report.totals.count} agendamento(s)   ·   Realizado: ${formatBRL(report.totals.revenue_done_cents)}   ·   Previsto: ${formatBRL(report.totals.revenue_expected_cents)}`);
    doc.moveDown(0.3).fontSize(9).fillColor('#333')
      .text(Object.entries(report.totals.by_status).map(([k, n]) => `${STATUS_LABEL[k]}: ${n}`).join('   '));
    doc.moveDown(0.8);

    const cols = [
      ['Data/hora', 78], ['Site', 90], ['Serviço', 100], ['Profissional', 72], ['Cliente', 90], ['Valor', 50], ['Status', 43],
    ];
    const drawHeader = () => {
      let x = doc.page.margins.left;
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000');
      for (const [label, w] of cols) { doc.text(label, x, y, { width: w - 4 }); x += w; }
      doc.moveTo(doc.page.margins.left, y + 12).lineTo(doc.page.width - doc.page.margins.right, y + 12).strokeColor('#999').stroke();
      doc.y = y + 16;
    };
    drawHeader();
    doc.font('Helvetica').fontSize(8);
    for (const r of report.rows) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(8); }
      const values = [formatDateTimeBR(r.starts_at), r.site_name, r.service_name, r.professional_name || '—', r.client_name,
        formatBRL(r.price_cents), STATUS_LABEL[r.status]];
      let x = doc.page.margins.left;
      const y = doc.y;
      values.forEach((v, i) => { doc.text(String(v), x, y, { width: cols[i][1] - 4, height: 11, ellipsis: true, lineBreak: false }); x += cols[i][1]; });
      doc.y = y + 13;
    }
    if (!report.rows.length) doc.text('Nenhum agendamento no filtro escolhido.');
    if (report.truncated) doc.moveDown().text(`Lista limitada a ${MAX_ROWS} linhas; os totais consideram todos os registros.`);
    doc.end();
  });
}

module.exports = () => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'operator'));

  router.get('/bookings', ah(async (req, res) => {
    const format = req.query.format || 'json';
    if (!['json', 'csv', 'xlsx', 'pdf'].includes(format)) return res.status(400).json({ error: 'Formato inválido (json, csv, xlsx ou pdf).' });
    const report = loadReport(req.query);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format !== 'json') audit(req, 'report.export', 'report', null, { format, filters: report.filters });
    if (format === 'csv') {
      return res.set('Content-Disposition', `attachment; filename="agendamentos-${stamp}.csv"`).type('text/csv; charset=utf-8').send(toCsv(report));
    }
    if (format === 'xlsx') {
      const buf = await toXlsx(report);
      return res.set('Content-Disposition', `attachment; filename="agendamentos-${stamp}.xlsx"`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buf));
    }
    if (format === 'pdf') {
      const buf = await toPdf(report);
      return res.set('Content-Disposition', `attachment; filename="agendamentos-${stamp}.pdf"`).type('application/pdf').send(buf);
    }
    res.json({ ...report, rows: report.rows.slice(0, 500), rows_total: report.rows.length });
  }));

  return router;
};

module.exports.loadReport = loadReport;
module.exports.STATUS_LABEL = STATUS_LABEL;
