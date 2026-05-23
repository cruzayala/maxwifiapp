import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavbarComponent } from '../../components/layout/navbar';
import { SurveyService, SurveyResponse } from '../../services/survey.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-encuestas',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent, DatePipe],
  template: `
    <app-navbar pageTitle="Encuestas a clientes" />

    <div class="page">
      <div class="toolbar">
        <div class="filters">
          <button class="chip" [class.active]="statusFilter() === ''" (click)="setFilter('')">Todas ({{ total() }})</button>
          <button class="chip" [class.active]="statusFilter() === 'pending'" (click)="setFilter('pending')">
            Pendientes ({{ pendingCount() }})
          </button>
          <button class="chip" [class.active]="statusFilter() === 'submitted'" (click)="setFilter('submitted')">
            Respondidas ({{ submittedCount() }})
          </button>
          <button class="chip" [class.active]="statusFilter() === 'cancelled'" (click)="setFilter('cancelled')">
            Canceladas
          </button>
        </div>
        <div class="actions">
          <button class="btn-icon" (click)="load()" title="Refrescar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
            Refrescar
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="loader">Cargando...</div>
      } @else if (filteredRows().length === 0) {
        <div class="empty">
          <h3>Sin encuestas{{ statusFilter() ? ' en este estado' : '' }}</h3>
          <p>Activa encuestas desde la pagina de Clientes haciendo clic en el boton "Encuesta" junto a cada cliente.</p>
        </div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Estado</th>
                <th>Cliente</th>
                <th>IP</th>
                <th>Nombre respondido</th>
                <th>Telefono respondido</th>
                <th>Enviada</th>
                <th>Respondida</th>
                <th>Proximo aviso</th>
                <th>Activo por</th>
                <th>Enlace</th>
                <th>Acciones</th>
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
                      <div class="muted">{{ r.client.planInternetName || '-' }}</div>
                    } @else {
                      <span class="muted">Sin vincular</span>
                    }
                  </td>
                  <td class="mono">{{ r.clientIp }}</td>
                  <td>{{ r.fullName || '-' }}</td>
                  <td>{{ r.phone || '-' }}</td>
                  <td class="date">{{ r.sentAt | date:'dd/MM HH:mm' }}</td>
                  <td class="date">{{ r.submittedAt ? (r.submittedAt | date:'dd/MM HH:mm') : '-' }}</td>
                  <td class="date">
                    @if (r.status === 'pending' && r.nextReminderAt) {
                      {{ r.nextReminderAt | date:'dd/MM HH:mm' }}
                      <div class="muted">{{ r.reminderCount || 0 }} aviso(s)</div>
                    } @else {
                      -
                    }
                  </td>
                  <td>{{ r.sentBy }}</td>
                  <td>
                    @if (r.status === 'pending' && r.publicUrl) {
                      <button class="btn-link" (click)="copyLink(r.publicUrl)">Copiar link</button>
                    } @else {
                      <span class="muted">-</span>
                    }
                  </td>
                  <td>
                    @if (r.status === 'pending') {
                      <button class="btn-resend" [disabled]="resendingId() === r.id" (click)="resend(r)" title="Reenviar por WhatsApp">
                        @if (resendingId() === r.id) { ... } @else { 📱 WhatsApp }
                      </button>
                      <button class="btn-cancel" (click)="cancel(r)">Cancelar</button>
                    }
                    <button class="btn-delete" (click)="del(r)" title="Eliminar registro">🗑</button>
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
    .toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .chip {
      background: white; border: 1px solid #e2e8f0; color: #475569;
      border-radius: 999px; padding: 7px 14px; font-size: 13px; font-weight: 500;
      cursor: pointer; transition: all 0.15s;
    }
    .chip:hover { border-color: #6366f1; color: #6366f1; }
    .chip.active { background: #6366f1; border-color: #6366f1; color: white; }

    .btn-icon {
      display: inline-flex; align-items: center; gap: 6px;
      background: white; border: 1px solid #e2e8f0; color: #475569;
      border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer;
    }
    .btn-icon:hover { border-color: #6366f1; color: #6366f1; }

    .loader, .empty { text-align: center; padding: 60px 20px; color: #64748b; }
    .empty h3 { color: #1e293b; margin-bottom: 8px; }
    .empty p { color: #94a3b8; max-width: 480px; margin: 0 auto; }

    .table-wrap {
      background: white; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; overflow-x: auto;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td {
      padding: 12px 14px; text-align: left; font-size: 13px;
      border-bottom: 1px solid #f1f5f9; vertical-align: top;
    }
    th { background: #f8fafc; color: #64748b; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr:hover { background: #f8fafc; }
    .mono { font-family: ui-monospace, Menlo, Monaco, monospace; font-size: 12px; color: #475569; }
    .date { color: #64748b; font-size: 12px; white-space: nowrap; }
    .muted { color: #94a3b8; font-size: 12px; }

    .badge {
      display: inline-block; padding: 3px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
    }
    .st-pending { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
    .st-submitted { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
    .st-cancelled { background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; }
    .st-expired { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }

    .btn-cancel, .btn-delete {
      border: none; padding: 5px 10px; border-radius: 6px; font-size: 11px;
      cursor: pointer; margin-right: 4px; font-weight: 600;
    }
    .btn-cancel { background: #fef3c7; color: #92400e; }
    .btn-cancel:hover { background: #fde68a; }
    .btn-delete { background: #fee2e2; color: #b91c1c; }
    .btn-delete:hover { background: #fecaca; }
    .btn-link { border: 1px solid #bfdbfe; background: #eff6ff; color: #2563eb; padding: 5px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; font-weight: 600; }
    .btn-link:hover { background: #dbeafe; border-color: #60a5fa; }
    .btn-resend { border: 1px solid #86efac; background: #dcfce7; color: #166534; padding: 5px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; font-weight: 600; margin-right: 4px; }
    .btn-resend:hover:not(:disabled) { background: #bbf7d0; border-color: #22c55e; }
    .btn-resend:disabled { opacity: 0.6; cursor: wait; }

    @media (max-width: 768px) {
      .page { padding: 16px; }
      .toolbar { flex-direction: column; align-items: stretch; }
      table { font-size: 12px; }
      th, td { padding: 8px 10px; }
    }
  `]
})
export class EncuestasComponent implements OnInit {
  private survey = inject(SurveyService);
  private toast = inject(ToastService);

