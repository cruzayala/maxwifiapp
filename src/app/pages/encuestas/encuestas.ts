import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NavbarComponent } from '../../components/layout/navbar';
import { SurveyService, SurveyResponse } from '../../services/survey.service';
import { ToastService } from '../../services/toast.service';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';
import {
  LucideCalendarDays, LucideLink, LucideMessageCircle, LucidePause, LucidePencil, LucidePlay,
  LucideRefreshCw, LucideRepeat, LucideSearch, LucideSettings, LucideTimer, LucideTrash2, LucideX,
} from '@lucide/angular';

interface ReminderConfig {
  intervalHours: number;
  maxReminders: number;
  pausedGlobally: boolean;
  minIntervalHours: number;
  lastRun?: any;
}

@Component({
  selector: 'app-encuestas',
  standalone: true,
  imports: [
    FormsModule, NavbarComponent, DatePipe, PlanLabelPipe,
    LucideCalendarDays, LucideLink, LucideMessageCircle, LucidePause, LucidePencil, LucidePlay,
    LucideRefreshCw, LucideRepeat, LucideSearch, LucideSettings, LucideTimer, LucideTrash2, LucideX,
  ],
  template: `
    <app-navbar pageTitle="Encuestas a clientes" />

    <div class="page">
      <!-- PANEL DE RECORDATORIOS (ANTISPAM) -->
      @if (config()) {
        <div class="cfg-panel" [class.paused]="config()!.pausedGlobally">
          <div class="cfg-main">
            <div class="cfg-status">
              <span class="cfg-dot" [class.on]="!config()!.pausedGlobally"></span>
              <strong>{{ config()!.pausedGlobally ? 'Recordatorios en pausa' : 'Recordatorios activos' }}</strong>
            </div>
            <div class="cfg-info">
              <span><svg lucideCalendarDays size="14"></svg> Cada <strong>{{ formatInterval(config()!.intervalHours) }}</strong></span>
              <span><svg lucideRepeat size="14"></svg> Máximo <strong>{{ config()!.maxReminders }}</strong> envíos por persona</span>
              <span><svg lucideTimer size="14"></svg> Mínimo permitido: {{ formatInterval(config()!.minIntervalHours) }}</span>
            </div>
            @if (config()!.pausedGlobally) {
              <small class="cfg-note">No se envía ningún recordatorio automático hasta que toques “Reanudar”.</small>
            }
          </div>
          <div class="cfg-actions">
            <button type="button" class="btn-outline" (click)="openCfg()"><svg lucideSettings size="14"></svg> Configurar</button>
            @if (config()!.pausedGlobally) {
              <button type="button" class="btn-success" (click)="toggleGlobal(false)"><svg lucidePlay size="14"></svg> Reanudar</button>
            } @else {
              <button type="button" class="btn-warn" (click)="toggleGlobal(true)"><svg lucidePause size="14"></svg> Pausar todo</button>
            }
          </div>
        </div>
      }

      @if (showCfg()) {
        <div class="modal-backdrop" (click)="showCfg.set(false)">
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cfg-title" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3 id="cfg-title">Frecuencia de recordatorios</h3>
              <button type="button" class="modal-close" aria-label="Cerrar" (click)="showCfg.set(false)"><svg lucideX size="18"></svg></button>
            </div>
            <p class="modal-help">
              Para evitar spam, el mínimo es {{ formatInterval(minInterval()) }} entre envíos
              y máximo 10 envíos por persona. Los cambios se aplican en el próximo ciclo.
            </p>
            <div class="cfg-form">
              <label>
                Intervalo entre envíos (horas)
                <input type="number" [min]="minInterval()" max="2160" step="24"
                  [class.invalid]="!!intervalError()"
                  [(ngModel)]="cfgForm.intervalHours" />
                @if (intervalError()) {
                  <small class="err">{{ intervalError() }}</small>
                } @else {
                  <small>Equivale a {{ formatInterval(cfgForm.intervalHours) }}.</small>
                }
              </label>
              <label>
                Máximo de envíos por encuesta
                <input type="number" min="1" max="10" [class.invalid]="!!maxError()" [(ngModel)]="cfgForm.maxReminders" />
                @if (maxError()) {
                  <small class="err">{{ maxError() }}</small>
                } @else {
                  <small>Al llegar a este número, no se vuelve a enviar.</small>
                }
              </label>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn-outline" (click)="showCfg.set(false)">Cancelar</button>
              <button type="button" class="btn-primary" (click)="saveCfg()" [disabled]="savingCfg() || !!intervalError() || !!maxError()"
                [title]="intervalError() || maxError() || ''">
                @if (savingCfg()) { Guardando… } @else { Guardar }
              </button>
            </div>
          </div>
        </div>
      }

      <div class="toolbar">
        <div class="filters">
          <button type="button" class="chip" [class.active]="statusFilter() === ''" (click)="setFilter('')">Todas ({{ total() }})</button>
          <button type="button" class="chip" [class.active]="statusFilter() === 'pending'" (click)="setFilter('pending')">
            Pendientes ({{ pendingCount() }})
          </button>
          <button type="button" class="chip" [class.active]="statusFilter() === 'submitted'" (click)="setFilter('submitted')">
            Respondidas ({{ submittedCount() }})
          </button>
          <button type="button" class="chip" [class.active]="statusFilter() === 'cancelled'" (click)="setFilter('cancelled')">
            Canceladas ({{ cancelledCount() }})
          </button>
        </div>
        <div class="actions">
          <div class="search">
            <svg lucideSearch size="14"></svg>
            <input type="search" placeholder="Buscar cliente, IP o teléfono…" aria-label="Buscar encuesta"
              [ngModel]="search()" (ngModelChange)="search.set($event)" />
          </div>
          <button type="button" class="btn-icon" (click)="openTemplate()" title="Editar el mensaje que se envía por WhatsApp">
            <svg lucidePencil size="15"></svg> Mensaje de WhatsApp
          </button>
          <button type="button" class="btn-icon" (click)="load()" title="Actualizar la lista" aria-label="Actualizar la lista">
            <svg lucideRefreshCw size="15"></svg> Actualizar
          </button>
        </div>
      </div>

      <!-- Editor del mensaje -->
      @if (showTemplate()) {
        <div class="modal-backdrop" (click)="closeTemplate()">
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="tpl-title" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3 id="tpl-title">Mensaje de WhatsApp</h3>
              <button type="button" class="modal-close" aria-label="Cerrar" (click)="closeTemplate()"><svg lucideX size="18"></svg></button>
            </div>
            <p class="modal-help">
              Datos que puedes insertar: <code>{{ '{nombre}' }}</code> <code>{{ '{negocio}' }}</code> <code>{{ '{url}' }}</code> <code>{{ '{telefono}' }}</code> <code>{{ '{ip}' }}</code> <code>{{ '{plan}' }}</code><br>
              <strong>{{ '{url}' }}</strong> es obligatorio: ahí va el enlace corto de la encuesta (por ejemplo <code>/s/abc12d</code>).
            </p>
            <textarea class="template-input" [class.invalid]="!templateHasUrl()" [(ngModel)]="templateDraft" rows="10" aria-label="Texto del mensaje"></textarea>
            @if (!templateHasUrl()) {
              <small class="err">Falta <strong>{{ '{url}' }}</strong>: sin el enlace, el cliente no podrá abrir la encuesta.</small>
            }
            <div class="modal-actions">
              <button type="button" class="btn-outline" (click)="resetToDefault()">Restaurar mensaje original</button>
              <button type="button" class="btn-primary" (click)="saveTemplate()" [disabled]="savingTemplate() || !templateHasUrl()">
                @if (savingTemplate()) { Guardando… } @else { Guardar }
              </button>
            </div>
          </div>
        </div>
      }

      @if (loading()) {
        <div class="loader">Cargando encuestas…</div>
      } @else if (filteredRows().length === 0) {
        <div class="empty">
          @if (search().trim()) {
            <h3>Ninguna encuesta coincide con “{{ search().trim() }}”</h3>
            <p>Revisa lo que escribiste o borra la búsqueda.</p>
          } @else {
            <h3>No hay encuestas{{ statusFilter() ? ' en este estado' : '' }}</h3>
            <p>Para enviar una encuesta, ve a <strong>Clientes</strong> y toca el botón “Encuesta” junto al cliente.</p>
          }
        </div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Estado</th>
                <th>Cliente</th>
                <th>IP</th>
                <th>Respuesta del cliente</th>
                <th>Enviada</th>
                <th>Respondida</th>
                <th>Próximo aviso</th>
                <th>Enviada por</th>
                <th>Enlace</th>
                <th class="right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (r of filteredRows(); track r.id) {
                <tr>
                  <td>
                    <span class="badge" [class]="'st-' + r.status">{{ statusLabel(r.status) }}</span>
                  </td>
                  <td>
                    @if (r.client) {
                      <strong>{{ r.client.nombre }}</strong>
                      <div class="muted">{{ r.client.planInternetName | planLabel:'—' }}</div>
                    } @else {
                      <span class="muted">Sin cliente vinculado</span>
                    }
                  </td>
                  <td class="mono">{{ r.clientIp }}</td>
                  <td>
                    @if (r.fullName || r.phone) {
                      <div>{{ r.fullName || '—' }}</div>
                      @if (r.phone) { <div class="muted">{{ r.phone }}</div> }
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td class="date">{{ r.sentAt | date:'dd/MM/yy h:mm a' }}</td>
                  <td class="date">{{ r.submittedAt ? (r.submittedAt | date:'dd/MM/yy h:mm a') : '—' }}</td>
                  <td class="date">
                    @if (r.status === 'pending' && r.nextReminderAt) {
                      {{ r.nextReminderAt | date:'dd/MM/yy h:mm a' }}
                      <div class="muted">{{ r.reminderCount || 0 }} {{ (r.reminderCount || 0) === 1 ? 'aviso enviado' : 'avisos enviados' }}</div>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td>{{ r.sentBy || '—' }}</td>
                  <td>
                    @if (r.status === 'pending' && (r.shortUrl || r.publicUrl)) {
                      <button type="button" class="btn-link" (click)="copyLink(r.shortUrl || r.publicUrl)" [title]="'Copiar enlace: ' + (r.shortUrl || r.publicUrl)">
                        <svg lucideLink size="12"></svg>
                        @if (r.shortUrl) { {{ r.shortCode }} } @else { Copiar enlace }
                      </button>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td class="right nowrap">
                    @if (r.status === 'pending') {
                      <button type="button" class="btn-resend" [disabled]="resendingId() === r.id" (click)="resend(r)" title="Reenviar por WhatsApp">
                        <svg lucideMessageCircle size="12"></svg>
                        @if (resendingId() === r.id) { Enviando… } @else { WhatsApp }
                      </button>
                      <button type="button" class="btn-cancel" (click)="cancel(r)" title="Cancelar la encuesta">Cancelar</button>
                    }
                    <button type="button" class="btn-delete" (click)="del(r)" title="Eliminar registro" aria-label="Eliminar registro">
                      <svg lucideTrash2 size="13"></svg>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }
    .cfg-panel {
      display: flex; justify-content: space-between; align-items: center; gap: 16px;
      background: white; border: 1px solid #e0e6e1; border-left: 4px solid #0f7a53;
      border-radius: 12px; padding: 14px 20px; margin-bottom: 18px;
      flex-wrap: wrap;
    }
    .cfg-panel.paused { border-left-color: #b36b12; background: #fff6e8; }
    .cfg-main { display: flex; flex-direction: column; gap: 6px; }
    .cfg-status { display: flex; align-items: center; gap: 8px; color: #15211c; font-size: 14px; }
    .cfg-dot { width: 8px; height: 8px; border-radius: 50%; background: #b36b12; }
    .cfg-dot.on { background: #0f7a53; box-shadow: 0 0 0 3px #e9f8f1; }
    .cfg-info { display: flex; gap: 16px; font-size: 13px; color: #56665e; flex-wrap: wrap; }
    .cfg-info span { display: inline-flex; align-items: center; gap: 5px; }
    .cfg-info strong { color: #15211c; }
    .cfg-note { font-size: 12px; color: #8a5410; }
    .cfg-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn-outline, .btn-success, .btn-warn, .btn-primary {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1px solid transparent; border-radius: 9px; padding: 8px 14px;
      font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s, border-color 0.15s;
    }
    .btn-outline { background: white; border-color: #cfd8d2; color: #2d3b34; }
    .btn-outline:hover { border-color: #0b6b52; color: #0b6b52; }
    .btn-success { background: #0f7a53; color: white; }
    .btn-success:hover { background: #0f704a; }
    .btn-warn { background: white; border-color: #e7c28f; color: #b36b12; }
    .btn-warn:hover { background: #fff6e8; }
    .btn-primary { background: #0b6b52; color: white; }
    .btn-primary:hover:not(:disabled) { background: #08523f; }
    .btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }

    .cfg-form { display: flex; flex-direction: column; gap: 16px; padding: 14px 0; }
    .cfg-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; color: #15211c; }
    .cfg-form input { padding: 9px 12px; border: 1px solid #cfd8d2; border-radius: 9px; font-size: 13px; outline: none; }
    .cfg-form input:focus { border-color: #0b6b52; box-shadow: 0 0 0 3px rgba(11, 107, 82, 0.12); }
    .cfg-form small { color: #56665e; font-size: 12px; font-weight: 400; }
    .invalid { border-color: #b42318 !important; }
    small.err, .err { display: block; color: #b42318; font-size: 12px; font-weight: 500; margin-top: 4px; }

    .toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .chip {
      background: white; border: 1px solid #e0e6e1; color: #2d3b34;
      border-radius: 999px; padding: 6px 13px; font-size: 13px; font-weight: 500;
      cursor: pointer; transition: all 0.15s;
    }
    .chip:hover { border-color: #0b6b52; color: #0b6b52; }
    .chip.active { background: #0b6b52; border-color: #0b6b52; color: white; }

    .search {
      display: flex; align-items: center; gap: 6px; background: white; border: 1px solid #cfd8d2;
      border-radius: 9px; padding: 0 10px; color: #56665e;
    }
    .search:focus-within { border-color: #0b6b52; }
    .search input { border: none; outline: none; padding: 8px 0; font-size: 13px; width: 210px; color: #2d3b34; background: none; }

    .btn-icon {
      display: inline-flex; align-items: center; gap: 6px;
      background: white; border: 1px solid #cfd8d2; color: #2d3b34;
      border-radius: 9px; padding: 8px 12px; font-size: 13px; cursor: pointer;
    }
    .btn-icon:hover { border-color: #0b6b52; color: #0b6b52; }

    .loader, .empty { text-align: center; padding: 56px 20px; color: #56665e; background: white; border: 1px dashed #e0e6e1; border-radius: 12px; }
    .empty h3 { color: #15211c; margin: 0 0 8px; font-size: 16px; }
    .empty p { color: #56665e; max-width: 480px; margin: 0 auto; font-size: 13px; }

    .table-wrap { background: white; border-radius: 12px; border: 1px solid #e0e6e1; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 11px 12px; text-align: left; font-size: 13px; border-bottom: 1px solid #eff2ee; vertical-align: top; color: #2d3b34; }
    th { background: #f4f6f2; color: #56665e; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
    td strong { color: #15211c; }
    th.right, td.right { text-align: right; }
    .nowrap { white-space: nowrap; }
    tbody tr:hover { background: #f4f6f2; }
    .mono { font-family: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; color: #2d3b34; }
    .date { color: #56665e; font-size: 12px; white-space: nowrap; }
    .muted { color: #56665e; font-size: 12px; }

    .badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .st-pending { background: #fff6e8; color: #b36b12; }
    .st-submitted { background: #e9f8f1; color: #0f7a53; }
    .st-cancelled { background: #f1f4f7; color: #56665e; }
    .st-expired { background: #fff0ef; color: #b42318; }

    .btn-cancel, .btn-delete, .btn-link, .btn-resend {
      display: inline-flex; align-items: center; gap: 4px; vertical-align: middle;
      padding: 5px 9px; border-radius: 9px; font-size: 12px; cursor: pointer; font-weight: 600;
      border: 1px solid transparent; margin-left: 4px;
    }
    .btn-cancel { background: white; border-color: #e7c28f; color: #b36b12; }
    .btn-cancel:hover { background: #fff6e8; }
    .btn-delete { background: white; border-color: #f0c4bf; color: #b42318; padding: 5px 7px; }
    .btn-delete:hover { background: #fff0ef; }
    .btn-link { margin-left: 0; border-color: #cfe0fa; background: #eef6f1; color: #0b6b52; font-family: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    .btn-link:hover { background: #e6f2ec; border-color: #0b6b52; }
    .btn-resend { border-color: #bfe6d3; background: #e9f8f1; color: #0f7a53; margin-left: 0; }
    .btn-resend:hover:not(:disabled) { border-color: #0f7a53; }
    .btn-resend:disabled { opacity: 0.6; cursor: wait; }

    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(14, 29, 23, 0.55); z-index: 100;
      display: flex; align-items: center; justify-content: center; padding: 16px;
    }
    .modal {
      background: white; border-radius: 12px; max-width: 600px; width: 100%; max-height: calc(100vh - 32px); overflow-y: auto;
      padding: 22px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25); box-sizing: border-box;
    }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .modal-header h3 { margin: 0; color: #15211c; font-size: 17px; }
    .modal-close { display: grid; place-items: center; background: none; border: none; cursor: pointer; color: #56665e; padding: 4px; border-radius: 9px; }
    .modal-close:hover { color: #15211c; background: #eef6f1; }
    .modal-help { font-size: 12px; color: #2d3b34; line-height: 1.6; background: #f4f6f2; border-radius: 9px; padding: 10px 14px; margin: 8px 0 14px; }
    .modal-help code { background: white; padding: 1px 6px; border-radius: 4px; font-size: 11px; border: 1px solid #e0e6e1; color: #0b6b52; font-family: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    .template-input {
      width: 100%; box-sizing: border-box; font-family: inherit; font-size: 13px; line-height: 1.5; color: #2d3b34;
      padding: 12px 14px; border: 1px solid #cfd8d2; border-radius: 9px;
      resize: vertical; min-height: 180px; outline: none;
    }
    .template-input:focus { border-color: #0b6b52; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; margin-top: 14px; }

    @media (max-width: 768px) {
      .page { padding: 16px; }
      .toolbar { flex-direction: column; align-items: stretch; }
      .search { flex: 1 1 100%; }
      .search input { width: 100%; }
      th, td { padding: 8px 10px; }
    }
  `]
})
export class EncuestasComponent implements OnInit {
  private survey = inject(SurveyService);
  private toast = inject(ToastService);
  private http = inject(HttpClient);

