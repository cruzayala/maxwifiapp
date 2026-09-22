import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideCircleAlert, LucideX } from '@lucide/angular';
import { WispHubClient } from '../../models/client.model';
import { TicketInput, TicketOptions, TicketsApiService } from '../../services/tickets-api.service';
import { formatPlanName } from '../../pipes/plan-label.pipe';

/**
 * Formulario para abrir o editar un ticket.
 * Al editar se lee primero el ticket en vivo de WispHub: asi se parte de lo que
 * hay ahora mismo y, si alguien lo cambio mientras tanto, el servidor lo avisa
 * en lugar de pisar su trabajo.
 */
@Component({
  selector: 'app-ticket-form',
  standalone: true,
  imports: [FormsModule, LucideCircleAlert, LucideX],
  template: `
    @if (visible()) {
      <div class="backdrop" (click)="requestClose()">
        <div class="sheet" role="dialog" aria-modal="true" [attr.aria-label]="title()" (click)="$event.stopPropagation()">
          <header>
            <div>
              <h3>{{ title() }}</h3>
              <p>{{ ticketId() ? 'Ticket #' + ticketId() : 'Se creará en WispHub y aparecerá en la lista' }}</p>
            </div>
            <button type="button" class="icon" (click)="requestClose()" aria-label="Cerrar"><svg lucideX size="18"></svg></button>
          </header>

          @if (loading()) {
            <div class="body center"><span class="loader"></span><p>Leyendo el ticket en WispHub…</p></div>
          } @else {
            <div class="body">
              @if (error()) {
                <p class="alert" role="alert"><svg lucideCircleAlert size="16"></svg><span>{{ error() }}</span></p>
              }

              <label>Cliente
                <input list="ticket-clients" [(ngModel)]="clientText" [disabled]="saving()" placeholder="Escribe el nombre del cliente" (input)="error.set('')" />
                <datalist id="ticket-clients">
                  @for (c of clients(); track c.id_servicio) {
                    <option [value]="clientOption(c)"></option>
                  }
                </datalist>
                <small>{{ resolvedClientText() }}</small>
              </label>

              <label>Asunto
                <input list="ticket-subjects" [(ngModel)]="subject" [disabled]="saving()" maxlength="200" placeholder="Ej. No Tiene Internet" />
                <datalist id="ticket-subjects">
                  @for (s of options()?.subjects || []; track s) { <option [value]="s"></option> }
                </datalist>
              </label>

              <div class="row">
                <label>Estado
                  <select [(ngModel)]="state" [disabled]="saving()">
                    @for (s of options()?.states || []; track s.id) { <option [value]="s.id">{{ s.name }}</option> }
                  </select>
                </label>
                <label>Prioridad
                  <select [(ngModel)]="priority" [disabled]="saving()">
                    @for (p of options()?.priorities || []; track p.id) { <option [value]="p.id">{{ p.name }}</option> }
                  </select>
                </label>
              </div>

              <label>Técnico asignado
                <select [(ngModel)]="technicianId" [disabled]="saving()">
                  <option [ngValue]="null">Elige un técnico</option>
                  @for (t of options()?.technicians || []; track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
                </select>
                @if (!(options()?.technicians || []).length) {
                  <small class="warn">No hay técnicos sincronizados. Sincroniza los clientes para poder asignar.</small>
                }
              </label>

              <label>Descripción
                <textarea rows="4" [(ngModel)]="description" [disabled]="saving()" maxlength="5000" placeholder="Qué reporta el cliente y qué se hizo"></textarea>
              </label>
            </div>

            <footer>
              <button type="button" (click)="requestClose()" [disabled]="saving()">Cancelar</button>
              <button type="button" class="primary" (click)="save()" [disabled]="saving()">
                {{ saving() ? 'Guardando…' : ticketId() ? 'Guardar cambios' : 'Crear ticket' }}
              </button>
            </footer>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(15,28,42,.55); }
    .sheet { display: flex; flex-direction: column; width: min(560px, 100%); max-height: 92vh; overflow: hidden; border-radius: 10px; background: #fff; box-shadow: 0 18px 48px rgba(12,26,40,.28); }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid #e3eaf0; }
    header h3 { margin: 0; color: #172c41; font-size: 16px; }
    header p { margin: 3px 0 0; color: #7b8b9b; font-size: 12px; }
    .icon { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid #dde5e0; border-radius: 9px; background: #fff; color: #61768a; cursor: pointer; }
    .icon:hover { background: #f4f8fb; }
    .body { display: grid; gap: 12px; overflow-y: auto; padding: 16px 18px; }
    .body.center { justify-items: center; gap: 10px; padding: 40px; color: #67788a; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    label { display: grid; gap: 6px; color: #2d3b34; font-size: 13px; font-weight: 600; }
    input, select, textarea { box-sizing: border-box; width: 100%; min-height: 42px; padding: 10px; border: 1px solid #cfd8d2; border-radius: 9px; background: #fff; color: #15211c; font: inherit; }
    textarea { min-height: 88px; resize: vertical; }
    label small { color: #8493a1; font-size: 11px; font-weight: 500; }
    label small.warn { color: #9a5b0f; }
    .alert { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 10px 12px; border: 1px solid #f0b4ae; border-radius: 10px; background: #fff3f2; color: #a72f25; font-size: 12px; font-weight: 600; }
    footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 18px; border-top: 1px solid #e3eaf0; background: #fafcfd; }
    footer button { min-height: 42px; padding: 0 16px; border: 1px solid #cfd8d2; border-radius: 9px; background: #fff; color: #15211c; font: inherit; font-weight: 600; cursor: pointer; }
    footer .primary { border-color: #0b6b52; background: #0b6b52; color: #fff; }
    footer .primary:hover:not(:disabled) { background: #08523f; }
    footer button:disabled { opacity: .6; cursor: not-allowed; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #0b6b52; outline-offset: 2px; }
    .loader { width: 26px; height: 26px; border: 3px solid #dce6ed; border-top-color: #2d6da8; border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .loader { animation: none; } }
    @media (max-width: 560px) { .row { grid-template-columns: 1fr; } }
  `],
})
export class TicketFormComponent {
  private api = inject(TicketsApiService);

