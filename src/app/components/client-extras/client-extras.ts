import { Component, inject, input, OnInit, signal, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ToastService } from '../../services/toast.service';

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
  imports: [FormsModule, DecimalPipe],
  template: `
    <!-- ALIAS / NOMBRE REAL -->
    <div class="card">
      <div class="card-head">
        <h3>📝 Alias / Nombre Real</h3>
        @if (!editingAlias()) {
          <button class="btn-edit" (click)="startEditAlias()">Editar</button>
        }
      </div>
      <p class="hint">Estos datos se usan en las facturas y mensajes WhatsApp en lugar de los de Wisphub. Útil cuando el nombre en Wisphub está cortado o sin apellido.</p>

      @if (editingAlias()) {
        <div class="form">
          <label>
            <span>Nombre completo real</span>
            <input type="text" [(ngModel)]="aliasForm.aliasNombre" placeholder="Ej: Máximo Eduardo Pérez Rodríguez" />
          </label>
          <label>
            <span>Cédula</span>
            <input type="text" [(ngModel)]="aliasForm.aliasCedula" placeholder="000-0000000-0" />
          </label>
          <label>
            <span>Teléfono</span>
            <input type="text" [(ngModel)]="aliasForm.aliasTelefono" placeholder="809-XXX-XXXX" />
          </label>
          <label class="full">
            <span>Notas internas</span>
            <textarea [(ngModel)]="aliasForm.aliasNotas" rows="2" placeholder="Notas privadas (no se muestran al cliente)"></textarea>
          </label>
          <div class="actions">
            <button class="btn btn-primary" (click)="saveAlias()" [disabled]="savingAlias()">
              {{ savingAlias() ? 'Guardando...' : 'Guardar' }}
            </button>
            <button class="btn btn-outline" (click)="editingAlias.set(false)">Cancelar</button>
          </div>
        </div>
      } @else {
        <div class="info-grid">
          <div class="info-item">
            <span class="lbl">Nombre real</span>
            <span class="val" [class.empty]="!aliasData()?.aliasNombre">
              {{ aliasData()?.aliasNombre || '(usar el de Wisphub)' }}
            </span>
          </div>
          <div class="info-item">
            <span class="lbl">Cédula</span>
            <span class="val" [class.empty]="!aliasData()?.aliasCedula">
              {{ aliasData()?.aliasCedula || '(usar el de Wisphub)' }}
            </span>
          </div>
          <div class="info-item">
            <span class="lbl">Teléfono</span>
            <span class="val" [class.empty]="!aliasData()?.aliasTelefono">
              {{ aliasData()?.aliasTelefono || '(usar el de Wisphub)' }}
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
        <h3>🌐 Actividad Web (DNS) — últimos {{ webActivityDays() }} días</h3>
        <select [ngModel]="webActivityDays()" (ngModelChange)="onChangeDays($event)">
          <option [ngValue]="1">Hoy</option>
          <option [ngValue]="7">7 días</option>
          <option [ngValue]="30">30 días</option>
        </select>
      </div>

      @if (loadingWeb()) {
        <p class="hint">Cargando...</p>
      } @else if (webData() && webData()!.totalQueries === 0) {
        <div class="empty-web">
          <p>📡 <strong>0 queries DNS registradas</strong></p>
          <p class="hint">
            Para que aparezcan datos, los clientes deben usar al MikroTik como servidor DNS. Actualmente probablemente apuntan a 8.8.8.8 directo.
            <br><br>
            Para activar:
            <code>/ip dns set allow-remote-requests=yes</code>
            <br>
            Y en el DHCP server: configurar el MikroTik como DNS de los clientes.
          </p>
        </div>
      } @else if (webData()) {
        <div class="kpi-row">
          <div class="kpi"><span class="n">{{ webData()!.totalQueries | number }}</span><span class="l">consultas</span></div>
          <div class="kpi"><span class="n">{{ webData()!.totalDomains | number }}</span><span class="l">dominios únicos</span></div>
        </div>
        <h4>Top dominios</h4>
        <table class="data-table-compact">
          <thead><tr><th>Dominio</th><th class="num">Consultas</th></tr></thead>
          <tbody>
            @for (d of webData()!.topDomains.slice(0, 20); track d.domain) {
              <tr>
                <td class="dom">{{ d.domain }}</td>
                <td class="num"><strong>{{ d.queryCount | number }}</strong></td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
  styles: [`
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; margin-bottom: 16px; }
    .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 12px; }
    .card-head h3 { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }
    .card-head select { padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; background: white; cursor: pointer; }
    .hint { color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 14px; }

    .btn-edit { background: #eef2ff; color: #6366f1; border: none; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn-edit:hover { background: #e0e7ff; }

    .form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form label { display: flex; flex-direction: column; gap: 4px; }
    .form label.full { grid-column: 1 / -1; }
    .form span { font-size: 12px; color: #64748b; font-weight: 500; }
    .form input, .form textarea { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; outline: none; resize: vertical; font-family: inherit; }
    .form input:focus, .form textarea:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
    .actions { grid-column: 1 / -1; display: flex; gap: 10px; margin-top: 4px; }
    .btn { padding: 10px 18px; border-radius: 10px; border: none; font-weight: 600; cursor: pointer; font-size: 14px; }
    .btn-primary { background: #6366f1; color: white; }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
    .info-item { display: flex; flex-direction: column; gap: 3px; }
    .info-item.full { grid-column: 1 / -1; }
    .lbl { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
    .val { font-size: 14px; color: #0f172a; font-weight: 500; }
    .val.empty { color: #cbd5e1; font-style: italic; font-weight: 400; }
    .val.notes { white-space: pre-wrap; background: #fefce8; padding: 8px 12px; border-radius: 8px; font-size: 13px; border: 1px solid #fde68a; }

    .empty-web { background: #f8fafc; border-radius: 10px; padding: 16px; }
    .empty-web p { margin: 0 0 6px; }
    .empty-web code { background: #1e293b; color: #f1f5f9; padding: 4px 10px; border-radius: 6px; font-size: 12px; display: inline-block; margin-top: 4px; }

    .kpi-row { display: flex; gap: 12px; margin-bottom: 14px; }
    .kpi { background: #f8fafc; border-radius: 10px; padding: 12px 16px; flex: 1; display: flex; flex-direction: column; }
    .kpi .n { font-size: 20px; font-weight: 700; color: #0f172a; }
    .kpi .l { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }

    .data-table-compact { width: 100%; border-collapse: collapse; }
    .data-table-compact th { text-align: left; font-size: 11px; color: #64748b; text-transform: uppercase; padding: 8px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .data-table-compact td { padding: 8px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
    .data-table-compact td.dom { color: #6366f1; font-family: 'Courier New', monospace; word-break: break-all; }
    .data-table-compact .num { text-align: right; }

    @media (max-width: 768px) {
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
        this.toast.success('Alias guardado. Se aplicará en próximas facturas/mensajes.');
      },
      error: (err) => {
        this.savingAlias.set(false);
        this.toast.error(err.error?.error || 'Error guardando alias');
      },
    });
  }

  loadWebActivity() {
    this.loadingWeb.set(true);
    this.http.get<WebActivityResp>(`/web-activity/${this.idServicio()}?days=${this.webActivityDays()}`).subscribe({
      next: (d) => { this.webData.set(d); this.loadingWeb.set(false); },
      error: () => { this.loadingWeb.set(false); },
    });
  }

  onChangeDays(v: number) {
    this.webActivityDays.set(v);
    this.loadWebActivity();
  }
}