  rows = signal<SurveyResponse[]>([]);
  loading = signal(true);
  statusFilter = signal<string>('');
  /** Búsqueda local por cliente, IP o teléfono (solo visual). */
  search = signal('');
  resendingId = signal<number | null>(null);

  // Editor de plantilla WhatsApp
  showTemplate = signal(false);
  savingTemplate = signal(false);
  templateDraft = '';
  templateDefault = '';

  // Config antispam
  config = signal<ReminderConfig | null>(null);
  showCfg = signal(false);
  savingCfg = signal(false);
  cfgForm: { intervalHours: number; maxReminders: number } = { intervalHours: 168, maxReminders: 3 };

  formatInterval(hours: number): string {
    if (!hours) return '—';
    if (hours >= 168) {
      const w = Math.round(hours / 168);
      return `${w} semana${w > 1 ? 's' : ''}`;
    }
    if (hours >= 24) {
      const d = Math.round(hours / 24);
      return `${d} día${d > 1 ? 's' : ''}`;
    }
    return `${hours}h`;
  }

  loadConfig() {
    this.http.get<ReminderConfig>('/api/survey/reminders/status').subscribe({
      next: (c) => this.config.set(c),
      error: () => {},
    });
  }

  openCfg() {
    const c = this.config();
    if (c) this.cfgForm = { intervalHours: c.intervalHours, maxReminders: c.maxReminders };
    this.showCfg.set(true);
  }

