import { Injectable, inject, signal } from '@angular/core';
import { ConfigService } from './config.service';
import { Invoice } from '../models/invoice.model';

export type PaperSize = '58mm' | '80mm';

@Injectable({ providedIn: 'root' })
export class ReceiptService {
  private cfg = inject(ConfigService);

  // Preview state
  previewVisible = signal(false);
  previewHTML = signal('');
  currentInvoice = signal<Invoice | null>(null);
  paperSize = signal<PaperSize>('80mm');

  private get paperWidth(): string {
    return this.paperSize() === '58mm' ? '48mm' : '72mm';
  }

  private get maxWidth(): string {
    return this.paperSize() === '58mm' ? '210px' : '300px';
  }

  private get fontSize(): string {
    return this.paperSize() === '58mm' ? '10px' : '12px';
  }

  private get titleSize(): string {
    return this.paperSize() === '58mm' ? '14px' : '18px';
  }

  private get totalSize(): string {
    return this.paperSize() === '58mm' ? '13px' : '16px';
  }

  generateHTML(inv: Invoice, forPrint = false): string {
    const c = this.cfg;
    const company = c.companyName();
    const slogan = c.companySlogan();
    const phone = c.companyPhone();
    const address = c.companyAddress();
    const rnc = c.rnc();
    const size = this.paperSize();
    const pw = this.paperWidth;
    const mw = this.maxWidth;
    const fs = this.fontSize;
    const ts = this.titleSize;
    const tots = this.totalSize;

    // Clean article descriptions for thermal
    const articulos = (inv.articulos || []).map(a => {
      let desc = a.descripcion?.replace(/\r\n/g, ' ').replace(/\n/g, ' ') || 'Servicio de Internet';
      // Simplify long descriptions for thermal
      if (desc.length > 60 && size === '58mm') desc = desc.substring(0, 57) + '...';
      if (desc.length > 80 && size === '80mm') desc = desc.substring(0, 77) + '...';
      return `<tr>
        <td class="desc">${desc}</td>
        <td class="r">${a.cantidad}</td>
        <td class="r">RD$${parseFloat(a.precio).toFixed(2)}</td>
      </tr>`;
    }).join('');

    const fechaPago = inv.fecha_pago
      ? new Date(inv.fecha_pago).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '-';

    const printScript = forPrint
      ? `<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}</script>`
      : '';

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Recibo #${inv.id_factura}</title>
  <style>
    @page {
      size: ${size} auto;
      margin: 2mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', 'Lucida Console', monospace;
      font-size: ${fs};
      color: #000;
      width: ${mw};
      max-width: ${mw};
      margin: 0 auto;
      padding: 4px;
      line-height: 1.3;
      -webkit-print-color-adjust: exact;
    }

    .c { text-align: center; }
    .r { text-align: right; }
    .b { font-weight: bold; }

    .company { font-size: ${ts}; font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
    .sub-info { font-size: ${size === '58mm' ? '8px' : '10px'}; color: #333; }

    .sep {
      border: none;
      border-top: 1px dashed #000;
      margin: 5px 0;
    }
    .sep-double {
      border: none;
      border-top: 2px solid #000;
      margin: 5px 0;
    }

    .receipt-title {
      font-size: ${size === '58mm' ? '11px' : '13px'};
      font-weight: bold;
      letter-spacing: 0.5px;
    }

    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; vertical-align: top; font-size: ${fs}; }
    .lbl { width: ${size === '58mm' ? '70px' : '90px'}; font-weight: bold; }
    .desc { max-width: ${size === '58mm' ? '120px' : '170px'}; word-wrap: break-word; font-size: ${size === '58mm' ? '9px' : '11px'}; }

    .items-header {
      font-weight: bold;
      font-size: ${size === '58mm' ? '9px' : '11px'};
      border-bottom: 1px solid #000;
      padding-bottom: 2px;
      margin-bottom: 2px;
    }

    .total-row td {
      font-size: ${tots};
      font-weight: bold;
      padding: 3px 0;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
    }

    .status-box {
      display: inline-block;
      border: 2px solid #000;
      padding: 3px 12px;
      font-weight: bold;
      font-size: ${size === '58mm' ? '11px' : '13px'};
      letter-spacing: 1px;
      margin: 4px 0;
    }

    .footer {
      font-size: ${size === '58mm' ? '7px' : '9px'};
      color: #555;
      margin-top: 6px;
      line-height: 1.4;
    }

    .cut-line {
      margin-top: 10px;
      border-top: 1px dashed #ccc;
      font-size: 8px;
      color: #ccc;
      text-align: center;
      padding-top: 2px;
    }
  </style>
</head>
<body>

  <!-- HEADER -->
  <div class="c">
    <div class="company">${company}</div>
    ${slogan ? `<div class="sub-info">${slogan}</div>` : ''}
    ${rnc ? `<div class="sub-info">RNC: ${rnc}</div>` : ''}
    ${phone ? `<div class="sub-info">Tel: ${phone}</div>` : ''}
    ${address ? `<div class="sub-info">${address}</div>` : ''}
  </div>

  <hr class="sep">

  <!-- TITULO -->
  <div class="c">
    <div class="receipt-title">RECIBO DE PAGO</div>
    <div class="b">No. ${inv.id_factura}</div>
    <div class="sub-info">Zona: ${inv.zona?.nombre || '-'}</div>
  </div>

  <hr class="sep">

  <!-- DATOS CLIENTE -->
  <table>
    <tr><td class="lbl">Cliente:</td><td>${inv.cliente?.nombre || '-'}</td></tr>
    ${inv.cliente?.cedula ? `<tr><td class="lbl">Cedula:</td><td>${inv.cliente.cedula}</td></tr>` : ''}
    ${inv.cliente?.telefono ? `<tr><td class="lbl">Tel:</td><td>${inv.cliente.telefono}</td></tr>` : ''}
    ${inv.cliente?.direccion ? `<tr><td class="lbl">Dir:</td><td>${inv.cliente.direccion}</td></tr>` : ''}
  </table>

  <hr class="sep">

  <!-- FECHAS -->
  <table>
    <tr><td class="lbl">Emision:</td><td>${inv.fecha_emision}</td></tr>
    <tr><td class="lbl">Vence:</td><td>${inv.fecha_vencimiento}</td></tr>
    ${inv.fecha_pago ? `<tr><td class="lbl">Pagado:</td><td>${fechaPago}</td></tr>` : ''}
    ${inv.forma_pago?.nombre ? `<tr><td class="lbl">Forma:</td><td>${inv.forma_pago.nombre}</td></tr>` : ''}
  </table>

  <hr class="sep">

  <!-- DETALLE ARTICULOS -->
  <table>
    <tr class="items-header">
      <td>Descripcion</td>
      <td class="r">Cant</td>
      <td class="r">Precio</td>
    </tr>
    ${articulos}
  </table>

  <hr class="sep">

  <!-- TOTALES -->
  <table>
    <tr><td>Subtotal:</td><td class="r">RD$${(inv.sub_total || 0).toFixed(2)}</td></tr>
    ${inv.descuento > 0 ? `<tr><td>Descuento:</td><td class="r">-RD$${inv.descuento.toFixed(2)}</td></tr>` : ''}
    ${inv.impuestos_total > 0 ? `<tr><td>ITBIS:</td><td class="r">RD$${inv.impuestos_total.toFixed(2)}</td></tr>` : ''}
  </table>

  <table>
    <tr class="total-row">
      <td>TOTAL</td>
      <td class="r">RD$ ${(inv.total || 0).toFixed(2)}</td>
    </tr>
  </table>

  ${inv.total_cobrado > 0 && inv.total_cobrado !== inv.total ? `
  <table>
    <tr><td>Cobrado:</td><td class="r">RD$${inv.total_cobrado.toFixed(2)}</td></tr>
    <tr><td>Saldo:</td><td class="r b">RD$${(inv.saldo || 0).toFixed(2)}</td></tr>
  </table>` : ''}

  <hr class="sep">

  <!-- ESTADO -->
  <div class="c">
    <div class="status-box">${inv.estado?.toUpperCase() || 'PENDIENTE'}</div>
  </div>

  <!-- PIE -->
  <div class="c footer">
    ${inv.cajero ? `Atendido por: ${inv.cajero.nombre}<br>` : ''}
    Gracias por su pago<br>
    ${company}${phone ? ' | ' + phone : ''}
  </div>

  <div class="cut-line">- - - - - cortar aqui - - - - -</div>

  ${printScript}
</body>
</html>`;
  }

  openPreview(inv: Invoice) {
    this.currentInvoice.set(inv);
    this.previewHTML.set(this.generateHTML(inv, false));
    this.previewVisible.set(true);
  }

  updatePreview() {
    const inv = this.currentInvoice();
    if (inv) this.previewHTML.set(this.generateHTML(inv, false));
  }

  printCurrent() {
    const inv = this.currentInvoice();
    if (!inv) return;
    const html = this.generateHTML(inv, true);
    const win = window.open('', '_blank', `width=${this.paperSize() === '58mm' ? '280' : '350'},height=600`);
    if (win) { win.document.write(html); win.document.close(); }
    this.previewVisible.set(false);
  }

  printDirect(inv: Invoice) {
    const html = this.generateHTML(inv, true);
    const win = window.open('', '_blank', `width=${this.paperSize() === '58mm' ? '280' : '350'},height=600`);
    if (win) { win.document.write(html); win.document.close(); }
  }

  closePreview() {
    this.previewVisible.set(false);
    this.currentInvoice.set(null);
  }
}
