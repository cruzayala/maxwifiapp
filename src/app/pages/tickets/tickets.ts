import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideCalendarDays, LucideCircleCheck, LucideClock, LucideMessageCircle, LucidePencil,
  LucidePhone, LucidePlus, LucideRefreshCw, LucideSearch, LucideTicket, LucideTimer,
  LucideUserRound, LucideWrench,
} from '@lucide/angular';
import { NavbarComponent } from '../../components/layout/navbar';
import { WisphubService } from '../../services/wisphub.service';
import { LocalDbService } from '../../services/local-db.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { TicketOptions, TicketsApiService } from '../../services/tickets-api.service';
import { Ticket } from '../../models/ticket.model';
import { WispHubClient } from '../../models/client.model';
import { telLink, whatsappLink } from '../../pipes/phone';
import { TicketFormComponent } from './ticket-form';

type TicketStatusGroup = 'all' | 'open' | 'progress' | 'closed';
type SortMode = 'oldest' | 'newest' | 'priority' | 'client';

@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [
    NavbarComponent, RouterLink, TicketFormComponent,
    LucideCalendarDays, LucideCircleCheck, LucideClock, LucideMessageCircle, LucidePencil,
    LucidePhone, LucidePlus, LucideRefreshCw, LucideSearch, LucideTicket, LucideTimer,
    LucideUserRound, LucideWrench,
  ],
  template: `
    <app-navbar pageTitle="Tickets de soporte" />

    <div class="page">
      @if (tickets().length) {
        <section class="kpi-strip" aria-label="Resumen de soporte">
          <article class="kpi-item open">
            <span class="kpi-icon"><svg lucideTicket size="19"></svg></span>
            <div><small>Sin resolver</small><strong>{{ countFor('open') + countFor('progress') }}</strong><p>{{ countFor('open') }} nuevos · {{ countFor('progress') }} en progreso</p></div>
          </article>
          <article class="kpi-item aging">
            <span class="kpi-icon"><svg lucideTimer size="19"></svg></span>
            <div><small>El más viejo</small><strong>{{ oldestOpenDays() }} días</strong><p>{{ staleCount() }} llevan más de 3 días</p></div>
          </article>
          <article class="kpi-item unassigned">
            <span class="kpi-icon"><svg lucideWrench size="19"></svg></span>
            <div><small>Sin técnico</small><strong>{{ unassignedCount() }}</strong><p>de {{ countFor('open') + countFor('progress') }} sin resolver</p></div>
          </article>
          <article class="kpi-item closed">
            <span class="kpi-icon"><svg lucideCircleCheck size="19"></svg></span>
            <div><small>Cerrados</small><strong>{{ countFor('closed') }}</strong><p>de {{ tickets().length }} en total</p></div>
          </article>
        </section>
      }

      <div class="toolbar">
        <div class="toolbar-title">
          <h3>{{ tickets().length }} {{ tickets().length === 1 ? 'ticket' : 'tickets' }}</h3>
          @if (tickets().length) {
            <p>Mostrando {{ visibleTickets().length }} con los filtros actuales</p>
          }
        </div>
        <div class="toolbar-actions">
          <button type="button" class="btn btn-outline" (click)="syncTickets()" [disabled]="syncing()" [title]="syncing() ? 'Sincronización en curso' : 'Traer los tickets más recientes de WispHub'">
            <svg lucideRefreshCw size="16" [class.spin]="syncing()"></svg>
            {{ syncing() ? 'Sincronizando…' : 'Sincronizar' }}
          </button>
          @if (canEdit()) {
            <button type="button" class="btn btn-primary" (click)="openNew()" title="Abrir un ticket nuevo en WispHub">
              <svg lucidePlus size="16"></svg>Nuevo ticket
            </button>
          }
        </div>
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
          <select class="plain-select" aria-label="Filtrar por técnico" [value]="technicianFilter()" (change)="technicianFilter.set($any($event.target).value)">
            <option value="">Todos los técnicos</option>
            <option value="__none__">Sin asignar</option>
            @for (name of technicianNames(); track name) { <option [value]="name">{{ name }}</option> }
          </select>
          <select class="plain-select" aria-label="Ordenar" [value]="sortBy()" (change)="sortBy.set($any($event.target).value)">
            <option value="oldest">Más viejos primero</option>
            <option value="newest">Más nuevos primero</option>
            <option value="priority">Por prioridad</option>
            <option value="client">Por cliente</option>
          </select>
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
          <button type="button" class="btn btn-primary" (click)="reload()">Reintentar</button>
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
          <p>Ningún ticket coincide con la búsqueda o los filtros elegidos.</p>
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
                @if (waFor(ticket); as wa) {
                  <a class="contact" [href]="wa" target="_blank" rel="noopener" [title]="'Escribir por WhatsApp a ' + ticket.cliente"><svg lucideMessageCircle size="13"></svg>WhatsApp</a>
                }
                @if (telFor(ticket); as tel) {
                  <a class="contact" [href]="tel" [title]="'Llamar a ' + ticket.cliente"><svg lucidePhone size="13"></svg>Llamar</a>
                }
              </p>

              @if (ticket.descripcion) {
                <p class="ticket-description" [title]="ticket.descripcion">{{ ticket.descripcion }}</p>
              }

              <div class="ticket-footer">
                <span class="badge" [class]="'badge badge-' + getTicketStatusClass(ticket.estado)">
                  {{ statusLabel(ticket.estado) }}
                </span>
                @if (!isClosed(ticket)) {
                  <span class="age" [class.stale]="ageDays(ticket) !== null && ageDays(ticket)! > 3" [title]="'Creado: ' + (ticket.fecha_creacion || 'sin fecha')">
                    <svg lucideClock size="13"></svg>{{ ageText(ticket) }}
                  </span>
                } @else {
                  <span class="ticket-meta" [title]="'Creado: ' + (ticket.fecha_creacion || 'sin fecha')"><svg lucideCalendarDays size="13"></svg>{{ readableDate(ticket.fecha_creacion) }}</span>
                }
                @if (ticket.asignado) {
                  <span class="ticket-meta assigned" title="Técnico asignado"><svg lucideUserRound size="13"></svg>{{ ticket.asignado }}</span>
                } @else {
                  <span class="ticket-meta unassigned">Sin asignar</span>
                }
                @if (canEdit()) {
                  <button type="button" class="edit-button" (click)="openEdit(ticket)" [attr.aria-label]="'Editar ticket ' + ticket.id_ticket" title="Cambiar estado, prioridad, técnico o descripción">
                    <svg lucidePencil size="13"></svg>Editar
                  </button>
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

      <app-ticket-form
        [visible]="formOpen()"
        [ticketId]="editingId()"
        [clients]="clients()"
        [options]="options()"
        (closed)="formOpen.set(false)"
        (saved)="onSaved($event)" />
    </div>
  `,
  styles: [`
    .page { padding: 20px 24px 32px; }

    .kpi-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; overflow: hidden; margin-bottom: 14px; border: 1px solid #e0e6e1; border-radius: 12px; background: #e0e6e1; }
    .kpi-item { display: flex; align-items: flex-start; gap: 12px; min-width: 0; padding: 16px 18px; background: #fff; }
    .kpi-icon { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 auto; border-radius: 10px; }
    .kpi-item > div { min-width: 0; }
    .kpi-item small { display: block; color: #728294; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .kpi-item strong { display: block; margin-top: 3px; color: #14283d; font-size: 22px; line-height: 1.2; }
    .kpi-item p { margin: 5px 0 0; color: #8291a0; font-size: 11px; }
    .open .kpi-icon { color: #0b6b52; background: #e6f2ec; }
    .aging .kpi-icon { color: #b36b12; background: #fff6e8; }
    .unassigned .kpi-icon { color: #c93643; background: #fff0f1; }
    .closed .kpi-icon { color: #0f7a53; background: #e9f8f1; }

    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
    .toolbar-title h3 { margin: 0; color: #15211c; font-size: 16px; }
    .toolbar-title p { margin: 3px 0 0; color: #56665e; font-size: 12px; }
    .toolbar-actions { display: flex; gap: 8px; flex-wrap: wrap; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 38px; padding: 0 16px; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: background 0.15s, border-color 0.15s, color 0.15s; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-outline { background: #fff; border-color: #e0e6e1; color: #2d3b34; }
    .btn-outline:hover:not(:disabled) { border-color: #0b6b52; color: #0b6b52; background: #eef6f1; }
    .btn-primary { background: #0b6b52; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #08523f; }
    .spin { animation: spin 0.9s linear infinite; }

    .filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
    .search-field { display: flex; flex: 1 1 280px; align-items: center; gap: 8px; min-width: 0; height: 38px; padding: 0 11px; border: 1px solid #e0e6e1; border-radius: 9px; background: #fff; color: #56665e; }
    .search-field:focus-within { border-color: #0b6b52; box-shadow: 0 0 0 3px rgba(11, 107, 82, 0.12); }
    .search-field input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: #2d3b34; font: inherit; font-size: 13px; }
    .plain-select { height: 38px; min-width: 165px; padding: 0 10px; border: 1px solid #e0e6e1; border-radius: 9px; background: #fff; color: #2d3b34; font: inherit; font-size: 12px; cursor: pointer; }
    .plain-select:focus-visible { outline: 2px solid #0b6b52; outline-offset: 2px; }
    .status-chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .status-chips button { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 11px; border: 1px solid #e0e6e1; border-radius: 9px; background: #fff; color: #2d3b34; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .status-chips button b { min-width: 18px; padding: 1px 5px; border-radius: 9px; background: #f1f4f6; color: #56665e; font-size: 11px; text-align: center; }
    .status-chips button:hover { border-color: #cfd8d2; background: #f4f6f2; }
    .status-chips button.active { border-color: #0b6b52; background: #e6f2ec; color: #0b6b52; }
    .status-chips button.active b { background: #0b6b52; color: #fff; }

    .tickets-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 14px; }

    .ticket-card { display: flex; flex-direction: column; min-width: 0; padding: 16px 18px; background: #fff; border: 1px solid #e0e6e1; border-left: 3px solid #cfd8d2; border-radius: 12px; transition: border-color 0.15s, box-shadow 0.15s; }
    .ticket-card:hover { box-shadow: 0 6px 18px rgba(23, 37, 53, 0.07); }
    .ticket-card.status-open { border-left-color: #0b6b52; }
    .ticket-card.status-progress { border-left-color: #b36b12; }
    .ticket-card.status-closed { border-left-color: #0f7a53; }

    .ticket-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .ticket-id { color: #0b6b52; font-family: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 13px; font-weight: 700; }
    .ticket-subject { margin: 0 0 4px; color: #15211c; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
    .ticket-client { display: flex; align-items: center; gap: 4px 10px; flex-wrap: wrap; margin: 0 0 8px; color: #2d3b34; font-size: 13px; }
    .ticket-client a { color: #0b6b52; font-weight: 600; text-decoration: none; }
    .ticket-client a:hover { text-decoration: underline; }
    .ticket-client .contact { display: inline-flex; align-items: center; gap: 4px; color: #146c45; font-size: 12px; font-weight: 700; }
    .ticket-description { display: -webkit-box; margin: 0 0 12px; overflow: hidden; color: #56665e; font-size: 12px; line-height: 1.45; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

    .ticket-footer { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; margin-top: auto; }
    .ticket-meta { display: inline-flex; align-items: center; gap: 4px; color: #56665e; font-size: 12px; }
    .ticket-meta.assigned { color: #2d3b34; font-weight: 600; }
    .ticket-meta.unassigned { color: #b4451f; font-weight: 600; }
    .age { display: inline-flex; align-items: center; gap: 4px; color: #56665e; font-size: 12px; font-weight: 600; }
    .age.stale { color: #b42318; }
    .edit-button { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; margin-left: auto; padding: 0 10px; border: 1px solid #e0e6e1; border-radius: 9px; background: #fff; color: #2d3b34; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
    .edit-button:hover { border-color: #0b6b52; background: #eef6f1; color: #0b6b52; }
    .edit-button:focus-visible { outline: 2px solid #0b6b52; outline-offset: 2px; }

    .badge { display: inline-block; padding: 3px 9px; border-radius: 12px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .badge-high { background: #fff0ef; color: #b42318; }
    .badge-medium { background: #fff6e8; color: #b36b12; }
    .badge-low { background: #e9f8f1; color: #0f7a53; }
    .badge-open { background: #e6f2ec; color: #0b6b52; }
    .badge-closed { background: #e9f8f1; color: #0f7a53; }
    .badge-progress { background: #fff6e8; color: #b36b12; }
    .badge-default { background: #f1f4f6; color: #56665e; }

    .loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 64px 20px; color: #56665e; text-align: center; }
    .empty-state svg { color: #cfd8d2; }
    .empty-state h3 { margin: 6px 0 0; color: #2d3b34; font-size: 16px; }
    .empty-state p { margin: 0; font-size: 13px; }
    .error-state { border: 1px solid #f3c7c3; border-radius: 12px; background: #fff0ef; }
    .error-state h3 { color: #b42318; }

    .spinner { width: 32px; height: 32px; border: 3px solid #e0e6e1; border-top-color: #0b6b52; border-radius: 50%; animation: spin 0.8s linear infinite; }
    .spinner.small { width: 18px; height: 18px; border-width: 2px; border-color: rgba(255,255,255,.3); border-top-color: #fff; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .sync-bar {
      position: fixed; bottom: -60px; left: 260px; right: 0; z-index: 50;
      display: flex; align-items: center; justify-content: center; gap: 12px; height: 48px; padding: 0 16px;
      background: #15211c; color: #fff; font-size: 13px; text-align: center; transition: bottom 0.3s;
    }
    .sync-bar.visible { bottom: 0; }
    .sync-bar.error { background: #b42318; }

    @media (max-width: 1120px) { .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) {
      .page { padding: 14px 16px 24px; }
      .toolbar-actions { width: 100%; }
      .toolbar-actions .btn { flex: 1; }
      .plain-select { flex: 1 1 150px; min-width: 0; }
      .sync-bar { left: 0; }
    }
    @media (max-width: 520px) {
      .kpi-item { display: block; }
      .kpi-icon { margin-bottom: 8px; }
      .kpi-item strong { font-size: 17px; }
    }
    @media (prefers-reduced-motion: reduce) { .spin, .spinner { animation: none; } .sync-bar { transition: none; } }
  `]
})
export class TicketsComponent implements OnInit {
  private api = inject(WisphubService);
  private db = inject(LocalDbService);
  private ticketsApi = inject(TicketsApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  tickets = signal<Ticket[]>([]);
  clients = signal<WispHubClient[]>([]);
  options = signal<TicketOptions | null>(null);
  loading = signal(true);
  loadError = signal('');
  syncing = signal(false);
  syncMessage = signal('');
  syncError = signal('');
  search = signal('');
  statusFilter = signal<TicketStatusGroup>('all');
  technicianFilter = signal('');
  sortBy = signal<SortMode>('oldest');

  formOpen = signal(false);
  editingId = signal<number | null>(null);

  canEdit = computed(() => this.auth.hasRole(['tecnico']));

  readonly statusOptions: { value: TicketStatusGroup; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'open', label: 'Abiertos' },
    { value: 'progress', label: 'En progreso' },
    { value: 'closed', label: 'Cerrados' },
  ];