  saveCfg() {
    this.savingCfg.set(true);
    this.http.put<ReminderConfig>('/api/survey/reminders/config', this.cfgForm).subscribe({
      next: (c) => {
        this.savingCfg.set(false);
        this.config.set({ ...(this.config() as ReminderConfig), ...c });
        this.showCfg.set(false);
        this.toast.success('Configuración guardada');
      },
      error: (e) => {
        this.savingCfg.set(false);
        this.toast.error(e.error?.error || 'No se pudo guardar la configuración');
      },
    });
  }

  toggleGlobal(pause: boolean) {
    const action = pause ? 'pause-all' : 'resume-all';
    if (pause && !confirm('¿Pausar TODOS los recordatorios de encuestas? Los envíos automáticos se detienen hasta que reanudes.')) return;
    this.http.post<{ pausedGlobally: boolean }>(`/api/survey/reminders/${action}`, {}).subscribe({
      next: (r) => {
        const c = this.config();
        if (c) this.config.set({ ...c, pausedGlobally: r.pausedGlobally });
        this.toast.success(pause ? 'Recordatorios pausados' : 'Recordatorios reanudados');
      },
      error: (e) => this.toast.error(e.error?.error || 'No se pudo cambiar el estado de los recordatorios'),
    });
  }

  filteredRows = computed(() => {
    const f = this.statusFilter();
    const term = this.search().toLowerCase().trim();
    let rows = f ? this.rows().filter(r => r.status === f) : this.rows();
    if (term) {
      rows = rows.filter(r =>
        r.client?.nombre?.toLowerCase().includes(term) ||
        r.clientIp?.includes(term) ||
        r.fullName?.toLowerCase().includes(term) ||
        r.phone?.includes(term) ||
        r.client?.telefono?.includes(term)
      );
    }
    return rows;
  });

