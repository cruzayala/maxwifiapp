import { Component, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { WisphubService } from '../../services/wisphub.service';
import { LocalDbService } from '../../services/local-db.service';
import { Ticket } from '../../models/ticket.model';

@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [NavbarComponent],
  template: `
    <app-navbar pageTitle="Tickets de Soporte" />

    <div class="page">
      <div class="toolbar">
        <h3>{{ tickets().length }} tickets</h3>
        <button class="btn btn-outline" (click)="syncTickets()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          Sincronizar
        </button>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Cargando tickets...</p>
        </div>
      } @else if (tickets().length === 0) {
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><path d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/></svg>
          <h3>Sin tickets</h3>
          <p>Sincroniza desde WispHub para ver tickets</p>
        </div>
      } @else {
        <div class="tickets-list">
          @for (ticket of tickets(); track ticket.id_ticket) {
            <div class="ticket-card">
              <div class="ticket-header">
                <span class="ticket-id">#{{ ticket.id_ticket }}</span>
                <span class="badge" [class]="'badge-' + getTicketPriorityClass(ticket.prioridad)">
                  {{ ticket.prioridad }}
                </span>
              </div>
              <h4 class="ticket-subject">{{ ticket.asunto }}</h4>
              <p class="ticket-client">{{ ticket.cliente }}</p>
              <div class="ticket-footer">
                <span class="badge" [class]="'badge-' + getTicketStatusClass(ticket.estado)">
                  {{ ticket.estado }}
                </span>
                <span class="ticket-date">{{ ticket.fecha_creacion }}</span>
                @if (ticket.asignado) {
                  <span class="ticket-assigned">{{ ticket.asignado }}</span>
                }
              </div>
            </div>
          }
        </div>
      }

      <div class="sync-bar" [class.visible]="syncing()">
        <div class="spinner small"></div>
        <span>{{ syncMessage() }}</span>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }

    .toolbar h3 { margin: 0; color: #0f172a; font-size: 16px; }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }

    .btn-outline {
      background: white;
      border: 1px solid #e2e8f0;
      color: #475569;
    }

    .btn-outline:hover { border-color: #6366f1; color: #6366f1; background: #eef2ff; }

    .tickets-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 16px;
    }

    .ticket-card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 20px;
      transition: all 0.2s;
    }

    .ticket-card:hover {
      border-color: #6366f1;
      box-shadow: 0 4px 15px rgba(99,102,241,0.1);
    }

    .ticket-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .ticket-id { font-size: 13px; color: #6366f1; font-weight: 600; }

    .ticket-subject {
      margin: 0 0 4px;
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
    }

    .ticket-client {
      margin: 0 0 12px;
      font-size: 13px;
      color: #64748b;
    }

    .ticket-footer {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .ticket-date { font-size: 12px; color: #94a3b8; }
    .ticket-assigned { font-size: 12px; color: #6366f1; font-weight: 500; }

    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
    }

    .badge-high { background: #fee2e2; color: #dc2626; }
    .badge-medium { background: #fef3c7; color: #d97706; }
    .badge-low { background: #dcfce7; color: #16a34a; }
    .badge-open { background: #dbeafe; color: #2563eb; }
    .badge-closed { background: #f1f5f9; color: #64748b; }
    .badge-progress { background: #fef3c7; color: #d97706; }
    .badge-default { background: #f1f5f9; color: #64748b; }

    .loading-state, .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 80px;
      gap: 12px;
      color: #94a3b8;
    }

    .empty-state h3 { color: #475569; margin: 8px 0 0; }

    .spinner {
      width: 32px; height: 32px;
      border: 3px solid #e2e8f0;
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .spinner.small { width: 18px; height: 18px; border-width: 2px; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .sync-bar {
      position: fixed;
      bottom: -60px; left: 260px; right: 0;
      height: 48px; background: #0f172a; color: white;
      display: flex; align-items: center; justify-content: center;
      gap: 12px; font-size: 14px;
      transition: bottom 0.3s; z-index: 50;
    }

    .sync-bar.visible { bottom: 0; }
  `]
})
export class TicketsComponent implements OnInit {
  private api = inject(WisphubService);
  private db = inject(LocalDbService);

  tickets = signal<Ticket[]>([]);
  loading = signal(true);
  syncing = signal(false);
  syncMessage = signal('');

  async ngOnInit() {
    this.tickets.set(await this.db.getTickets());
    this.loading.set(false);
  }

  syncTickets() {
    this.syncing.set(true);
    this.syncMessage.set('Sincronizando tickets...');
    this.api.getTickets().subscribe({
      next: async (res) => {
        if (res.results) {
          await this.db.saveTickets(res.results);
          this.tickets.set(await this.db.getTickets());
        }
        this.syncing.set(false);
      },
      error: (e) => {
        this.syncMessage.set('Error: ' + (e.error?.detail || 'Sin permisos'));
        setTimeout(() => this.syncing.set(false), 3000);
      }
    });
  }

  getTicketPriorityClass(p: string): string {
    const s = p?.toLowerCase();
    if (s === 'alta' || s === 'high') return 'high';
    if (s === 'media' || s === 'medium') return 'medium';
    if (s === 'baja' || s === 'low') return 'low';
    return 'default';
  }

  getTicketStatusClass(estado: string): string {
    const s = estado?.toLowerCase();
    if (s === 'abierto' || s === 'open') return 'open';
    if (s === 'cerrado' || s === 'closed') return 'closed';
    if (s === 'en progreso' || s === 'in_progress') return 'progress';
    return 'default';
  }
}
