import { Component, inject, input, output, signal, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WisphubService } from '../../services/wisphub.service';
import { ToastService } from '../../services/toast.service';
import { DbService } from '../../services/db.service';
import { Invoice } from '../../models/invoice.model';
import { DecimalPipe } from '@angular/common';

@Component({
  selector: 'app-payment-modal',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  template: `
    @if (visible()) {
      <div class="overlay" (click)="close()"></div>
      <div class="modal">
        <div class="modal-header">
          <h3>Registrar Pago</h3>
          <button class="close-btn" (click)="close()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        @if (invoice()) {
          <div class="modal-body">
            <div class="invoice-info">
              <div class="ii-row"><span>Factura:</span><strong>#{{ invoice()!.id_factura }}</strong></div>
              <div class="ii-row"><span>Cliente:</span><strong>{{ invoice()!.cliente?.nombre }}</strong></div>
              <div class="ii-row"><span>Emision:</span><strong>{{ invoice()!.fecha_emision }}</strong></div>
              <div class="ii-row"><span>Vencimiento:</span><strong>{{ invoice()!.fecha_vencimiento }}</strong></div>
              <div class="ii-row total"><span>Total:</span><strong>RD$ {{ invoice()!.total | number:'1.2-2' }}</strong></div>
            </div>

            <div class="form-group">
              <label>Forma de Pago</label>
              <div class="payment-methods">
                <button [class.active]="formaPago === 2405" (click)="formaPago = 2405">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
                  Efectivo
                </button>
                <button [class.active]="formaPago === 2406" (click)="formaPago = 2406">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                  Transferencia
                </button>
                <button [class.active]="formaPago === 2897" (click)="formaPago = 2897">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                  Saldo a Favor
                </button>
              </div>
            </div>

            <div class="form-group">
              <label>Monto Cobrado</label>
              <input type="number" [(ngModel)]="totalCobrado" class="form-input big-input" step="0.01" />
              <div class="amount-hint">
                <button class="hint-btn" (click)="totalCobrado = invoice()!.total">Total exacto</button>
                <button class="hint-btn" (click)="totalCobrado = invoice()!.total + 100">+ RD$100</button>
                <button class="hint-btn" (click)="totalCobrado = invoice()!.total + 500">+ RD$500</button>
              </div>
            </div>

            <div class="form-group">
              <label>Fecha de Pago</label>
              <input type="datetime-local" [(ngModel)]="fechaPago" class="form-input" />
            </div>

            <div class="modal-actions">
              <button class="btn btn-outline" (click)="close()">Cancelar</button>
              <button class="btn btn-green" (click)="register()" [disabled]="saving()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                {{ saving() ? 'Procesando...' : 'Registrar Pago RD$ ' + totalCobrado }}
              </button>
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      z-index: 1000; backdrop-filter: blur(2px);
    }
    .modal {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: white; border-radius: 16px; width: 480px; max-width: 95vw;
      max-height: 92vh; overflow-y: auto; z-index: 1001;
      box-shadow: 0 25px 60px rgba(0,0,0,0.3);
      animation: slideUp 0.25s ease;
    }
    @keyframes slideUp { from { transform: translate(-50%, -45%); opacity: 0; } to { transform: translate(-50%, -50%); opacity: 1; } }

    .modal-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 18px 24px; border-bottom: 1px solid #e2e8f0;
    }
    .modal-header h3 { margin: 0; font-size: 17px; font-weight: 600; color: #0f172a; }
    .close-btn { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 4px; border-radius: 8px; }
    .close-btn:hover { background: #f1f5f9; color: #0f172a; }

    .modal-body { padding: 20px 24px 24px; }

    .invoice-info {
      background: #f8fafc; border-radius: 10px; padding: 14px 16px;
      margin-bottom: 20px;
    }
    .ii-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
    .ii-row span { color: #64748b; }
    .ii-row strong { color: #0f172a; }
    .ii-row.total { font-size: 18px; padding-top: 8px; margin-top: 4px; border-top: 1px solid #e2e8f0; }
    .ii-row.total strong { color: #6366f1; font-size: 22px; font-weight: 800; }

    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.3px; }

    .payment-methods { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
    .payment-methods button {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 14px 8px; border: 2px solid #e2e8f0; border-radius: 10px;
      background: white; font-size: 12px; font-weight: 500; color: #475569;
      cursor: pointer; transition: all 0.2s;
    }
    .payment-methods button:hover { border-color: #6366f1; }
    .payment-methods button.active { border-color: #6366f1; background: #eef2ff; color: #6366f1; }

    .form-input {
      width: 100%; padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 10px;
      font-size: 14px; color: #0f172a; outline: none; box-sizing: border-box;
    }
    .big-input { font-size: 24px; font-weight: 700; text-align: center; }
    .form-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }

    .amount-hint { display: flex; gap: 6px; margin-top: 8px; }
    .hint-btn { flex: 1; padding: 6px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; font-size: 11px; color: #475569; cursor: pointer; }
    .hint-btn:hover { background: #6366f1; color: white; }

    .modal-actions { display: flex; gap: 10px; margin-top: 24px; }
    .btn {
      flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 12px 20px; border-radius: 10px; font-size: 14px; font-weight: 600;
      cursor: pointer; border: none; transition: all 0.2s;
    }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }
    .btn-outline:hover { background: #f1f5f9; }
    .btn-green { background: #22c55e; color: white; }
    .btn-green:hover { background: #16a34a; }
    .btn-green:disabled { opacity: 0.6; cursor: not-allowed; }

    @media (max-width: 640px) {
      .modal { width: 95vw; }
      .payment-methods { grid-template-columns: 1fr; }
      .modal-actions { flex-direction: column; }
    }
  `]
})
export class PaymentModalComponent implements OnChanges {
  visible = input(false);
  invoice = input<Invoice | null>(null);
  onClose = output<void>();
  onSuccess = output<void>();

