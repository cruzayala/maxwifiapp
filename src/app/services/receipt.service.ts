import { Injectable, inject, signal } from '@angular/core';
import { ConfigService } from './config.service';
import { Invoice } from '../models/invoice.model';

export type PaperSize = '58mm' | '80mm';
export type PrintMode = 'invoice' | 'receipt';

@Injectable({ providedIn: 'root' })
export class ReceiptService {
  private cfg = inject(ConfigService);

  previewVisible = signal(false);
  previewHTML = signal('');
  currentInvoice = signal<Invoice | null>(null);
  paperSize = signal<PaperSize>('80mm');
  printMode = signal<PrintMode>('receipt');

  constructor() {
    this.paperSize.set(this.cfg.defaultPaperSize());
  }

  openPreview(inv: Invoice, mode: PrintMode = 'receipt') {
    this.currentInvoice.set(inv);
    this.printMode.set(mode);
    if (mode === 'receipt') this.paperSize.set(this.cfg.defaultPaperSize());
    this.updatePreview();
    this.previewVisible.set(true);
  }

  openInvoicePreview(inv: Invoice) {
    this.openPreview(inv, 'invoice');
  }

  openReceiptPreview(inv: Invoice) {
    this.openPreview(inv, 'receipt');
  }

  updatePreview() {
    const inv = this.currentInvoice();
    if (!inv) return;
    this.previewHTML.set(this.generateHTML(inv, false));
  }

  generateHTML(inv: Invoice, forPrint = false): string {
    return this.printMode() === 'invoice'
      ? this.generateInvoiceHTML(inv, forPrint)
      : this.generateReceiptHTML(inv, forPrint);
  }

