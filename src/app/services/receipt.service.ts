import { InvoiceRenderer } from '../../../shared/invoice-renderer';
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
    return this.renderer().generateInvoiceHTML(inv, forPrint);
  }

  generateReceiptHTML(inv: Invoice, forPrint = false): string {
    return this.renderer().generateReceiptHTML(inv, forPrint);
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

  printBatch(invoices: Invoice[], mode: PrintMode = 'invoice') {
    if (!invoices.length) return;
    const documents = invoices.map((invoice) => this.generateDocumentParts(invoice, mode));
    const style = documents[0].style;
    const pages = documents.map((document) => `<section class="batch-document">${document.body}</section>`).join('');
    const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${mode === 'invoice' ? 'Facturas' : 'Recibos'} (${invoices.length})</title>
  <style>${style}
    .batch-document { break-after: page; page-break-after: always; }
    .batch-document:last-child { break-after: auto; page-break-after: auto; }
    @media print { body { background: white; } }
  </style>
</head>
<body>${pages}<script>window.onload=function(){window.print();}</script></body>
</html>`;
    const features = mode === 'invoice' ? 'width=1000,height=900' : 'width=420,height=800';
    const win = window.open('', '_blank', features);
    if (win) { win.document.write(html); win.document.close(); }
  }

  closePreview() {
    this.previewVisible.set(false);
    this.currentInvoice.set(null);
  }

  private generateDocumentParts(invoice: Invoice, mode: PrintMode): { style: string; body: string } {
    const html = mode === 'invoice'
      ? this.generateInvoiceHTML(invoice, false)
      : this.generateReceiptHTML(invoice, false);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return {
      style: Array.from(parsed.head.querySelectorAll('style')).map((node) => node.textContent || '').join('\n'),
      body: parsed.body.innerHTML,
    };
  }

  isInvoiceMode(): boolean {
    return this.printMode() === 'invoice';
  }

  private renderer(): InvoiceRenderer {
    return new InvoiceRenderer({
      companyName: this.cfg.companyName(), companySlogan: this.cfg.companySlogan(),
      companyPhone: this.cfg.companyPhone(), companyAddress: this.cfg.companyAddress(), rnc: this.cfg.rnc(),
    }, this.paperSize());
  }
}