  private api = inject(WisphubService);
  private toast = inject(ToastService);
  private db = inject(DbService);

  formaPago = 2405; // Efectivo por default
  totalCobrado = 0;
  fechaPago = '';
  saving = signal(false);

  ngOnChanges(changes: SimpleChanges) {
    if (changes['invoice'] && this.invoice()) {
      this.totalCobrado = this.invoice()!.total || 0;
      const now = new Date();
      this.fechaPago = now.toISOString().slice(0, 16);
    }
  }

  close() {
    this.onClose.emit();
  }

  register() {
    const inv = this.invoice();
    if (!inv) return;
    if (!this.totalCobrado || this.totalCobrado < 0) {
      this.toast.error('Monto invalido');
      return;
    }

    this.saving.set(true);
    const fechaFmt = this.fechaPago.replace('T', ' ');

    const paymentMethods: any = { 2405: 'Efectivo', 2406: 'Transferencia', 2897: 'Saldo a Favor' };

    this.api.registerPayment(inv.id_factura, this.formaPago, this.totalCobrado, fechaFmt).subscribe({
      next: () => {
        // Log payment in local DB
        this.db.logPayment({
          idFactura: inv.id_factura,
          idServicio: inv.articulos?.[0]?.servicio?.id_servicio,
          clientName: inv.cliente?.nombre || 'N/A',
          amount: this.totalCobrado,
          paymentMethodId: this.formaPago,
          paymentMethodName: paymentMethods[this.formaPago],
          paidAt: new Date(this.fechaPago).toISOString(),
          success: true,
        }).subscribe({ error: () => {} });

        // Log activity
        this.db.logActivity({
          action: 'payment',
          entityType: 'invoice',
          entityId: String(inv.id_factura),
          entityName: `Factura #${inv.id_factura} - ${inv.cliente?.nombre}`,
          details: `Pago de RD$ ${this.totalCobrado} via ${paymentMethods[this.formaPago]}`,
        }).subscribe({ error: () => {} });

        this.saving.set(false);
        this.toast.success(`Pago de RD$ ${this.totalCobrado} registrado correctamente`);
        this.onSuccess.emit();
        this.close();
      },
      error: (e) => {
        // Log failed attempt too
        this.db.logPayment({
          idFactura: inv.id_factura,
          clientName: inv.cliente?.nombre || 'N/A',
          amount: this.totalCobrado,
          paymentMethodId: this.formaPago,
          paymentMethodName: paymentMethods[this.formaPago],
          paidAt: new Date(this.fechaPago).toISOString(),
          success: false,
          errorMessage: JSON.stringify(e.error)?.substring(0, 500),
        }).subscribe({ error: () => {} });

        this.saving.set(false);
        const detail = e.error?.detail || e.error?.errors?.[0] || JSON.stringify(e.error);
        this.toast.error('Error: ' + detail);
      }
    });
  }
}
