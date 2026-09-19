import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideCalendarDays, LucideRefreshCw, LucideSearch, LucideTicket, LucideUserRound } from '@lucide/angular';
import { NavbarComponent } from '../../components/layout/navbar';
import { WisphubService } from '../../services/wisphub.service';
import { LocalDbService } from '../../services/local-db.service';
import { Ticket } from '../../models/ticket.model';

type TicketStatusGroup = 'all' | 'open' | 'progress' | 'closed';

@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [NavbarComponent, RouterLink, LucideCalendarDays, LucideRefreshCw, LucideSearch, LucideTicket, LucideUserRound],
  template: `
    <app-navbar pageTitle="Tickets de soporte" />

    <div class="page">
      <div class="toolbar">
        <div class="toolbar-title">
          <h3>{{ tickets().length }} {{ tickets().length === 1 ? 'ticket' : 'tickets' }}</h3>
          @if (tickets().length) {
            <p>{{ countFor('open') }} abiertos · {{ countFor('progress') }} en progreso · {{ countFor('closed') }} cerrados</p>
          }
        </div>
        <button type="button" class="btn btn-outline" (click)="syncTickets()" [disabled]="syncing()" [title]="syncing() ? 'Sincronización en curso' : 'Traer los tickets más recientes de WispHub'">
          <svg lucideRefreshCw size="16" [class.spin]="syncing()"></svg>
          {{ syncing() ? 'Sincronizando…' : 'Sincronizar' }}
        </button>
      </div>

      @if (tickets().length) {
        <div class="filters">
          <label class="search-field">
            <svg lucideSearch size="16"></svg>
            <input type="search" placeholder="Buscar por número, asunto, cliente o técnico" aria-label="Buscar ticket" [value]="search()" (input)="search.set($any($event.target).value)" />
          </label>
          <div class="status-chips" role="group" aria-label="Filtrar por estado">
            @for (option of statusOptions; track option.value) {
              <button type="button" [class.active]="statusFilter() === option.value" [attr.aria-pressed]="statusFilter() === option.value" (click)="statusFilter.set(option.value)">
                {{ option.label }} <b>{{ countFor(option.value) }}</b>
              </button>
            }
          </div>
        </div>
      }

      @if (loading()) {
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Cargando tickets…</p>
        </div>
      } @else if (loadError()) {
        <div class="empty-state error-state" role="alert">
          <h3>No se pudieron cargar los tickets</h3>
          <p>{{ loadError() }}</p>
          <button type="button" class="btn btn-primary" (click)="ngOnInit()">Reintentar</button>
        </div>
      } @else if (tickets().length === 0) {
        <div class="empty-state">
          <svg lucideTicket size="48"></svg>
          <h3>No hay tickets guardados</h3>
          <p>Presiona «Sincronizar» para traer los tickets de soporte desde WispHub.</p>
          <button type="button" class="btn btn-primary" (click)="syncTickets()" [disabled]="syncing()">Sincronizar ahora</button>
        </div>
      } @else if (visibleTickets().length === 0) {
        <div class="empty-state">
          <h3>No hay coincidencias</h3>
          <p>Ningún ticket coincide con la búsqueda o el estado elegido.</p>
          <button type="button" class="btn btn-outline" (click)="clearFilters()">Limpiar filtros</button>
        </div>
      } @else {
        <div class="tickets-list">
          @for (ticket of visibleTickets(); track ticket.id_ticket) {
            <article class="ticket-card" [class]="'ticket-card status-' + getTicketStatusClass(ticket.estado)">
              <div class="ticket-header">
                <span class="ticket-id">#{{ ticket.id_ticket }}</span>
                <span class="badge" [class]="'badge badge-' + getTicketPriorityClass(ticket.prioridad)">
                  Prioridad {{ priorityLabel(ticket.prioridad) }}
                </span>
              </div>
              <h4 class="ticket-subject">{{ ticket.asunto || 'Sin asunto' }}</h4>
              <p class="ticket-client">
                @if (ticket.id_servicio) {
                  <a [routerLink]="['/clients', ticket.id_servicio]" [title]="'Abrir ficha de ' + ticket.cliente">{{ ticket.cliente || ('Cliente #' + ticket.id_servicio) }}</a>
                } @else {
                  {{ ticket.cliente || 'Cliente no indicado' }}
                }
              </p>
              @if (ticket.descripcion) {
                <p class="ticket-description" [title]="ticket.descripcion">{{ ticket.descripcion }}</p>
              }
              <div class="ticket-footer">
                <span class="badge" [class]="'badge badge-' + getTicketStatusClass(ticket.estado)">
                  {{ statusLabel(ticket.estado) }}
                </span>
                <span class="ticket-meta" [title]="'Creado: ' + (ticket.fecha_creacion || 'sin fecha')"><svg lucideCalendarDays size="13"></svg>{{ readableDate(ticket.fecha_creacion) }}</span>
                @if (ticket.asignado) {
                  <span class="ticket-meta assigned" title="Técnico asignado"><svg lucideUserRound size="13"></svg>{{ ticket.asignado }}</span>
                } @else {
                  <span class="ticket-meta unassigned">Sin asignar</span>
                }
              </div>
            </article>
          }
        </div>
      }

      <div class="sync-bar" [class.visible]="syncing() || !!syncError()" [class.error]="!!syncError()" role="status" aria-live="polite">
        @if (!syncError()) { <div class="spinner small"></div> }
        <span>{{ syncError() || syncMessage() }}</span>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 20px 24px 32px; }

    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
    .toolbar-title h3 { margin: 0; color: #172535; font-size: 16px; }
    .toolbar-title p { margin: 3px 0 0; color: #667582; font-size: 12px; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 38px; padding: 0 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: background 0.15s, border-color 0.15s, color 0.15s; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-outline { background: #fff; border-color: #dfe5ea; color: #334250; }
    .btn-outline:hover:not(:disabled) { border-color: #1267dd; color: #1267dd; background: #f2f7ff; }
    .btn-primary { background: #1267dd; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #0d58c0; }
    .spin { animation: spin 0.9s linear infinite; }

    .filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
    .search-field { display: flex; flex: 1 1 280px; align-items: center; gap: 8px; min-width: 0; height: 38px; padding: 0 11px; border: 1px solid #dfe5ea; border-radius: 6px; background: #fff; color: #667582; }
    .search-field:focus-within { border-color: #1267dd; box-shadow: 0 0 0 3px rgba(18, 103, 221, 0.12); }
    .search-field input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: #334250; font: inherit; font-size: 13px; }
    .status-chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .status-chips button { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 11px; border: 1px solid #dfe5ea; border-radius: 6px; background: #fff; color: #334250; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .status-chips button b { min-width: 18px; padding: 1px 5px; border-radius: 9px; background: #f1f4f6; color: #667582; font-size: 11px; text-align: center; }
    .status-chips button:hover { border-color: #ccd6de; background: #f8fafc; }
    .status-chips button.active { border-color: #1267dd; background: #edf4ff; color: #1267dd; }
    .status-chips button.active b { background: #1267dd; color: #fff; }

    .tickets-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 14px; }

    .ticket-card { min-width: 0; padding: 16px 18px; background: #fff; border: 1px solid #dfe5ea; border-left: 3px solid #ccd6de; border-radius: 8px; transition: border-color 0.15s, box-shadow 0.15s; }
    .ticket-card:hover { box-shadow: 0 6px 18px rgba(23, 37, 53, 0.07); }
    .ticket-card.status-open { border-left-color: #1267dd; }
    .ticket-card.status-progress { border-left-color: #b36b12; }
    .ticket-card.status-closed { border-left-color: #13875a; }

    .ticket-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .ticket-id { color: #1267dd; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 13px; font-weight: 700; }
    .ticket-subject { margin: 0 0 4px; color: #172535; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
    .ticket-client { margin: 0 0 8px; color: #334250; font-size: 13px; }
    .ticket-client a { color: #1267dd; font-weight: 600; text-decoration: none; }
    .ticket-client a:hover { text-decoration: underline; }
    .ticket-description { display: -webkit-box; margin: 0 0 12px; overflow: hidden; color: #667582; font-size: 12px; line-height: 1.45; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

    .ticket-footer { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; }
    .ticket-meta { display: inline-flex; align-items: center; gap: 4px; color: #667582; font-size: 12px; }
    .ticket-meta.assigned { color: #334250; font-weight: 600; }
    .ticket-meta.unassigned { color: #8a98a5; font-style: italic; }

    .badge { display: inline-block; padding: 3px 9px; border-radius: 12px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .badge-high { background: #fff0ef; color: #b42318; }
    .badge-medium { background: #fff6e8; color: #b36b12; }
    .badge-low { background: #e9f8f1; color: #13875a; }
    .badge-open { background: #edf4ff; color: #1267dd; }
    .badge-closed { background: #e9f8f1; color: #13875a; }
    .badge-progress { background: #fff6e8; color: #b36b12; }
    .badge-default { background: #f1f4f6; color: #667582; }

    .loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 64px 20px; color: #667582; text-align: center; }
    .empty-state svg { color: #ccd6de; }
    .empty-state h3 { margin: 6px 0 0; color: #334250; font-size: 16px; }
    .empty-state p { margin: 0; font-size: 13px; }
    .error-state { border: 1px solid #f3c7c3; border-radius: 8px; background: #fff0ef; }
    .error-state h3 { color: #b42318; }

    .spinner { width: 32px; height: 32px; border: 3px solid #dfe5ea; border-top-color: #1267dd; border-radius: 50%; animation: spin 0.8s linear infinite; }
    .spinner.small { width: 18px; height: 18px; border-width: 2px; border-color: rgba(255,255,255,.3); border-top-color: #fff; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .sync-bar {
      position: fixed; bottom: -60px; left: 260px; right: 0; z-index: 50;
      display: flex; align-items: center; justify-content: center; gap: 12px; height: 48px; padding: 0 16px;
      background: #172535; color: #fff; font-size: 13px; text-align: center; transition: bottom 0.3s;
    }
    .sync-bar.visible { bottom: 0; }
    .sync-bar.error { background: #b42318; }

    @media (max-width: 760px) {
      .page { padding: 14px 16px 24px; }
      .toolbar .btn { width: 100%; }
      .sync-bar { left: 0; }
    }
    @media (prefers-reduced-motion: reduce) { .spin, .spinner { animation: none; } .sync-bar { transition: none; } }
  `]
})
export class TicketsComponent implements OnInit {
  private api = inject(WisphubService);
  private db = inject(LocalDbService);