  generateInvoiceHTML(inv: Invoice, forPrint = false): string {
    const company = this.escape(this.cfg.companyName());
    const slogan = this.escape(this.cfg.companySlogan());
    const phone = this.escape(this.cfg.companyPhone());
    const address = this.escape(this.cfg.companyAddress());
    const rnc = this.escape(this.cfg.rnc());
    const status = this.statusText(inv);
    const statusClass = this.isPaid(inv) ? 'paid' : 'pending';
    const balance = this.balanceAmount(inv);
    const articles = this.invoiceArticles(inv);
    const printScript = this.printScript(forPrint);

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Factura #${inv.id_factura}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f1f5f9;
      color: #0f172a;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: #fff;
      padding: 18mm;
    }
    .top {
      display: grid;
      grid-template-columns: 1fr 220px;
      gap: 22px;
      align-items: start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 18px;
    }
    .brand {
      display: flex;
      gap: 14px;
      align-items: flex-start;
    }
    .mark {
      width: 54px;
      height: 54px;
      border-radius: 14px;
      background: #4f46e5;
      color: white;
      display: grid;
      place-items: center;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .company { font-size: 24px; font-weight: 800; letter-spacing: 0; }
    .muted { color: #64748b; }
    .company-lines { margin-top: 7px; color: #475569; font-size: 11px; }
    .doc-box {
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 14px;
      background: #f8fafc;
    }
    .doc-title {
      font-size: 22px;
      font-weight: 800;
      text-align: right;
      letter-spacing: 0;
      margin-bottom: 8px;
    }
    .doc-row { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; }
    .doc-row span:first-child { color: #64748b; }
    .section {
      margin-top: 22px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    .panel {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px;
    }
    .panel h3 {
      margin: 0 0 10px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #475569;
    }
    .kv { display: grid; grid-template-columns: 110px 1fr; gap: 8px; padding: 3px 0; }
    .kv .label { color: #64748b; }
    .items { margin-top: 22px; }
    table { width: 100%; border-collapse: collapse; }
    th {
      text-align: left;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: #475569;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
      padding: 9px 8px;
    }
    td { border-bottom: 1px solid #edf2f7; padding: 10px 8px; vertical-align: top; }
    .r { text-align: right; }
    .desc { font-weight: 600; color: #0f172a; }
    .desc small { display: block; color: #64748b; font-weight: 400; margin-top: 2px; }
    .totals {
      margin-top: 22px;
      display: grid;
      grid-template-columns: 1fr 280px;
      gap: 24px;
      align-items: start;
    }
    .note {
      border-left: 4px solid #6366f1;
      padding: 10px 12px;
      color: #475569;
      background: #eef2ff;
      border-radius: 8px;
    }
    .total-box {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
    }
    .total-line { display: flex; justify-content: space-between; padding: 9px 12px; border-bottom: 1px solid #edf2f7; }
    .total-line.grand { background: #0f172a; color: white; font-weight: 800; font-size: 16px; }
    .total-line.balance { color: #dc2626; font-weight: 800; }
    .status {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .status.paid { background: #dcfce7; color: #166534; }
    .status.pending { background: #fef3c7; color: #92400e; }
    .footer {
      margin-top: 34px;
      padding-top: 14px;
      border-top: 1px solid #e2e8f0;
      color: #64748b;
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      gap: 16px;
    }
    @media print {
      body { background: white; }
      .sheet { width: auto; min-height: auto; padding: 0; }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="top">
      <div class="brand">
        <div class="mark">${this.initials(company)}</div>
        <div>
          <div class="company">${company}</div>
          ${slogan ? `<div class="muted">${slogan}</div>` : ''}
          <div class="company-lines">
            ${rnc ? `<div>RNC/Cedula: ${rnc}</div>` : ''}
            ${phone ? `<div>Telefono: ${phone}</div>` : ''}
            ${address ? `<div>Direccion: ${address}</div>` : ''}
          </div>
        </div>
      </div>
      <div class="doc-box">
        <div class="doc-title">FACTURA</div>
        <div class="doc-row"><span>No.</span><strong>#${inv.id_factura}</strong></div>
        <div class="doc-row"><span>Estado</span><span class="status ${statusClass}">${status}</span></div>
        <div class="doc-row"><span>Zona</span><strong>${this.escape(inv.zona?.nombre || '-')}</strong></div>
      </div>
    </header>

    <section class="section">
      <div class="panel">
        <h3>Cliente</h3>
        <div class="kv"><span class="label">Nombre</span><strong>${this.escape(inv.cliente?.nombre || '-')}</strong></div>
        <div class="kv"><span class="label">Usuario</span><span>${this.escape(inv.cliente?.usuario || '-')}</span></div>
        <div class="kv"><span class="label">Cedula/RNC</span><span>${this.escape(inv.cliente?.cedula || inv.cliente?.rfc || '-')}</span></div>
        <div class="kv"><span class="label">Telefono</span><span>${this.escape(inv.cliente?.telefono || '-')}</span></div>
        <div class="kv"><span class="label">Direccion</span><span>${this.escape(inv.cliente?.direccion || inv.cliente?.localidad || '-')}</span></div>
      </div>
      <div class="panel">
        <h3>Datos de factura</h3>
        <div class="kv"><span class="label">Emision</span><span>${this.formatDate(inv.fecha_emision)}</span></div>
        <div class="kv"><span class="label">Vencimiento</span><span>${this.formatDate(inv.fecha_vencimiento)}</span></div>
        <div class="kv"><span class="label">Pago</span><span>${this.formatDateTime(inv.fecha_pago) || '-'}</span></div>
        <div class="kv"><span class="label">Forma</span><span>${this.escape(inv.forma_pago?.nombre || '-')}</span></div>
        <div class="kv"><span class="label">Referencia</span><span>${this.escape(inv.referencia || inv.folio || '-')}</span></div>
      </div>
    </section>

    <section class="items">
      <table>
        <thead>
          <tr>
            <th>Descripcion</th>
            <th class="r">Cant.</th>
            <th class="r">Precio</th>
            <th class="r">Importe</th>
          </tr>
        </thead>
        <tbody>${articles}</tbody>
      </table>
    </section>

    <section class="totals">
      <div class="note">
        Gracias por su preferencia. Este documento fue generado desde el sistema administrativo y puede guardarse como PDF desde el dialogo de impresion.
      </div>
      <div class="total-box">
        <div class="total-line"><span>Subtotal</span><strong>${this.money(inv.sub_total)}</strong></div>
        ${inv.descuento > 0 ? `<div class="total-line"><span>Descuento</span><strong>-${this.money(inv.descuento)}</strong></div>` : ''}
        ${inv.impuestos_total > 0 ? `<div class="total-line"><span>Impuestos</span><strong>${this.money(inv.impuestos_total)}</strong></div>` : ''}
        <div class="total-line grand"><span>Total</span><strong>${this.money(inv.total)}</strong></div>
        <div class="total-line"><span>Cobrado</span><strong>${this.money(inv.total_cobrado)}</strong></div>
        <div class="total-line balance"><span>Saldo</span><strong>${this.money(balance)}</strong></div>
      </div>
    </section>

    <footer class="footer">
      <span>${company}${phone ? ` | ${phone}` : ''}</span>
      ${inv.cajero ? `<span>Atendido por: ${this.escape(inv.cajero.nombre)}</span>` : '<span></span>'}
    </footer>
  </main>
  ${printScript}
</body>
</html>`;
  }

  generateReceiptHTML(inv: Invoice, forPrint = false): string {
    const company = this.escape(this.cfg.companyName());
    const slogan = this.escape(this.cfg.companySlogan());
    const phone = this.escape(this.cfg.companyPhone());
    const address = this.escape(this.cfg.companyAddress());
    const rnc = this.escape(this.cfg.rnc());
    const size = this.paperSize();
    const maxWidth = size === '58mm' ? '210px' : '300px';
    const fontSize = size === '58mm' ? '10px' : '12px';
    const titleSize = size === '58mm' ? '14px' : '18px';
    const totalSize = size === '58mm' ? '13px' : '16px';
    const articles = this.receiptArticles(inv);
    const balance = this.balanceAmount(inv);
    const printScript = this.printScript(forPrint);

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Recibo #${inv.id_factura}</title>
  <style>
    @page { size: ${size} auto; margin: 2mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', 'Lucida Console', monospace;
      font-size: ${fontSize};
      color: #000;
      width: ${maxWidth};
      max-width: ${maxWidth};
      margin: 0 auto;
      padding: 4px;
      line-height: 1.28;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .c { text-align: center; }
    .r { text-align: right; }
    .b { font-weight: bold; }
    .company { font-size: ${titleSize}; font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
    .sub-info { font-size: ${size === '58mm' ? '8px' : '10px'}; color: #333; }
    .sep { border: none; border-top: 1px dashed #000; margin: 5px 0; }
    .sep-strong { border: none; border-top: 2px solid #000; margin: 5px 0; }
    .receipt-title { font-size: ${size === '58mm' ? '11px' : '13px'}; font-weight: bold; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; vertical-align: top; font-size: ${fontSize}; }
    .lbl { width: ${size === '58mm' ? '64px' : '86px'}; font-weight: bold; }
    .desc { max-width: ${size === '58mm' ? '118px' : '170px'}; word-wrap: break-word; font-size: ${size === '58mm' ? '9px' : '11px'}; }
    .items-header td { font-weight: bold; font-size: ${size === '58mm' ? '9px' : '11px'}; border-bottom: 1px solid #000; padding-bottom: 2px; }
    .total-row td { font-size: ${totalSize}; font-weight: bold; padding: 3px 0; border-top: 1px solid #000; border-bottom: 1px solid #000; }
    .status-box { display: inline-block; border: 2px solid #000; padding: 3px 12px; font-weight: bold; font-size: ${size === '58mm' ? '11px' : '13px'}; letter-spacing: 1px; margin: 4px 0; }
    .footer { font-size: ${size === '58mm' ? '7px' : '9px'}; color: #555; margin-top: 6px; line-height: 1.4; }
    .cut-line { margin-top: 10px; border-top: 1px dashed #ccc; font-size: 8px; color: #aaa; text-align: center; padding-top: 2px; }
  </style>
</head>
<body>
  <div class="c">
    <div class="company">${company}</div>
    ${slogan ? `<div class="sub-info">${slogan}</div>` : ''}
    ${rnc ? `<div class="sub-info">RNC/Cedula: ${rnc}</div>` : ''}
    ${phone ? `<div class="sub-info">Tel: ${phone}</div>` : ''}
    ${address ? `<div class="sub-info">${address}</div>` : ''}
  </div>

  <hr class="sep">

  <div class="c">
    <div class="receipt-title">RECIBO DE PAGO</div>
    <div class="b">No. ${inv.id_factura}</div>
    <div class="sub-info">Zona: ${this.escape(inv.zona?.nombre || '-')}</div>
  </div>

  <hr class="sep">

  <table>
    <tr><td class="lbl">Cliente:</td><td>${this.escape(inv.cliente?.nombre || '-')}</td></tr>
    ${inv.cliente?.cedula ? `<tr><td class="lbl">Cedula:</td><td>${this.escape(inv.cliente.cedula)}</td></tr>` : ''}
    ${inv.cliente?.telefono ? `<tr><td class="lbl">Tel:</td><td>${this.escape(inv.cliente.telefono)}</td></tr>` : ''}
    ${inv.cliente?.direccion ? `<tr><td class="lbl">Dir:</td><td>${this.escape(inv.cliente.direccion)}</td></tr>` : ''}
  </table>

  <hr class="sep">

  <table>
    <tr><td class="lbl">Emision:</td><td>${this.formatDate(inv.fecha_emision)}</td></tr>
    <tr><td class="lbl">Vence:</td><td>${this.formatDate(inv.fecha_vencimiento)}</td></tr>
    ${inv.fecha_pago ? `<tr><td class="lbl">Pagado:</td><td>${this.formatDateTime(inv.fecha_pago)}</td></tr>` : ''}
    ${inv.forma_pago?.nombre ? `<tr><td class="lbl">Forma:</td><td>${this.escape(inv.forma_pago.nombre)}</td></tr>` : ''}
  </table>

  <hr class="sep">

  <table>
    <tr class="items-header">
      <td>Descripcion</td>
      <td class="r">Cant</td>
      <td class="r">Precio</td>
    </tr>
    ${articles}
  </table>

  <hr class="sep">

  <table>
    <tr><td>Subtotal:</td><td class="r">${this.money(inv.sub_total)}</td></tr>
    ${inv.descuento > 0 ? `<tr><td>Descuento:</td><td class="r">-${this.money(inv.descuento)}</td></tr>` : ''}
    ${inv.impuestos_total > 0 ? `<tr><td>ITBIS:</td><td class="r">${this.money(inv.impuestos_total)}</td></tr>` : ''}
  </table>

  <table>
    <tr class="total-row">
      <td>TOTAL</td>
      <td class="r">${this.money(inv.total)}</td>
    </tr>
  </table>

  ${(inv.total_cobrado || 0) > 0 ? `
  <table>
    <tr><td>Cobrado:</td><td class="r">${this.money(inv.total_cobrado)}</td></tr>
    <tr><td>Saldo:</td><td class="r b">${this.money(balance)}</td></tr>
  </table>` : ''}

  <hr class="sep">

  <div class="c">
    <div class="status-box">${this.statusText(inv)}</div>
  </div>

  <div class="c footer">
    ${inv.cajero ? `Atendido por: ${this.escape(inv.cajero.nombre)}<br>` : ''}
    Gracias por su pago<br>
    ${company}${phone ? ` | ${phone}` : ''}
  </div>

  <div class="cut-line">- - - - - cortar aqui - - - - -</div>

  ${printScript}
</body>
</html>`;
  }

  printCurrent() {
    const inv = this.currentInvoice();
    if (!inv) return;
    const html = this.generateHTML(inv, true);
    const features = this.printMode() === 'invoice'
      ? 'width=900,height=900'
      : `width=${this.paperSize() === '58mm' ? '280' : '350'},height=600`;
    const win = window.open('', '_blank', features);
    if (win) { win.document.write(html); win.document.close(); }
    this.previewVisible.set(false);
  }

  printDirect(inv: Invoice, mode: PrintMode = 'receipt') {
    this.printMode.set(mode);
    const html = this.generateHTML(inv, true);
    const features = mode === 'invoice'
      ? 'width=900,height=900'
      : `width=${this.paperSize() === '58mm' ? '280' : '350'},height=600`;
    const win = window.open('', '_blank', features);
    if (win) { win.document.write(html); win.document.close(); }
  }

  closePreview() {
    this.previewVisible.set(false);
    this.currentInvoice.set(null);
  }

  isInvoiceMode(): boolean {
    return this.printMode() === 'invoice';
  }

  private invoiceArticles(inv: Invoice): string {
    const articles = inv.articulos?.length ? inv.articulos : [];
    if (!articles.length) {
      return `<tr>
        <td><span class="desc">Servicio de Internet</span></td>
        <td class="r">1</td>
        <td class="r">${this.money(inv.total)}</td>
        <td class="r">${this.money(inv.total)}</td>
      </tr>`;
    }
    return articles.map((a) => {
      const price = this.parseMoney(a.precio);
      const qty = Number(a.cantidad || 0);
      return `<tr>
        <td><span class="desc">${this.escape(a.descripcion || 'Servicio de Internet')}</span><small>Servicio #${a.servicio?.id_servicio || '-'}</small></td>
        <td class="r">${qty}</td>
        <td class="r">${this.money(price)}</td>
        <td class="r">${this.money(price * qty)}</td>
      </tr>`;
    }).join('');
  }

  private receiptArticles(inv: Invoice): string {
    const size = this.paperSize();
    const max = size === '58mm' ? 54 : 78;
    const articles = inv.articulos?.length ? inv.articulos : [];
    if (!articles.length) {
      return `<tr>
        <td class="desc">Servicio de Internet</td>
        <td class="r">1</td>
        <td class="r">${this.money(inv.total).replace('RD$ ', '')}</td>
      </tr>`;
    }
    return articles.map((a) => {
      const desc = this.truncate(this.escape(a.descripcion || 'Servicio de Internet'), max);
      return `<tr>
        <td class="desc">${desc}</td>
        <td class="r">${a.cantidad}</td>
        <td class="r">${this.money(this.parseMoney(a.precio)).replace('RD$ ', '')}</td>
      </tr>`;
    }).join('');
  }

  private printScript(forPrint: boolean): string {
    return forPrint
      ? `<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}</script>`
      : '';
  }

  private isPaid(inv: Invoice): boolean {
    return (inv.estado || '').toLowerCase().includes('pagad');
  }

  private statusText(inv: Invoice): string {
    return (inv.estado || (this.isPaid(inv) ? 'Pagada' : 'Pendiente')).toUpperCase();
  }

  private balanceAmount(inv: Invoice): number {
    if (this.isPaid(inv)) return inv.saldo || 0;
    return inv.saldo || Math.max((inv.total || 0) - (inv.total_cobrado || 0), 0);
  }

  private money(value: number | string | null | undefined): string {
    const amount = typeof value === 'string' ? this.parseMoney(value) : Number(value || 0);
    return `RD$ ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private parseMoney(value: string | number | null | undefined): number {
    if (typeof value === 'number') return value;
    const parsed = parseFloat(String(value || '0').replace(/,/g, ''));
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private formatDate(value: string | null | undefined): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return this.escape(value);
    return date.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  private formatDateTime(value: string | null | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return this.escape(value);
    return date.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  private initials(value: string): string {
    return value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'W';
  }

  private truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
  }

  private escape(value: string | number | null | undefined): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
