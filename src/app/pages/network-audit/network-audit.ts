import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideActivity, LucideAlertTriangle, LucideChevronLeft, LucideChevronRight,
  LucideCircleCheck, LucideClock3, LucideDownload, LucideGauge, LucideRefreshCw,
  LucideSearch, LucideServer, LucideSignal, LucideWifi, LucideX,
} from '@lucide/angular';
import { forkJoin } from 'rxjs';
import { NavbarComponent } from '../../components/layout/navbar';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import {
  ClientAuditPage, ClientAuditRow, ClientNetworkSample, NetworkAuditService,
  NetworkAuditStatus, NetworkHealthState, WanAuditResponse,
} from '../../services/network-audit.service';

@Component({
  selector: 'app-network-audit',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, FormsModule, RouterLink, NavbarComponent,
    LucideActivity, LucideAlertTriangle, LucideChevronLeft, LucideChevronRight,
    LucideCircleCheck, LucideClock3, LucideDownload, LucideGauge, LucideRefreshCw,
    LucideSearch, LucideServer, LucideSignal, LucideWifi, LucideX,
  ],
  templateUrl: './network-audit.html',
  styleUrl: './network-audit.scss',
})
export class NetworkAuditComponent implements OnInit {
  private readonly audit = inject(NetworkAuditService);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);

  status = signal<NetworkAuditStatus | null>(null);
  pageData = signal<ClientAuditPage | null>(null);
  wan = signal<WanAuditResponse | null>(null);
  loading = signal(true);
  collecting = signal(false);
  error = signal('');
  view = signal<'clients' | 'wan'>('clients');
  search = signal('');
  state = signal('all');
  days = signal(30);
  page = signal(1);
  pageSize = 50;
  selected = signal<ClientAuditRow | null>(null);
  detail = signal<ClientNetworkSample[]>([]);
  detailLoading = signal(false);

  totalPages = computed(() => this.pageData()?.pages || 1);
  latestWan = computed(() => this.status()?.latestWan || this.wan()?.items?.[0] || null);

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      status: this.audit.status(),
      clients: this.audit.clients({ days: this.days(), q: this.search(), status: this.state(), page: this.page(), pageSize: this.pageSize }),
      wan: this.audit.wan(Math.min(24 * this.days(), 8760), 500),
    }).subscribe({
      next: result => {
        this.status.set(result.status);
        this.pageData.set(result.clients);
        this.wan.set(result.wan);
        this.loading.set(false);
      },
      error: error => {
        this.error.set(error?.error?.error || 'No se pudo cargar la auditoria de red');
        this.loading.set(false);
      },
    });
  }

  applyFilters(): void { this.page.set(1); this.load(); }
  clearFilters(): void { this.search.set(''); this.state.set('all'); this.days.set(30); this.page.set(1); this.load(); }
  setView(view: 'clients' | 'wan'): void { this.view.set(view); }

  changePage(delta: number): void {
    const next = Math.max(1, Math.min(this.totalPages(), this.page() + delta));
    if (next === this.page()) return;
    this.page.set(next);
    this.load();
  }

  collectNow(): void {
    if (this.collecting()) return;
    this.collecting.set(true);
    this.audit.collect().subscribe({
      next: result => {
        this.toast.success(`${result.clientsStored || 0} muestras nuevas guardadas`);
        this.collecting.set(false);
        this.load();
      },
      error: error => {
        this.toast.error(error?.error?.error || 'No se pudo ejecutar la recoleccion');
        this.collecting.set(false);
      },
    });
  }

  openDetail(row: ClientAuditRow): void {
    this.selected.set(row);
    this.detail.set([]);
    this.detailLoading.set(true);
    this.audit.clientDetail(row.idServicio, Math.min(this.days(), 14)).subscribe({
      next: result => { this.detail.set(result.samples); this.detailLoading.set(false); },
      error: () => { this.detailLoading.set(false); this.toast.error('No se pudo cargar el detalle del cliente'); },
    });
  }

  closeDetail(): void { this.selected.set(null); this.detail.set([]); }

  exportCsv(): void {
    const pages = Math.max(1, Math.ceil((this.pageData()?.total || 0) / 200));
    const requests = Array.from({ length: pages }, (_, index) => this.audit.clients({
      days: this.days(), q: this.search(), status: this.state(), page: index + 1, pageSize: 200,
    }));
    forkJoin(requests).subscribe({
      next: results => {
        const rows = results.flatMap(result => result.items);
        const header = ['Cliente','Usuario','IP','Plan','Zona','Estado','Disponibilidad %','Estabilidad %','Promedio bajada Mbps','Pico bajada Mbps','Promedio subida Mbps','Pico subida Mbps','RX promedio dBm','ONU','Muestras','Ultima lectura'];
        const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const lines = [header, ...rows.map(row => [row.name,row.username,row.ip,row.plan,row.zone,row.latestState,row.availabilityPercent,row.stabilityPercent,row.avgDownloadMbps,row.peakDownloadMbps,row.avgUploadMbps,row.peakUploadMbps,row.avgRxPowerDbm,row.onuIndex,row.sampleCount,row.lastCapturedAt])];
        const blob = new Blob(['\ufeff' + lines.map(line => line.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `auditoria-red-${this.days()}d.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
      },
      error: () => this.toast.error('No se pudo exportar la auditoria'),
    });
  }

  stateLabel(state: NetworkHealthState | string): string {
    return ({ stable: 'Estable', degraded: 'Degradado', offline: 'Fuera de linea', unknown: 'Sin datos' } as Record<string, string>)[state] || state;
  }

  opticalLabel(state: string): string {
    return ({ healthy: 'Correcta', strong: 'Muy fuerte', weak: 'Debil', critical: 'Critica', unknown: 'Sin lectura' } as Record<string, string>)[state] || state;
  }

  mbps(bps: number): number { return Number((Number(bps || 0) / 1e6).toFixed(2)); }
  percent(value: number, max: number): number { return max > 0 ? Math.min(100, (value / max) * 100) : 0; }
  issueLabel(value: string | null): string {
    if (!value) return 'Sin incidencias';
    const labels: Record<string, string> = {
      mikrotik_offline: 'MikroTik sin conexion',
      missing_mikrotik: 'sin lectura MikroTik',
      client_offline: 'cliente sin presencia',
      high_utilization: 'uso elevado del plan',
      olt_offline: 'ONU fuera de linea',
      weak_optical_signal: 'senal optica debil',
      critical_optical_signal: 'senal optica critica',
      missing_optical_data: 'sin lectura optica',
    };
    return value.split(',').map(issue => labels[issue.trim()] || issue.trim()).join(', ');
  }
}
