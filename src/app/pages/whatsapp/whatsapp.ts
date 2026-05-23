import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { HttpClient } from '@angular/common/http';
import { LocalDbService } from '../../services/local-db.service';
import { WispHubClient } from '../../models/client.model';
import { ToastService } from '../../services/toast.service';
import { FormsModule } from '@angular/forms';
import { SlicePipe } from '@angular/common';
import { ConfigService } from '../../services/config.service';

@Component({
  selector: 'app-whatsapp',
  standalone: true,
  imports: [NavbarComponent, FormsModule, SlicePipe],
  template: `
    <app-navbar pageTitle="WhatsApp" />

    <div class="page">
      <!-- CONNECTION STATUS -->
      <div class="status-card" [class]="'status-' + waStatus()">
        <div class="status-left">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.61.61l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.239 0-4.308-.724-5.993-1.953l-.42-.306-2.65.889.889-2.65-.306-.42A9.935 9.935 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>
          <div>
            <h3>WhatsApp Business</h3>
            <span class="status-text">{{ getStatusText() }}</span>
          </div>
        </div>
        <div class="status-actions">
          @if (waStatus() === 'disconnected' || waStatus() === 'error') {
            <button class="btn btn-green" (click)="connect()">Conectar</button>
          }
          @if (waStatus() === 'connected') {
            <button class="btn btn-red" (click)="disconnect()">Desconectar</button>
          }
          @if (waStatus() === 'conflict' || waStatus() === 'logged_out') {
            <button class="btn btn-green" (click)="reconnect()">Limpiar y reconectar</button>
          }
        </div>
      </div>

      @if (waStatus() === 'conflict') {
        <div class="conflict-card">
          <div class="conflict-header">
            <span class="conflict-icon">⚠️</span>
            <h3>Otra sesion de WhatsApp esta usando esta cuenta</h3>
          </div>
          <p>WhatsApp detecto que hay <strong>otro dispositivo o WhatsApp Web</strong> usando este mismo numero. Por eso te desconecto.</p>
          <ol class="conflict-steps">
            <li>Abre WhatsApp en tu telefono</li>
            <li>Toca <strong>⋮ Menu</strong> (Android) o <strong>Configuracion</strong> (iPhone) → <strong>Dispositivos vinculados</strong></li>
            <li>Cierra TODAS las sesiones que aparezcan (incluso si las reconoces)</li>
            <li>Vuelve aqui y toca <strong>"Limpiar y reconectar"</strong> arriba</li>
            <li>Escanea el QR nuevo desde el telefono</li>
          </ol>
          <p class="conflict-tip">
            💡 Tip: Si vas a usar WhatsApp Web en tu navegador, ten en cuenta que esta app se desconectara.
            Esta app es para envios automaticos del sistema, no compite con WhatsApp Web.
          </p>
        </div>
      }

      @if (waStatus() === 'logged_out') {
        <div class="conflict-card">
          <div class="conflict-header">
            <span class="conflict-icon">🚪</span>
            <h3>Sesion cerrada desde el telefono</h3>
          </div>
          <p>Cerraste la sesion de esta app desde tu WhatsApp. Para volver a conectar:</p>
          <ol class="conflict-steps">
            <li>Toca <strong>"Limpiar y reconectar"</strong> arriba</li>
            <li>Escanea el QR nuevo</li>
          </ol>
        </div>
      }

      @if (waStatus() === 'qr') {
        <div class="qr-card">
          <h3>Escanea el codigo QR con WhatsApp</h3>
          <p>Abre WhatsApp > Menu > Dispositivos vinculados > Vincular dispositivo</p>
          <div class="qr-box">
            @if (qrImage()) {
              <img [src]="qrImage()" alt="QR Code" />
            } @else {
              <p>Generando QR...</p>
            }
          </div>
        </div>
      }

      @if (waStatus() === 'connected') {
        <div class="content-grid">
          <!-- SEND INDIVIDUAL -->
          <div class="card">
            <h3>Enviar Mensaje Individual</h3>
            <div class="form-group">
              <label>Cliente</label>
              <select [(ngModel)]="selectedClient" class="form-input">
                <option value="">Seleccionar cliente...</option>
                @for (c of clientsWithPhone(); track c.id_servicio) {
                  <option [value]="c.telefono">{{ c.nombre }} - {{ c.telefono }}</option>
                }
              </select>
            </div>
            <div class="form-group">
              <label>O escribir numero directo</label>
              <input type="text" [(ngModel)]="customPhone" placeholder="18091234567" class="form-input" />
            </div>
            <div class="form-group">
              <label>Mensaje</label>
              <textarea [(ngModel)]="messageText" class="form-input" rows="4" placeholder="Escriba el mensaje..."></textarea>
            </div>
            <div class="template-btns">
              <button class="tmpl-btn" (click)="useTemplate('cobro')">Cobro</button>
              <button class="tmpl-btn" (click)="useTemplate('corte')">Aviso Corte</button>
              <button class="tmpl-btn" (click)="useTemplate('reconexion')">Reconexion</button>
              <button class="tmpl-btn" (click)="useTemplate('saludo')">Saludo</button>
            </div>
            <button class="btn btn-green" (click)="sendMessage()" [disabled]="sending()">
              {{ sending() ? 'Enviando...' : 'Enviar WhatsApp' }}
            </button>
          </div>

          <!-- SEND BULK TO MOROSOS -->
          <div class="card">
            <h3>Cobro Masivo a Morosos</h3>
            <p class="card-desc">Enviar mensaje de cobro a todos los clientes con pago pendiente que tengan telefono</p>
            <div class="morosos-count">
              <span class="big-num">{{ morososWithPhone().length }}</span>
              <span>clientes morosos con telefono</span>
            </div>
            <div class="form-group">
              <label>Mensaje de cobro</label>
              <textarea [(ngModel)]="bulkMessage" class="form-input" rows="4"></textarea>
            </div>
            <button class="btn btn-red" (click)="sendBulk()" [disabled]="sendingBulk()">
              {{ sendingBulk() ? 'Enviando ' + bulkProgress() + '/' + morososWithPhone().length + '...' : 'Enviar a ' + morososWithPhone().length + ' morosos' }}
            </button>
          </div>

          <!-- HISTORY -->
          <div class="card full">
            <h3>Mensajes Enviados</h3>
            @if (history().length === 0) {
              <p class="empty-msg">No hay mensajes enviados aun</p>
            } @else {
              <div class="history-list">
                @for (msg of history(); track msg.time) {
                  <div class="history-item">
                    <span class="h-phone">{{ msg.phone }}</span>
                    <span class="h-msg">{{ msg.message | slice:0:80 }}{{ msg.message.length > 80 ? '...' : '' }}</span>
                    <span class="h-time">{{ msg.time | slice:11:16 }}</span>
                    <span class="h-status" [class]="'hs-' + msg.status">{{ msg.status }}</span>
                  </div>
                }
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }

    .status-card {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 24px; border-radius: 14px; margin-bottom: 20px;
      border: 1px solid #e2e8f0; background: white;
    }
    .status-connected { border-left: 4px solid #22c55e; }
    .status-disconnected { border-left: 4px solid #ef4444; }
    .status-qr { border-left: 4px solid #f59e0b; }
    .status-error { border-left: 4px solid #ef4444; }

    .status-left { display: flex; align-items: center; gap: 16px; }
    .status-connected .status-left { color: #22c55e; }
    .status-disconnected .status-left { color: #ef4444; }
    .status-qr .status-left { color: #f59e0b; }
    .status-conflict .status-left { color: #d97706; }
    .status-logged_out .status-left { color: #94a3b8; }

    .conflict-card {
      background: #fef3c7; border: 1px solid #fcd34d;
      border-radius: 14px; padding: 20px 24px; margin-bottom: 20px;
    }
    .conflict-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .conflict-icon { font-size: 28px; }
    .conflict-header h3 { margin: 0; color: #78350f; font-size: 17px; }
    .conflict-card p { color: #78350f; font-size: 14px; line-height: 1.55; margin: 8px 0; }
    .conflict-steps { color: #78350f; padding-left: 22px; margin: 12px 0; line-height: 1.8; }
    .conflict-steps li { font-size: 14px; }
    .conflict-tip {
      background: rgba(255,255,255,0.5); border-radius: 8px;
      padding: 10px 14px; font-size: 13px !important;
      margin-top: 14px !important;
    }

    .status-left h3 { margin: 0; font-size: 18px; color: #0f172a; }
    .status-text { font-size: 13px; color: #64748b; }

    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; transition: all 0.2s; }
    .btn-green { background: #22c55e; color: white; }
    .btn-green:hover { background: #16a34a; }
    .btn-green:disabled { opacity: 0.6; }
    .btn-red { background: #ef4444; color: white; }
    .btn-red:hover { background: #dc2626; }
    .btn-red:disabled { opacity: 0.6; }

    .qr-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 30px; text-align: center; margin-bottom: 20px; }
    .qr-card h3 { margin: 0 0 8px; }
    .qr-card p { color: #64748b; margin: 0 0 20px; font-size: 14px; }
    .qr-box { display: flex; justify-content: center; padding: 20px; }
    .qr-box img { width: 280px; height: 280px; border-radius: 12px; }

    .content-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; }
    .card.full { grid-column: 1 / -1; }
    .card h3 { margin: 0 0 16px; font-size: 15px; font-weight: 600; color: #0f172a; }
    .card-desc { font-size: 13px; color: #64748b; margin: -8px 0 16px; }

    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px; }
    .form-input { width: 100%; padding: 9px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; color: #334155; outline: none; box-sizing: border-box; }
    .form-input:focus { border-color: #6366f1; }
    textarea.form-input { resize: vertical; }

    .template-btns { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
    .tmpl-btn { padding: 5px 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; font-size: 12px; color: #475569; cursor: pointer; }
    .tmpl-btn:hover { background: #6366f1; color: white; border-color: #6366f1; }

    .morosos-count { text-align: center; padding: 20px; margin-bottom: 16px; }
    .big-num { display: block; font-size: 48px; font-weight: 800; color: #ef4444; }
    .morosos-count span:last-child { font-size: 14px; color: #64748b; }

    .history-list { max-height: 300px; overflow-y: auto; }
    .history-item { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
    .h-phone { font-weight: 600; color: #0f172a; width: 130px; }
    .h-msg { flex: 1; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .h-time { color: #94a3b8; font-size: 12px; }
    .h-status { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; }
    .hs-sent { background: #dcfce7; color: #16a34a; }
    .hs-error { background: #fee2e2; color: #dc2626; }
    .empty-msg { color: #94a3b8; text-align: center; padding: 20px; }

    @media (max-width: 768px) {
      .content-grid { grid-template-columns: 1fr; }
      .status-card { flex-direction: column; gap: 16px; align-items: flex-start; }
      .status-actions { width: 100%; }
      .status-actions .btn { width: 100%; justify-content: center; }
      .qr-box img { width: 220px; height: 220px; }
      .history-item { flex-wrap: wrap; }
      .h-phone { width: 100%; }
      .h-msg { width: 100%; white-space: normal; }
    }
  `]
})
export class WhatsappComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private db = inject(LocalDbService);
  private toast = inject(ToastService);
  private cfg = inject(ConfigService);

  waStatus = signal<string>('disconnected');
  qrImage = signal<string>('');
  clientsWithPhone = signal<WispHubClient[]>([]);
  morososWithPhone = signal<WispHubClient[]>([]);
  history = signal<any[]>([]);
  sending = signal(false);
  sendingBulk = signal(false);
  bulkProgress = signal(0);

  selectedClient = '';
  customPhone = '';
  messageText = '';
  bulkMessage = '';

  private pollTimer: any;

  async ngOnInit() {
    const clients = await this.db.getClients();
    this.clientsWithPhone.set(clients.filter(c => c.telefono && c.telefono.length >= 7));
    this.morososWithPhone.set(clients.filter(c =>
      c.estado_facturas?.toLowerCase().includes('pendiente') &&
      c.telefono && c.telefono.length >= 7 &&
      c.estado?.toLowerCase() === 'activo'
    ));

    const company = this.cfg.companyName();
    this.bulkMessage = `Estimado cliente de ${company}, le recordamos que su factura de internet se encuentra pendiente de pago. Por favor regularice su cuenta para evitar la suspension del servicio. Gracias.`;

    this.checkStatus();
    this.pollTimer = setInterval(() => this.checkStatus(), 5000);
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  checkStatus() {
    this.http.get<any>('/wa/status').subscribe({
      next: (res) => {
        this.waStatus.set(res.status);
        if (res.qr) {
          // Generate QR image URL from the QR string
          this.qrImage.set(`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(res.qr)}`);
        }
      },
      error: () => this.waStatus.set('disconnected')
    });

    this.http.get<any[]>('/wa/history').subscribe({
      next: (msgs) => this.history.set(msgs.reverse()),
      error: () => {}
    });
  }

  connect() {
    this.http.post<any>('/wa/connect', {}).subscribe({
      next: () => this.toast.info('Conectando WhatsApp...'),
      error: () => this.toast.error('Error al conectar')
    });
  }

  disconnect() {
    this.http.post<any>('/wa/disconnect', {}).subscribe({
      next: () => { this.waStatus.set('disconnected'); this.toast.info('WhatsApp desconectado'); },
      error: () => this.toast.error('Error')
    });
  }

  // Limpia la sesion actual y reconecta (recomendado tras conflict o logout)
  reconnect() {
    this.toast.info('Limpiando sesion anterior...');
    this.http.post<any>('/wa/disconnect', {}).subscribe({
      next: () => {
        setTimeout(() => {
          this.http.post<any>('/wa/connect', {}).subscribe({
            next: () => this.toast.info('Generando QR nuevo...'),
            error: () => this.toast.error('Error al reconectar'),
          });
        }, 1500);
      },
      error: () => this.toast.error('Error limpiando sesion previa'),
    });
  }

  useTemplate(type: string) {
    const company = this.cfg.companyName();
    const phone = this.cfg.companyPhone();
    switch (type) {
      case 'cobro':
        this.messageText = `Estimado cliente de ${company}, le recordamos que su factura de internet se encuentra pendiente de pago. Favor comunicarse al ${phone || 'nuestra oficina'} para regularizar. Gracias.`;
        break;
      case 'corte':
        this.messageText = `Aviso de ${company}: Su servicio de internet sera suspendido por falta de pago. Por favor realice su pago a la brevedad para evitar la interrupcion. Gracias.`;
        break;
      case 'reconexion':
        this.messageText = `${company} le informa: Su servicio de internet ha sido reconectado exitosamente. Gracias por su pago.`;
        break;
      case 'saludo':
        this.messageText = `Saludos de ${company}! Esperamos que disfrute de nuestro servicio de internet. Para soporte contactenos al ${phone || 'nuestra oficina'}. Gracias por preferirnos.`;
        break;
    }
  }

  sendMessage() {
    const phone = this.customPhone || this.selectedClient;
    if (!phone) { this.toast.error('Seleccione un cliente o escriba un numero'); return; }
    if (!this.messageText) { this.toast.error('Escriba un mensaje'); return; }

    this.sending.set(true);
    this.http.post<any>('/wa/send', { phone, message: this.messageText }).subscribe({
      next: () => {
        this.sending.set(false);
        this.toast.success('Mensaje enviado a ' + phone);
        this.messageText = '';
        this.customPhone = '';
        this.selectedClient = '';
        this.checkStatus();
      },
      error: (e) => {
        this.sending.set(false);
        this.toast.error('Error: ' + (e.error?.error || 'No se pudo enviar'));
      }
    });
  }

  sendBulk() {
    const morosos = this.morososWithPhone();
    if (!morosos.length) return;
    if (!this.bulkMessage) { this.toast.error('Escriba un mensaje'); return; }

    this.sendingBulk.set(true);
    this.bulkProgress.set(0);

    const contacts = morosos.map(c => ({
      phone: c.telefono,
      message: this.bulkMessage.replace('{nombre}', c.nombre).replace('{precio}', c.precio_plan)
    }));

    this.http.post<any>('/wa/send-bulk', { contacts }).subscribe({
      next: (res) => {
        this.sendingBulk.set(false);
        const sent = res.results.filter((r: any) => r.status === 'sent').length;
        this.toast.success(`${sent} mensajes enviados de ${contacts.length}`);
        this.checkStatus();
      },
      error: (e) => {
        this.sendingBulk.set(false);
        this.toast.error('Error en envio masivo');
      }
    });
  }

  getStatusText(): string {
    switch (this.waStatus()) {
      case 'connected': return 'Conectado y listo para enviar';
      case 'qr': return 'Esperando escaneo del QR';
      case 'disconnected': return 'Desconectado';
      case 'conflict': return 'Otra sesion WhatsApp Web esta usando esta cuenta';
      case 'logged_out': return 'Sesion cerrada desde el telefono';
      default: return 'Error de conexion';
    }
  }
}
