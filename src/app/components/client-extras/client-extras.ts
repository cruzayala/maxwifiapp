import { Component, inject, input, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ToastService } from '../../services/toast.service';
import { LucideGlobe, LucideTriangleAlert, LucideUserPen } from '@lucide/angular';

interface AliasData {
  aliasNombre: string | null;
  aliasCedula: string | null;
  aliasTelefono: string | null;
  aliasNotas: string | null;
}

interface WebActivityResp {
  idServicio: number;
  days: number;
  totalDomains: number;
  totalQueries: number;
  byDay: Record<string, number>;
  topDomains: { domain: string; queryCount: number; day: string }[];
}

@Component({
  selector: 'app-client-extras',
  standalone: true,
  imports: [FormsModule, DecimalPipe, LucideGlobe, LucideTriangleAlert, LucideUserPen],
  template: `
    <!-- ALIAS / NOMBRE REAL -->
    <div class="card">
      <div class="card-head">
        <h3><svg lucideUserPen size="17"></svg> Nombre real y notas</h3>
        @if (!editingAlias()) {
          <button type="button" class="btn-edit" (click)="startEditAlias()">Editar</button>
        }
      </div>
      <p class="hint">Estos datos se usan en las facturas y los mensajes de WhatsApp en lugar de los de WispHub. Útil cuando el nombre en WispHub está cortado o sin apellido.</p>

      @if (editingAlias()) {
        <div class="form">
          <label>
            <span>Nombre completo real</span>
            <input type="text" [(ngModel)]="aliasForm.aliasNombre" placeholder="Ej.: Máximo Eduardo Pérez Rodríguez" />
          </label>
          <label>
            <span>Cédula</span>
            <input type="text" [(ngModel)]="aliasForm.aliasCedula" placeholder="000-0000000-0" />
          </label>
          <label>
            <span>Teléfono</span>
            <input type="tel" [(ngModel)]="aliasForm.aliasTelefono" placeholder="809-000-0000" />
          </label>
          <label class="full">
            <span>Notas internas</span>
            <textarea [(ngModel)]="aliasForm.aliasNotas" rows="2" placeholder="Notas privadas (el cliente no las ve)"></textarea>
          </label>
          <div class="actions">
            <button type="button" class="btn btn-primary" (click)="saveAlias()" [disabled]="savingAlias()">
              {{ savingAlias() ? 'Guardando…' : 'Guardar' }}
            </button>
            <button type="button" class="btn btn-outline" (click)="editingAlias.set(false)" [disabled]="savingAlias()">Cancelar</button>
          </div>
        </div>
      } @else {
        <div class="info-grid">
          <div class="info-item">
            <span class="lbl">Nombre real</span>
            <span class="val" [class.empty]="!aliasData()?.aliasNombre">
              {{ aliasData()?.aliasNombre || 'Igual que en WispHub' }}
            </span>
          </div>
          <div class="info-item">
            <span class="lbl">Cédula</span>
            <span class="val" [class.empty]="!aliasData()?.aliasCedula">
              {{ aliasData()?.aliasCedula || 'Igual que en WispHub' }}
            </span>
          </div>
          <div class="info-item">
            <span class="lbl">Teléfono</span>
            <span class="val" [class.empty]="!aliasData()?.aliasTelefono">
              {{ aliasData()?.aliasTelefono || 'Igual que en WispHub' }}
            </span>
          </div>
          @if (aliasData()?.aliasNotas) {
            <div class="info-item full">
              <span class="lbl">Notas internas</span>
              <span class="val notes">{{ aliasData()?.aliasNotas }}</span>
            </div>
          }
        </div>
      }
    </div>

    <!-- WEB ACTIVITY (DNS) -->
    <div class="card">
      <div class="card-head">
        <h3><svg lucideGlobe size="17"></svg> Actividad web · {{ daysLabel() }}</h3>
        <label class="period"><span class="sr-only">Periodo</span>
          <select [ngModel]="webActivityDays()" (ngModelChange)="onChangeDays($event)" aria-label="Periodo de actividad web">
            <option [ngValue]="1">Hoy</option>
            <option [ngValue]="7">Últimos 7 días</option>
            <option [ngValue]="30">Últimos 30 días</option>
          </select>
        </label>
      </div>

      @if (loadingWeb()) {
        <p class="hint loading"><span class="spinner"></span>Cargando actividad web…</p>
      } @else if (webError()) {
        <div class="empty-web error">
          <svg lucideTriangleAlert size="18"></svg>
          <div>
            <p><strong>No se pudo cargar la actividad web.</strong></p>
            <p class="hint">Revise la conexión con el servidor e intente de nuevo.</p>
            <button type="button" class="btn btn-outline small" (click)="loadWebActivity()">Reintentar</button>
          </div>
        </div>
      } @else if (webData() && webData()!.totalQueries === 0) {
        <div class="empty-web">
          <p><strong>No hay actividad web registrada en este periodo.</strong></p>
          <p class="hint">Normalmente ocurre cuando el equipo del cliente no usa el MikroTik como servidor DNS (por ejemplo, usa 8.8.8.8 directo). Un técnico puede activarlo.</p>
          <details>
            <summary>Instrucciones para el técnico</summary>
            <p class="hint">En el MikroTik ejecutar <code>/ip dns set allow-remote-requests=yes</code> y, en el servidor DHCP, entregar el MikroTik como DNS de los clientes.</p>
          </details>
        </div>
      } @else if (webData()) {
        <div class="kpi-row">
          <div class="kpi"><span class="n">{{ webData()!.totalQueries | number }}</span><span class="l">Consultas</span></div>
          <div class="kpi"><span class="n">{{ webData()!.totalDomains | number }}</span><span class="l">Sitios distintos</span></div>
        </div>
        <h4>Sitios más visitados</h4>
        <div class="table-scroll">
          <table class="data-table-compact">
            <thead><tr><th>Sitio</th><th class="num">Consultas</th></tr></thead>
            <tbody>
              @for (d of webData()!.topDomains.slice(0, 20); track d.domain) {
                <tr>
                  <td class="dom">{{ d.domain }}</td>
                  <td class="num"><strong>{{ d.queryCount | number }}</strong></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [`
    .card { background: white; border: 1px solid #e0e6e1; border-radius: 12px; padding: 20px; margin-bottom: 16px; color: #2d3b34; }
    .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 12px; flex-wrap: wrap; }
    .card-head h3 { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 15px; font-weight: 700; color: #15211c; }
    .card-head h3 svg { color: #0b6b52; flex: 0 0 auto; }
    .card-head select { min-height: 34px; padding: 6px 10px; border: 1px solid #cfd8d2; border-radius: 9px; font-size: 13px; background: white; color: #2d3b34; cursor: pointer; }
    .hint { color: #56665e; font-size: 13px; line-height: 1.5; margin: 0 0 14px; }
    .hint.loading { display: flex; align-items: center; gap: 8px; }
    .spinner { width: 16px; height: 16px; border: 2px solid #e0e6e1; border-top-color: #0b6b52; border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }

    .btn-edit { background: #fff; color: #0b6b52; border: 1px solid #cfd8d2; padding: 6px 12px; border-radius: 9px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn-edit:hover { background: #eef6f1; border-color: #0b6b52; }

    .form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form label { display: flex; flex-direction: column; gap: 4px; }
    .form label.full { grid-column: 1 / -1; }
    .form span { font-size: 12px; color: #2d3b34; font-weight: 600; }
    .form input, .form textarea { padding: 10px 12px; border: 1px solid #cfd8d2; border-radius: 9px; font-size: 14px; outline: none; resize: vertical; font-family: inherit; color: #15211c; }
    .form input:focus, .form textarea:focus { border-color: #0b6b52; box-shadow: 0 0 0 3px rgba(11, 107, 82, 0.1); }
    .actions { grid-column: 1 / -1; display: flex; gap: 10px; margin-top: 4px; }
    .btn { padding: 10px 18px; border-radius: 9px; border: 1px solid transparent; font-weight: 600; cursor: pointer; font-size: 14px; }
    .btn.small { padding: 6px 12px; font-size: 12px; }
    .btn:disabled { opacity: .6; cursor: not-allowed; }
    .btn-primary { background: #0b6b52; color: white; }
    .btn-primary:hover:not(:disabled) { background: #08523f; }
    .btn-outline { background: white; border-color: #cfd8d2; color: #2d3b34; }
    .btn-outline:hover:not(:disabled) { background: #f4f6f2; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
    .info-item { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .info-item.full { grid-column: 1 / -1; }
    .lbl { font-size: 11px; color: #56665e; text-transform: uppercase; font-weight: 700; }
    .val { font-size: 14px; color: #15211c; font-weight: 500; overflow-wrap: anywhere; }
    .val.empty { color: #8a98a5; font-style: italic; font-weight: 400; font-size: 13px; }
    .val.notes { white-space: pre-wrap; background: #fff6e8; padding: 8px 12px; border-radius: 9px; font-size: 13px; border: 1px solid #f3d19e; }

    .empty-web { background: #f4f6f2; border: 1px solid #e0e6e1; border-radius: 12px; padding: 16px; }
    .empty-web.error { display: flex; gap: 10px; align-items: flex-start; background: #fff0ef; border-color: #f0b4ae; }
    .empty-web.error > svg { color: #b42318; flex: 0 0 auto; margin-top: 2px; }
    .empty-web p { margin: 0 0 6px; }
    .empty-web details summary { cursor: pointer; color: #0b6b52; font-size: 12px; font-weight: 600; }
    .empty-web details .hint { margin: 8px 0 0; font-size: 12px; }
    .empty-web code { background: #15211c; color: #eef2ee; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-family: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace; overflow-wrap: anywhere; }

    .kpi-row { display: flex; gap: 12px; margin-bottom: 14px; }
    .kpi { background: #f4f6f2; border: 1px solid #ecf0ec; border-radius: 12px; padding: 12px 16px; flex: 1; display: flex; flex-direction: column; }
    .kpi .n { font-size: 20px; font-weight: 700; color: #15211c; }
    .kpi .l { font-size: 11px; color: #56665e; text-transform: uppercase; font-weight: 700; }
    h4 { margin: 0 0 8px; color: #15211c; font-size: 14px; }

    .table-scroll { overflow-x: auto; }
    .data-table-compact { width: 100%; border-collapse: collapse; }
    .data-table-compact th { text-align: left; font-size: 11px; color: #56665e; text-transform: uppercase; padding: 8px; background: #f4f6f2; border-bottom: 1px solid #e0e6e1; }
    .data-table-compact td { padding: 8px; font-size: 13px; border-bottom: 1px solid #ecf0ec; }
    .data-table-compact td.dom { color: #0b6b52; font-family: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; word-break: break-all; }
    .data-table-compact .num { text-align: right; }

    @media (max-width: 768px) {
      .card { padding: 16px; }
      .form { grid-template-columns: 1fr; }
      .info-grid { grid-template-columns: 1fr; }
    }
  `],
})
export class ClientExtrasComponent implements OnInit {
  private http = inject(HttpClient);
  private toast = inject(ToastService);

  idServicio = input.required<number>();

  aliasData = signal<AliasData | null>(null);
  aliasForm: AliasData = { aliasNombre: '', aliasCedula: '', aliasTelefono: '', aliasNotas: '' };
  editingAlias = signal(false);
  savingAlias = signal(false);

  webData = signal<WebActivityResp | null>(null);
  loadingWeb = signal(false);
  webError = signal(false);
  webActivityDays = signal(7);

  ngOnInit() {
    this.loadAlias();
    this.loadWebActivity();
  }

  loadAlias() {
    // Trae info del cliente (incluye aliases)
    this.http.get<any[]>('/clients-actions/aliases').subscribe({
      next: (rows) => {
        const found = rows.find((r) => r.idServicio === this.idServicio());
        if (found) {
          this.aliasData.set({
            aliasNombre: found.aliasNombre,
            aliasCedula: found.aliasCedula,
            aliasTelefono: found.aliasTelefono,
            aliasNotas: found.aliasNotas,
          });
        } else {
          this.aliasData.set({ aliasNombre: null, aliasCedula: null, aliasTelefono: null, aliasNotas: null });
        }
      },
      error: () => this.aliasData.set({ aliasNombre: null, aliasCedula: null, aliasTelefono: null, aliasNotas: null }),
    });
  }

  startEditAlias() {
    const d = this.aliasData() || { aliasNombre: '', aliasCedula: '', aliasTelefono: '', aliasNotas: '' };
    this.aliasForm = { ...d, aliasNombre: d.aliasNombre || '', aliasCedula: d.aliasCedula || '', aliasTelefono: d.aliasTelefono || '', aliasNotas: d.aliasNotas || '' };
    this.editingAlias.set(true);
  }

  saveAlias() {
    this.savingAlias.set(true);
    this.http.patch(`/clients-actions/${this.idServicio()}/alias`, this.aliasForm).subscribe({
      next: () => {
        this.savingAlias.set(false);
        this.editingAlias.set(false);
        this.aliasData.set({ ...this.aliasForm });
        this.toast.success('Datos guardados. Se usarán en las próximas facturas y mensajes.');
      },
      error: (err) => {
        this.savingAlias.set(false);
        this.toast.error(err.error?.error || 'No se pudieron guardar los datos. Intente de nuevo.');
      },
    });
  }

  loadWebActivity() {
    this.loadingWeb.set(true);
    this.webError.set(false);
    this.http.get<WebActivityResp>(`/web-activity/${this.idServicio()}?days=${this.webActivityDays()}`).subscribe({
      next: (d) => { this.webData.set(d); this.loadingWeb.set(false); },
      error: () => { this.loadingWeb.set(false); this.webError.set(true); },
    });
  }

  daysLabel(): string {
    const days = this.webActivityDays();
    return days === 1 ? 'hoy' : `últimos ${days} días`;
  }

  onChangeDays(v: number) {
    this.webActivityDays.set(v);
    this.loadWebActivity();
  }
}
