import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { HttpClient } from '@angular/common/http';
import { LocalDbService } from '../../services/local-db.service';
import { WispHubClient } from '../../models/client.model';
import { ToastService } from '../../services/toast.service';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ConfigService } from '../../services/config.service';
import {
  LucideInfo,
  LucideLightbulb,
  LucideLogOut,
  LucideQrCode,
  LucideRefreshCw,
  LucideSend,
  LucideSmartphone,
  LucideTriangleAlert,
  LucideUsers,
} from '@lucide/angular';

@Component({
  selector: 'app-whatsapp',
  standalone: true,
  imports: [
    NavbarComponent, FormsModule, DatePipe,
    LucideInfo, LucideLightbulb, LucideLogOut, LucideQrCode, LucideRefreshCw,
    LucideSend, LucideSmartphone, LucideTriangleAlert, LucideUsers,
  ],
  template: `
    <app-navbar pageTitle="WhatsApp" />

    <div class="page">
      <!-- ESTADO DE CONEXIÓN -->
      <div class="status-card" [class]="'status-' + waStatus()">
        <div class="status-left">
          <span class="wa-logo" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.61.61l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.239 0-4.308-.724-5.993-1.953l-.42-.306-2.65.889.889-2.65-.306-.42A9.935 9.935 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>
          </span>
          <div>
            <h3>WhatsApp Business</h3>
            <span class="status-pill"><i class="dot"></i>{{ getStatusText() }}</span>
          </div>
        </div>
        <div class="status-actions">
          @if (waStatus() === 'disconnected' || waStatus() === 'error') {
            <button class="btn btn-green" (click)="connect()"><svg lucideQrCode size="16"></svg> Conectar</button>
          }
          @if (waStatus() === 'connected') {
            <button class="btn btn-outline-red" (click)="disconnect()"><svg lucideLogOut size="16"></svg> Desconectar</button>
          }
          @if (waStatus() === 'conflict' || waStatus() === 'logged_out') {
            <button class="btn btn-green" (click)="reconnect()"><svg lucideRefreshCw size="16"></svg> Limpiar y reconectar</button>
          }
        </div>
      </div>

      @if (waStatus() === 'disconnected' || waStatus() === 'error') {
        <div class="help-card">
          <svg lucideInfo size="18"></svg>
          <div>
            <strong>{{ waStatus() === 'error' ? 'No se pudo conectar con WhatsApp.' : 'WhatsApp no está conectado.' }}</strong>
            <p>Mientras esté desconectado no se envían mensajes ni avisos automáticos de cobro. Toca <strong>Conectar</strong>
              y escanea el código QR con el teléfono del negocio.</p>
          </div>
        </div>
      }

      @if (waStatus() === 'conflict') {
        <div class="conflict-card">
          <div class="conflict-header">
            <svg lucideTriangleAlert size="22"></svg>
            <h3>Otra sesión de WhatsApp está usando esta cuenta</h3>
          </div>
          <p>WhatsApp detectó que hay <strong>otro dispositivo o WhatsApp Web</strong> usando este mismo número. Por eso te desconectó.</p>
          <ol class="conflict-steps">
            <li>Abre WhatsApp en tu teléfono.</li>
            <li>Toca <strong>Menú ⋮</strong> (Android) o <strong>Configuración</strong> (iPhone) → <strong>Dispositivos vinculados</strong>.</li>
            <li>Cierra TODAS las sesiones que aparezcan (incluso si las reconoces).</li>
            <li>Vuelve aquí y toca <strong>“Limpiar y reconectar”</strong> arriba.</li>
            <li>Escanea el QR nuevo desde el teléfono.</li>
          </ol>
          <p class="conflict-tip">
            <svg lucideLightbulb size="16"></svg>
            <span>Si abres WhatsApp Web en tu navegador con este mismo número, esta app se desconectará.
            Esta app es para los envíos automáticos del sistema.</span>
          </p>
        </div>
      }

      @if (waStatus() === 'logged_out') {
        <div class="conflict-card">
          <div class="conflict-header">
            <svg lucideLogOut size="22"></svg>
            <h3>Sesión cerrada desde el teléfono</h3>
          </div>
          <p>Se cerró la sesión de esta app desde tu WhatsApp. Para volver a conectar:</p>
          <ol class="conflict-steps">
            <li>Toca <strong>“Limpiar y reconectar”</strong> arriba.</li>
            <li>Escanea el QR nuevo.</li>
          </ol>
        </div>
      }

      @if (waStatus() === 'qr') {
        <div class="qr-card">
          <h3>Escanea el código QR con WhatsApp</h3>
          <ol class="qr-steps">
            <li>Abre WhatsApp en el teléfono del negocio.</li>
            <li>Ve a <strong>Menú ⋮</strong> o <strong>Configuración</strong> → <strong>Dispositivos vinculados</strong>.</li>
            <li>Toca <strong>Vincular dispositivo</strong> y apunta la cámara a este código.</li>
          </ol>
          <div class="qr-box">
            @if (qrImage()) {
              <img [src]="qrImage()" alt="Código QR para vincular WhatsApp" />
            } @else {
              <p class="muted">Generando código QR…</p>
            }
          </div>
          <p class="muted small">El código se renueva solo cada pocos segundos. Si no funciona, espera a que cambie y vuelve a escanear.</p>
        </div>
      }

      @if (waStatus() === 'connected') {
        <div class="content-grid">
          <!-- ENVÍO INDIVIDUAL -->
          <div class="card">
            <h3><svg lucideSmartphone size="16"></svg> Enviar mensaje individual</h3>
            <div class="form-group">
              <label for="wa-client-filter">Cliente</label>
              <input id="wa-client-filter" type="search" class="form-input filter-input"
                [ngModel]="clientFilter()" (ngModelChange)="clientFilter.set($event)"
                placeholder="Filtrar por nombre o teléfono…" />
              <select [(ngModel)]="selectedClient" class="form-input" aria-label="Seleccionar cliente">
                <option value="">Seleccionar cliente… ({{ filteredClients().length }})</option>
                @for (c of filteredClients(); track c.id_servicio) {
                  <option [value]="c.telefono">{{ c.nombre }} — {{ c.telefono }}</option>
                }
              </select>
            </div>
            <div class="form-group">
              <label for="wa-phone">O escribir número directo</label>
              <input id="wa-phone" type="tel" inputmode="tel" [(ngModel)]="customPhone" placeholder="Ej.: 18091234567" class="form-input" />
              <small class="hint">Con código de país (1 + 809/829/849). Si escribes un número, se usa este en vez del cliente seleccionado.</small>
            </div>
            <div class="form-group">
              <label for="wa-msg">Mensaje</label>
              <textarea id="wa-msg" [(ngModel)]="messageText" class="form-input" rows="4" placeholder="Escribe el mensaje…"></textarea>
              <small class="hint right">{{ messageText.length }} caracteres</small>
            </div>
            <div class="template-btns">
              <span class="tmpl-label">Plantillas:</span>
              <button type="button" class="tmpl-btn" (click)="useTemplate('cobro')">Cobro</button>
              <button type="button" class="tmpl-btn" (click)="useTemplate('corte')">Aviso de corte</button>
              <button type="button" class="tmpl-btn" (click)="useTemplate('reconexion')">Reconexión</button>
              <button type="button" class="tmpl-btn" (click)="useTemplate('saludo')">Saludo</button>
            </div>
            @if (targetPhone()) {
              <p class="send-to">Se enviará a: <strong>{{ targetPhone() }}</strong></p>
            }
            <button class="btn btn-primary" (click)="sendMessage()" [disabled]="sending() || !targetPhone() || !messageText.trim()"
              [title]="!targetPhone() ? 'Selecciona un cliente o escribe un número' : (!messageText.trim() ? 'Escribe el mensaje' : '')">
              <svg lucideSend size="16"></svg> {{ sending() ? 'Enviando…' : 'Enviar WhatsApp' }}
            </button>
            @if (!sending() && (!targetPhone() || !messageText.trim())) {
              <small class="hint">{{ !targetPhone() ? 'Falta elegir el cliente o escribir un número.' : 'Falta escribir el mensaje.' }}</small>
            }
          </div>

          <!-- COBRO MASIVO -->
          <div class="card">
            <h3><svg lucideUsers size="16"></svg> Cobro masivo a morosos</h3>
            <p class="card-desc">Envía un mensaje de cobro a todos los clientes activos con pago pendiente que tienen teléfono.</p>
            <div class="morosos-count">
              <span class="big-num">{{ morososWithPhone().length }}</span>
              <span>clientes morosos con teléfono</span>
            </div>
            <div class="form-group">
              <label for="wa-bulk">Mensaje de cobro</label>
              <textarea id="wa-bulk" [(ngModel)]="bulkMessage" class="form-input" rows="4"></textarea>
              <small class="hint">Puedes usar <code>&#123;nombre&#125;</code> y <code>&#123;precio&#125;</code> para personalizar el mensaje.</small>
            </div>
            <button class="btn btn-primary" (click)="sendBulk()" [disabled]="sendingBulk() || !morososWithPhone().length || !bulkMessage.trim()">
              <svg lucideSend size="16"></svg>
              {{ sendingBulk() ? 'Enviando ' + morososWithPhone().length + ' mensajes…' : 'Enviar a ' + morososWithPhone().length + ' morosos' }}
            </button>
            @if (sendingBulk()) {
              <small class="hint">Se envía un mensaje cada 2 segundos para evitar bloqueos de WhatsApp. Tiempo aproximado: {{ bulkEta() }}. No cierres esta página.</small>
            } @else if (!morososWithPhone().length) {
              <small class="hint">No hay clientes morosos con teléfono registrado.</small>
            }
          </div>

          <!-- HISTORIAL -->
          <div class="card full">
            <h3>Mensajes enviados <span class="count">{{ history().length }}</span></h3>
            @if (history().length === 0) {
              <p class="empty-msg">Todavía no se han enviado mensajes. Los envíos manuales y automáticos aparecerán aquí.</p>
            } @else {
              <div class="history-list">
                @for (msg of history(); track $index) {
                  <div class="history-item">
                    <div class="h-who">
                      <span class="h-name">{{ msg.clientName || msg.phone }}</span>
                      @if (msg.clientName) { <span class="h-phone">{{ msg.phone }}</span> }
                    </div>
                    <span class="h-msg" [title]="msg.message">{{ msg.message }}</span>
                    <span class="h-time">{{ (msg.createdAt || msg.time) | date:'dd/MM h:mm a' }}</span>
                    <span class="h-status" [class]="'hs-' + msg.status" [title]="msg.errorMessage || ''">{{ statusLabel(msg.status) }}</span>
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
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 18px 22px; border-radius: 8px; margin-bottom: 16px;
      border: 1px solid #dfe5ea; border-left: 4px solid #ccd6de; background: white;
      --st: #667582; --st-bg: #f8fafc;
    }
    .status-connected { --st: #13875a; --st-bg: #e9f8f1; }
    .status-disconnected, .status-error { --st: #b42318; --st-bg: #fff0ef; }
    .status-qr, .status-conflict { --st: #b36b12; --st-bg: #fff6e8; }
    .status-card { border-left-color: var(--st); }

    .status-left { display: flex; align-items: center; gap: 14px; }
    .wa-logo { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 8px; background: var(--st-bg); color: var(--st); flex-shrink: 0; }
    .status-left h3 { margin: 0 0 4px; font-size: 17px; color: #172535; }
    .status-pill {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600; color: var(--st); background: var(--st-bg);
      padding: 3px 10px; border-radius: 999px;
    }
    .status-pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--st); }

    .help-card {
      display: flex; gap: 12px; align-items: flex-start;
      background: #f2f7ff; border: 1px solid #cfe0fa; color: #172535;
      border-radius: 8px; padding: 14px 18px; margin-bottom: 16px; font-size: 13px;
    }
    .help-card svg { color: #1267dd; flex-shrink: 0; margin-top: 1px; }
    .help-card p { margin: 4px 0 0; color: #334250; line-height: 1.5; }

    .conflict-card {
      background: #fff6e8; border: 1px solid #f1d3a4;
      border-radius: 8px; padding: 18px 22px; margin-bottom: 16px; color: #5c3a0b;
    }
    .conflict-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; color: #b36b12; }
    .conflict-header h3 { margin: 0; color: #5c3a0b; font-size: 16px; }
    .conflict-card p { font-size: 13px; line-height: 1.55; margin: 8px 0; }
    .conflict-steps { padding-left: 22px; margin: 10px 0; line-height: 1.8; }
    .conflict-steps li { font-size: 13px; }
    .conflict-tip {
      display: flex; gap: 8px; align-items: flex-start;
      background: rgba(255,255,255,0.6); border-radius: 6px;
      padding: 10px 12px; margin-top: 12px !important;
    }
    .conflict-tip svg { flex-shrink: 0; margin-top: 1px; color: #b36b12; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 9px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: background 0.15s; }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-green { background: #13875a; color: white; }
    .btn-green:hover:not(:disabled) { background: #0f704a; }
    .btn-primary { background: #1267dd; color: white; }
    .btn-primary:hover:not(:disabled) { background: #0d58c0; }
    .btn-outline-red { background: white; color: #b42318; border-color: #f0c4bf; }
    .btn-outline-red:hover { background: #fff0ef; }

    .qr-card { background: white; border: 1px solid #dfe5ea; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 16px; }
    .qr-card h3 { margin: 0 0 12px; color: #172535; font-size: 16px; }
    .qr-steps { display: inline-block; text-align: left; margin: 0 0 8px; padding-left: 20px; color: #334250; font-size: 13px; line-height: 1.8; }
    .qr-box { display: flex; justify-content: center; padding: 12px; }
    .qr-box img { width: 280px; height: 280px; max-width: 100%; border-radius: 8px; border: 1px solid #dfe5ea; }
    .muted { color: #667582; font-size: 13px; }
    .small { font-size: 12px; margin: 0; }

    .content-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { background: white; border: 1px solid #dfe5ea; border-radius: 8px; padding: 20px; min-width: 0; }
    .card.full { grid-column: 1 / -1; }
    .card h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 14px; font-size: 15px; font-weight: 600; color: #172535; }
    .card h3 svg { color: #1267dd; }
    .card-desc { font-size: 13px; color: #667582; margin: -6px 0 12px; }
    .count { font-size: 11px; font-weight: 600; color: #667582; background: #f1f4f7; padding: 2px 8px; border-radius: 999px; }

    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: #334250; margin-bottom: 4px; }
    .form-input { width: 100%; padding: 9px 12px; border: 1px solid #ccd6de; border-radius: 6px; font-size: 13px; color: #334250; background: white; outline: none; box-sizing: border-box; font-family: inherit; }
    .form-input:focus { border-color: #1267dd; box-shadow: 0 0 0 3px rgba(18, 103, 221, 0.12); }
    .filter-input { margin-bottom: 6px; }
    textarea.form-input { resize: vertical; }
    .hint { display: block; margin-top: 5px; font-size: 11px; color: #667582; line-height: 1.4; }
    .hint.right { text-align: right; }
    .hint code { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; background: #f1f4f7; padding: 0 4px; border-radius: 4px; color: #172535; }
    .send-to { font-size: 12px; color: #334250; margin: 0 0 10px; }

    .template-btns { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
    .tmpl-label { font-size: 12px; color: #667582; margin-right: 2px; }
    .tmpl-btn { padding: 5px 12px; border: 1px solid #ccd6de; border-radius: 6px; background: #f8fafc; font-size: 12px; color: #334250; cursor: pointer; }
    .tmpl-btn:hover { background: #edf4ff; color: #1267dd; border-color: #1267dd; }

    .morosos-count { text-align: center; padding: 14px; margin-bottom: 14px; background: #fff6e8; border-radius: 8px; }
    .big-num { display: block; font-size: 32px; font-weight: 800; color: #b36b12; line-height: 1.1; }
    .morosos-count span:last-child { font-size: 13px; color: #5c3a0b; }

    .history-list { max-height: 360px; overflow-y: auto; }
    .history-item { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid #f0f3f6; font-size: 13px; }
    .h-who { width: 170px; flex-shrink: 0; min-width: 0; }
    .h-name { display: block; font-weight: 600; color: #172535; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .h-phone { display: block; font-size: 11px; color: #667582; }
    .h-msg { flex: 1; min-width: 0; color: #334250; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .h-time { color: #667582; font-size: 12px; white-space: nowrap; }
    .h-status { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; white-space: nowrap; background: #f1f4f7; color: #667582; }
    .hs-sent { background: #e9f8f1; color: #13875a; }
    .hs-error, .hs-failed { background: #fff0ef; color: #b42318; }
    .hs-pending { background: #fff6e8; color: #b36b12; }
    .empty-msg { color: #667582; text-align: center; padding: 20px; font-size: 13px; }

    @media (max-width: 768px) {
      .page { padding: 16px; }
      .content-grid { grid-template-columns: 1fr; }
      .status-card { flex-direction: column; align-items: flex-start; }
      .status-actions { width: 100%; }
      .status-actions .btn { width: 100%; }
      .qr-box img { width: 220px; height: 220px; }
      .history-item { flex-wrap: wrap; gap: 4px 10px; }
      .h-who { width: auto; flex: 1; }
      .h-msg { order: 5; width: 100%; flex-basis: 100%; white-space: normal; }
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

  /** Filtro local para la lista de clientes (solo visual). */
  clientFilter = signal('');
  filteredClients = computed(() => {
    const term = this.clientFilter().toLowerCase().trim();
    const list = this.clientsWithPhone();
    if (!term) return list;
    return list.filter(c => c.nombre?.toLowerCase().includes(term) || c.telefono?.includes(term));
  });

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
    this.bulkMessage = `Estimado cliente de ${company}, le recordamos que su factura de internet se encuentra pendiente de pago. Por favor regularice su cuenta para evitar la suspensión del servicio. Gracias.`;

    this.checkStatus();
    this.pollTimer = setInterval(() => this.checkStatus(), 5000);
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  /** Número al que se enviará el mensaje individual (el escrito tiene prioridad). */
  targetPhone(): string {
    return (this.customPhone || this.selectedClient || '').trim();
  }

  bulkEta(): string {
    const secs = this.morososWithPhone().length * 2;
    if (secs < 60) return `menos de 1 minuto`;
    const mins = Math.ceil(secs / 60);
    return `${mins} ${mins === 1 ? 'minuto' : 'minutos'}`;
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'sent': return 'Enviado';
      case 'failed':
      case 'error': return 'Falló';
      case 'pending': return 'Pendiente';
      default: return status || '—';
    }
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
      // El servidor ya los devuelve del más reciente al más antiguo.
      next: (msgs) => this.history.set(msgs),
      error: () => {}
    });
  }

  connect() {
    this.http.post<any>('/wa/connect', {}).subscribe({
      next: () => this.toast.info('Conectando WhatsApp… En unos segundos aparecerá el código QR.'),
      error: () => this.toast.error('No se pudo iniciar la conexión con WhatsApp. Intenta de nuevo.')
    });
  }

  disconnect() {
    if (!confirm('¿Desconectar WhatsApp?\n\nSe cerrará la sesión y dejarán de enviarse los mensajes y avisos automáticos de cobro hasta que vuelvas a escanear el código QR.')) return;
    this.http.post<any>('/wa/disconnect', {}).subscribe({
      next: () => { this.waStatus.set('disconnected'); this.toast.info('WhatsApp desconectado'); },
      error: () => this.toast.error('No se pudo desconectar WhatsApp. Intenta de nuevo.')
    });
  }

  // Limpia la sesion actual y reconecta (recomendado tras conflict o logout)
  reconnect() {
    this.toast.info('Limpiando sesión anterior…');
    this.http.post<any>('/wa/disconnect', {}).subscribe({
      next: () => {
        setTimeout(() => {
          this.http.post<any>('/wa/connect', {}).subscribe({
            next: () => this.toast.info('Generando código QR nuevo…'),
            error: () => this.toast.error('No se pudo reconectar WhatsApp. Intenta de nuevo.'),
          });
        }, 1500);
      },
      error: () => this.toast.error('No se pudo limpiar la sesión anterior. Intenta de nuevo.'),
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
        this.messageText = `Aviso de ${company}: Su servicio de internet será suspendido por falta de pago. Por favor realice su pago a la brevedad para evitar la interrupción. Gracias.`;
        break;
      case 'reconexion':
        this.messageText = `${company} le informa: Su servicio de internet ha sido reconectado exitosamente. Gracias por su pago.`;
        break;
      case 'saludo':
        this.messageText = `¡Saludos de ${company}! Esperamos que disfrute de nuestro servicio de internet. Para soporte contáctenos al ${phone || 'nuestra oficina'}. Gracias por preferirnos.`;
        break;
    }
  }

  sendMessage() {
    const phone = this.customPhone || this.selectedClient;
    if (!phone) { this.toast.error('Selecciona un cliente o escribe un número'); return; }
    if (!this.messageText) { this.toast.error('Escribe un mensaje'); return; }

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
        this.toast.error('No se pudo enviar: ' + (e.error?.error || 'revisa el número e intenta de nuevo'));
      }
    });
  }

  sendBulk() {
    const morosos = this.morososWithPhone();
    if (!morosos.length) return;
    if (!this.bulkMessage) { this.toast.error('Escribe un mensaje'); return; }
    if (!confirm(`¿Enviar el mensaje de cobro por WhatsApp a ${morosos.length} clientes morosos?\n\nLos mensajes no se pueden cancelar una vez enviados. Tardará aproximadamente ${this.bulkEta()}.`)) return;

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
        this.toast.success(`${sent} de ${contacts.length} mensajes enviados`);
        this.checkStatus();
      },
      error: (e) => {
        this.sendingBulk.set(false);
        this.toast.error('El envío masivo falló: ' + (e.error?.error || 'intenta de nuevo'));
      }
    });
  }

  getStatusText(): string {
    switch (this.waStatus()) {
      case 'connected': return 'Conectado y listo para enviar';
      case 'qr': return 'Esperando que escanees el QR';
      case 'connecting': return 'Conectando…';
      case 'disconnected': return 'Desconectado';
      case 'conflict': return 'Otra sesión de WhatsApp Web está usando esta cuenta';
      case 'logged_out': return 'Sesión cerrada desde el teléfono';
      default: return 'Error de conexión';
    }
  }
}
