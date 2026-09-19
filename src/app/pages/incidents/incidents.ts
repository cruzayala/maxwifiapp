import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideActivity,
  LucideAlertTriangle,
  LucideChevronLeft,
  LucideChevronRight,
  LucideCircleCheck,
  LucideClock3,
  LucideMessageSquare,
  LucideRefreshCw,
  LucideRotateCcw,
  LucideSearch,
  LucideShieldCheck,
  LucideUserRoundCheck,
  LucideUsers,
  LucideX,
} from '@lucide/angular';
import { forkJoin } from 'rxjs';
import { NavbarComponent } from '../../components/layout/navbar';
import { IncidentStatus, NocIncident, NocSummary, NocService } from '../../services/noc.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-incidents',
  standalone: true,
  imports: [
    FormsModule, RouterLink, NavbarComponent, LucideActivity, LucideAlertTriangle,
    LucideChevronLeft, LucideChevronRight, LucideCircleCheck, LucideClock3,
    LucideMessageSquare, LucideRefreshCw, LucideRotateCcw, LucideSearch,
    LucideShieldCheck, LucideUserRoundCheck, LucideUsers, LucideX,
  ],
  templateUrl: './incidents.html',
  styleUrl: './incidents.scss',
})
export class IncidentsComponent implements OnInit {
  private readonly noc = inject(NocService);
  private readonly toast = inject(ToastService);

  summary = signal<NocSummary | null>(null);
  incidents = signal<NocIncident[]>([]);
  selected = signal<NocIncident | null>(null);
  loading = signal(true);
  evaluating = signal(false);
  actionLoading = signal(false);
  error = signal('');
  status = signal('active');
  severity = signal('');
  search = signal('');
  page = signal(1);
  pageSize = 25;
  total = signal(0);
  lastUpdated = signal<Date | null>(null);

  totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize)));

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      summary: this.noc.summary(),
      incidents: this.noc.incidents({ status: this.status(), severity: this.severity(), q: this.search(), page: this.page(), pageSize: this.pageSize }),
    }).subscribe({
      next: ({ summary, incidents }) => {
        this.summary.set(summary);
        this.incidents.set(incidents.items);
        this.total.set(incidents.total);
        this.lastUpdated.set(new Date());
        this.loading.set(false);
      },
      error: error => {
        this.error.set(error?.error?.error || 'No se pudo cargar el centro NOC');
        this.loading.set(false);
      },
    });
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  clearFilters(): void {
    this.status.set('active');
    this.severity.set('');
    this.search.set('');
    this.page.set(1);
    this.load();
  }

  changePage(delta: number): void {
    const next = Math.min(this.totalPages(), Math.max(1, this.page() + delta));
    if (next === this.page()) return;
    this.page.set(next);
    this.load();
  }

  evaluate(): void {
    if (this.evaluating()) return;
    this.evaluating.set(true);
    this.noc.evaluate().subscribe({
      next: result => {
        this.evaluating.set(false);
        this.toast.success(`Evaluacion completa: ${result.created} nuevos, ${result.resolved} recuperados`);
        this.load();
      },
      error: error => {
        this.evaluating.set(false);
        this.toast.error(error?.error?.error || 'No se pudo evaluar la red');
      },
    });
  }

  open(incident: NocIncident): void {
    this.selected.set(incident);
    this.noc.detail(incident.id).subscribe({
      next: detail => this.selected.set(detail),
      error: () => this.toast.error('No se pudo cargar el detalle del incidente'),
    });
  }

  close(): void {
    this.selected.set(null);
  }

  acknowledge(): void {
    this.runAction('acknowledge');
  }

  assign(): void {
    const current = this.selected();
    if (!current) return;
    const assignedTo = prompt('Responsable del incidente', current.assignedTo || '')?.trim();
    if (assignedTo === undefined) return;
    this.runAction('assign', { assignedTo });
  }

  addNote(): void {
    const note = prompt('Nota operativa')?.trim();
    if (!note) return;
    this.runAction('note', { note });
  }

  resolve(): void {
    const note = prompt('Detalle de la solucion aplicada')?.trim();
    if (note === undefined) return;
    this.runAction('resolve', { note });
  }

  reopen(): void {
    this.runAction('reopen');
  }

  severityLabel(value: string): string {
    return { critical: 'Critico', high: 'Alto', medium: 'Medio', low: 'Bajo' }[value] || value;
  }

  statusLabel(value: IncidentStatus): string {
    return { open: 'Abierto', acknowledged: 'Reconocido', resolved: 'Resuelto' }[value];
  }

  scopeLabel(value: string): string {
    return { network: 'Red', zone: 'Zona', interface: 'Interfaz', router: 'Router' }[value] || value;
  }

  formatDate(value?: string | null): string {
    if (!value) return '-';
    return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  age(value: string): string {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Hace ${hours} h`;
    return `Hace ${Math.floor(hours / 24)} d`;
  }

  displayName(client: { aliasNombre?: string | null; nombre: string }): string {
    return client.aliasNombre || client.nombre;
  }

  private runAction(action: 'acknowledge' | 'resolve' | 'reopen' | 'assign' | 'note', data: { note?: string; assignedTo?: string } = {}): void {
    const incident = this.selected();
    if (!incident || this.actionLoading()) return;
    this.actionLoading.set(true);
    this.noc.action(incident.id, action, data).subscribe({
      next: updated => {
        this.actionLoading.set(false);
        this.selected.set({ ...incident, ...updated });
        this.toast.success('Incidente actualizado');
        this.load();
        this.open({ ...incident, ...updated });
      },
      error: error => {
        this.actionLoading.set(false);
        this.toast.error(error?.error?.error || 'No se pudo actualizar el incidente');
      },
    });
  }
}