  total = computed(() => this.rows().length);
  pendingCount = computed(() => this.rows().filter(r => r.status === 'pending').length);
  submittedCount = computed(() => this.rows().filter(r => r.status === 'submitted').length);
  cancelledCount = computed(() => this.rows().filter(r => r.status === 'cancelled').length);

  minInterval(): number {
    return this.config()?.minIntervalHours || 168;
  }

  /** Validación visible del formulario de frecuencia (el servidor valida igual). */
  intervalError(): string {
    const v = Number(this.cfgForm.intervalHours);
    if (!v) return 'Escribe cada cuántas horas se envía el recordatorio.';
    if (v < this.minInterval()) return `Debe ser al menos ${this.minInterval()} horas (${this.formatInterval(this.minInterval())}).`;
    if (v > 2160) return 'Debe ser como máximo 2160 horas (90 días).';
    return '';
  }

  maxError(): string {
    const v = Number(this.cfgForm.maxReminders);
    if (!v || v < 1 || v > 10) return 'Debe ser un número entre 1 y 10.';
    return '';
  }

  templateHasUrl(): boolean {
    return (this.templateDraft || '').includes('{url}');
  }

  ngOnInit() {
    this.load();
    this.loadConfig();
  }

  setFilter(s: string) { this.statusFilter.set(s); }

