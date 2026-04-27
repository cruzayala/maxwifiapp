import { Component, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { LocalDbService } from '../../services/local-db.service';
import { ConfigService } from '../../services/config.service';
import { NotificationSchedulerService } from '../../services/notification-scheduler.service';
import { ToastService } from '../../services/toast.service';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [NavbarComponent, FormsModule],
  template: `
    <app-navbar pageTitle="Configuracion" />

    <div class="page">
      <div class="settings-grid">
        <!-- EMPRESA -->
        <div class="card full">
          <h3>Datos de la Empresa (para recibos)</h3>
          <div class="form-row">
            <div class="form-group">
              <label>Nombre de la Empresa</label>
              <input type="text" [(ngModel)]="config.companyName" (ngModelChange)="config.companyName.set($event)" class="form-input" />
            </div>
            <div class="form-group">
              <label>Slogan / Descripcion</label>
              <input type="text" [(ngModel)]="config.companySlogan" (ngModelChange)="config.companySlogan.set($event)" class="form-input" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Telefono</label>
              <input type="text" [(ngModel)]="config.companyPhone" (ngModelChange)="config.companyPhone.set($event)" class="form-input" />
            </div>
            <div class="form-group">
              <label>RNC / Cedula</label>
              <input type="text" [(ngModel)]="config.rnc" (ngModelChange)="config.rnc.set($event)" class="form-input" />
            </div>
          </div>
          <div class="form-group">
            <label>Direccion</label>
            <input type="text" [(ngModel)]="config.companyAddress" (ngModelChange)="config.companyAddress.set($event)" class="form-input" />
          </div>
          <div class="form-group">
            <label>Tamano de Papel para Recibos</label>
            <div class="paper-select">
              <button [class.active]="config.defaultPaperSize() === '58mm'" (click)="config.defaultPaperSize.set('58mm')">
                58mm (Mini)
              </button>
              <button [class.active]="config.defaultPaperSize() === '80mm'" (click)="config.defaultPaperSize.set('80mm')">
                80mm (Estandar)
              </button>
            </div>
          </div>
          <button class="btn btn-primary" (click)="saveConfig()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
            Guardar
          </button>
          @if (saved()) {
            <span class="saved-msg">Guardado correctamente</span>
          }
        </div>

        <!-- API -->
        <div class="card">
          <h3>Conexion WispHub API</h3>
          <div class="form-group">
            <label>API URL</label>
            <input type="text" [value]="apiUrl" class="form-input" disabled />
          </div>
          <div class="form-group">
            <label>API Key</label>
            <div class="key-input">
              <input [type]="showKey() ? 'text' : 'password'" [value]="apiKey" class="form-input" disabled />
              <button class="toggle-btn" (click)="showKey.set(!showKey())">
                {{ showKey() ? 'Ocultar' : 'Ver' }}
              </button>
            </div>
          </div>
          <p class="help-text">
            La API Key se configura en el archivo <code>environment.ts</code>.
            Se genera desde <strong>WispHub > Staff > Generar API Key</strong>.
          </p>
        </div>

        <!-- DB LOCAL -->
        <div class="card">
          <h3>Base de Datos Local (IndexedDB)</h3>
          <div class="db-info">
            <div class="db-stat">
              <span>Clientes guardados</span>
              <span class="db-val">{{ localClientsCount() }}</span>
            </div>
            <div class="db-stat">
              <span>Facturas guardadas</span>
              <span class="db-val">{{ localInvoicesCount() }}</span>
            </div>
            <div class="db-stat">
              <span>Tickets guardados</span>
              <span class="db-val">{{ localTicketsCount() }}</span>
            </div>
            <div class="db-stat">
              <span>Ultima sync clientes</span>
              <span class="db-val">{{ lastSyncClients() || 'Nunca' }}</span>
            </div>
            <div class="db-stat">
              <span>Ultima sync facturas</span>
              <span class="db-val">{{ lastSyncInvoices() || 'Nunca' }}</span>
            </div>
          </div>
          <button class="btn btn-red" (click)="clearLocalData()">
            Limpiar todos los datos locales
          </button>
        </div>

        <!-- WHATSAPP AUTOMATICO -->
        <div class="card full">
          <h3>Notificaciones Automaticas WhatsApp</h3>
          <p class="help-text">
            Envia mensajes automaticos a clientes con pago pendiente o proximo al corte.
            Requiere que WhatsApp este conectado.
          </p>

          <div class="toggle-row">
            <label class="switch">
              <input type="checkbox" [(ngModel)]="config.autoNotifEnabled" (ngModelChange)="config.autoNotifEnabled.set($event); saveConfig()" />
              <span class="slider"></span>
            </label>
            <div>
              <strong>Activar envio automatico</strong>
              <div class="sub-text">El sistema revisara cada 30 minutos si debe enviar mensajes</div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Hora del dia para enviar (0-23)</label>
              <input type="number" min="0" max="23" [(ngModel)]="config.autoNotifScheduleHour" (ngModelChange)="config.autoNotifScheduleHour.set(+$event)" class="form-input" />
            </div>
            <div class="form-group">
              <label>Dias antes del corte para recordar</label>
              <input type="number" min="1" max="10" [(ngModel)]="config.autoNotifReminderDays" (ngModelChange)="config.autoNotifReminderDays.set(+$event)" class="form-input" />
            </div>
          </div>

          <div class="form-group">
            <label>Mensaje de recordatorio (antes del corte)</label>
            <textarea rows="3" [(ngModel)]="config.autoNotifReminderMsg" (ngModelChange)="config.autoNotifReminderMsg.set($event)" class="form-input"></textarea>
            <span class="hint">Variables: &#123;nombre&#125; &#123;empresa&#125; &#123;fecha_corte&#125; &#123;precio&#125; &#123;plan&#125;</span>
          </div>

          <div class="toggle-row">
            <label class="switch">
              <input type="checkbox" [(ngModel)]="config.autoNotifOverdueEnabled" (ngModelChange)="config.autoNotifOverdueEnabled.set($event); saveConfig()" />
              <span class="slider"></span>
            </label>
            <div>
              <strong>Enviar avisos a clientes ya vencidos (morosos)</strong>
              <div class="sub-text">Repite cada {{ config.autoNotifOverdueInterval() }} dias mientras no pague</div>
            </div>
          </div>

          <div class="form-group">
            <label>Cada cuantos dias reenviar a moroso</label>
            <input type="number" min="1" max="30" [(ngModel)]="config.autoNotifOverdueInterval" (ngModelChange)="config.autoNotifOverdueInterval.set(+$event)" class="form-input" style="max-width:200px" />
          </div>

          <div class="form-group">
            <label>Mensaje de morosos (ya vencido)</label>
            <textarea rows="3" [(ngModel)]="config.autoNotifOverdueMsg" (ngModelChange)="config.autoNotifOverdueMsg.set($event)" class="form-input"></textarea>
            <span class="hint">Variables: &#123;nombre&#125; &#123;empresa&#125; &#123;fecha_corte&#125; &#123;precio&#125; &#123;dias_vencido&#125;</span>
          </div>

          <div class="actions-row">
            <button class="btn btn-primary" (click)="saveConfig()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
              Guardar
            </button>
            <button class="btn btn-green" (click)="runNotifNow()">
              Ejecutar Ahora (prueba)
            </button>
          </div>
        </div>

        <!-- DETECTOR IP WAN -->
        <div class="card full">
          <h3>Diagnostico de Red</h3>
          <p class="help-text">
            Si abres esta pagina desde una red conectada al MikroTik, la IP publica mostrada es tu IP WAN.
            Desde otra red (casa, 4G) sera diferente.
          </p>
          @if (wanIp()) {
            <div class="wan-info">
              <div class="wan-row">
                <span class="wan-label">IP Publica actual:</span>
                <strong class="wan-value">{{ wanIp() }}</strong>
                <button class="btn-copy" (click)="copyIp()">Copiar</button>
              </div>
              @if (isp()) {
                <div class="wan-row">
                  <span class="wan-label">ISP:</span>
                  <span>{{ isp() }}</span>
                </div>
              }
              @if (city()) {
                <div class="wan-row">
                  <span class="wan-label">Ubicacion:</span>
                  <span>{{ city() }}, {{ country() }}</span>
                </div>
              }
              <div class="wan-row">
                <span class="wan-label">Router WispHub (VPN):</span>
                <strong class="mono">172.29.33.223</strong>
                <span class="muted">IP privada - no es tu WAN</span>
              </div>
            </div>
          } @else {
            <button class="btn btn-primary" (click)="detectWanIp()" [disabled]="detecting()">
              {{ detecting() ? 'Detectando...' : 'Detectar IP Publica' }}
            </button>
          }
        </div>

        <!-- INFO -->
        <div class="card full">
          <h3>Informacion del Sistema</h3>
          <div class="info-grid">
            <div class="info-item"><span>Version</span><span>1.0.0</span></div>
            <div class="info-item"><span>API</span><span>WispHub.io REST API</span></div>
            <div class="info-item"><span>Base de datos</span><span>IndexedDB (navegador)</span></div>
            <div class="info-item"><span>Framework</span><span>Angular 21</span></div>
            <div class="info-item"><span>Almacenamiento</span><span>Local (offline-capable)</span></div>
            <div class="info-item"><span>Deploy target</span><span>Railway</span></div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }

    .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

    .card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; }
    .card.full { grid-column: 1 / -1; }

    .card h3 {
      margin: 0 0 20px; font-size: 15px; font-weight: 600; color: #0f172a;
      padding-bottom: 12px; border-bottom: 1px solid #f1f5f9;
    }

    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px; }
    .form-input {
      width: 100%; padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 10px;
      font-size: 14px; color: #334155; outline: none; box-sizing: border-box;
    }
    .form-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
    .form-input:disabled { background: #f8fafc; color: #94a3b8; }

    .key-input { display: flex; gap: 8px; }
    .key-input .form-input { flex: 1; }
    .toggle-btn {
      padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 10px;
      background: #f8fafc; color: #475569; font-size: 13px; cursor: pointer; white-space: nowrap;
    }

    .toggle-row {
      display: flex; align-items: center; gap: 14px; padding: 12px 0;
      border-bottom: 1px solid #f1f5f9; margin-bottom: 14px;
    }
    .toggle-row strong { display: block; font-size: 14px; color: #0f172a; }
    .toggle-row .sub-text { font-size: 12px; color: #94a3b8; margin-top: 2px; }

    .switch { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; cursor: pointer; inset: 0;
      background: #cbd5e1; transition: 0.3s; border-radius: 24px;
    }
    .slider:before {
      position: absolute; content: ''; height: 18px; width: 18px;
      left: 3px; bottom: 3px; background: white; transition: 0.3s; border-radius: 50%;
    }
    .switch input:checked + .slider { background: #22c55e; }
    .switch input:checked + .slider:before { transform: translateX(20px); }

    .actions-row { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
    .btn-green { background: #22c55e; color: white; }
    .btn-green:hover { background: #16a34a; }
    .hint { display: block; font-size: 11px; color: #94a3b8; margin-top: 4px; }
    textarea.form-input { resize: vertical; font-family: inherit; }

    .wan-info { background: #f8fafc; border-radius: 10px; padding: 16px; }
    .wan-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    .wan-row:last-child { border-bottom: none; }
    .wan-label { color: #64748b; min-width: 160px; }
    .wan-value { color: #6366f1; font-family: 'Courier New', monospace; font-weight: 700; font-size: 18px; }
    .mono { font-family: 'Courier New', monospace; }
    .muted { color: #94a3b8; font-size: 12px; font-style: italic; }
    .btn-copy { padding: 4px 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: white; color: #6366f1; font-size: 11px; cursor: pointer; }
    .btn-copy:hover { background: #6366f1; color: white; border-color: #6366f1; }

    .paper-select { display: flex; gap: 8px; }
    .paper-select button {
      flex: 1; padding: 10px; border: 2px solid #e2e8f0; border-radius: 10px;
      background: white; font-size: 14px; font-weight: 500; color: #475569;
      cursor: pointer; transition: all 0.2s;
    }
    .paper-select button.active { border-color: #6366f1; background: #eef2ff; color: #6366f1; }
    .paper-select button:hover { border-color: #6366f1; }

    .help-text { font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 0; }
    .help-text code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 11px; }

    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 20px; border-radius: 10px; font-size: 14px; font-weight: 500;
      cursor: pointer; border: none; transition: all 0.2s;
    }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-red { background: #ef4444; color: white; }
    .btn-red:hover { background: #dc2626; }

    .saved-msg { font-size: 13px; color: #16a34a; font-weight: 500; margin-left: 12px; }

    .db-info { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
    .db-stat { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #64748b; }
    .db-val { font-weight: 700; color: #0f172a; }

    .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .info-item { display: flex; flex-direction: column; gap: 2px; }
    .info-item span:first-child { font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600; }
    .info-item span:last-child { font-size: 14px; color: #0f172a; font-weight: 500; }

    @media (max-width: 768px) {
      .settings-grid { grid-template-columns: 1fr; }
      .form-row { grid-template-columns: 1fr; }
      .info-grid { grid-template-columns: 1fr 1fr; }
    }
  `]
})
export class SettingsComponent implements OnInit {
  private db = inject(LocalDbService);
  private scheduler = inject(NotificationSchedulerService);
  private toast = inject(ToastService);
  config = inject(ConfigService);

