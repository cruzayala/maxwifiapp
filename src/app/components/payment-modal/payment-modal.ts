import { Component, inject, input, output, signal, OnChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { WisphubService } from '../../services/wisphub.service';
import { ToastService } from '../../services/toast.service';
import { Invoice } from '../../models/invoice.model';

@Component({
  selector: 'app-payment-modal', standalone: true, imports: [FormsModule, DecimalPipe],
  template: `
    @if (visible()) {
      <div class="overlay" (click)="close()"></div>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="payment-title">
        <header><h3 id="payment-title">Pago de factura #{{ invoice()?.id_factura }}</h3><button type="button" (click)="close()" aria-label="Cerrar" [disabled]="saving()">&#215;</button></header>
        <main>
          <strong>{{ invoice()?.cliente?.nombre }}</strong>
          @if (message()) { <p role="status">{{ message() }}</p> }
          @if (operation()) {
            <h4>{{ operation()!.ok ? 'Pago confirmado' : operation()!.state === 'rejected' ? 'Solicitud rechazada' : 'Pago pendiente de verificacion' }}</h4>
            <p>RD$ {{ operation()!.amount | number:'1.2-2' }} · {{ operation()!.paymentMethodName }}</p>
            @if (!operation()!.ok) { <p>{{ operation()!.state === 'confirmed_external' ? 'WispHub confirmo el pago. Falta verificar los importes de la factura.' : 'No se enviara otro cobro. Consulta el estado antes de continuar.' }}</p> }
            @if (operation()!.canVerify) { <button class="primary" (click)="verify()" [disabled]="saving()">{{ saving() ? 'Consultando...' : 'Verificar pago' }}</button> }
            @if (operation()!.ok || operation()!.state === 'rejected' && !operation()!.canVerify) { <button (click)="load(true)" [disabled]="saving()">Consultar saldo restante</button> }
          } @else if (version && !attempted) {
            <div class="balance"><span>Saldo verificado en WispHub</span><strong>RD$ {{ balance | number:'1.2-2' }}</strong></div>
            <label>Forma de pago<select [(ngModel)]="formaPago" [disabled]="saving()"><option [ngValue]="0">Selecciona una forma</option>@for (method of methods; track method.id) { <option [ngValue]="method.id">{{ method.nombre }}</option> }</select></label>
            <label>Importe recibido<input type="number" [(ngModel)]="totalCobrado" min="0.01" [max]="balance" step="0.01" [disabled]="saving()" /></label>
            <label>Fecha del pago<input type="datetime-local" [(ngModel)]="fechaPago" [disabled]="saving()" /></label>
            <button class="primary" (click)="register()" [disabled]="saving() || formaPago === 0 || balance <= 0">Registrar pago</button>
          } @else {
            <button (click)="load()" [disabled]="saving()">{{ saving() ? 'Consultando...' : 'Consultar factura' }}</button>
          }
        </main>
      </section>
    }
  `,
  styles: [`
    .overlay{position:fixed;inset:0;background:#17212e70;z-index:1000}
    .modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(480px,94vw);max-height:90dvh;overflow:auto;background:#fff;border-radius:8px;z-index:1001;box-shadow:0 20px 60px #17212e30;animation:appear .18s ease}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid #e1e7ea}h3{font-size:17px;margin:0}header button{font-size:24px;width:44px;height:44px;padding:0}
    main{padding:20px;display:grid;gap:16px}p{margin:0;color:#526170;font-size:14px;line-height:1.5}h4{margin:0;font-size:17px}
    .balance{display:grid;gap:6px;padding-block:12px;border-block:1px solid #e1e7ea}.balance span{font-size:13px;color:#526170}.balance strong{font-size:24px;color:#087b54}
    label{display:grid;gap:7px;font-size:13px;font-weight:600}input,select{box-sizing:border-box;width:100%;min-height:44px;padding:10px;border:1px solid #cdd8de;border-radius:6px;background:white;color:#142637;font:inherit}
    button{min-height:44px;border:1px solid #cdd8de;border-radius:6px;padding:10px 16px;background:white;color:#142637;cursor:pointer;font:inherit}.primary{background:#087b54;color:white;border-color:#087b54}button:disabled{opacity:.6;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #087b54;outline-offset:2px}
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
      if (!this.methods.length) this.message.set('No hay formas de pago sincronizadas. Actualiza el catalogo antes de cobrar.');
    }, error: e => { if (generation === this.generation) { this.saving.set(false); this.message.set(e.error?.error || 'No se pudo consultar WispHub.'); } } });
  }
  register() {
    if (this.saving() || this.attempted || !this.version || !this.formaPago) return;
    const paidAt = new Date(this.fechaPago);
    if (!Number.isFinite(paidAt.getTime()) || this.totalCobrado <= 0 || this.totalCobrado > this.balance) { this.message.set('Comprueba el importe y la fecha.'); return; }
    this.attempted = true; this.saving.set(true); this.message.set('Enviando solicitud de pago...');
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
  private failure(e: any) { this.saving.set(false); this.message.set(e.error?.error || 'Respuesta no confirmada. Consulta la factura; no repitas el cobro.'); }
}