  load() {
    this.loading.set(true);
    this.survey.list().subscribe({
      next: r => {
        this.rows.set(r.rows || []);
        this.loading.set(false);
      },
      error: e => {
        this.toast.error(e.error?.error || 'No se pudieron cargar las encuestas. Revisa la conexión e intenta de nuevo.');
        this.loading.set(false);
      }
    });
  }

  statusLabel(s: string): string {
    switch (s) {
      case 'pending': return 'Pendiente';
      case 'submitted': return 'Respondida';
      case 'cancelled': return 'Cancelada';
      case 'expired': return 'Expirada';
      default: return s;
    }
  }

  openTemplate() {
    this.survey.getTemplate().subscribe({
      next: (r) => {
        this.templateDraft = r.template || '';
        this.templateDefault = r.default || '';
        this.showTemplate.set(true);
      },
      error: (e) => this.toast.error(e.error?.error || 'No se pudo cargar la plantilla'),
    });
  }
  closeTemplate() { this.showTemplate.set(false); }
  resetToDefault() { this.templateDraft = this.templateDefault; }
  saveTemplate() {
    if (!this.templateDraft.includes('{url}')) {
      this.toast.error('La plantilla debe contener {url}');
      return;
    }
    this.savingTemplate.set(true);
    this.survey.saveTemplate(this.templateDraft).subscribe({
      next: (r) => {
        this.savingTemplate.set(false);
        if (r.ok) {
          this.toast.success('Plantilla guardada');
          this.closeTemplate();
        } else {
          this.toast.error(r.error || 'No se pudo guardar');
        }
      },
      error: (e) => {
        this.savingTemplate.set(false);
        this.toast.error(e.error?.error || 'No se pudo guardar el mensaje');
      },
    });
  }

