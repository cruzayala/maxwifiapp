import { Component, inject } from '@angular/core';
import { ReceiptService, PaperSize } from '../../services/receipt.service';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-receipt-preview',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (receipt.previewVisible()) {
      <div class="overlay" (click)="receipt.closePreview()"></div>
      <div class="preview-panel" [class.invoice-mode]="receipt.isInvoiceMode()">
        <div class="preview-header">
          <h3>{{ receipt.isInvoiceMode() ? 'Vista previa de Factura' : 'Vista previa de Recibo' }}</h3>
          <button class="close-btn" (click)="receipt.closePreview()" aria-label="Cerrar vista previa">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="preview-controls">
          <div class="control-group">
            <label>{{ receipt.isInvoiceMode() ? 'Formato:' : 'Tamano de papel:' }}</label>
            @if (receipt.isInvoiceMode()) {
              <div class="format-pill">Carta / A4</div>
            } @else {
              <div class="paper-toggle">
                <button [class.active]="receipt.paperSize() === '58mm'" (click)="setPaper('58mm')">58mm</button>
                <button [class.active]="receipt.paperSize() === '80mm'" (click)="setPaper('80mm')">80mm</button>
              </div>
            }
          </div>
          <div class="control-actions">
            <button class="btn btn-primary" (click)="receipt.printCurrent()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Imprimir
            </button>
            <button class="btn btn-outline" (click)="receipt.closePreview()">Cerrar</button>
          </div>
        </div>

        <div class="preview-body" [class.invoice-body]="receipt.isInvoiceMode()">
          <div
            class="paper-simulation"
            [class.paper-invoice]="receipt.isInvoiceMode()"
            [class.paper-58mm]="!receipt.isInvoiceMode() && receipt.paperSize() === '58mm'"
            [class.paper-80mm]="!receipt.isInvoiceMode() && receipt.paperSize() === '80mm'">
            <iframe class="preview-frame" [srcdoc]="safePreviewHTML()" title="Vista previa de impresion"></iframe>
          </div>
        </div>

        <div class="preview-footer">
          <span class="paper-info">
            {{ receipt.isInvoiceMode() ? 'Factura Carta/A4' : 'Recibo ' + receipt.paperSize() }} |
            Factura #{{ receipt.currentInvoice()?.id_factura }} |
            {{ receipt.currentInvoice()?.cliente?.nombre }}
          </span>
        </div>
      </div>
    }
  `,
  styles: [`
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      backdrop-filter: blur(2px);
    }

    .preview-panel {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 480px;
      max-width: 95vw;
      max-height: 92vh;
      background: #1e293b;
      border-radius: 20px;
      z-index: 1001;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.4);
      animation: slideUp 0.25s ease;
    }
    .preview-panel.invoice-mode { width: min(980px, 96vw); }

    @keyframes slideUp {
      from { transform: translate(-50%, -45%); opacity: 0; }
      to { transform: translate(-50%, -50%); opacity: 1; }
    }

    .preview-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 24px;
      border-bottom: 1px solid #334155;
    }
    .preview-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: #f8fafc;
    }
    .close-btn {
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 4px;
      border-radius: 8px;
      transition: all 0.2s;
    }
    .close-btn:hover { color: white; background: #334155; }

    .preview-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 24px;
      border-bottom: 1px solid #334155;
      gap: 12px;
      flex-wrap: wrap;
    }
    .control-group { display: flex; align-items: center; gap: 10px; }
    .control-group label { font-size: 13px; color: #94a3b8; font-weight: 500; }

    .paper-toggle {
      display: flex;
      background: #0f172a;
      border-radius: 8px;
      overflow: hidden;
    }
    .paper-toggle button {
      padding: 6px 16px;
      border: none;
      background: none;
      color: #94a3b8;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .paper-toggle button.active { background: #6366f1; color: white; }
    .format-pill {
      display: inline-flex;
      align-items: center;
      padding: 6px 14px;
      border-radius: 999px;
      background: #0f172a;
      color: #e2e8f0;
      font-size: 13px;
      font-weight: 700;
    }

    .control-actions { display: flex; gap: 8px; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-outline { background: transparent; border: 1px solid #475569; color: #94a3b8; }
    .btn-outline:hover { border-color: #94a3b8; color: white; }

    .preview-body {
      flex: 1;
      overflow: auto;
      padding: 24px;
      display: flex;
      justify-content: center;
      background: #0f172a;
    }
    .preview-body.invoice-body { align-items: flex-start; }
    .paper-simulation {
      background: white;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      padding: 4px;
      border-radius: 2px;
      min-height: 400px;
    }
    .preview-frame {
      display: block;
      width: 100%;
      border: 0;
      background: white;
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
      padding: 10px 24px;
      border-top: 1px solid #334155;
    }
    .paper-info { font-size: 11px; color: #64748b; }

    @media (max-width: 860px) {
      .paper-invoice { transform: scale(0.72); margin-bottom: -300px; }
      .preview-body.invoice-body { justify-content: flex-start; }
    }
    @media (max-width: 640px) {
      .preview-controls, .control-actions { width: 100%; }
      .control-actions .btn { flex: 1; justify-content: center; }
      .paper-invoice { transform: scale(0.52); margin-bottom: -520px; }
    }
  `]
})
export class ReceiptPreviewComponent {
  receipt = inject(ReceiptService);
  private sanitizer = inject(DomSanitizer);

  setPaper(size: PaperSize) {
    this.receipt.paperSize.set(size);
    this.receipt.updatePreview();
  }

  safePreviewHTML(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.receipt.previewHTML());
  }
}