  /** Teléfono por servicio, para poder escribir o llamar sin salir del ticket. */
  private phones = computed(() => {
    const map = new Map<number, string>();
    for (const client of this.clients()) {
      if (client.telefono?.trim()) map.set(client.id_servicio, client.telefono.trim());
    }
    return map;
  });

  technicianNames = computed(() => {
    const names = new Set<string>();
    for (const ticket of this.tickets()) if (ticket.asignado?.trim()) names.add(ticket.asignado.trim());
    return [...names].sort((a, b) => a.localeCompare(b, 'es'));
  });

  unassignedCount = computed(() =>
    this.tickets().filter((ticket) => !this.isClosed(ticket) && !ticket.asignado?.trim()).length);

  /** Días que lleva abierto el ticket sin resolver más antiguo. */
  oldestOpenDays = computed(() => {
    const ages = this.tickets().filter((ticket) => !this.isClosed(ticket))
      .map((ticket) => this.ageDays(ticket)).filter((days): days is number => days !== null);
    return ages.length ? Math.max(...ages) : 0;
  });

  staleCount = computed(() => this.tickets()
    .filter((ticket) => !this.isClosed(ticket) && (this.ageDays(ticket) ?? 0) > 3).length);

  visibleTickets = computed(() => {
    const term = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    const technician = this.technicianFilter();
    const priorityOrder: Record<string, number> = { high: 3, medium: 2, low: 1, default: 0 };

    const result = this.tickets().filter((ticket) => {
      if (status !== 'all' && this.getTicketStatusClass(ticket.estado) !== status) return false;
      if (technician === '__none__' && ticket.asignado?.trim()) return false;
      if (technician && technician !== '__none__' && ticket.asignado?.trim() !== technician) return false;
      if (!term) return true;
      return [ticket.id_ticket, ticket.asunto, ticket.cliente, ticket.asignado, ticket.descripcion]
        .some((value) => String(value ?? '').toLowerCase().includes(term));
    });

    const mode = this.sortBy();
    return [...result].sort((left, right) => {
      // Lo cerrado va al final: la lista es para trabajar lo que sigue abierto.
      const closedDiff = (this.isClosed(left) ? 1 : 0) - (this.isClosed(right) ? 1 : 0);
      if (closedDiff) return closedDiff;
      if (mode === 'client') return (left.cliente || '').localeCompare(right.cliente || '', 'es');
      if (mode === 'priority') {
        return priorityOrder[this.getTicketPriorityClass(right.prioridad)] - priorityOrder[this.getTicketPriorityClass(left.prioridad)]
          || (this.ageDays(right) ?? 0) - (this.ageDays(left) ?? 0);
      }
      const leftAge = this.ageDays(left) ?? -1;
      const rightAge = this.ageDays(right) ?? -1;
      return mode === 'newest' ? leftAge - rightAge : rightAge - leftAge;
    });
  });