  resend(r: SurveyResponse) {
    if (r.status !== 'pending') return;
    if (!confirm(`¿Reenviar el mensaje de WhatsApp${r.client?.nombre ? ' a ' + r.client.nombre : ''} (${r.client?.telefono || 'sin teléfono'})?`)) return;
    this.resendingId.set(r.id);
    this.survey.resend(r.id).subscribe({
      next: (resp) => {
        this.resendingId.set(null);
        if (resp.ok) {
          this.toast.success('WhatsApp enviado');
          this.load();
        } else {
          this.toast.error(resp.error || 'No se pudo enviar');
        }
      },
      error: (e) => {
        this.resendingId.set(null);
        this.toast.error(e.error?.error || 'No se pudo reenviar el mensaje');
      },
    });
  }

  cancel(r: SurveyResponse) {
    if (!confirm(`¿Cancelar la encuesta${r.client?.nombre ? ' de ' + r.client.nombre : ''} (IP ${r.clientIp})?\n\nEl enlace dejará de aceptar respuestas. Si quedaba una regla antigua en el MikroTik, también se limpia.`)) return;
    this.survey.cancel(r.id).subscribe({
      next: () => {
        this.toast.success('Encuesta cancelada');
        this.load();
      },
      error: e => this.toast.error(e.error?.error || 'No se pudo cancelar')
    });
  }

  del(r: SurveyResponse) {
    if (!confirm(`¿Eliminar este registro de encuesta${r.client?.nombre ? ' de ' + r.client.nombre : ''}?\n\nSe borra de forma permanente y no se puede deshacer.`)) return;
    this.survey.delete(r.id).subscribe({
      next: () => {
        this.toast.success('Registro eliminado');
        this.load();
      },
      error: e => this.toast.error(e.error?.error || 'No se pudo eliminar')
    });
  }

  copyLink(url: string | null | undefined) {
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => this.toast.success('Enlace copiado'),
      () => this.toast.error('No se pudo copiar. Enlace: ' + url),
    );
  }
}
