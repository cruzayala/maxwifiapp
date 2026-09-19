import { Component, HostListener, computed, inject } from '@angular/core';
import { ReceiptService, PaperSize } from '../../services/receipt.service';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { LucidePrinter, LucideX } from '@lucide/angular';

@Component({
  selector: 'app-receipt-preview',
  standalone: true,
  imports: [FormsModule, LucidePrinter, LucideX],
  template: `
    @if (receipt.previewVisible()) {
      <div class="overlay" (click)="receipt.closePreview()"></div>
      <div class="preview-panel" [class.invoice-mode]="receipt.isInvoiceMode()" role="dialog" aria-modal="true" aria-labelledby="receipt-preview-title">
        <div class="preview-header">
          <div>
            <h3 id="receipt-preview-title">{{ receipt.isInvoiceMode() ? 'Vista previa de factura' : 'Vista previa de recibo' }}</h3>
            @if (receipt.currentInvoice(); as inv) {
              <p>Factura #{{ inv.id_factura }}@if (inv.cliente?.nombre) { · {{ inv.cliente?.nombre }} }</p>
            }
          </div>
          <button type="button" class="close-btn" (click)="receipt.closePreview()" aria-label="Cerrar vista previa" title="Cerrar (Esc)">
            <svg lucideX size="20"></svg>
          </button>
        </div>

        <div class="preview-controls">
          <div class="control-group">
            <span class="control-label">{{ receipt.isInvoiceMode() ? 'Formato' : 'Tamaño de papel' }}</span>
            @if (receipt.isInvoiceMode()) {
              <div class="format-pill">Carta / A4</div>
            } @else {
              <div class="paper-toggle" role="group" aria-label="Tamaño de papel">
                <button type="button" [class.active]="receipt.paperSize() === '58mm'" [attr.aria-pressed]="receipt.paperSize() === '58mm'" (click)="setPaper('58mm')" title="Impresora térmica pequeña">58 mm</button>
                <button type="button" [class.active]="receipt.paperSize() === '80mm'" [attr.aria-pressed]="receipt.paperSize() === '80mm'" (click)="setPaper('80mm')" title="Impresora térmica estándar">80 mm</button>
              </div>
            }
          </div>
          <div class="control-actions">
            <button type="button" class="btn btn-outline" (click)="receipt.closePreview()">Cerrar</button>
            <button type="button" class="btn btn-primary" (click)="receipt.printCurrent()" [disabled]="!receipt.currentInvoice()">
              <svg lucidePrinter size="16"></svg>
              Imprimir
            </button>
          </div>
        </div>

        <div class="preview-body" [class.invoice-body]="receipt.isInvoiceMode()">
          <div
            class="paper-simulation"
            [class.paper-invoice]="receipt.isInvoiceMode()"
            [class.paper-58mm]="!receipt.isInvoiceMode() && receipt.paperSize() === '58mm'"
            [class.paper-80mm]="!receipt.isInvoiceMode() && receipt.paperSize() === '80mm'">
            <iframe class="preview-frame" [srcdoc]="safePreviewHTML()" title="Vista previa de impresión"></iframe>
          </div>
        </div>

        <div class="preview-footer">
          <span class="paper-info">
            {{ receipt.isInvoiceMode() ? 'Factura tamaño carta / A4' : 'Recibo de ' + receipt.paperSize().replace('mm', ' mm') }}
            · Se abrirá una ventana nueva para imprimir.
          </span>
        </div>
      </div>
    }
  `,
  styles: [`
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(17, 26, 36, 0.5);
      backdrop-filter: blur(2px);
    }

    .preview-panel {
      position: fixed;
      top: 50%;
      left: 50%;
      z-index: 1001;
      display: flex;
      flex-direction: column;
      width: 480px;
      max-width: 95vw;
      max-height: 92vh;
      overflow: hidden;
      background: #fff;
      border: 1px solid #dfe5ea;
      border-radius: 8px;
      box-shadow: 0 24px 60px rgba(17, 26, 36, 0.28);
      transform: translate(-50%, -50%);
      animation: slideUp 0.2s ease;
    }
    .preview-panel.invoice-mode { width: min(980px, 96vw); }

    @keyframes slideUp {
      from { transform: translate(-50%, -47%); opacity: 0; }
      to { transform: translate(-50%, -50%); opacity: 1; }
    }

    .preview-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid #dfe5ea;
    }
    .preview-header > div { min-width: 0; }
    .preview-header h3 { margin: 0; color: #172535; font-size: 16px; font-weight: 700; }
    .preview-header p { margin: 2px 0 0; overflow: hidden; color: #667582; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .close-btn {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 34px;
      height: 34px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 6px;
      background: none;
      color: #667582;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .close-btn:hover { background: #f1f4f6; color: #172535; }

    .preview-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      padding: 10px 18px;
      border-bottom: 1px solid #dfe5ea;
      background: #f8fafc;
    }
    .control-group { display: flex; align-items: center; gap: 10px; }
    .control-label { color: #667582; font-size: 12px; font-weight: 600; }

    .paper-toggle {
      display: flex;
      overflow: hidden;
      border: 1px solid #ccd6de;
      border-radius: 6px;
      background: #fff;
    }
    .paper-toggle button {
      padding: 6px 14px;
      border: none;
      background: none;
      color: #334250;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .paper-toggle button + button { border-left: 1px solid #ccd6de; }
    .paper-toggle button:hover:not(.active) { background: #f2f7ff; }
    .paper-toggle button.active { background: #1267dd; color: #fff; }
    .format-pill {
      display: inline-flex;
      align-items: center;
      padding: 5px 12px;
      border-radius: 6px;
      background: #edf4ff;
      color: #1267dd;
      font-size: 13px;
      font-weight: 700;
    }

    .control-actions { display: flex; gap: 8px; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 36px;
      padding: 0 16px;
      border: 1px solid transparent;
      border-radius: 6px;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-primary { background: #1267dd; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #0d58c0; }
    .btn-outline { background: #fff; border-color: #ccd6de; color: #334250; }
    .btn-outline:hover { border-color: #667582; color: #172535; }

    .preview-body {
      display: flex;
      flex: 1;
      justify-content: center;
      overflow: auto;
      padding: 20px;
      background: #e9eef2;
    }
    .preview-body.invoice-body { align-items: flex-start; }
    .paper-simulation {
      min-height: 400px;
      padding: 4px;
      border-radius: 2px;
      background: #fff;
      box-shadow: 0 4px 18px rgba(17, 26, 36, 0.14);
    }
    .preview-frame {
      display: block;
      width: 100%;
      border: 0;
      background: #fff;
    }
    .paper-58mm { width: 220px; }
    .paper-58mm .preview-frame { height: 720px; }
    .paper-80mm { width: 310px; }
    .paper-80mm .preview-frame { height: 760px; }
    .paper-invoice {
      width: 794px;
      min-height: 1123px;
      padding: 0;
      transform-origin: top center;
    }
    .paper-invoice .preview-frame { height: 1123px; }

    .preview-footer {
      padding: 9px 18px;
      border-top: 1px solid #dfe5ea;
    }
    .paper-info { color: #667582; font-size: 11px; }

    @media (max-width: 860px) {
      .paper-invoice { transform: scale(0.72); margin-bottom: -300px; }
      .preview-body.invoice-body { justify-content: flex-start; }
    }
    @media (max-width: 640px) {
      .preview-header, .preview-controls, .preview-footer { padding-inline: 14px; }
      .preview-controls, .control-actions { width: 100%; }
      .control-actions .btn { flex: 1; }
      .paper-invoice { transform: scale(0.52); margin-bottom: -520px; }
    }
    @media (prefers-reduced-motion: reduce) { .preview-panel { animation: none; } }
  `]
})
export class ReceiptPreviewComponent {
  receipt = inject(ReceiptService);
  private sanitizer = inject(DomSanitizer);

  /** Se memoriza para no recargar el iframe en cada ciclo de detección de cambios. */
  private safePreview = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.receipt.previewHTML()));

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.receipt.previewVisible()) this.receipt.closePreview();
  }

  setPaper(size: PaperSize) {
    this.receipt.paperSize.set(size);
    this.receipt.updatePreview();
  }

  safePreviewHTML(): SafeHtml {
    return this.safePreview();
  }
}