  tickets = signal<Ticket[]>([]);
  loading = signal(true);
  loadError = signal('');
  syncing = signal(false);
  syncMessage = signal('');
  syncError = signal('');
  search = signal('');
  statusFilter = signal<TicketStatusGroup>('all');

  readonly statusOptions: { value: TicketStatusGroup; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'open', label: 'Abiertos' },
    { value: 'progress', label: 'En progreso' },
    { value: 'closed', label: 'Cerrados' },
  ];

  visibleTickets = computed(() => {
    const term = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    return this.tickets().filter((ticket) => {
      if (status !== 'all' && this.getTicketStatusClass(ticket.estado) !== status) return false;
      if (!term) return true;
      return [ticket.id_ticket, ticket.asunto, ticket.cliente, ticket.asignado, ticket.descripcion]
        .some((value) => String(value ?? '').toLowerCase().includes(term));
    });
  });

  async ngOnInit() {
    this.loading.set(true);
    this.loadError.set('');
    try {
      this.tickets.set(await this.db.getTickets());
    } catch {
      this.loadError.set('No fue posible leer los tickets guardados. Revisa la conexión y vuelve a intentarlo.');
    } finally {
      this.loading.set(false);
    }
  }

  syncTickets() {
    this.syncing.set(true);
    this.syncError.set('');
    this.syncMessage.set('Sincronizando tickets con WispHub…');
    this.api.getTickets().subscribe({
      next: async (res) => {
        if (res.results) {
          await this.db.saveTickets(res.results);
          this.tickets.set(await this.db.getTickets());
        }
        this.syncing.set(false);
      },
      error: (e) => {
        this.syncing.set(false);
        const reason = e?.status === 401 || e?.status === 403
          ? 'La cuenta de WispHub no tiene permiso para ver tickets.'
          : 'Revisa la conexión e inténtalo de nuevo.';
        this.syncError.set(`No se pudieron sincronizar los tickets. ${reason}`);
        setTimeout(() => this.syncError.set(''), 5000);
      }
    });
  }

  clearFilters() {
    this.search.set('');
    this.statusFilter.set('all');
  }

  countFor(group: TicketStatusGroup): number {
    if (group === 'all') return this.tickets().length;
    return this.tickets().filter((ticket) => this.getTicketStatusClass(ticket.estado) === group).length;
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

  priorityLabel(prioridad: string): string {
    const labels: Record<string, string> = { high: 'alta', medium: 'media', low: 'baja' };
    return labels[this.getTicketPriorityClass(prioridad)] || (prioridad ? prioridad.toLowerCase() : 'sin definir');
  }

  statusLabel(estado: string): string {
    const labels: Record<string, string> = { open: 'Abierto', progress: 'En progreso', closed: 'Cerrado' };
    return labels[this.getTicketStatusClass(estado)] || estado || 'Sin estado';
  }

  readableDate(value: string | null | undefined): string {
    if (!value) return 'Sin fecha';
    const text = String(value).trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const latin = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const date = iso
      ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
      : latin ? new Date(Number(latin[3]), Number(latin[2]) - 1, Number(latin[1])) : new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
  }
}