  ngOnInit() {
    void this.reload();
  }

  async reload() {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const [tickets, clients] = await Promise.all([this.db.getTickets(), this.db.getClients().catch(() => [])]);
      this.tickets.set(tickets);
      this.clients.set(clients);
    } catch {
      this.loadError.set('No fue posible leer los tickets guardados. Revisa la conexión y vuelve a intentarlo.');
    } finally {
      this.loading.set(false);
    }
    if (this.canEdit() && !this.options()) this.loadOptions();
  }

  private loadOptions() {
    this.ticketsApi.options().subscribe({
      next: (options) => this.options.set(options),
      error: () => {},
    });
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

  // ─── Alta y edición ───

  openNew() {
    if (!this.options()) this.loadOptions();
    this.editingId.set(null);
    this.formOpen.set(true);
  }

  openEdit(ticket: Ticket) {
    if (!this.options()) this.loadOptions();
    this.editingId.set(ticket.id_ticket);
    this.formOpen.set(true);
  }

  onSaved(event: { created: boolean; idTicket: number }) {
    this.formOpen.set(false);
    this.toast.success(event.created
      ? `Ticket #${event.idTicket} creado en WispHub.`
      : `Ticket #${event.idTicket} actualizado.`);
    // WispHub ya confirmó el cambio: se recarga la lista para verlo reflejado.
    this.syncTickets();
  }

  // ─── Contacto ───

  waFor(ticket: Ticket): string | null {
    const phone = this.phones().get(ticket.id_servicio);
    if (!phone) return null;
    return whatsappLink(phone, `Hola ${ticket.cliente || ''}, le escribimos por su reporte #${ticket.id_ticket}: ${ticket.asunto || 'soporte técnico'}.`.trim());
  }

  telFor(ticket: Ticket): string | null {
    const phone = this.phones().get(ticket.id_servicio);
    return phone ? telLink(phone) : null;
  }

  // ─── Filtros y etiquetas ───

  clearFilters() {
    this.search.set('');
    this.statusFilter.set('all');
    this.technicianFilter.set('');
    this.sortBy.set('oldest');
  }

  countFor(group: TicketStatusGroup): number {
    if (group === 'all') return this.tickets().length;
    return this.tickets().filter((ticket) => this.getTicketStatusClass(ticket.estado) === group).length;
  }

  isClosed(ticket: Ticket): boolean {
    return this.getTicketStatusClass(ticket.estado) === 'closed';
  }

  getTicketPriorityClass(p: string): string {
    const s = p?.toLowerCase();
    if (s === 'alta' || s === 'high' || s === 'muy alta') return 'high';
    if (s === 'media' || s === 'medium' || s === 'normal') return 'medium';
    if (s === 'baja' || s === 'low') return 'low';
    return 'default';
  }

  getTicketStatusClass(estado: string): string {
    const s = estado?.toLowerCase();
    if (s === 'abierto' || s === 'open' || s === 'nuevo') return 'open';
    if (s === 'cerrado' || s === 'closed' || s === 'resuelto') return 'closed';
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

  /** Días transcurridos desde que se creó el ticket; null si no hay fecha entendible. */
  ageDays(ticket: Ticket): number | null {
    const date = this.parseDate(ticket.fecha_creacion);
    if (!date) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((today.getTime() - date.getTime()) / 86400000));
  }

  ageText(ticket: Ticket): string {
    const days = this.ageDays(ticket);
    if (days === null) return 'Sin fecha';
    if (days === 0) return 'Abierto hoy';
    if (days === 1) return 'Abierto ayer';
    return `Abierto hace ${days} días`;
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const text = String(value).trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const latin = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const date = iso
      ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
      : latin ? new Date(Number(latin[3]), Number(latin[2]) - 1, Number(latin[1])) : new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  readableDate(value: string | null | undefined): string {
    const date = this.parseDate(value);
    if (!date) return value ? String(value) : 'Sin fecha';
    return date.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
  }
}