  apiUrl = environment.apiUrl;
  apiKey = environment.apiKey;
  showKey = signal(false);
  saved = signal(false);
  private http = inject(HttpClient);
  wanIp = signal('');
  isp = signal('');
  city = signal('');
  country = signal('');
  detecting = signal(false);
  localClientsCount = signal(0);
  localInvoicesCount = signal(0);
  localTicketsCount = signal(0);
  lastSyncClients = signal('');
  lastSyncInvoices = signal('');

  async ngOnInit() {
    this.localClientsCount.set((await this.db.getClients()).length);
    this.localInvoicesCount.set((await this.db.getInvoices()).length);
    this.localTicketsCount.set((await this.db.getTickets()).length);
    const lsc = await this.db.getLastSync('clients');
    const lsi = await this.db.getLastSync('invoices');
    if (lsc) this.lastSyncClients.set(new Date(lsc).toLocaleString('es-DO'));
    if (lsi) this.lastSyncInvoices.set(new Date(lsi).toLocaleString('es-DO'));
  }

  saveConfig() {
    this.config.save();
    this.saved.set(true);
    this.toast.success('Configuracion guardada');
    // If auto-notif was enabled, start scheduler
    if (this.config.autoNotifEnabled()) {
      this.scheduler.start();
    } else {
      this.scheduler.stop();
    }
    setTimeout(() => this.saved.set(false), 3000);
  }

  runNotifNow() {
    this.scheduler.runNow();
  }

  async detectWanIp() {
    this.detecting.set(true);
    try {
      const ipRes: any = await this.http.get('https://api.ipify.org?format=json').toPromise();
      this.wanIp.set(ipRes.ip);
      try {
        const geo: any = await this.http.get(`https://ipapi.co/${ipRes.ip}/json/`).toPromise();
        this.isp.set(geo.org || geo.asn || '');
        this.city.set(geo.city || '');
        this.country.set(geo.country_name || '');
      } catch {}
    } catch (e) {
      this.toast.error('No se pudo detectar IP');
    }
    this.detecting.set(false);
  }

  copyIp() {
    navigator.clipboard.writeText(this.wanIp());
    this.toast.success('IP copiada al portapapeles');
  }

  async clearLocalData() {
    indexedDB.deleteDatabase('WishubDB');
    this.localClientsCount.set(0);
    this.localInvoicesCount.set(0);
    this.localTicketsCount.set(0);
    this.lastSyncClients.set('');
    this.lastSyncInvoices.set('');
  }
}