  rows = signal<SurveyResponse[]>([]);
  loading = signal(true);
  statusFilter = signal<string>('');
  resendingId = signal<number | null>(null);

  filteredRows = computed(() => {
    const f = this.statusFilter();
    if (!f) return this.rows();
    return this.rows().filter(r => r.status === f);
  });

  total = computed(() => this.rows().length);
  pendingCount = computed(() => this.rows().filter(r => r.status === 'pending').length);
  submittedCount = computed(() => this.rows().filter(r => r.status === 'submitted').length);

  ngOnInit() {
    this.load();
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
        this.toast.error(e.error?.error || e.message || 'Error al cargar');
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

  resend(r: SurveyResponse) {
    if (r.status !== 'pending') return;
    if (!confirm(`Reenviar el mensaje de WhatsApp${r.client?.nombre ? ' a ' + r.client.nombre : ''} (${r.client?.telefono || 'sin telefono'})?`)) return;
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
        this.toast.error(e.error?.error || e.message || 'Error al reenviar');
      },
    });
  }

  cancel(r: SurveyResponse) {
    if (!confirm(`Cancelar encuesta para IP ${r.clientIp}?\n\nEl enlace dejara de aceptar respuestas. Si hubiera una regla antigua en MikroTik, tambien se limpia.`)) return;
    this.survey.cancel(r.id).subscribe({
      next: () => {
        this.toast.success('Encuesta cancelada');
        this.load();
      },
      error: e => this.toast.error(e.error?.error || 'No se pudo cancelar')
    });
  }

  del(r: SurveyResponse) {
    if (!confirm(`Eliminar este registro permanentemente?`)) return;
    this.survey.delete(r.id).subscribe({
      next: () => {
        this.toast.success('Eliminado');
        this.load();
      },
      error: e => this.toast.error(e.error?.error || 'No se pudo eliminar')
    });
  }

  copyLink(url: string | null | undefined) {
    if (!url) return;
    navigator.clipboard.writeText(url);
    this.toast.success('Enlace copiado');
  }
}
