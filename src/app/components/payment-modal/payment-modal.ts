import { Component, HostListener, inject, input, output, signal, OnChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { LucideCircleAlert, LucideCircleCheck, LucideX } from '@lucide/angular';
import { WisphubService } from '../../services/wisphub.service';
import { ToastService } from '../../services/toast.service';
import { Invoice } from '../../models/invoice.model';

@Component({
  selector: 'app-payment-modal', standalone: true, imports: [FormsModule, DecimalPipe, LucideCircleAlert, LucideCircleCheck, LucideX],
  template: `
    @if (visible()) {
      <div class="overlay" (click)="close()"></div>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="payment-title">
        <header>
          <div><small>Registrar pago</small><h3 id="payment-title">Factura #{{ invoice()?.id_factura }}</h3>@if (invoice()?.cliente?.nombre) { <p class="client-name">{{ invoice()?.cliente?.nombre }}</p> }</div>
          <button type="button" class="close-btn" (click)="close()" aria-label="Cerrar" [title]="saving() ? 'Espere a que termine la operación' : 'Cerrar'" [disabled]="saving()"><svg lucideX size="18"></svg></button>
        </header>
        <main>
          @if (message()) { <p class="notice" role="status">{{ message() }}</p> }
          @if (operation()) {
            <div class="result" [class.ok]="operation()!.ok" [class.bad]="!operation()!.ok && operation()!.state === 'rejected'">
              @if (operation()!.ok) { <svg lucideCircleCheck size="20"></svg> } @else { <svg lucideCircleAlert size="20"></svg> }
              <div>
                <h4>{{ operation()!.ok ? 'Pago confirmado' : operation()!.state === 'rejected' ? 'Solicitud rechazada' : 'Pago pendiente de verificación' }}</h4>
                <p>RD$ {{ operation()!.amount | number:'1.2-2' }} · {{ operation()!.paymentMethodName }}</p>
              </div>
            </div>
            @if (!operation()!.ok) { <p>{{ operation()!.state === 'confirmed_external' ? 'WispHub confirmó el pago. Falta verificar los importes de la factura.' : 'No se enviará otro cobro. Consulte el estado antes de continuar.' }}</p> }
            @if (operation()!.canVerify) { <button class="primary" (click)="verify()" [disabled]="saving()">{{ saving() ? 'Consultando…' : 'Verificar pago' }}</button> }
            @if (operation()!.ok || operation()!.state === 'rejected' && !operation()!.canVerify) { <button (click)="load(true)" [disabled]="saving()">Consultar saldo restante</button> }
          } @else if (version && !attempted) {
            <div class="balance"><span>Saldo pendiente según WispHub</span><strong>RD$ {{ balance | number:'1.2-2' }}</strong></div>
            <label>Forma de pago<select [(ngModel)]="formaPago" [disabled]="saving()"><option [ngValue]="0">Seleccione una forma de pago</option>@for (method of methods; track method.id) { <option [ngValue]="method.id">{{ method.nombre }}</option> }</select></label>
            <label>Monto recibido (RD$)<input type="number" inputmode="decimal" [(ngModel)]="totalCobrado" min="0.01" [max]="balance" step="0.01" [disabled]="saving()" [class.invalid]="!!amountError()" /></label>
            @if (amountError(); as err) { <p class="field-error">{{ err }}</p> }
            @else if (totalCobrado > 0 && totalCobrado < balance) { <p class="field-note">Pago parcial: quedarán RD$ {{ balance - totalCobrado | number:'1.2-2' }} pendientes.</p> }
            <label>Fecha del pago<input type="datetime-local" [(ngModel)]="fechaPago" [disabled]="saving()" /></label>
            <button class="primary" (click)="confirmRegister()" [disabled]="saving() || formaPago === 0 || balance <= 0 || !!amountError()">Registrar pago</button>
            @if (!saving() && disabledReason(); as reason) { <p class="field-note">{{ reason }}</p> }
          } @else {
            <button (click)="load()" [disabled]="saving()">{{ saving() ? 'Consultando…' : 'Consultar factura' }}</button>
          }
        </main>
      </section>
    }
  `,
  styles: [`
    .overlay{position:fixed;inset:0;background:#17212e70;z-index:1000}
    .modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(480px,94vw);max-height:90dvh;overflow:auto;background:#fff;border-radius:12px;z-index:1001;box-shadow:0 20px 60px #17212e30;animation:appear .18s ease;color:#2d3b34}
    header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid #e0e6e1}header small{display:block;color:#56665e;font-size:11px;font-weight:700;text-transform:uppercase}h3{font-size:17px;margin:2px 0 0;color:#15211c}.client-name{margin-top:3px;font-size:13px;font-weight:600;color:#2d3b34}
    .close-btn{display:grid;place-items:center;width:40px;height:40px;min-height:40px;padding:0;color:#56665e}.close-btn:hover:not(:disabled){color:#b42318;border-color:#f0b4ae;background:#fff0ef}
    main{padding:20px;display:grid;gap:14px}p{margin:0;color:#526170;font-size:13px;line-height:1.5}h4{margin:0;font-size:16px;color:#15211c}
    .notice{padding:10px 12px;border:1px solid #f3d19e;border-radius:9px;background:#fff6e8;color:#7a4a0c}
    .result{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid #f3d19e;border-radius:9px;background:#fff6e8;color:#b36b12}.result.ok{border-color:#a8dcc3;background:#e9f8f1;color:#0f7a53}.result.bad{border-color:#f0b4ae;background:#fff0ef;color:#b42318}.result svg{flex:0 0 auto;margin-top:1px}
    .balance{display:grid;gap:6px;padding-block:12px;border-block:1px solid #e0e6e1}.balance span{font-size:12px;color:#56665e}.balance strong{font-size:24px;color:#15211c}
    label{display:grid;gap:7px;font-size:13px;font-weight:600;color:#2d3b34}input,select{box-sizing:border-box;width:100%;min-height:44px;padding:10px;border:1px solid #cfd8d2;border-radius:9px;background:white;color:#15211c;font:inherit}input.invalid{border-color:#b42318}
    .field-error{margin-top:-6px;color:#b42318;font-size:12px}.field-note{margin-top:-6px;color:#56665e;font-size:12px}
    button{min-height:44px;border:1px solid #cfd8d2;border-radius:9px;padding:10px 16px;background:white;color:#15211c;cursor:pointer;font:inherit;font-weight:600}.primary{background:#0b6b52;color:white;border-color:#0b6b52}.primary:hover:not(:disabled){background:#08523f}button:disabled{opacity:.6;cursor:not-allowed}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #0b6b52;outline-offset:2px}
    @keyframes appear{from{opacity:0}to{opacity:1}}@media(prefers-reduced-motion:reduce){.modal{animation:none}}
  `],
})
export class PaymentModalComponent implements OnChanges {
  visible = input(false); invoice = input<Invoice | null>(null);
  onClose = output<void>(); onSuccess = output<void>();
  private api = inject(WisphubService); private toast = inject(ToastService);
  saving = signal(false); operation = signal<any>(null); message = signal('');
  methods: { id: number; nombre: string }[] = [];
  formaPago = 0; totalCobrado = 0; balance = 0; fechaPago = ''; version = ''; attempted = false;
  private key = ''; private generation = 0;
  ngOnChanges() { if (this.visible() && this.invoice()) { this.operation.set(null); this.attempted = false; this.load(); } }
  close() { if (!this.saving()) { this.generation++; this.onClose.emit(); } }
  @HostListener('document:keydown.escape') onEscape() { if (this.visible()) this.close(); }
  amountError(): string {
    if (!this.version || this.operation()) return '';
    const amount = Number(this.totalCobrado);
    if (!(amount > 0)) return 'Escriba el monto recibido.';
    if (amount > this.balance + 0.001) return `El monto no puede ser mayor que el saldo (RD$ ${this.money(this.balance)}).`;
    return '';
  }
  disabledReason(): string {
    if (this.balance <= 0) return 'Esta factura no tiene saldo pendiente.';
    if (this.formaPago === 0) return 'Seleccione la forma de pago para continuar.';
    return '';
  }
  confirmRegister() {
    const method = this.methods.find((m) => m.id === this.formaPago)?.nombre || 'forma seleccionada';
    if (!confirm(`¿Registrar pago de RD$ ${this.money(Number(this.totalCobrado))} (${method}) en la factura #${this.invoice()?.id_factura}?\n\nEl pago se enviará a WispHub.`)) return;
    this.register();
  }
  private money(value: number): string { return value.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  load(newPayment = false) {
    const id = this.invoice()?.id_factura; if (!id || this.saving()) return;
    const generation = ++this.generation;
    this.saving.set(true); this.message.set(''); this.version = '';
    this.api.paymentOptions(id).subscribe({ next: result => {
      if (generation !== this.generation) return;
      this.saving.set(false); this.operation.set(result.activeOperation || (!newPayment ? result.previousOperation : null));
      if (this.operation()) return;
      this.attempted = false; this.methods = result.methods; this.formaPago = 0;
      this.balance = result.invoice.balance; this.totalCobrado = this.balance; this.version = result.invoice.version;
      const now = new Date(); this.fechaPago = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      this.key = crypto.randomUUID();
      if (!this.methods.length) this.message.set('No hay formas de pago sincronizadas. Actualice el catálogo antes de cobrar.');
    }, error: e => { if (generation === this.generation) { this.saving.set(false); this.message.set(e.error?.error || 'No se pudo consultar WispHub.'); } } });
  }
  register() {
    if (this.saving() || this.attempted || !this.version || !this.formaPago) return;
    const paidAt = new Date(this.fechaPago);
    if (!Number.isFinite(paidAt.getTime()) || this.totalCobrado <= 0 || this.totalCobrado > this.balance) { this.message.set('Revise el monto y la fecha del pago.'); return; }
    this.attempted = true; this.saving.set(true); this.message.set('Enviando el pago a WispHub…');
    this.api.submitPayment(this.invoice()!.id_factura, { amount: this.totalCobrado, paymentMethodId: this.formaPago, paidAt: paidAt.toISOString(), invoiceVersion: this.version }, this.key).subscribe({ next: r => this.receive(r), error: e => this.failure(e) });
  }
  verify() {
    if (this.saving() || !this.operation()) return;
    this.saving.set(true);
    this.api.verifyPayment(this.operation()!.id).subscribe({ next: r => this.receive(r), error: e => this.failure(e) });
  }
  private receive(result: any) {
    this.saving.set(false); this.operation.set(result); this.message.set('');
    if (result.ok === true && result.state === 'confirmed' && result.localLogSaved === true) { this.toast.success('Pago confirmado y registrado'); this.onSuccess.emit(); }
  }
  private failure(e: any) { this.saving.set(false); this.message.set(e.error?.error || 'No se recibió confirmación. Consulte la factura antes de volver a cobrar; no repita el cobro.'); }
}