  visible = input(false);
  /** null = crear un ticket nuevo. */
  ticketId = input<number | null>(null);
  clients = input<WispHubClient[]>([]);
  options = input<TicketOptions | null>(null);

  closed = output<void>();
  saved = output<{ created: boolean; idTicket: number }>();

  loading = signal(false);
  saving = signal(false);
  error = signal('');

  clientText = '';
  subject = '';
  description = '';
  state: number | string = 1;
  priority: number | string = 2;
  technicianId: number | null = null;
  private version = '';

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      const id = this.ticketId();
      this.error.set('');
      if (id) this.loadTicket(id);
      else this.resetForm();
    });
  }

  title(): string {
    return this.ticketId() ? 'Editar ticket' : 'Nuevo ticket';
  }

  clientOption(client: WispHubClient): string {
    return `${client.nombre} · #${client.id_servicio}`;
  }

  /** Devuelve el id del cliente escrito en el campo (acepta el nombre o el "#id"). */
  private resolveClientId(): number | null {
    const text = this.clientText.trim();
    if (!text) return null;
    const byId = text.match(/#(\d+)\s*$/);
    if (byId) return Number(byId[1]);
    const lower = text.toLowerCase();
    const match = this.clients().find((c) => (c.nombre || '').toLowerCase() === lower);
    return match ? match.id_servicio : null;
  }

  resolvedClientText(): string {
    const id = this.resolveClientId();
    if (!this.clientText.trim()) return 'Elige el cliente de la lista.';
    if (!id) return 'Ese cliente no aparece en la lista sincronizada.';
    const match = this.clients().find((c) => c.id_servicio === id);
    return match ? `Servicio #${id} · ${formatPlanName(match.plan_internet?.nombre, 'sin plan')}` : `Servicio #${id}`;
  }

  private resetForm() {
    this.clientText = '';
    this.subject = '';
    this.description = '';
    this.state = 1;
    this.priority = 2;
    this.technicianId = this.options()?.technicians?.[0]?.id ?? null;
    this.version = '';
    this.loading.set(false);
  }

  private loadTicket(id: number) {
    this.loading.set(true);
    this.api.manage(id).subscribe({
      next: (snapshot) => {
        const client = this.clients().find((c) => c.id_servicio === snapshot.client.id);
        this.clientText = client ? this.clientOption(client) : snapshot.client.name || `#${snapshot.client.id ?? ''}`;
        this.subject = snapshot.subject;
        this.description = snapshot.description;
        this.state = snapshot.state ?? 1;
        this.priority = snapshot.priority ?? 2;
        this.technicianId = snapshot.technician.id ?? null;
        this.version = snapshot.version;
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(this.messageOf(e, 'No se pudo leer el ticket en WispHub.'));
      },
    });
  }

  private messageOf(error: unknown, fallback: string): string {
    const body = (error as { error?: { error?: string } })?.error;
    return body?.error || fallback;
  }

  requestClose() {
    if (this.saving()) return;
    this.closed.emit();
  }

  save() {
    const clientId = this.resolveClientId();
    if (!clientId) return this.error.set('Elige un cliente de la lista para continuar.');
    if (this.subject.trim().length < 2) return this.error.set('Escribe el asunto del ticket.');
    if (this.description.trim().length < 3) return this.error.set('Describe brevemente lo que pasa.');
    if (!this.technicianId) return this.error.set('Elige el técnico que atenderá el ticket.');

    const input: TicketInput = {
      clientId,
      subject: this.subject.trim(),
      technicianId: Number(this.technicianId),
      description: this.description.trim(),
      state: Number(this.state),
      priority: Number(this.priority),
    };

    this.saving.set(true);
    this.error.set('');
    const id = this.ticketId();
    const request = id ? this.api.update(id, input, this.version) : this.api.create(input);
    request.subscribe({
      next: (result) => {
        this.saving.set(false);
        this.saved.emit({ created: !id, idTicket: result.ticket.idTicket });
      },
      error: (e) => {
        this.saving.set(false);
        const code = (e as { error?: { code?: string } })?.error?.code;
        if (code === 'STALE_TICKET') {
          this.error.set('Alguien cambió este ticket en WispHub mientras lo editabas. Ciérralo y vuelve a abrirlo para ver la versión nueva.');
          return;
        }
        this.error.set(this.messageOf(e, 'WispHub no confirmó el cambio. Revisa allí antes de reintentar.'));
      },
    });
  }
}
